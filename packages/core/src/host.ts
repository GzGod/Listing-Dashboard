import type { Redis } from "ioredis";
import { makeModuleRedis } from "./redis.js";
import Fastify, { type FastifyInstance } from "fastify";
import type { PrismaClient } from "@app/db";
import type { MenuItem, ModuleInfo } from "@app/shared";
import { EventBus, JOBS_QUEUE, redisConnection, jobOpts, staticCfg } from "./event-bus.js";
import { ConfigCenter } from "./config.js";
import { registerUserRoutes } from "./users.js";
import { Worker } from "bullmq";
import { Services } from "./services.js";
import { makeLogger } from "./logger.js";
import { discoverModules, resolveOrder } from "./loader.js";
import { Auth, Permissions } from "./auth.js";
import { makeAudit } from "./audit.js";
import { applyModuleMigrations, waitModuleMigrations, makeModuleDb } from "./db.js";
import { AppError } from "./errors.js";
import { CORE_VERSION, type ModuleContext, type ModuleRecord } from "./types.js";

export interface HostOptions {
  role: "server" | "worker";
  app?: FastifyInstance;          // server 角色必填
  db: PrismaClient;
  modulesDir: string;
  disabled?: string[];
  bus?: EventBus;
}

/** 模块宿主：发现 → 校验/排序 → 迁移 → register → start。单个模块出错只影响它自己和依赖它的模块。 */
export class ModuleHost {
  readonly bus: EventBus;
  readonly services = new Services();
  readonly perms = new Permissions();
  readonly auth: Auth;
  readonly config: ConfigCenter;
  records: ModuleRecord[] = [];
  private ctxs = new Map<string, ModuleContext>();
  private timers: NodeJS.Timeout[] = [];
  private log = makeLogger("host");
  constructor(private opts: HostOptions) { this.bus = opts.bus ?? new EventBus(); this.auth = new Auth(opts.db, this.perms); this.config = new ConfigCenter(opts.db); }

  get(name: string) { return this.records.find((r) => r.manifest.name === name); }
  ctx(name: string) { return this.ctxs.get(name); }

  async boot() {
    this.records = resolveOrder(await discoverModules(this.opts.modulesDir, this.opts.disabled));
    this.perms.addFromModules(this.records.filter((r) => r.status === "loaded"));
    for (const r of this.records) if (r.status === "loaded") this.config.addModuleDefaults(r.manifest.config ?? []);
    if (this.opts.role === "server") {
      for (const r of this.records) if (r.status === "loaded") {
        try { await applyModuleMigrations(this.opts.db, r, this.log); }
        catch (e) { r.status = "failed"; r.error = `迁移失败: ${(e as Error).message}`; }
      }
    } else {
      // worker 不跑迁移，等 server 跑完（避免两边同时迁移、或 worker 先启动读到不存在的表）
      const [timeout, poll] = [await this.config.get("modules.migrationWaitTimeoutMs"), await this.config.get("modules.migrationPollMs")];
      await Promise.all(this.records.filter((r) => r.status === "loaded").map(async (r) => {
        try { await waitModuleMigrations(this.opts.db, r, timeout, poll); }
        catch (e) { r.status = "failed"; r.error = (e as Error).message; this.log.error(`${r.manifest.name}: ${r.error}`); }
      }));
    }
    this.bus.setSubscribers(this.records);
    for (const r of this.records) if (r.status === "loaded") await this.register(r);
    for (const r of this.records) if (r.status === "loaded") await this.start(r);
    if (this.opts.role === "server") { this.registerCoreRoutes(); this.startHealthChecks(); }
    this.printSummary();
  }

  private depBroken(r: ModuleRecord) {
    for (const dep of r.manifest.dependsOn ?? []) { const d = this.get(dep); if (!d || d.status === "failed" || d.status === "skipped") return dep; }
  }

  private async register(r: ModuleRecord) {
    const m = r.manifest;
    const broken = this.depBroken(r);
    if (broken) { r.status = "skipped"; r.error = `依赖 ${broken} 不可用`; return; }
    try {
      const mount = async (router: FastifyInstance) => {
        const ctx = this.makeCtx(r, router);
        this.ctxs.set(m.name, ctx);
        if (m.kind === "external") { if (this.opts.role === "server") this.mountExternal(r, router); }
        else await m.register?.(ctx);
      };
      if (this.opts.role === "server") await this.opts.app!.register(mount, { prefix: `/api/${m.name}` });
      else { const scratch = Fastify(); await mount(scratch); } // worker 不对外提供路由，但让 register 里的 ctx.events.on 生效
    } catch (e) { r.status = "failed"; r.error = (e as Error).message; this.log.error(`模块 ${m.name} 注册失败`, r.error); }
  }

