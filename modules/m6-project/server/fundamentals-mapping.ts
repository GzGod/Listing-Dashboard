/**
 * THE ONLY place that knows how PD-01/PD-02 (+ logo/links) map from core columns to the API.
 * Source: core `projects` (M4-entered, read-only for M6) per base schema.prisma:
 *   logo_url, website_url, x_handle, docs_url, users_count/users_as_of/users_source,
 *   revenue_usd/revenue_period/revenue_as_of/revenue_source, longge_rating/longge_rated_at,
 *   fundamentals (JSON, capTable) and team (JSON) validated with base-owned zod schemas (FundamentalsSchema / TeamSchema from @app/shared; optional fields normalised to null).
 * Invalid JSON -> treated as missing + logged.
 */
import { FundamentalsSchema, TeamSchema } from '@app/shared';
import type { ProjectDetail } from '../schema/index.js';

/** projects columns as returned by the repository (snake_case DB names; dates as YYYY-MM-DD) */
export interface ProjectProfileColumns {
  logo_url: string | null; website_url: string | null; x_handle: string | null; docs_url: string | null;
  users_count: number | null; users_as_of: string | null; users_source: string | null;
  revenue_usd: number | null; revenue_period: string | null; revenue_as_of: string | null; revenue_source: string | null;
  fundamentals: unknown; team: unknown;
  longge_rating: string | null; longge_rated_at: string | null;
}
export type Log = (msg: string) => void;

/** base schemas use optional (not nullable) fields; treat stored `null` as absent rather than rejecting the whole JSON */
const dropNullKeys = (o: unknown) => (o && typeof o === 'object' && !Array.isArray(o) ? Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null)) : o);
const dropNullItemKeys = (o: unknown, key: string) => {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return o;
  const v = (o as Record<string, unknown>)[key];
  return Array.isArray(v) ? { ...o, [key]: v.map(dropNullKeys) } : o;
};

export function mapFundamentals(projectId: number, c: ProjectProfileColumns, log: Log = () => {}): ProjectDetail['fundamentals'] {
  let capTable: ProjectDetail['fundamentals']['capTable'] = [];
  if (c.fundamentals != null) {
    const r = FundamentalsSchema.safeParse(dropNullItemKeys(c.fundamentals, 'capTable'));
    if (r.success) capTable = (r.data.capTable ?? []).map((x) => ({ holder: x.holder, pct: x.pct, note: x.note ?? null }));
    else log(`projects.fundamentals invalid for project ${projectId}: ${r.error.issues[0]?.message ?? 'parse error'}`);
  }
  let team: ProjectDetail['fundamentals']['team'] = [];
  if (c.team != null) {
    const r = TeamSchema.safeParse(Array.isArray(c.team) ? c.team.map(dropNullKeys) : c.team);
    if (r.success) team = r.data.map((t) => ({ name: t.name, role: t.role, bio: t.bio ?? null, url: t.url ?? null }));
    else log(`projects.team invalid for project ${projectId}: ${r.error.issues[0]?.message ?? 'parse error'}`);
  }
  return {
    capTable, team,
    rating: c.longge_rating ? { grade: c.longge_rating, ratedAt: c.longge_rated_at } : null,
    // value + as-of are required to show the item; source may be null (UI then shows the no-data label for source)
    userCount: c.users_count != null && c.users_as_of ? { value: c.users_count, asOf: c.users_as_of, source: c.users_source } : null,
    revenue: c.revenue_usd != null && c.revenue_as_of ? { valueUsd: c.revenue_usd, period: c.revenue_period, asOf: c.revenue_as_of, source: c.revenue_source } : null,
  };
}

export function mapLinks(c: ProjectProfileColumns): ProjectDetail['links'] {
  return { website: c.website_url, x: c.x_handle ? `https://x.com/${c.x_handle.replace(/^@/, '')}` : null, docs: c.docs_url };
}
export const mapLogo = (c: ProjectProfileColumns) => c.logo_url;
