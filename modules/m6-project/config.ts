/**
 * Single source of every M6 tunable. Loaded through a ConfigProvider so the 底座's unified config
 * (MODULE_GUIDE.md, `ctx.config` / MOD_M6_PROJECT_*) can replace `staticConfigProvider` later.
 */
import { isValidTimeZone, referenceDay } from './lib/day.js';
import type { ApiListingStage, ProjectParamRules } from './schema/index.js';

export const MODULE_ID = 'm6-project';

export interface M6Config extends ProjectParamRules {
  /** range key -> days, e.g. { '7d': 7 } (daily granularity only) */
  ranges: Readonly<Record<string, number>>;
  defaultSeriesRange: string;
  defaultPostsRange: string;
  postsPageSize: number;
  postsMaxPageSize: number;
  /** IANA zone where days are cut (base key time.dayCutTimezone, default 'UTC') */
  dayCutTimezone: string;
  /** "latest" day = reference day + offset (−1 => most recent complete UTC day) */
  defaultDateOffsetDays: number;
  labels: { noData: string; partialData: string; stage: Record<ApiListingStage, string> };
  stageColors: Record<ApiListingStage, string>;
  /** display-only secondary timezone offset (北京时间) */
  displayTzOffsetHours: number;
}

export const defaultM6Config: M6Config = {
  ranges: { '7d': 7, '30d': 30, '90d': 90 },
  defaultSeriesRange: '90d',
  defaultPostsRange: '30d',
  postsPageSize: 20,
  postsMaxPageSize: 50,
  dayCutTimezone: 'UTC',
  defaultDateOffsetDays: -1,
  labels: { noData: '暂无数据', partialData: '数据不全', stage: { teaser: '预告', spot: '现货', perp: '合约' } },
  stageColors: { teaser: '#f59e0b', spot: '#10b981', perp: '#8b5cf6' },
  displayTzOffsetHours: 8,
};

export interface ConfigProvider<T> { get(): T }
export function staticConfigProvider(overrides: Partial<M6Config> = {}): ConfigProvider<M6Config> {
  const cfg: M6Config = { ...defaultM6Config, ...overrides, labels: { ...defaultM6Config.labels, ...overrides.labels } };
  if (!isValidTimeZone(cfg.dayCutTimezone)) throw new Error(`[${MODULE_ID}] unknown time zone ${cfg.dayCutTimezone}`);
  for (const k of [cfg.defaultSeriesRange, cfg.defaultPostsRange]) if (!(k in cfg.ranges)) throw new Error(`[${MODULE_ID}] default range ${k} not in ranges`);
  return { get: () => cfg };
}
export const latestDay = (cfg: M6Config, now: Date = new Date()) => referenceDay(now, cfg.dayCutTimezone, cfg.defaultDateOffsetDays);

/**
 * Our field -> base config key. Shared keys from base CONFIG_DEFAULTS; module keys start with the module id and are
 * declared in module.manifest.ts `config` as an ARRAY [{key, default, description}] (base ModuleConfigSpec).
 */
type Field = keyof M6Config;
export const M6_CONFIG_SPEC: { field: Field; key: string; description: string }[] = [
  { field: 'postsPageSize', key: 'pagination.defaultPageSize', description: '默认分页大小' },
  { field: 'defaultDateOffsetDays', key: 'ranking.defaultDateOffsetDays', description: '"最新"日期偏移（-1=最近完整日）' },
  { field: 'dayCutTimezone', key: 'time.dayCutTimezone', description: '切日时区（IANA）' },
  { field: 'postsMaxPageSize', key: 'm6-project.postsMaxPageSize', description: 'KOL 发帖列表单页上限' },
  { field: 'ranges', key: 'm6-project.ranges', description: '联动图/发帖可选区间（key -> 天数）' },
  { field: 'defaultSeriesRange', key: 'm6-project.defaultSeriesRange', description: '联动图默认区间' },
  { field: 'defaultPostsRange', key: 'm6-project.defaultPostsRange', description: '发帖列表默认区间' },
  { field: 'displayTzOffsetHours', key: 'm6-project.displayTzOffsetHours', description: '辅助显示时区偏移（北京时间=8）' },
  { field: 'labels', key: 'm6-project.labels', description: '前台文案：暂无数据 / 数据不全 / 上币阶段名' },
  { field: 'stageColors', key: 'm6-project.stageColors', description: '上币阶段颜色' },
];
export const M6_CONFIG_KEYS = Object.fromEntries(M6_CONFIG_SPEC.map((c) => [c.field, c.key])) as Record<Field, string>;
export const m6ManifestConfig = () => M6_CONFIG_SPEC.filter((c) => c.key.startsWith(`${MODULE_ID}.`))
  .map((c) => ({ key: c.key, default: defaultM6Config[c.field], description: c.description }));

export interface BaseConfigReader { get<T = unknown>(key: string, fallback?: T): Promise<T> }
export async function loadM6ConfigFromBase(reader: BaseConfigReader): Promise<ConfigProvider<M6Config>> {
  const out: Record<string, unknown> = {};
  for (const c of M6_CONFIG_SPEC) out[c.field] = await reader.get(c.key, defaultM6Config[c.field]);
  return staticConfigProvider(out as Partial<M6Config>);
}
