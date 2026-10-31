import { Queue, Worker, type Job, type ConnectionOptions } from "bullmq";
import { randomUUID } from "node:crypto";
import type { EventMeta } from "@app/shared";
import { makeLogger } from "./logger.js";
import { CONFIG_DEFAULTS, configEnvName } from "@app/shared";
import type { Handler, ModuleRecord } from "./types.js";

export const moduleQueue = (name: string) => `mod.${name}`;
export const JOBS_QUEUE = "jobs";
/** 启动期参数：env CONFIG_* > 默认值（运行期可变参数请用 ConfigCenter） */
export function staticCfg<K extends keyof typeof CONFIG_DEFAULTS>(k: K): (typeof CONFIG_DEFAULTS)[K] {
  const raw = process.env[configEnvName(k)]; if (raw === undefined) return CONFIG_DEFAULTS[k];
  try { return JSON.parse(raw); } catch { return raw as any; }
}
export const DEAD_LETTER_QUEUE = staticCfg("queue.deadLetterQueue");
export const jobOpts = () => ({ attempts: staticCfg("queue.attempts"), backoff: { type: staticCfg("queue.backoffType"), delay: staticCfg("queue.backoffDelayMs") },
  removeOnComplete: staticCfg("queue.keepCompleted"), removeOnFail: staticCfg("queue.keepFailed") });
export function redisConnection(): ConnectionOptions {
  const u = new URL(process.env.REDIS_URL ?? "redis://localhost:6379");
  return { host: u.hostname, port: Number(u.port || 6379), password: u.password || undefined, maxRetriesPerRequest: null };
}

/**
 * BullMQ 事件总线。对模块暴露的接口和 v1 进程内总线一样：emit / on。
 * - emit：按各模块 manifest.subscribes 扇出，每个订阅模块一条队列 mod.<name>，互不影响。
 * - on：登记处理函数；真正消费在 worker 进程（apps/worker），失败自动重试（指数退避），
 *   重试用尽后进入 dead-letter 队列。
 */
export class EventBus {
  private handlers = new Map<string, Map<string, Handler>>(); // module -> event -> handler
  private subs = new Map<string, string[]>();                 // event -> modules
  private queues = new Map<string, Queue>();
  private workers: Worker[] = [];
  private log = makeLogger("events");
  constructor(private conn: ConnectionOptions = redisConnection()) {}

  setSubscribers(records: ModuleRecord[]) {
    this.subs.clear();
    for (const r of records) if (r.status === "loaded" || r.status === "started" || r.status === "unavailable")
      for (const ev of r.manifest.subscribes ?? []) this.subs.set(ev, [...(this.subs.get(ev) ?? []), r.manifest.name]);
  }
  queue(name: string) { let q = this.queues.get(name); if (!q) { q = new Queue(name, { connection: this.conn }); this.queues.set(name, q); } return q; }

  async emit(event: string, payload: unknown, from = "core") {
    const meta: EventMeta = { event, from, at: new Date().toISOString(), id: randomUUID() };
    const targets = [...(this.subs.get(event) ?? []), ...(this.subs.get("*") ?? [])];
    await Promise.all(targets.map((m) => this.queue(moduleQueue(m)).add(event, { ...meta, payload }, jobOpts())));
    this.log.info(`emit ${event} from ${from} -> [${targets.join(", ")}]`);
    return { id: meta.id, deliveredTo: targets };
  }
  on(event: string, owner: string, fn: Handler) {
    const m = this.handlers.get(owner) ?? new Map(); m.set(event, fn); this.handlers.set(owner, m);
  }
  listEvents() { return [...this.subs.entries()].map(([event, subscribers]) => ({ event, subscribers })); }

  /** worker 进程：为每个订阅模块起一个消费者。external 用 deliver 投递（http）；transport=redis 的外部模块自己消费 */
  startConsumers(records: ModuleRecord[], deliverExternal: (r: ModuleRecord, env: any) => Promise<void>) {
    for (const r of records) {
      if (!(r.manifest.subscribes?.length) || !["started", "loaded", "unavailable"].includes(r.status)) continue;
      if (r.manifest.kind === "external" && r.manifest.external?.transport === "redis") continue;
      const name = r.manifest.name;
      const w = new Worker(moduleQueue(name), async (job: Job) => {
        if (r.manifest.kind === "external") return deliverExternal(r, job.data);
        const h = this.handlers.get(name)?.get(job.name) ?? this.handlers.get(name)?.get("*");
        if (!h) throw new Error(`模块 ${name} 声明订阅了 ${job.name} 但没有调用 ctx.events.on 注册处理函数`);
        const { payload, ...meta } = job.data; await h(payload, meta);
      }, { connection: this.conn, concurrency: staticCfg("queue.concurrency") });
      this.attachDeadLetter(w);
    }
  }
  attachDeadLetter(w: Worker) {
    w.on("failed", async (job, err) => {
      if (!job) return;
      this.log.warn(`${w.name} 任务失败 ${job.name} 第 ${job.attemptsMade}/${job.opts.attempts ?? 1} 次: ${err.message}`);
      if (job.attemptsMade >= (job.opts.attempts ?? 1))
        await this.queue(DEAD_LETTER_QUEUE).add(job.name, { queue: w.name, jobId: job.id, data: job.data, error: err.message, failedAt: new Date().toISOString() });
    });
    if (!this.workers.includes(w)) this.workers.push(w);
  }
  async close() { await Promise.all([...this.workers.map((w) => w.close()), ...[...this.queues.values()].map((q) => q.close())]); }
}
