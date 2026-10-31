/**
 * Single source of every M5 tunable, loaded through a ConfigProvider.
 * Base mapping (provisional MODULE_GUIDE / base CONFIG_DEFAULTS): see `M5_CONFIG_KEYS` + `loadM5ConfigFromBase`.
 */
import { isValidTimeZone, referenceDay } from './lib/day.js';
import type { RankingsParamRules } from './schema/index.js';

export const MODULE_ID = 'm5-rankings';

export interface M5Config extends RankingsParamRules {
  windows: readonly number[];
  defaultWindow: number;
  /** IANA zone where days are cut (base key time.dayCutTimezone, default 'UTC') */
  dayCutTimezone: string;
  /** default `date` = reference day + offset (−1 => yesterday) */
  defaultDateOffsetDays: number;
  /** decimals applied to `score` on output only (ranking uses raw sums) */
  scoreDecimals: number;
  labels: { noData: string; partialData: string };
  /** seconds (base key m5-rankings.cacheTtlSec) */
  cacheTtlSec: number;
  /** detail-page link template (server fills it into each item's detailHref); `{id}` is replaced. Default /m/m6-project/{id} */
  projectDetailHref: string;
}

export const defaultM5Config: M5Config = {
  windows: [1, 7, 30],
  defaultWindow: 7,
  dayCutTimezone: 'UTC',
  defaultDateOffsetDays: -1,
  scoreDecimals: 2,
  labels: { noData: '暂无数据', partialData: '数据不全' },
  cacheTtlSec: 600,
  projectDetailHref: '/m/m6-project/{id}',
};

export interface ConfigProvider<T> { get(): T }
export function staticConfigProvider(overrides: Partial<M5Config> = {}): ConfigProvider<M5Config> {
  const cfg = { ...defaultM5Config, ...overrides, labels: { ...defaultM5Config.labels, ...overrides.labels } };
  if (!isValidTimeZone(cfg.dayCutTimezone)) throw new Error(`[${MODULE_ID}] unknown time zone ${cfg.dayCutTimezone}`);
  if (!cfg.windows.includes(cfg.defaultWindow)) throw new Error(`[${MODULE_ID}] defaultWindow ${cfg.defaultWindow} not in windows`);
  return { get: () => cfg };
}
export const defaultDate = (cfg: M5Config, now: Date = new Date()) => referenceDay(now, cfg.dayCutTimezone, cfg.defaultDateOffsetDays);
/** server-side only: fills every `{id}` in the template with the URL-encoded id */
export const projectHref = (cfg: M5Config, id: number | string) => cfg.projectDetailHref.split('{id}').join(encodeURIComponent(String(id)));

/**
 * Our field -> base config key. Shared keys (ranking.*, time.dayCutTimezone) come from base CONFIG_DEFAULTS;
 * module keys start with the module id and are declared in module.manifest.ts `config` as an ARRAY [{key, default, description}] (base ModuleConfigSpec).
 */
type Field = keyof M5Config;
export const M5_CONFIG_SPEC: { field: Field; key: string; description: string }[] = [
  { field: 'windows', key: 'ranking.windows', description: '可选时间窗（天）' },
  { field: 'defaultWindow', key: 'ranking.defaultWindow', description: '默认时间窗' },
  { field: 'defaultDateOffsetDays', key: 'ranking.defaultDateOffsetDays', description: '默认排名日期偏移（-1=昨天）' },
  { field: 'dayCutTimezone', key: 'time.dayCutTimezone', description: '切日时区（IANA）' },
  { field: 'scoreDecimals', key: 'm5-rankings.scoreDecimals', description: '声量分输出保留小数位（排名用原始值）' },
  { field: 'cacheTtlSec', key: 'm5-rankings.cacheTtlSec', description: '排行榜缓存 TTL（秒）' },
  { field: 'projectDetailHref', key: 'm5-rankings.projectDetailHref', description: '项目详情页链接模板，{id} 会被替换' },
  { field: 'labels', key: 'm5-rankings.labels', description: '前台文案：暂无数据 / 数据不全' },
];
export const M5_CONFIG_KEYS = Object.fromEntries(M5_CONFIG_SPEC.map((c) => [c.field, c.key])) as Record<Field, string>;
/** manifest `config` ARRAY (base ModuleConfigSpec): module-scoped keys only, with descriptions; none public (all server-side) */
export const m5ManifestConfig = () => M5_CONFIG_SPEC.filter((c) => c.key.startsWith(`${MODULE_ID}.`))
  .map((c) => ({ key: c.key, default: defaultM5Config[c.field], description: c.description }));

export interface BaseConfigReader { get<T = unknown>(key: string, fallback?: T): Promise<T> }
export async function loadM5ConfigFromBase(reader: BaseConfigReader): Promise<ConfigProvider<M5Config>> {
  const out: Record<string, unknown> = {};
  for (const c of M5_CONFIG_SPEC) out[c.field] = await reader.get(c.key, defaultM5Config[c.field]);
  return staticConfigProvider(out as Partial<M5Config>);
}