  private async start(r: ModuleRecord) {
    try { await r.manifest.start?.(this.ctxs.get(r.manifest.name)!); r.status = "started"; }
    catch (e) { r.status = "failed"; r.error = (e as Error).message; this.log.error(`模块 ${r.manifest.name} 启动失败`, r.error); }
  }

  async shutdown() {
    this.timers.forEach(clearInterval);
    for (const r of [...this.records].reverse()) if (r.status === "started") { try { await r.manifest.stop?.(this.ctxs.get(r.manifest.name)!); } catch { /* 忽略 */ } }
    await this.bus.close();
    for (const c of this.redisConns.values()) c.disconnect();
  }

  private redisConns = new Map<string, Redis>();
  /** 每个模块一条底座管理的连接（ioredis keyPrefix 是连接级的），懒连接；Redis 不可用时命令快速失败，错误只落在该模块 */
  private moduleRedis(name: string, log: { warn: (...a: any[]) => void }): Redis {
    let c = this.redisConns.get(name);
    if (!c) { c = makeModuleRedis(name, log); this.redisConns.set(name, c); }
    return c;
  }

  private makeCtx(r: ModuleRecord, router: FastifyInstance): ModuleContext {
    const name = r.manifest.name;
    const envPrefix = `MOD_${name.toUpperCase().replace(/-/g, "_")}_`;
    const log = makeLogger(name);
    const db = this.opts.db;
    // 每个处理函数包一层：模块代码出错只记日志 + 统一错误格式，不影响别的模块
    const isolatedRouter = router;
    isolatedRouter.addHook("onError", async (_req, _reply, err) => log.error("接口出错", err.message));
    return {
      name, role: this.opts.role, log, router: isolatedRouter, services: this.services,
      config: {
        get: ((k: string, fb?: unknown) => this.config.get(k, fb)) as ModuleContext["config"]["get"],
        env: (k, fb) => process.env[envPrefix + k] ?? fb,
        scoreParams: (date) => this.config.scoreParams(date),
        kolTiers: (date) => this.config.kolTiers(date),
      },
      events: {
        emit: async (e: string, p: unknown) => { await this.bus.emit(e, p, name); },
        on: (e: string, fn: any) => {
          if (!(r.manifest.subscribes ?? []).includes(e)) log.warn(`on("${e}") 但 manifest.subscribes 没有声明，收不到`);
          this.bus.on(e, name, fn);
        },
      },
      redis: this.moduleRedis(name, log),
      db: makeModuleDb(db, name, r.manifest.tables?.writes ?? []),
      audit: makeAudit(db, name),
      requirePermission: (perm) => this.auth.require(perm),
    };
  }

