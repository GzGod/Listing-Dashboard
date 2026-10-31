/** M6 contract — from the base `@app/shared` namespace `m5m6` (test/harness shim in packages/shared mirrors it). */
import { m5m6 } from '@app/shared';
export const { projectParamsSchema, makeSeriesQuerySchema, makePostsQuerySchema, projectDetailSchema, postSchema, postsResponseSchema,
  apiListingStageSchema, seriesPointSchema, listingEventSchema, seriesResponseSchema } = m5m6;
export type ProjectParamRules = m5m6.ProjectParamRules;
export type ProjectDetail = m5m6.ProjectDetail;
export type PostItem = m5m6.PostItem;
export type PostsResponse = m5m6.PostsResponse;
/** API-layer stage (teaser|spot|perp); DB-layer is `ListingStage` (preannounce|spot|perp) from @app/shared */
export type ApiListingStage = m5m6.ApiListingStage;
export type SeriesPoint = m5m6.SeriesPoint;
export type ApiListingEvent = m5m6.ApiListingEvent;
export type SeriesResponse = m5m6.SeriesResponse;
