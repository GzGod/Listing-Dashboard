/**
 * ALL raw SQL of m5-rankings, isolated here. Written as `ctx.db.core.$queryRaw` TEMPLATE STRINGS (the base's current
 * rule: template form only, read-only single SELECT/WITH, every value bound). Whether the base later prefers
 * Prisma.sql fragments is pending — only this file would change. No string concatenation, no unsafe/execute raw.
 * Column names per base schema.prisma (snake_case).
 */
import type { MemberRec, ProjectRec, SnapshotRec, TrackRec } from './types.js';

/** Minimal shape of the base `ctx.db.core` (scoped PrismaClient) that we use; PrismaClient satisfies it. */
export interface CoreDb { $queryRaw<T = unknown>(query: TemplateStringsArray, ...values: unknown[]): Promise<T> }

export const listTracks = (db: CoreDb) =>
  db.$queryRaw<TrackRec[]>`SELECT id, name, parent_id AS "parentId" FROM tracks ORDER BY id`;

export const getTrack = (db: CoreDb, id: number) =>
  db.$queryRaw<TrackRec[]>`SELECT id, name, parent_id AS "parentId" FROM tracks WHERE id = ${id}`;

/** membership as of `asOf` (= window END date): latest snapshot on/before asOf (NULL track => excluded), else projects.track_id */
export const getMembers = (db: CoreDb, trackId: number, asOf: string) =>
  db.$queryRaw<MemberRec[]>`
    WITH latest AS (
      SELECT DISTINCT ON (project_id) project_id, track_id FROM buzz_snapshots
      WHERE day <= ${asOf}::date ORDER BY project_id, day DESC)
    SELECT p.id AS "projectId", CASE WHEN l.project_id IS NOT NULL THEN 'snapshot' ELSE 'current' END AS source
    FROM projects p LEFT JOIN latest l ON l.project_id = p.id
    WHERE (l.project_id IS NOT NULL AND l.track_id = ${trackId})
       OR (l.project_id IS NULL AND p.track_id = ${trackId})
    ORDER BY 1`;

/** null-track rows are returned and dropped in computeRanking (never COALESCEd) */
export const getSnapshots = (db: CoreDb, ids: number[], from: string, to: string) =>
  db.$queryRaw<SnapshotRec[]>`
    SELECT project_id AS "projectId", to_char(day, 'YYYY-MM-DD') AS day, adjusted_total AS "adjustedTotal",
           track_id AS "trackId", track_rank AS "trackRank"
    FROM buzz_snapshots
    WHERE project_id = ANY(${ids}::int[]) AND day BETWEEN ${from}::date AND ${to}::date`;

export const getFirstSnapshotDays = (db: CoreDb, ids: number[]) =>
  db.$queryRaw<{ projectId: number; day: string }[]>`
    SELECT project_id AS "projectId", to_char(MIN(day), 'YYYY-MM-DD') AS day FROM buzz_snapshots
    WHERE project_id = ANY(${ids}::int[]) GROUP BY project_id`;

export const getProjects = (db: CoreDb, ids: number[]) =>
  db.$queryRaw<ProjectRec[]>`SELECT id, name, symbol, logo_url AS "logoUrl" FROM projects WHERE id = ANY(${ids}::int[])`;
