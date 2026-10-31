'use client';
/**
 * Base entry (manifest frontRoutes component). The base wraps it in its ModuleErrorBoundary; our inner boundaries stay.
 * Transport = base `@app/ui` api(). Detail links come from the server (`detailHref` on each /rankings item).
 */
import { Suspense } from 'react';
import { api } from '@app/ui';
import { RankingsPage } from '../RankingsPage.js';
import { MODULE_ID } from '../../config.js';

export default function FrontPage() {
  return <Suspense fallback={null}><RankingsPage apiBase={`/api/${MODULE_ID}`} fetcher={api} /></Suspense>;
}
