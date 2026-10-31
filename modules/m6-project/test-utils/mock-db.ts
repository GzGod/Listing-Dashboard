/**
 * TEST/HARNESS ONLY (duplicated per module on purpose; no cross-module import). Deterministic in-memory stand-in for the
 * read-only core tables, base column names (snake_case) + numeric ids. Never imported by module production code.
 */
/**
 * Mock of the READ-ONLY core tables, using the column names of the base Prisma schema
 * (/workspace/listing-dashboard/packages/db/prisma/schema.prisma, read-only reference), snake_case = DB columns.
 * Deterministic: seeded PRNG + fixed anchor day. Missing days have NO row (never zero rows).
 * Differences vs base schema (see README gap list): ids are numeric (Int) as in the base; tags are inlined
 * on people instead of person_tags; post platform is a string; post_mentions.status ('confirmed'|'pending'|'rejected') per group decision
 * although schema.prisma still has `confirmed Boolean`; project_daily.track_id is present per base team's
 * confirmation although the current schema.prisma does not have it yet.
 * buzz_adjustments (M4-only) is intentionally NOT mocked: buzz_snapshots.adjusted_total already includes it.
 */
import { addDays, dayRange } from '../lib/day.js';

export const MOCK_ANCHOR = '2026-10-30'; // last day with data (yesterday UTC on 2026-10-31)
export const MOCK_DAYS = 90;
export const MOCK_FIRST_DAY = addDays(MOCK_ANCHOR, -(MOCK_DAYS - 1));

