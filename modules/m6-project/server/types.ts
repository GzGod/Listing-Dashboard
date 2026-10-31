/** Domain records shared by queries.ts and repository.ts (own file to avoid an import cycle). */
import type { ApiListingStage } from '../schema/index.js';
import type { ProjectProfileColumns } from './fundamentals-mapping.js';
export interface ProjectBase { id: number; name: string; symbol: string; trackId: number | null; profile: ProjectProfileColumns }
export interface TrackRec { id: number; name: string; parentId: number | null }
export interface BuzzDay { day: string; adjustedTotal: number; trackRank: number | null; /** null on hand-filled days — never coerced to 0 */ kolPostCount: number | null; coreExposureCount: number | null; heatScore: number | null }
export interface MarketDay { day: string; priceUsd: number | null; totalSpotVolumeUsd: number | null; volumeTrackRank: number | null }
export interface ExchangeVolume { exchange: string; volumeUsd: number }
export interface ListingRec { id: number; exchange: string; stage: ApiListingStage; day: string; pair: string | null; announcementUrl: string | null }
export interface PostRec { postId: number; url: string; platform: string; postedAt: string; views: number; bookmarks: number; matchMethod: string;
  author: { personId: number; name: string; handle: string; kolTier: string | null; tags: string[] } }
/** postedAt = posts.posted_at (timestamp(3), UTC wall time) as YYYY-MM-DDTHH:MM:SS.mmmZ — full ms precision, so the keyset cursor never drops/duplicates same-second posts */
export interface PostCursor { postedAt: string; postId: number }