  /** 外部服务模块：代理 HTTP（带超时），定时健康检查，失败标记 unavailable */
  private mountExternal(r: ModuleRecord, router: FastifyInstance) {
    const ext = r.manifest.external!;
    const base = ext.baseUrl.replace(/\/$/, "");
    router.all("/*", async (req, reply) => {
      if (r.status === "unavailable") throw new AppError(503, "MODULE_UNAVAILABLE", `外部模块 ${r.manifest.name} 暂不可用：${r.error ?? ""}`);
      const sub = (req.params as any)["*"] ?? "";
      const qs = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
      let res: Response;
      try {
        res = await fetch(`${base}/${sub}${qs}`, {
          method: req.method, signal: AbortSignal.timeout(ext.timeoutMs ?? await this.config.get("external.timeoutMs")),
          headers: { "content-type": "application/json", "x-user-id": String(req.user?.id ?? ""), "x-user-role": req.user?.role ?? "" },
          body: ["GET", "HEAD"].includes(req.method) ? undefined : JSON.stringify(req.body ?? {}),
        });
      } catch (e) {
        const timeout = (e as Error).name === "TimeoutError";
        throw new AppError(timeout ? 504 : 502, timeout ? "MODULE_TIMEOUT" : "MODULE_UNREACHABLE", `外部模块 ${r.manifest.name} ${timeout ? "超时" : "不可达"}`);
      }
      reply.code(res.status).header("content-type", res.headers.get("content-type") ?? "application/json");
      return Buffer.from(await res.arrayBuffer());
    });
  }
  private startHealthChecks() {
    const check = async () => {
      for (const r of this.records) {
        if (r.manifest.kind !== "external" || !["started", "unavailable"].includes(r.status)) continue;
        const url = r.manifest.external!.baseUrl.replace(/\/$/, "") + (r.manifest.external!.health ?? "/health");
        try {
          const res = await fetch(url, { signal: AbortSignal.timeout(await this.config.get("external.healthTimeoutMs")) });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          if (r.status === "unavailable") this.log.info(`外部模块 ${r.manifest.name} 恢复`);
          r.status = "started"; r.error = undefined;
        } catch (e) {
          if (r.status !== "unavailable") this.log.warn(`外部模块 ${r.manifest.name} 健康检查失败，标记不可用`, (e as Error).message);
          r.status = "unavailable"; r.error = `健康检查失败: ${(e as Error).message}`;
        }
      }
    };
    void check();
    this.timers.push(setInterval(check, staticCfg("external.healthIntervalMs")));
  }

  private registerCoreRoutes() {
    const app = this.opts.app!;
    const info = (r: ModuleRecord): ModuleInfo & Record<string, unknown> => ({
      id: r.manifest.name, name: r.manifest.displayName ?? r.manifest.name, version: r.manifest.version, apiVersion: r.manifest.apiVersion,
      kind: r.manifest.kind ?? "internal", status: r.status, error: r.error, dependsOn: r.manifest.dependsOn ?? [],
      subscribes: r.manifest.subscribes ?? [], emits: r.manifest.emits ?? [], tables: r.manifest.tables ?? {}, apis: r.manifest.apis ?? [],
      jobs: (r.manifest.jobs ?? []).map((j) => ({ name: j.name, cron: j.cron })),
    });
    app.get("/api/_core/health", async () => ({ ok: true, core: CORE_VERSION }));
    app.get("/api/_core/modules", async () => ({ core: CORE_VERSION, modules: this.records.map(info), services: this.services.names(), events: this.bus.listEvents() }));
    // 前后台外壳据此生成菜单：模块加页面不用改外壳代码
    app.get("/api/_core/menu", async (req): Promise<MenuItem[]> => this.records
      .filter((r) => r.status === "started" || r.status === "unavailable")
      .flatMap((r) => ([["front", r.manifest.frontRoutes], ["admin", r.manifest.adminMenu]] as const).flatMap(([area, items]) => (items ?? []).map((p) => ({
        module: r.manifest.name, area, path: p.path, title: p.title, permission: p.permission, hidden: !!p.hidden || p.path.includes(":"),
        kind: r.manifest.kind ?? "internal", available: r.status === "started",
        ...(p.url ? { url: `/api/${r.manifest.name}/${p.url.replace(/^\//, "")}` } : {}),
      }))))
      .filter((m) => (m.area === "front" || this.perms.has(req.user!.role, "admin:access")) && (!m.permission || this.perms.has(req.user!.role, m.permission))));
    // 外部模块发事件：POST /api/_core/events  头 x-module-name + x-module-token
    app.post("/api/_core/events", async (req) => {
      const from = String(req.headers["x-module-name"] ?? "");
      if (process.env.MODULE_TOKEN && req.headers["x-module-token"] !== process.env.MODULE_TOKEN) throw new AppError(401, "UNAUTHORIZED", "x-module-token 不对");
      const r = this.get(from);
      if (!r || r.manifest.kind !== "external" || !(r.manifest.emits ?? []).includes((req.body as any)?.event))
        throw new AppError(403, "FORBIDDEN", "只有在 manifest.emits 里声明过该事件的外部模块才能发");
      const { event, payload } = req.body as any;
      return this.bus.emit(event, payload, from);
    });
    app.post("/api/_core/jobs/:module/:job/run", { preHandler: this.auth.require("admin:access") }, async (req) => {
      const { module, job } = req.params as any;
      const r = this.get(module);
      if (!r || !r.manifest.jobs?.some((j) => j.name === job)) throw new AppError(404, "NOT_FOUND", "job 不存在");
      const j = await this.bus.queue(JOBS_QUEUE).add(`${module}:${job}`, { module, job, data: req.body ?? null, manual: true }, jobOpts());
      return { queued: true, jobId: j.id };
    });
    app.get("/api/_core/dead-letter", { preHandler: this.auth.require("admin:access") }, async () => {
      const jobs = await this.bus.queue(staticCfg("queue.deadLetterQueue")).getJobs(["waiting", "completed", "delayed"], 0, 100);
      return jobs.map((j) => ({ id: j.id, name: j.name, ...j.data }));
    });
    // 配置中心：查看全部配置（默认值 / 库里的值 / 环境变量 / 生效值），admin 可改库里的值（写审计）
    app.get("/api/_core/config/public", async () => this.config.publicConfig());
    app.get("/api/_core/config", { preHandler: this.auth.require("admin:access") }, async () => this.config.all());
    app.put("/api/_core/config/:key", { preHandler: this.auth.require("config:write") }, async (req) => {
      const { key } = req.params as any; const before = await this.config.get(key); const value = (req.body as any)?.value;
      await this.config.set(key, value, req.user!.id);
      await makeAudit(this.opts.db, "_core")({ action: "config.set", table: "system_config", recordId: key, before, after: value, actorId: req.user!.id });
      return { key, value };
    });
    registerUserRoutes(app, this.opts.db, this.auth);
    app.get("/api/_core/audit", { preHandler: this.auth.require("admin:access") }, async () =>
      (await this.opts.db.auditLog.findMany({ orderBy: { id: "desc" }, take: 100 })).map((a) => ({ ...a, id: a.id.toString() })));
  }

