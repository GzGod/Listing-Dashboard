import { dayRange } from '../lib/day.js';
import type { SeriesPoint } from '../schema/index.js';
import type { BuzzDay, MarketDay, PostCursor } from './repository.js';

/** One point per day in [from, to]. Missing day (no row) and null columns -> null; never 0, never interpolated. */
export function alignSeries(from: string, to: string, buzz: BuzzDay[], market: MarketDay[]): SeriesPoint[] {
  const b = new Map(buzz.map((r) => [r.day, r]));
  const m = new Map(market.map((r) => [r.day, r]));
  return dayRange(from, to).map((date) => {
    const x = b.get(date); const y = m.get(date);
    return {
      date,
      buzzScore: x?.adjustedTotal ?? null, buzzRankInTrack: x?.trackRank ?? null, kolPostCount: x?.kolPostCount ?? null,
      coreExposureCount: x?.coreExposureCount ?? null, heatScore: x?.heatScore ?? null,
      spotVolumeUsd24h: y?.totalSpotVolumeUsd ?? null, volumeRankInTrack: y?.volumeTrackRank ?? null, priceUsd: y?.priceUsd ?? null,
    };
  });
}

/** cursor timestamp = posts.posted_at at millisecond precision (timestamp(3)), UTC wall time with literal Z */
export const POSTED_AT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
export const encodeCursor = (c: PostCursor) => Buffer.from(`${c.postedAt}|${c.postId}`).toString('base64url');
export function decodeCursor(s: string): PostCursor | null {
  try {
    const [postedAt, id, extra] = Buffer.from(s, 'base64url').toString('utf8').split('|');
    if (!postedAt || !id || extra !== undefined || !POSTED_AT_RE.test(postedAt) || Number.isNaN(Date.parse(postedAt)) || !/^\d+$/.test(id)) return null;
    return { postedAt, postId: Number(id) };
  } catch { return null; }
}
