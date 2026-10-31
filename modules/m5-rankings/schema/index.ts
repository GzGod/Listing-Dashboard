/** M5 contract — from the base `@app/shared` namespace `m5m6` (test/harness shim in packages/shared mirrors it). */
import { m5m6 } from '@app/shared';
export const { makeRankingsQuerySchema, rankingItemSchema, rankingsResponseSchema, tracksResponseSchema } = m5m6;
export type RankingsParamRules = m5m6.RankingsParamRules;
export type RankingsQuery = m5m6.RankingsQuery;
export type RankingItem = m5m6.RankingItem;
export type RankingsResponse = m5m6.RankingsResponse;
export type TracksResponse = m5m6.TracksResponse;
