import type { Redis } from "ioredis";
import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import type { PrismaClient } from "@app/db";
import type { ConfigKey, ConfigValue, EventMap, EventMeta, ScoreParams, KolTierSet } from "@app/shared";
import type { Logger } from "./logger.js";

/** 底座版本（semver）。模块用 requires.core 声明兼容范围，例如 "^1.0.0" */
export const CORE_VERSION = "1.1.0";
/** manifest 规范版本。规范有不兼容变更时才 +1 */
export const MANIFEST_API_VERSION = 1;

export interface MenuSpec {
  path: string;            // 模块内路径，例如 "/"、"/items"，支持动态段 "/items/:id"（不进菜单，页面组件通过 props.params 拿参数）；最终 URL：前台 /m/<name><path>，后台 /admin/m/<name><path>
  title: string;           // 菜单名
  component?: string;      // 代码内模块：页面组件文件（相对模块目录），默认导出 React 组件
  url?: string;            // 外部服务模块：页面地址（相对模块 baseUrl），后台用 iframe 打开
  permission?: string;     // 看到这个菜单/页面需要的权限
  hidden?: boolean;        // true = 能访问但不进菜单（详情页等）；带 :参数 的路由自动视为 hidden
}
export interface JobSpec {
  name: string;
  cron?: string;           // 固定 cron（5 段，按 time.dayCutTimezone）。推荐用 cronKey，别写死
  cronKey?: string;        // 从配置中心读 cron 的键，例如 "m3-engine.dailyCron"（在 manifest.config 里给默认值）。优先于 cron
  run?: (ctx: ModuleContext, data?: unknown) => Promise<void>; // 外部模块不填，底座 POST <baseUrl>/_jobs/<name>
}
export interface ApiSpec { method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"; path: string; permission?: string; description?: string }

/** 模块描述文件 module.manifest.ts（或外部服务用 module.manifest.json）的格式 */
export interface ModuleManifest {
  apiVersion: 1;
  name: string;                       // 小写字母/数字/短横线；接口挂在 /api/<name>，自有表前缀 m_<name 中 - 换成 _>_
  version: string;                    // 模块自己的语义化版本
  displayName?: string;
  description?: string;
  requires?: { core?: string };       // 兼容的底座版本范围
  dependsOn?: string[];               // 依赖的其他模块（只能调它的公开接口/service）
  kind?: "internal" | "external";
  external?: {
    baseUrl: string;                  // 支持 ${ENV_VAR} 占位
    health?: string;                  // 健康检查路径，默认 /health
    transport?: "http" | "redis";     // 事件投递方式：http = POST <baseUrl>/_events；redis = 自己消费 BullMQ 队列 mod.<name>
    timeoutMs?: number;
  };
  tables?: { reads?: string[]; writes?: string[]; owns?: string[] }; // reads：读哪些表（任何核心表都可读）；writes：要写的核心表/列（必须归本模块所有，见 ownership.ts）；owns：自有表（m_<name>_ 前缀）
  apis?: ApiSpec[];                   // 对外暴露的接口（文档 + 权限）
  subscribes?: (keyof EventMap | string)[];
  emits?: (keyof EventMap | string)[];
  adminMenu?: MenuSpec[];
  frontRoutes?: MenuSpec[];
  permissions?: { key: string; description?: string; roles: ("admin" | "editor" | "viewer")[] }[];
  jobs?: JobSpec[];
  migrations?: string;                // 迁移目录，默认 "migrations"，里面是按文件名排序执行的 *.sql
  /** 本模块自己的配置键。key 必须以 "<模块名>." 开头，不能和底座或其他模块的键重复；public: true 的键会出现在 /api/_core/config/public（前端可读，别放密钥） */
  config?: ModuleConfigSpec[];
  provides?: string[];
  register?: (ctx: ModuleContext) => void | Promise<void>;
  start?: (ctx: ModuleContext) => void | Promise<void>;
  stop?: (ctx: ModuleContext) => void | Promise<void>;
}

export interface ModuleConfigSpec { key: string; default: unknown; description?: string; public?: boolean }
export type Handler<P = any> = (payload: P, meta: EventMeta) => void | Promise<void>;
export interface ModuleEvents {
  emit<E extends keyof EventMap>(event: E, payload: EventMap[E]): Promise<void>;
  emit(event: string, payload: unknown): Promise<void>;
  on<E extends keyof EventMap>(event: E, fn: Handler<EventMap[E]>): void;
  on(event: string, fn: Handler): void;
}
export interface AuditEntry { action: string; table?: string; recordId?: string | number; before?: unknown; after?: unknown; actorId?: number | null }
export interface ModuleDb {
  /** Prisma 客户端（已加作用域）：任何核心表都能读；只能写 manifest.tables.writes 里声明且归本模块所有的表/列 */
  core: PrismaClient;
  /** 自有表名：t("items") -> "m_example_items" */
  t(short: string): string;
  /** 在自有表上执行 SQL（$1 参数）。写操作目标不是自有表会直接报错 */
  query<T = any>(sql: string, ...params: unknown[]): Promise<T[]>;
}
export interface ModuleContext {
  name: string;
  role: "server" | "worker";
  /** 配置中心（禁止在代码里写死可变参数）。get：env CONFIG_* > system_config 表 > 默认值；env：本模块私有环境变量 MOD_<NAME>_<KEY>（密钥等） */
  config: {
    get<K extends ConfigKey>(key: K): Promise<ConfigValue<K>>;
    get<T = unknown>(key: string, fallback?: T): Promise<T>;
    env(key: string, fallback?: string): string | undefined;
    scoreParams(date?: string): Promise<ScoreParams | null>;
    kolTiers(date?: string): Promise<KolTierSet | null>;
  };
  log: Logger;
  events: ModuleEvents;
  router: FastifyInstance;            // 已带 /api/<name> 前缀，server 进程里才有路由
  services: ServiceRegistry;
  db: ModuleDb;
  /** 底座为本模块单独管理的一条 Redis 连接（每个模块一条，不共用；来自核心 REDIS_URL），所有 key 自动加前缀 m:<模块名>:；Redis 挂了只会让本模块的调用报错 */
  redis: Redis;
  audit(entry: AuditEntry): Promise<void>;
  requirePermission(perm: string): preHandlerHookHandler;
}
export interface ServiceRegistry { provide<T>(name: string, impl: T): void; get<T>(name: string): T; has(name: string): boolean }

export type ModuleStatus = "loaded" | "started" | "failed" | "skipped" | "unavailable";
export interface ModuleRecord { manifest: ModuleManifest; dir: string; status: ModuleStatus; error?: string }
