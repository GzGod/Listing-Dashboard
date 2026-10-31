# m5-rankings · 声量排行榜（RK-01 ~ RK-03）

Status: mock data plus a PROVISIONAL base integration (`module.manifest.ts`). The base's MODULE_GUIDE.md is not final.

## API (mounted under `/api/m5-rankings` in the base)
`GET /rankings?track=<sub-track id, positive integer>&window=<config.windows, default config.defaultWindow>&date=YYYY-MM-DD`
- **`date`**: defaults to the reference day plus `defaultDateOffsetDays`, i.e. yesterday in UTC.
- **400**: `{ error: { code: 'BAD_REQUEST', message, module, requestId } }` (base AppError format). Returned for:
  - a missing or non-integer `track`
  - an illegal `window` or `date`
  - a future `date`
  - an unknown track
  - a parent track (no cross-track leaderboard)
- **Response**: `{ track:{id,name,parentId}, window, date, from, items:[{rank,prevRank,rankDelta,projectId,name,symbol,logoUrl,score,coveredDays,partial,daily:(number|null)[]}], noData:[…] }`
- **Score**: only `buzz_snapshots.adjusted_total` is read. M3 already merges manual adjustments into it. **`buzz_adjustments` (written only by M4) is never read.** Multi-day totals are sums of adjusted scores.
- **Ranking**:
  - window = 1: uses the stored `buzz_snapshots.track_rank` written by M3. It is only recomputed if a stored rank is missing.
  - window > 1: computed at query time.
  - Rule (`server/rank.ts`): standard competition ranking on raw values (1,1,3); ties are displayed in projectId ascending order. Rounding happens only on output (`scoreDecimals`).
- **Track attribution as of `date`**, in this order:
  1. the `track_id` of the project's snapshot on that day
  2. the `track_id` of its latest snapshot before that day
  3. the current `projects.track_id`, only if it has no snapshot on or before that day

  This means a project that later moved still appears in its old track's historical rankings. The query first resolves candidate projects (DISTINCT ON), then reads snapshots with `WHERE project_id = ANY($1)`.
- **Missing days**: a day with no snapshot appears as `null` in `daily[]`, and the sparkline breaks there.
  - A project with no rows at all in the window goes into `noData`.
- **`partial` rule**: `expectedDays = days in [max(from, the project's first-ever snapshot day), date]`, and `partial = coveredDays < expectedDays`. A brand-new project with complete data since its first snapshot therefore does not show 「数据不全」 forever.
- **prevRank**: the rank in the previous window of the same length, using the same rules.
- **Cache**: key `${date}:${track}:${window}` on `ctx.redis` (base adds `m:m5-rankings:`); shared across instances.
  - On `daily.batch.done` it deletes only keys whose date is >= `payload.dateFrom`, and logs `reason` if present (e.g. manual_backfill).
  - `MemoryCache` is used only by the single-process harness.
- **Extra endpoint**: `GET /rankings/tracks` returns the track tree for the frontend tabs. It is not in the approved spec.

## File map
| Path | Purpose |
|---|---|
| `config.ts` | All tunables + `ConfigProvider`, plus the base mapping `M5_CONFIG_KEYS` / `loadM5ConfigFromBase(ctx.config)`. Shared keys: `ranking.windows`, `ranking.defaultWindow`, `ranking.defaultDateOffsetDays`, `time.dayCutTimezone`. Module keys: `m5-rankings.*` (cacheTtlSec, scoreDecimals, cacheKeyPrefix, projectDetailHref, labels) |
| `schema/` | Re-exports the M5 contract from `@app/shared` (root import; base will adopt it) |
| `lib/day.ts` | Module-local addDays/dayRange/referenceDay/isValidDay (duplicated per module on purpose) |
| `server/rank.ts` | `competitionRank`, pure. **Will move into the base @app/shared** |
| `server/ranking.ts` / `aggregator.ts` | Window aggregation (`WindowAggregator` interface) |
| `server/repository.ts` | `RankingsRepository` + Mock + `PgRankingsRepository`. The Pg version maps column names per the base Prisma schema, binds all parameters, and is **not run in tests: there is no Postgres on this machine** |
| `server/cache.ts` | Redis / Memory caches + the `daily.batch.done` handler |
| `server/plugin.ts` | Fastify plugin. Options: `{config, repo (required), aggregator, cache, now, auth}`. No error formatter: the base's global handler renders AppError; tests use `test-utils/http.ts` installTestErrorFormat; the harness uses `installErrorHandler` (mirror of the base) |
| `module.manifest.ts` (+ `module.ts` re-export) | PROVISIONAL `defineModule`:<br>• `tables.reads` lists the tables read; `writes`/`owns` are empty<br>• `apis` carry `core:read`<br>• `subscribes: ['daily.batch.done']`<br>• frontRoutes point to `web/base/FrontPage.tsx`<br>• `register(ctx)` loads config from ctx.config, uses the Redis cache, subscribes with `ctx.events.on`, and mounts the plugin on `ctx.router` with `ctx.requirePermission('core:read')` |
| `web/api-client.ts` | The only file that knows the URL/DTO; the fetcher is injectable |
| `web/RankingsPage.tsx`, `Sparkline.tsx`, `ErrorBoundary.tsx` | Page. Detail links use `config.projectDetailHref`: `item.detailHref` from the server (template = config key `m5-rankings.projectDetailHref`, default `/m/m6-project/{id}`) |
| `web/base/FrontPage.tsx` | Base entry point (default export, no props, attaches the bearer token) |

