import { describe, expect, it } from 'vitest';
import * as q from '../queries.js';

/** Base read-only guard rejects multi-statement SQL: no ';' and no '--' comments in any SQL text we build. */
function capture() {
  const sqls: string[] = [];
  const db = { $queryRaw: (strings: TemplateStringsArray) => { sqls.push(strings.join('$?')); return Promise.resolve([]); } };
  return { db: db as unknown as q.CoreDb, sqls };
}
describe('m5 queries.ts SQL text', () => {
  it('contains no ";" and no "--"', async () => {
    const { db, sqls } = capture();
    for (const [name, fn] of Object.entries(q)) {
      if (typeof fn !== 'function') continue;
      await (fn as (...a: unknown[]) => Promise<unknown>)(db, 1, '2026-10-01', '2026-10-30');
      expect(sqls.length, name).toBeGreaterThan(0);
    }
    for (const s of sqls) { expect(s).not.toContain(';'); expect(s).not.toContain('--'); }
  });
});
