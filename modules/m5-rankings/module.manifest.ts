/**
 * PROVISIONAL — written against /workspace/listing-dashboard (base CORE_VERSION 1.1.0). MODULE_GUIDE.md is NOT final.
 * Manifest file name `module.manifest.ts` (decided).
 * `@app/core` resolves to our local mirror (packages/core-shim) until this module moves into the base repo.
 */
import { defineModule, type ModuleContext } from '@app/core';
import type { EventMap, EventName } from '@app/shared';
import plugin from './server/plugin.js';
import { PgRankingsRepository } from './server/repository.js';
import { RedisRankingsCache, createDailyBatchDoneHandler } from './server/cache.js';

/** event name straight from the base EventMap */
const DAILY_BATCH_DONE = 'daily.batch.done' satisfies EventName;
import { loadM5ConfigFromBase, m5ManifestConfig, MODULE_ID } from './config.js';

export default defineModule({
  apiVersion: 1,
  name: MODULE_ID,
  version: '0.1.0',
  displayName: '声量排行榜',
  requires: { core: '^1.1.0' },
  tables: { reads: ['tracks', 'projects', 'buzz_snapshots'], writes: [], owns: [] },
  apis: [
    { method: 'GET', path: '/rankings', permission: 'core:read', description: '细分赛道内声量排行（1/7/30 天窗口，调整后分数求和）' },
    { method: 'GET', path: '/rankings/tracks', permission: 'core:read', description: '赛道树（前台 Tab 用）' },
  ],
  subscribes: [DAILY_BATCH_DONE],
  emits: [],
  frontRoutes: [{ path: '/', title: '声量排行榜', component: 'web/base/FrontPage.tsx', permission: 'core:read' }],
  // module config ARRAY [{key, default, description}] (base ModuleConfigSpec; nothing public); shared keys ranking.* / time.dayCutTimezone come from base
  config: m5ManifestConfig(),
  register: async (ctx: ModuleContext) => {
    const config = await loadM5ConfigFromBase(ctx.config);
    // ctx.redis: the base's single shared connection, keys auto-prefixed with `m:m5-rankings:` (we add no prefix of our own)
    const cache = new RedisRankingsCache(ctx.redis);
    const onDone = createDailyBatchDoneHandler(cache, (m) => ctx.log.info(m));
    ctx.events.on(DAILY_BATCH_DONE, (payload) => onDone(payload as EventMap[typeof DAILY_BATCH_DONE]).then(() => undefined));
    if (ctx.role === 'server') {
      await ctx.router.register(plugin, { config, cache, repo: new PgRankingsRepository(ctx.db.core),
        auth: ctx.requirePermission('core:read') });
    }
  },
});