  /** worker 角色：事件消费者 + 定时任务调度（BullMQ Job Scheduler，cron 按 UTC） */
  async startWorker(deliverExternal: (r: ModuleRecord, env: any) => Promise<void>) {
    this.bus.startConsumers(this.records, deliverExternal);
    const q = this.bus.queue(JOBS_QUEUE);
    const wanted = new Set<string>();
    for (const r of this.records) {
      if (!["started", "unavailable"].includes(r.status)) continue;
      for (const j of r.manifest.jobs ?? []) {
        const cron = j.cronKey ? await this.config.get<string>(j.cronKey) : j.cron;
        if (!cron) continue;
        const id = `${r.manifest.name}:${j.name}`; wanted.add(id);
        await q.upsertJobScheduler(id, { pattern: cron, tz: await this.config.get("time.dayCutTimezone") }, { name: id, data: { module: r.manifest.name, job: j.name, data: null },
          opts: jobOpts() });
      }
    }
    // 模块被删 / 改了 cron：清掉旧的调度
    for (const s of await q.getJobSchedulers()) if (s.key && !wanted.has(s.key)) await q.removeJobScheduler(s.key);
    const w = new Worker(JOBS_QUEUE, async (job) => {
      const { module, job: name, data } = job.data;
      const r = this.get(module);
      const spec = r?.manifest.jobs?.find((j) => j.name === name);
      if (!r || !spec || !["started", "unavailable"].includes(r.status)) throw new Error(`job ${module}:${name} 不可用`);
      if (r.manifest.kind === "external") {
        const res = await fetch(`${r.manifest.external!.baseUrl.replace(/\/$/, "")}/_jobs/${name}`, { method: "POST", signal: AbortSignal.timeout(r.manifest.external!.timeoutMs ?? await this.config.get("external.timeoutMs")), headers: { "content-type": "application/json" }, body: JSON.stringify({ data }) });
        if (!res.ok) throw new Error(`外部 job 返回 HTTP ${res.status}`);
      } else await spec.run!(this.ctxs.get(module)!, data);
      this.log.info(`job 完成 ${module}:${name}`);
    }, { connection: redisConnection(), concurrency: staticCfg("queue.concurrency") });
    this.bus.attachDeadLetter(w);
    this.log.info(`已注册定时任务: ${[...wanted].join(", ") || "无"}`);
    return w;
  }

  private printSummary() {
    for (const r of this.records) this.log.info(`[${this.opts.role}] ${r.status.padEnd(9)} ${r.manifest.name}@${r.manifest.version}${r.error ? "  <- " + r.error : ""}`);
  }
}