export interface TrackRow { id: number; name: string; parent_id: number | null }
export interface ProjectRow {
  id: number; name: string; symbol: string; track_id: number;
  logo_url: string | null; website_url: string | null; x_handle: string | null; docs_url: string | null;
  users_count: number | null; users_as_of: string | null; users_source: string | null;
  revenue_usd: number | null; revenue_period: string | null; revenue_as_of: string | null; revenue_source: string | null;
  /** JSON, validated with @app/shared FundamentalsSchema/TeamSchema */
  fundamentals: unknown; team: unknown;
  longge_rating: string | null; longge_rated_at: string | null;
}
export interface ProjectContractRow { project_id: number; chain: string; address: string }
export interface ExchangeRow { id: number; name: string; type: 'CEX' | 'DEX' }
/** written only by M3; adjusted_total already merges buzz_adjustments */
export interface BuzzSnapshotRow {
  project_id: number; day: string; track_id: number | null; kol_post_count: number | null; core_exposure_count: number | null; heat_score: number | null;
  raw_total: number | null; adjusted_total: number;
  /** daily rank within track_id by adjusted_total, written by M3 (Prisma: trackRank) */
  track_rank: number | null;
}
export interface ProjectDailyRow {
  project_id: number; day: string; track_id: number | null; total_spot_volume_usd: number | null; price_usd: number | null;
  /** same-day same-sub-track rank by total_spot_volume_usd, written by M3 (Prisma: volumeTrackRank) */
  volume_track_rank: number | null;
}
export interface VolumeSnapshotRow { project_id: number; exchange_id: number; day: string; spot_volume_usd_24h: number }
export type ListingStageDb = 'preannounce' | 'spot' | 'perp';
export interface ListingEventRow { id: number; project_id: number; exchange_id: number; day: string; stage: ListingStageDb; pair: string | null; announcement_url: string | null }
export interface PersonRow { id: number; display_name: string; handle: string; kol_tier: string | null; tags: string[] }
export interface PostRow { id: number; person_id: number; platform: string; posted_at: string; views: number; bookmarks: number; url: string }
export type MentionStatus = 'confirmed' | 'pending' | 'rejected';
export interface PostMentionRow { post_id: number; project_id: number; match_method: 'ticker' | 'name' | 'contract'; status: MentionStatus }
export interface MockDb {
  tracks: TrackRow[]; projects: ProjectRow[]; project_contracts: ProjectContractRow[]; exchanges: ExchangeRow[];
  buzz_snapshots: BuzzSnapshotRow[]; project_daily: ProjectDailyRow[]; volume_snapshots: VolumeSnapshotRow[];
  listing_events: ListingEventRow[]; people: PersonRow[]; posts: PostRow[]; post_mentions: PostMentionRow[];
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const r2 = (n: number) => Math.round(n * 100) / 100;

const TRACKS: TrackRow[] = [
  { id: 1, name: 'AI', parent_id: null },
  { id: 2, name: 'AI Agent', parent_id: 1 },
  { id: 3, name: 'AI 基础设施', parent_id: 1 },
  { id: 4, name: 'DeFi', parent_id: null },
  { id: 5, name: '永续 DEX', parent_id: 4 },
  { id: 6, name: 'RWA', parent_id: 4 },
];
/** named ids for tests/docs */
export const T = { AI: 1, AI_AGENT: 2, AI_INFRA: 3, DEFI: 4, DEFI_PERP: 5, DEFI_RWA: 6 } as const;
export const P = { P04_MOVED: 4, P07_NEW: 7, P11_BAD_JSON: 11, P19_NO_BUZZ: 19, P20_NO_DATA: 20 } as const;
const TRACK_BY_SLUG: Record<string, number> = { 'ai-agent': 2, 'ai-infra': 3, 'defi-perp': 5, 'defi-rwa': 6 };
const PROJECTS: [string, string, keyof typeof TRACK_BY_SLUG][] = [
  ['Agentix', 'AGX', 'ai-agent'], ['Nexa Mind', 'NEXA', 'ai-agent'], ['Swarmly', 'SWRM', 'ai-agent'],
  ['Tensorfi', 'TSF', 'ai-agent'] /* p04: ai-infra for first 60 days, ai-agent since */, ['Cortex Lab', 'CTX', 'ai-agent'],
  ['GPU Grid', 'GGRD', 'ai-infra'], ['Infera', 'INF', 'ai-infra'] /* p07: brand-new, 3 days */, ['Datamesh', 'DMSH', 'ai-infra'],
  ['Perpex', 'PRPX', 'defi-perp'], ['Leverage One', 'LEV1', 'defi-perp'], ['Hyperflow', 'HFLW', 'defi-perp'],
  ['Orderly X', 'ORDX', 'defi-perp'], ['Funding Rate', 'FRT', 'defi-perp'],
  ['Treasury Chain', 'TRSY', 'defi-rwa'], ['Ondora', 'ONDR', 'defi-rwa'], ['Realty Token', 'RLTY', 'defi-rwa'],
  ['Bondly', 'BNDL', 'defi-rwa'], ['GoldStack', 'GSTK', 'defi-rwa'],
  ['Silent Agent', 'SLNT', 'ai-agent'] /* p19: no buzz */, ['Ghost RWA', 'GHST', 'defi-rwa'] /* p20: no data */,
];
export const EXCHANGES = ['Binance', 'OKX', 'Bybit', 'Bitget', 'Gate'];
const CHAINS = ['Ethereum', 'Solana', 'BNB Chain', 'Base', 'Arbitrum'];
/** p04 moved ai-infra -> ai-agent on this day index */
export const P04_MOVE_DAY_INDEX = 60;

export function buildMockDb(seed = 20261030): MockDb {
  const rnd = mulberry32(seed);
  const days = dayRange(MOCK_FIRST_DAY, MOCK_ANCHOR);
  const project_contracts: ProjectContractRow[] = [];
  const projects: ProjectRow[] = PROJECTS.map(([name, symbol, slugTrack], i) => {
    const id = i + 1;
    const track_id = TRACK_BY_SLUG[slugTrack]!;
    const hex = Array.from({ length: 40 }, () => Math.floor(rnd() * 16).toString(16)).join('');
    project_contracts.push({ project_id: id, chain: CHAINS[i % CHAINS.length]!, address: `0x${hex}` });
    const hasProfile = i < 15;
    const slug = name.toLowerCase().replace(/\s+/g, '');
    const users = hasProfile && i % 3 !== 2;
    const rev = hasProfile && i % 3 !== 1;
    return {
      id, name, symbol, track_id,
      logo_url: i % 7 === 6 ? null : `https://placehold.co/64x64?text=${symbol}`,
      website_url: `https://${slug}.example`, x_handle: slug, docs_url: i % 3 === 0 ? null : `https://docs.${slug}.example`,
      users_count: users ? Math.round(1e4 + rnd() * 5e5) : null, users_as_of: users ? addDays(MOCK_ANCHOR, -7) : null, users_source: users ? 'Dune' : null,
      revenue_usd: rev ? Math.round(rnd() * 3e6) : null, revenue_period: rev ? '30d' : null, revenue_as_of: rev ? addDays(MOCK_ANCHOR, -7) : null, revenue_source: rev ? 'DefiLlama' : null,
      // p11 deliberately holds invalid JSON to exercise "invalid -> missing + log"
      fundamentals: id === P.P11_BAD_JSON ? { capTable: 'oops' } : hasProfile ? { capTable: i % 5 === 3 ? [] : [
        { holder: '团队', pct: 20, note: '4 年线性解锁' }, { holder: '投资人', pct: 18, note: '1 年锁仓' },
        { holder: '社区 / 生态', pct: 45, note: null }, { holder: '基金会', pct: 17, note: null }] } : null,
      team: hasProfile ? [{ name: `${name} 创始人`, role: 'CEO', bio: '前头部交易所产品负责人', url: `https://x.com/${symbol.toLowerCase()}_ceo` },
        { name: `${name} CTO`, role: 'CTO', bio: null, url: null }] : null,
      longge_rating: hasProfile && i % 4 !== 2 ? ['A', 'B+', 'B', 'A-'][i % 4]! : null,
      longge_rated_at: hasProfile && i % 4 !== 2 ? addDays(MOCK_ANCHOR, -(i * 3)) : null,
    };
  });
  const trackOn = (p: ProjectRow, d: number) => (p.id === P.P04_MOVED && d < P04_MOVE_DAY_INDEX ? T.AI_INFRA : p.track_id);

  const buzz: BuzzSnapshotRow[] = [];
  const daily: ProjectDailyRow[] = [];
  const vols: VolumeSnapshotRow[] = [];
  projects.forEach((p, i) => {
    let level = 20 + rnd() * 80;
    let price = 0.05 + rnd() * 5;
    let volume = 2e6 + rnd() * 5e7;
    const noBuzz = p.id === P.P19_NO_BUZZ || p.id === P.P20_NO_DATA;
    const lateStart = p.id === P.P07_NEW ? MOCK_DAYS - 3 : 0;
    const weights = EXCHANGES.map(() => rnd());
    const wSum = weights.reduce((a, b) => a + b, 0);
    days.forEach((day, d) => {
      level = Math.max(1, level * (0.9 + rnd() * 0.22));
      price = Math.max(0.0001, price * (0.95 + rnd() * 0.1));
      volume = Math.max(1e5, volume * (0.85 + rnd() * 0.32));
      const gap = rnd() < 0.08 && d !== MOCK_DAYS - 1 - (i % 2); // keep some recent days dense
      if (!noBuzz && d >= lateStart && !gap) {
        const kol = Math.round(level / 4 + rnd() * 5);
        const core = Math.round(rnd() * 6);
        const heat = r2(level * (0.8 + rnd() * 0.4));
        const raw = r2(kol * 1.5 + core * 3 + heat * 0.6);
        buzz.push({ project_id: p.id, day, track_id: trackOn(p, d), kol_post_count: kol, core_exposure_count: core, heat_score: heat,
          raw_total: raw, adjusted_total: r2(raw * (0.85 + rnd() * 0.3)), track_rank: null });
      }
      if (p.id === P.P20_NO_DATA) return;
      if (rnd() < 0.03) return; // missing market day -> no row
      const priceNull = rnd() < 0.03; // row present but price column null
      daily.push({ project_id: p.id, day, track_id: trackOn(p, d), price_usd: priceNull ? null : r2(price * 1e4) / 1e4, total_spot_volume_usd: Math.round(volume), volume_track_rank: null });
      EXCHANGES.forEach((_, k) => {
        if (i % 4 === 0 && k === 4) return; // not listed everywhere
        vols.push({ project_id: p.id, exchange_id: k + 1, day, spot_volume_usd_24h: Math.round((volume * weights[k]!) / wSum) });
      });
    });
  });
  // M3-style stored daily ranks (competition rank, ties share)
  const rankDay = <R extends { day: string; track_id: number | null }>(rows: R[], val: (r: R) => number | null, set: (r: R, k: number) => void) => {
    const g = new Map<string, R[]>();
    for (const r of rows) if (val(r) !== null && r.track_id !== null) { const k = `${r.day}|${r.track_id}`; (g.get(k) ?? g.set(k, []).get(k)!).push(r); }
    for (const list of g.values()) {
      list.sort((a, b) => val(b)! - val(a)!);
      let prevRank = 0;
      list.forEach((r, i) => { const rank = i > 0 && val(list[i - 1]!) === val(r) ? prevRank : i + 1; prevRank = rank; set(r, rank); });
    }
  };
  rankDay(buzz, (r) => r.adjusted_total, (r, k) => (r.track_rank = k));
  rankDay(daily, (r) => r.total_spot_volume_usd, (r, k) => (r.volume_track_rank = k));

  const listing_events: ListingEventRow[] = [];
  projects.slice(0, 16).forEach((p, i) => {
    if (i % 5 === 4) return;
    const exIdx = Math.floor(rnd() * 3);
    const ex = EXCHANGES[exIdx]!;
    const t = 10 + Math.floor(rnd() * 60);
    const plan: [ListingStageDb, number][] = [['preannounce', t], ['spot', t + 2 + Math.floor(rnd() * 3)], ['perp', t + 7 + Math.floor(rnd() * 5)]];
    plan.forEach(([stage, off]) => {
      if (off >= MOCK_DAYS) return;
      listing_events.push({ id: listing_events.length + 1, project_id: p.id, exchange_id: exIdx + 1, stage, day: days[off]!,
        pair: stage === 'preannounce' ? null : `${p.symbol}/USDT`,
        announcement_url: stage === 'perp' && i % 3 === 0 ? null : `https://announcements.example/${ex.toLowerCase()}/${p.symbol.toLowerCase()}-${stage}` });
    });
    if (i % 3 === 1) listing_events.push({ id: listing_events.length + 1, project_id: p.id, exchange_id: 2, stage: 'spot',
      day: days[Math.min(MOCK_DAYS - 1, t + 20)]!, pair: `${p.symbol}/USDT`, announcement_url: `https://announcements.example/okx/${p.symbol.toLowerCase()}` });
  });

  const tiers = ['S', 'A', 'A', 'B', 'B', 'B', 'C'];
  const people: PersonRow[] = Array.from({ length: 15 }, (_, i) => ({
    id: i + 1, display_name: `KOL ${String.fromCharCode(65 + i)}`, handle: `kol_${String.fromCharCode(97 + i)}`,
    kol_tier: tiers[i % tiers.length]!, tags: i % 4 === 0 ? ['核心人物', '交易员'] : i % 2 ? ['研究员'] : ['交易员'],
  }));
  const posts: PostRow[] = [];
  const post_mentions: PostMentionRow[] = [];
  let n = 0;
  projects.forEach((p) => {
    if (p.id === P.P20_NO_DATA) return;
    days.forEach((day) => {
      const k = Math.floor(rnd() * 3);
      for (let j = 0; j < k; j++) {
        n++;
        const person = people[Math.floor(rnd() * people.length)]!;
        const id = n;
        const hh = String(Math.floor(rnd() * 24)).padStart(2, '0');
        const mm = String(Math.floor(rnd() * 60)).padStart(2, '0');
        posts.push({ id, person_id: person.id, platform: 'x', posted_at: `${day}T${hh}:${mm}:00.${String(id % 1000).padStart(3, '0')}Z`, url: `https://x.com/${person.handle}/status/${1800000000000 + id}`,
          views: Math.round(500 + rnd() * 2e5), bookmarks: Math.round(rnd() * 800) });
        const mt = rnd();
        post_mentions.push({ post_id: id, project_id: p.id, match_method: mt < 0.6 ? 'ticker' : mt < 0.85 ? 'name' : 'contract', status: ((r) => (r < 0.85 ? 'confirmed' : r < 0.95 ? 'pending' : 'rejected'))(rnd()) });
      }
    });
  });
  return { tracks: TRACKS, projects, project_contracts, exchanges: EXCHANGES.map((name, k) => ({ id: k + 1, name, type: 'CEX' as const })),
    buzz_snapshots: buzz, project_daily: daily, volume_snapshots: vols, listing_events, people, posts, post_mentions };
}

let cached: MockDb | null = null;
export function getMockDb(): MockDb {
  return (cached ??= buildMockDb());
}
