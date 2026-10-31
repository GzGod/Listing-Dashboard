"use client";
import React from "react";
import { api, useApi, Card, Button, Input, Table, Empty } from "@app/ui";
const dash = (v: unknown) => (v == null ? "—" : String(v));
const NO_SNAP_MSG = "当天无快照，补分须填写理由";
export default function AdjustPage() {
  const snaps = useApi<any[]>("/api/m4-admin/snapshots");
  const adj = useApi<any[]>("/api/m4-admin/adjustments");
  const [f, setF] = React.useState({ projectId: "", day: "", adjustedScore: "", reason: "" });
  const [msg, setMsg] = React.useState("");
  const [noSnap, setNoSnap] = React.useState(false);
  // 选好项目和日期后查当天有没有快照；没有 = 补分，理由必填
  React.useEffect(() => {
    if (!f.projectId || !/^\d{4}-\d{2}-\d{2}$/.test(f.day)) { setNoSnap(false); return; }
    api<any[]>(`/api/m4-admin/snapshots?projectId=${f.projectId}&day=${f.day}`).then((r) => setNoSnap(!r.length || r[0].rawTotal == null)).catch(() => setNoSnap(false));
  }, [f.projectId, f.day]);
  const save = async () => {
    if (noSnap && f.adjustedScore !== "" && !f.reason.trim()) { setMsg(NO_SNAP_MSG); return; }
    try { const r = await api<any>("/api/m4-admin/adjustments", { method: "POST", json: f }); setMsg(`${r.fill ? "补分" : "调分"}已写入 buzz_adjustments，已发 recalc.requested(manual_adjust)`); adj.reload(); }
    catch (e) { setMsg((e as Error).message); }
  };
  return (<div>
    <Card title="AD-04 人工调分（按项目 + 日期写 buzz_adjustments；每天只保留一条有效记录，可调没有快照的日子；调整分留空 = 撤销）">
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        {(["projectId", "day", "adjustedScore", "reason"] as const).map((k) => <Input key={k} placeholder={{ projectId: "项目ID", day: "日期 YYYY-MM-DD", adjustedScore: "调整后分数", reason: noSnap ? "补分理由（必填）" : "原因（必填）" }[k]} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} />)}
        {noSnap && <b style={{ color: "#d97706" }}>当天无原始数据</b>}<Button onClick={save}>{noSnap ? "补分" : "提交"}</Button><span>{msg}</span>
      </div>
      {adj.data?.length ? <Table rows={adj.data.map((s) => ({ ...s, d: String(s.day).slice(0, 10), p: s.project?.name ?? s.projectId, rv: s.revoked ? "是" : "", snap: !s.buzzSnapshot ? "无快照（补分）" : s.buzzSnapshot.rawTotal == null ? "—（补分）" : String(s.buzzSnapshot.rawTotal) }))} columns={[{ key: "d", title: "日期" }, { key: "p", title: "项目" }, { key: "snap", title: "原始分" }, { key: "value", title: "调整分" }, { key: "reason", title: "原因" }, { key: "createdBy", title: "操作人" }, { key: "rv", title: "已撤销" }]} /> : <Empty text="暂无调分记录" />}
    </Card>
    <Card title="快照（只读，M3 写入）">
      {snaps.data?.length ? <Table rows={snaps.data.map((s) => ({ ...s, d: String(s.day).slice(0, 10), p: s.project?.name, raw: s.rawTotal == null ? "—（无原始数据）" : String(s.rawTotal), kp: dash(s.kolPostCount), ce: dash(s.coreExposureCount), hs: dash(s.heatScore), adj: dash(s.adjustedTotal), pv: dash(s.paramsVersion), tr: dash(s.trackRank) }))} columns={[{ key: "d", title: "日期" }, { key: "p", title: "项目" }, { key: "kp", title: "KOL 帖数" }, { key: "ce", title: "核心曝光" }, { key: "hs", title: "热度" }, { key: "raw", title: "原始分" }, { key: "adj", title: "最终分" }, { key: "pv", title: "参数版本" }, { key: "tr", title: "赛道排名" }]} /> : <Empty text={snaps.error ?? "暂无快照"} />}
    </Card>
  </div>);
}
