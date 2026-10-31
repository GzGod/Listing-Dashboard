// 事件契约。新增事件 = 在 EventMap 里加一行，并走评审。
export interface PostIngestedEvent { postIds: number[]; platform: string; ingestedAt: string }
/** projectIds 省略 = 全部项目 */
export interface RecalcRequestedEvent {
  reason: "weights_changed" | "manual_adjust" | "mention_changed" | "manual_backfill";
  projectIds?: number[];
  dateFrom: string;            // UTC YYYY-MM-DD
  dateTo: string;              // UTC YYYY-MM-DD
}
/** m3-engine 在日批完成后、以及每次重算完成后发出 */
export interface DailyBatchDoneEvent { dateFrom: string; dateTo: string /* UTC YYYY-MM-DD */ }
/** 每天一次：全部项目行情拉取完成后发出；数据本身在 volume_snapshots */
export interface MarketSnapshotIngestedEvent { date: string /* UTC YYYY-MM-DD */ }
export interface EventMap {
  "market.snapshot.ingested": MarketSnapshotIngestedEvent;
  "post.ingested": PostIngestedEvent;
  "recalc.requested": RecalcRequestedEvent;
  "daily.batch.done": DailyBatchDoneEvent;
}
export type EventName = keyof EventMap;
export const EVENT_NAMES: EventName[] = ["post.ingested", "market.snapshot.ingested", "recalc.requested", "daily.batch.done"];
export interface EventMeta { event: string; from: string; at: string; id: string }
export interface EventEnvelope<E extends string = string> extends EventMeta { payload: E extends EventName ? EventMap[E] : unknown }
