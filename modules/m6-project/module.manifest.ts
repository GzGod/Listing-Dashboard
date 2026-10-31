/**
 * PROVISIONAL — written against /workspace/listing-dashboard (base CORE_VERSION 1.1.0). MODULE_GUIDE.md is NOT final.
 * Manifest file name `module.manifest.ts` (decided).
 * `@app/core` = local mirror (packages/core-shim) until the module moves into the base repo.
 */
import { defineModule, type ModuleContext } from '@app/core';
import plugin from './server/plugin.js';
import { PgProjectRepository } from './server/repository.js';
import { loadM6ConfigFromBase, m6ManifestConfig, MODULE_ID } from './config.js';

export default defineModule({
  apiVersion: 1,
  name: MODULE_ID,
  version: '0.1.0',
  displayName: '项目详情页',
  requires: { core: '^1.1.0' },
  tables: {
    reads: ['projects', 'tracks', 'project_contracts', 'buzz_snapshots', 'project_daily', 'volume_snapshots', 'exchanges',
      'listing_events', 'posts', 'post_mentions', 'people', 'person_tags', 'platforms'],
    writes: [], owns: [],
  },
  apis: [
    { method: 'GET', path: '/projects/:id', permission: 'core:read', description: '项目详情（PD-01~04）' },
    { method: 'GET', path: '/projects/:id/series', permission: 'core:read', description: '联动图日序列 + 上币节点（PD-05）' },
    { method: 'GET', path: '/projects/:id/posts', permission: 'core:read', description: 'KOL 发帖（已确认，分页）' },
  ],
  subscribes: [], emits: [],
  // NOT a menu entry: base convention (core MenuSpec.path) = dynamic-segment paths are never put in the menu; reached only via M5 ranking links
  frontRoutes: [{ path: '/:id', title: '项目详情', component: 'web/base/FrontPage.tsx', permission: 'core:read' }],
  config: m6ManifestConfig(),
  register: async (ctx: ModuleContext) => {
    if (ctx.role !== 'server') return;
    const config = await loadM6ConfigFromBase(ctx.config);
    await ctx.router.register(plugin, { config, repo: new PgProjectRepository(ctx.db.core,
      (i) => ctx.log.warn(`[m6-project] unknown listing stage '${i.stage}' (listing_events.id=${i.listingEventId}) skipped`)),
      auth: ctx.requirePermission('core:read'), log: (m) => ctx.log.warn(m) });
  },
});
