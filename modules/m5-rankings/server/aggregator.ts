import { addDays } from '../lib/day.js';
import type { RankingsRepository } from './repository.js';
import { computeRanking, type RankOutput } from './ranking.js';

/**
 * Window aggregation behind an interface (confirmed: we aggregate; M3 only produces daily snapshots).
 * Contract: Σ buzz_snapshots.adjusted_total, never raw; membership by the snapshot track_id as of `date`.
 */
export interface WindowAggregator {
  aggregate(args: { trackId: number; window: number; date: string }): Promise<RankOutput>;
}

export class SnapshotWindowAggregator implements WindowAggregator {
  constructor(private repo: RankingsRepository) {}
  async aggregate({ trackId, window, date }: { trackId: number; window: number; date: string }) {
    // 1) candidates first (includes projects historically in the track that later moved), 2) then WHERE project_id IN (...)
    const members = await this.repo.getMembers(trackId, date);
    const ids = members.map((m) => m.projectId);
    const [snapshots, firstDays] = await Promise.all([
      this.repo.getSnapshots(ids, addDays(date, -(window - 1)), date),
      this.repo.getFirstSnapshotDays(ids),
    ]);
    return computeRanking({ window, date, members, snapshots, firstDays });
  }
}
