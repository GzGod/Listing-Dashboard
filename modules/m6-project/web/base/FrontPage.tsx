'use client';
/**
 * Base entry: manifest frontRoutes path "/:id" => URL /m/m6-project/<id>; the base passes route params as props
 * (ModulePageProps). Transport = base `@app/ui` api(). The base wraps it in ModuleErrorBoundary; our per-section boundaries stay.
 */
import { api, type ModulePageProps } from '@app/ui';
import { ProjectPage } from '../ProjectPage.js';
import { defaultM6Config, MODULE_ID } from '../../config.js';

export default function FrontPage({ params }: ModulePageProps) {
  const raw = params.id ?? '';
  if (!/^[1-9]\d{0,9}$/.test(raw)) return <p>{defaultM6Config.labels.noData}</p>;
  return <ProjectPage id={Number(raw)} apiBase={`/api/${MODULE_ID}`} config={defaultM6Config} fetcher={api} />;
}
