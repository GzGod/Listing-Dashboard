"use client";
import React from "react";
import { api, useApi, useConfig, Card, Button, Input, Table, Empty } from "@app/ui";
export default function WeightsPage() {
  const list = useApi<any[]>("/api/m4-admin/score-params");
  const sys = useApi<{ keys: Record<string, string>; values: Record<string, unknown> }>("/api/m4-admin/system-config");
  const [f, setF] = React.useState({ a: "", b: "", effectiveFrom: "" });
  const [msg, setMsg] = React.useState("");
  const save = async () => {
    try { const r = await api<any>("/api/m4-admin/score-params", { method: "POST", json: f }); setMsg(`已保存 ${r.params.version}，已发 recalc.requested（${r.event.dateFrom} ~ ${r.event.dateTo}$，reason=${r.event.reason}）`); list.reload(); }
    catch (e) { setMsg((e as Error).message); }
  };
  const { value: backfillFrom } = useConfig<string>("m4-admin.backfillFrom");
  const [bf, setBf] = React.useState({ dateFrom: "", dateTo: "", projectIds: "" });
  const [bfMsg, setBfMsg] = React.useState("");
  const backfill = async () => {
    const scope = bf.projectIds.trim() ? `项目 ${bf.projectIds}` : "全部项目";
    if (!confirm(`确认手动回算 ${bf.dateFrom || backfillFrom} ~ ${bf.dateTo || "今天"}，${scope}？`)) return;
    try { const r = await api<any>("/api/m4-admin/backfill", { method: "POST", json: { ...bf, projectIds: bf.projectIds.split(",").map((x) => x.trim()).filter(Boolean) } }); setBfMsg(`已发 manual_backfill（${r.event.dateFrom} ~ ${r.event.dateTo}）`); }
    catch (e) { setBfMsg((e as Error).message); }
  };
  return (<><Card title="AD-03 打分系数 score_params（每次保存新增版本 + 生效日，旧版本保留）">
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
      <Input placeholder="a 浏览量系数" value={f.a} onChange={(e) => setF({ ...f, a: e.target.value })} />
      <Input placeholder="b 收藏量系数" value={f.b} onChange={(e) => setF({ ...f, b: e.target.value })} />
      <Input placeholder="生效日 YYYY-MM-DD（默认今天）" value={f.effectiveFrom} onChange={(e) => setF({ ...f, effectiveFrom: e.target.value })} />
      <Button onClick={save}>保存新版本</Button><span>{msg}</span>
    </div>
    {list.data?.length ? <Table rows={list.data.map((r) => ({ ...r, act: String(r.effectiveFrom).slice(0, 10) }))} columns={[{ key: "version", title: "版本" }, { key: "a", title: "a" }, { key: "b", title: "b" }, { key: "act", title: "生效日" }, { key: "updatedAt", title: "更新时间" }]} /> : <Empty text={list.error ?? undefined} />}
    <p style={{ color: "#6b7280" }}>系统配置（底座配置中心，只读）：{sys.data ? Object.entries(sys.data.values).map(([k, v]) => `${sys.data!.keys[k]} = ${JSON.stringify(v)}`).join("；") : "…"}</p>
  </Card>
  <Card title="手动回算（按当时生效的参数版本重算快照）">
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
      <Input placeholder={`开始日（默认 ${backfillFrom ?? "…"}）`} value={bf.dateFrom} onChange={(e) => setBf({ ...bf, dateFrom: e.target.value })} />
      <Input placeholder="结束日（默认今天）" value={bf.dateTo} onChange={(e) => setBf({ ...bf, dateTo: e.target.value })} />
      <Input placeholder="项目ID，逗号分隔（留空=全部）" value={bf.projectIds} onChange={(e) => setBf({ ...bf, projectIds: e.target.value })} />
      <Button onClick={backfill} style={{ background: "#d97706", borderColor: "#d97706" }}>手动回算</Button><span>{bfMsg}</span>
    </div>
  </Card>
  <KolWeights /></>);
}

function KolWeights() {
  const v = useApi<{ rows: any[] }>("/api/m4-admin/kol-tiers/versions");
  const cur = useApi<{ version: string; effectiveFrom: string; weights: Record<string, number> } | null>("/api/m4-admin/kol-tiers");
  const [eff, setEff] = React.useState(""); const [w, setW] = React.useState<Record<string, string>>({}); const [newTier, setNewTier] = React.useState(""); const [msg, setMsg] = React.useState("");
  const base = cur.data?.weights ?? {};
  const names = [...new Set([...Object.keys(base), ...Object.keys(w)])];
  const save = async () => {
    const weights = Object.fromEntries(names.map((n) => [n, w[n] ?? String(base[n] ?? "")]).filter(([, x]) => x !== ""));
    if (!confirm(`保存一整套 KOL 权重新版本（${Object.entries(weights).map(([k, x]) => `${k}=${x}`).join(", ")}），生效日 ${eff || "今天"}？`)) return;
    try { const r = await api<any>("/api/m4-admin/kol-tiers/versions", { method: "POST", json: { effectiveFrom: eff, weights } }); setMsg(`已保存 ${r.version}，已发 weights_changed（${r.event.dateFrom} ~ ${r.event.dateTo}）`); setW({}); v.reload(); cur.reload(); }
    catch (e) { setMsg((e as Error).message); }
  };
  const rows = v.data?.rows ?? [];
  return (<Card title={`KOL 等级权重（kol_tiers，一个版本 = 一整套等级；当前生效：${cur.data?.version ?? "无"}）`}>
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12, alignItems: "center" }}>
      {names.map((n) => <label key={n}>{n} <Input style={{ width: 80 }} value={w[n] ?? String(base[n] ?? "")} onChange={(e) => setW({ ...w, [n]: e.target.value })} /></label>)}
      <Input style={{ width: 90 }} placeholder="新等级名" value={newTier} onChange={(e) => setNewTier(e.target.value)} />
      <Button onClick={() => { if (newTier.trim()) { setW({ ...w, [newTier.trim()]: "" }); setNewTier(""); } }}>+ 等级</Button>
      <Input type="date" value={eff} onChange={(e) => setEff(e.target.value)} />
      <Button onClick={save}>保存新版本</Button><span>{msg}</span>
    </div>
    {rows.length ? <Table rows={rows.map((r) => ({ ...r, d: String(r.effectiveFrom).slice(0, 10) }))} columns={[{ key: "version", title: "版本" }, { key: "d", title: "生效日" }, { key: "name", title: "等级" }, { key: "weight", title: "权重 w" }]} /> : <Empty text="暂无版本" />}
  </Card>);
}
