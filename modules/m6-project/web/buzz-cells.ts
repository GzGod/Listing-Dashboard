/** PD-03 breakdown cells. Sub-scores are null on hand-filled days -> 「暂无数据」(config label), never 0. No imports (unit-tested). */
export interface BuzzCellsInput { kolPostCount: number | null; coreExposureCount: number | null; heatScore: number | null; adjustedScore: number; rankInTrack: number | null }
export function buzzCells(b: BuzzCellsInput, noData: string, num: (n: number) => string): [string, string][] {
  const v = (n: number | null) => (n == null ? noData : num(n));
  return [['KOL 发帖数', v(b.kolPostCount)], ['核心人物时间线曝光', v(b.coreExposureCount)], ['热度分', v(b.heatScore)],
    ['调整后声量分', num(b.adjustedScore)], ['赛道内排名', b.rankInTrack == null ? noData : `#${b.rankInTrack}`]];
}
