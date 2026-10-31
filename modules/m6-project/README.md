# m6-project · 项目详情页（PD-01 ~ PD-05; PD-06 out of scope）

## API (mounted under `/api/m6-project` in the base)
- **`:id`**: must be a positive integer. Anything else returns 400; an unknown id returns 404. Errors use the base AppError format.
- **`GET /projects/:id`**:
  - Sections: basic info, contracts, links, fundamentals (PD-01/02), buzzBreakdown, volume, latestPriceUsd + latestPriceDate.
  - "Latest" means the most recent row with day <= the latest complete UTC day. Each section returns the day it actually used (`buzzBreakdown.date`, `volume.date`, `latestPriceDate`).
  - Ranks are read from the stored columns `buzz_snapshots.track_rank` and `project_daily.volume_track_rank`, both written by M3. **Nothing is computed live.**
- **`GET /projects/:id/series?range=`**: one point per day.
  - A day with no row, and a row with an individual null column (for example volume present but price null), both give `null`. Values are never 0 and never interpolated, and the chart line breaks there.
  - Includes `buzzRankInTrack` and `volumeRankInTrack`, both stored values.
  - `listingEvents` are joined with `exchanges` (exchange_id → name). DB stage `preannounce` is mapped to API `teaser`.
- **`GET /projects/:id/posts?range=&cursor=&limit=`**:
  - Only rows with `post_mentions.status = 'confirmed'`, and each must have a url.
  - Ordered by `posted_at DESC, id DESC`.
  - The cursor is the SQL row comparison `(posted_at, id) < ($3, $4)`, with every value a bound parameter.

## PD-01 / PD-02 field mapping: only `server/fundamentals-mapping.ts`
| Source (core `projects`, entered by M4, read-only for us) | API field |
|---|---|
| `logo_url` | `logoUrl` |
| `website_url`, `x_handle`, `docs_url` | `links.website`, `links.x` (built as `https://x.com/<handle>`), `links.docs` |
| `users_count` / `users_as_of` / `users_source` | `fundamentals.userCount {value, asOf, source}`. The UI shows source and as-of date; if empty it shows the configured 「暂无数据」 |
| `revenue_usd` / `revenue_period` / `revenue_as_of` / `revenue_source` | `fundamentals.revenue {...}` (same display rule) |
| `fundamentals` JSON (`capTable`) | `fundamentals.capTable`, validated with `FundamentalsSchema` from `@app/shared` |
| `team` JSON | `fundamentals.team`, same validation |
| `longge_rating` / `longge_rated_at` | `fundamentals.rating` (the only opinion content) |

Invalid JSON is treated as missing and logged. The zod schemas (`FundamentalsSchema`/`TeamSchema`) are owned by the base (`@app/shared`); optional fields are normalised to null.

## File map
| Path | Purpose |
|---|---|
| `config.ts` | Tunables + base mapping `M6_CONFIG_KEYS` / `loadM6ConfigFromBase`. Shared keys: `pagination.defaultPageSize`, `ranking.defaultDateOffsetDays`, `time.dayCutTimezone`. Module keys: `m6-project.*` |
| `schema/` | Re-exports the M6 contract from `@app/shared` (root import) |
| `lib/day.ts` | Module-local date helpers |
| `server/repository.ts` | Mock + `PgProjectRepository`. The Pg version maps column names per the base Prisma schema and is **not run in tests** |
| `server/fundamentals-mapping.ts` | See the table above |
| `server/series.ts` | Date alignment and cursor handling |
| `server/plugin.ts` | Fastify plugin. Options: `{config, repo (required), now, auth, log}`; no error formatter in the plugin |
| `module.manifest.ts` (+ `module.ts`) | PROVISIONAL `defineModule`: reads only, `core:read`, frontRoutes `/` → `web/base/FrontPage.tsx` (reads `?id=`, because base menu paths must match exactly) |
| `web/api-client.ts` | The only file that knows the URL/DTO; the fetcher is injectable |
| `web/ProjectPage.tsx` | Six sections, each with its own ErrorBoundary |
| `web/LinkedChart.tsx` | One ECharts instance |

## Swap when MODULE_GUIDE is final
Same as m5.

## Review fixes
- Front route `/:id` → URL `/m/m6-project/<id>` (base passes `params`); transport = `@app/ui` api().
- Posts cursor: `posts.posted_at` is `timestamp(3)` WITHOUT time zone (UTC wall time). Output `to_char(p.posted_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`, compare `(posted_at, id) < ($ts::timestamp, $id)` — no AT TIME ZONE / timestamptz, so the session TimeZone cannot shift it. Verified against real PG 17 with `SET TimeZone='Asia/Shanghai'` (`__tests__/pg-cursor.test.ts`, runs when `PG_TEST_URL` is set).
- Unknown `listing_events.stage`: logged (ctx.log.warn) and skipped via `mapListingRows`; never defaulted.
- Stage types: API `m5m6.ApiListingStage` (teaser|spot|perp) mapped from DB `ListingStage` (preannounce|spot|perp, base schema.prisma); unknown → `ctx.log.warn` + skip (module.manifest.ts:35).
- Raw SQL in `server/queries.ts` only (template-string vs Prisma.sql pending base decision); mocks in `test-utils/`; tsconfig/shims: see m5 README.
- The `/:id` front route (URL `/m/m6-project/<id>`) is **not a menu entry**. The base convention (core `MenuSpec.path` doc) keeps dynamic-segment routes out of the menu, so no flag is needed. It is reached only from M5 ranking links.
- `post_mentions.status` ∈ pending|confirmed|rejected; only `'confirmed'` counts (SQL `repository.ts`, mock repo, test).
- 404 detection in `web/api-client.ts` uses `err.status === 404` (official base `api()` throws `ApiRequestError` with `status`).
- Null-track days (project_daily / buzz_snapshots track_id NULL): price and volume are still shown; nothing in M6 filters on track_id (ranks show 暂无数据).
- Hand-filled buzz days: `buzzBreakdown.kolPostCount/coreExposureCount/heatScore` are `null` in the API (M5M6 contract change: nullable) and render 「暂无数据」 (`web/buzz-cells.ts`); adjustedScore and rankInTrack display normally. No COALESCE(...,0) anywhere.

## Day cut (time.dayCutTimezone)
Every "today/yesterday", default date, window/series range bound, posts range start and cache-key date is derived from the
shared key `time.dayCutTimezone` (default UTC; CONFIG_TIME_DAYCUTTIMEZONE / system_config), read via `ctx.config` at register
(`loadM*ConfigFromBase`). Only `lib/day.ts` (tz-taking helpers) does date math; posts range start = 00:00 in that zone converted
to the UTC instant (`dayStartUtcIso`), since posts.posted_at is stored in UTC. Tests: `server/__tests__/day-cut-tz.test.ts` (Asia/Shanghai).
SQL: no ';' and no '--' inside `$queryRaw` template text (base read-only guard); enforced by `sql-text.test.ts` and scripts/check-modules.mjs.

## TODO (deferred per Coding Bot final scope)
- `pnpm check --module` (17:52 base): remaining errors are base-side resolution of third-party deps not installed in the base (vitest in tests; m6 also pg, echarts).
- Lint (react-hooks rules), dayCutTimezone follow-ups, and other should-fix review items: re-verify on the next base package.