## Swap when MODULE_GUIDE is final
- Delete `packages/core-shim` and import the real `@app/core`.
- Delete our `packages/shared` shim: contracts come from `import { m5m6 } from '@app/shared'` and `competitionRank` from `@app/shared` (both already in the base).
- Use `@app/ui`'s `api()` and base components instead of the inline fetcher, styles and ErrorBoundary. The base already wraps each module page in a ModuleErrorBoundary; keep our per-section boundaries.
- Delete `scripts/check-modules.mjs` and use the base's `pnpm check`.

## Track attribution & null tracks (Coding Bot rules)
- `buzz_snapshots.track_id` is NULLABLE: M3 still writes rows for projects without a track (track/rank NULL).
- **Null-track days never enter the ranking** (no COALESCE to projects.track_id): excluded from the 1d ranking, and not
  summed into 7d/30d scores (shown as null in `daily[]`, so they also count as uncovered days).
- **Membership as of `date`** (window END date for 7d/30d — *end-date attribution pending product confirmation*): the latest
  snapshot on/before `date` decides; if it exists with a NULL track the project is excluded ("exists, no track" is never
  skipped over). `projects.track_id` is used ONLY when there is no snapshot at all on/before `date`.
  Code: `server/repository.ts` resolveMembers, `server/queries.ts` getMembers, `server/ranking.ts` computeRanking.
- **Hand-filled days** (crawler missed; raw_total and the three sub-scores NULL, adjusted_total set, track_id normal):
  ranked by adjusted_total as usual, the day counts as covered (coveredDays/partial), `daily[]` shows adjusted_total.
  Nothing coerces those NULLs to 0 (no COALESCE(...,0) in SQL, mapping or UI).

## Test-only shims (outside module dirs)
- `packages/shared` = shim for the base `@app/shared` (M5/M6 contracts, `competitionRank`, EventMap subset). Delete when the base ships them.
- `modules/m5-rankings/test-utils/` = mock tables + MockRankingsRepository (duplicated per module, no cross-module import); only `__tests__` and the dev harness import it.
- `packages/core-shim` (`@app/core` types mirror of the official m0 package), `packages/shared` and `packages/ui-shim` = verbatim copies of the m0 package's shared/ui sources. No `@app/db`: DB access is `ctx.db.core` only.
- tsconfig: `modules/*/tsconfig.json` extends `../../tsconfig.module.json` (base module tsconfig; LOCAL MIRROR at the same path here);
  `tsconfig.web.json` extends `../../apps/web/tsconfig.json` (base web tsconfig; local mirror here).

## Raw SQL (pending base decision)
All SQL is in `server/queries.ts`, written as `ctx.db.core.$queryRaw` template strings (base MODULE_GUIDE rule today).
If the base switches to Prisma.sql fragments, only that file changes. No `$queryRawUnsafe` / `$executeRaw*` / `$queryRaw(`.

## Redis
Cache uses `ctx.redis` (official package core/src/redis.ts: per-module managed ioredis connection, keyPrefix `m:m5-rankings:`).
If Redis is down or a command fails, `/rankings` logs a warning and serves from the DB (never 500). We open no connection, read no
REDIS_URL and add no prefix: keys are `<date>:<track>:<window>` (date first) under the base prefix. `daily.batch.done` invalidation
SCANs `MATCH ${keyPrefix}*` explicitly (ioredis does not prefix SCAN patterns or results), strips the prefix, filters date >= dateFrom,
then DELs (which re-adds the prefix). Tested with `test-utils/redis.ts`, a prefix-applying fake with ioredis SCAN semantics (no ioredis in module or test-utils code).

## Manifest config
`config` is an ARRAY of base `ModuleConfigSpec` `{key, default, description}`; nothing is `public` (projectDetailHref stays server-side).

## Contract change for base @app/shared
- `GET /rankings`: every `items[]` and `noData[]` entry now has `detailHref: string`, filled server-side from
  `m5-rankings.projectDetailHref` (default `/m/m6-project/{id}`, `{id}` → `encodeURIComponent(projectId)`). The web uses it
  directly, so this key does not need to be public config.

## Day cut (time.dayCutTimezone)
Every "today/yesterday", default date, window/series range bound, posts range start and cache-key date is derived from the
shared key `time.dayCutTimezone` (default UTC; CONFIG_TIME_DAYCUTTIMEZONE / system_config), read via `ctx.config` at register
(`loadM*ConfigFromBase`). Only `lib/day.ts` (tz-taking helpers) does date math; posts range start = 00:00 in that zone converted
to the UTC instant (`dayStartUtcIso`), since posts.posted_at is stored in UTC. Tests: `server/__tests__/day-cut-tz.test.ts` (Asia/Shanghai).
SQL: no ';' and no '--' inside `$queryRaw` template text (base read-only guard); enforced by `sql-text.test.ts` and scripts/check-modules.mjs.

## TODO (deferred per Coding Bot final scope)
- `pnpm check --module` (17:52 base): remaining errors are base-side resolution of third-party deps not installed in the base (vitest in tests; m6 also pg, echarts).
- Lint (react-hooks rules), dayCutTimezone follow-ups, and other should-fix review items: re-verify on the next base package.
