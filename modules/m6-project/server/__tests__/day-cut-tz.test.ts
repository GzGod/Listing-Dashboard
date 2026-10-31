import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { MockProjectRepository } from '../../test-utils/index.js';
import { installTestErrorFormat } from '../../test-utils/http.js';
import plugin from '../plugin.js';
import { loadM6ConfigFromBase } from '../../config.js';

const now = () => new Date('2026-10-30T17:00:00Z'); // = 2026-10-31 01:00 Asia/Shanghai
const reader = (tz?: string) => ({ get: async <V = unknown>(key: string, d?: V) => (key === 'time.dayCutTimezone' && tz ? tz : d) as V });
async function run(tz?: string) {
  const repo = new MockProjectRepository();
  const seen: Record<string, unknown[]> = { buzz: [], posts: [] };
  const b = repo.getBuzzRange.bind(repo); repo.getBuzzRange = (id, f, t) => { seen.buzz!.push([f, t]); return b(id, f, t); };
  const p = repo.getConfirmedPosts.bind(repo); repo.getConfirmedPosts = (id, f, a, l) => { seen.posts!.push(f); return p(id, f, a, l); };
  const a = Fastify(); installTestErrorFormat(a);
  await a.register(plugin, { now, config: await loadM6ConfigFromBase(reader(tz)), repo });
  const id = (repo as unknown as { db: { projects: { id: number }[] } }).db.projects[0]!.id;
  for (const r of ['7d', '30d', '90d']) await a.inject(`/projects/${id}/series?range=${r}`);
  await a.inject(`/projects/${id}/posts?range=7d`);
  const det = (await a.inject(`/projects/${id}`)).json();
  return { seen, det };
}
describe('M6 day cut from time.dayCutTimezone', () => {
  it('UTC default: series ranges end 10-29; posts start = 10-23T00:00Z', async () => {
    const { seen } = await run();
    expect(seen.buzz).toEqual([['2026-10-23', '2026-10-29'], ['2026-09-30', '2026-10-29'], ['2026-08-01', '2026-10-29']]);
    expect(seen.posts).toEqual(['2026-10-23T00:00:00.000Z']);
  });
  it('Asia/Shanghai: ranges shift to end 10-30; posts start = 10-24 00:00 Shanghai = 10-23T16:00Z', async () => {
    const { seen } = await run('Asia/Shanghai');
    expect(seen.buzz).toEqual([['2026-10-24', '2026-10-30'], ['2026-10-01', '2026-10-30'], ['2026-08-02', '2026-10-30']]);
    expect(seen.posts).toEqual(['2026-10-23T16:00:00.000Z']);
  });
});
