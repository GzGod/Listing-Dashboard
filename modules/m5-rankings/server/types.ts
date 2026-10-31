/** Domain records shared by queries.ts and repository.ts (own file to avoid an import cycle). */
export interface TrackRec { id: number; name: string; parentId: number | null }
export interface ProjectRec { id: number; name: string; symbol: string; logoUrl: string | null }
/** buzz_snapshots row (Prisma: adjustedTotal <- adjusted_total, trackId <- track_id, trackRank <- track_rank) */
export interface SnapshotRec { projectId: number; day: string; adjustedTotal: number; trackId: number | null; trackRank: number | null }
export interface MemberRec { projectId: number; source: 'snapshot' | 'current' }
