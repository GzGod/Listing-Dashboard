"use client";
import React from "react";
import { api, useApi, Card, Button, Input, Table, Empty } from "@app/ui";
import { Crud } from "./Crud.js";

type Cap = { holder: string; pct: string; note?: string };
type Member = { name: string; role: string; bio?: string; url?: string };
const EMPTY = { name: "", symbol: "", coingeckoId: "", parentTrackId: "", trackId: "", logoUrl: "", websiteUrl: "", xHandle: "", docsUrl: "", usersCount: "", usersAsOf: "", usersSource: "",
  revenueUsd: "", revenuePeriod: "", revenueAsOf: "", revenueSource: "", longgeRating: "", longgeRatedAt: "", summary: "", tokenomics: "", investors: "", extraJson: "" };
const d10 = (v: any) => (v ? String(v).slice(0, 10) : "");
const sel = { padding: 6, border: "1px solid #d1d5db", borderRadius: 6 } as const;
const L = ({ t, children }: { t: string; children: React.ReactNode }) => <label style={{ display: "flex", flexDirection: "column", fontSize: 12, gap: 2 }}>{t}{children}</label>;

export default function ProjectsPage() {
  const list = useApi<any[]>("/api/m4-admin/projects");
  const tracks = useApi<any[]>("/api/m4-admin/tracks");
  const exchanges = useApi<any[]>("/api/m4-admin/exchanges");
  const [editId, setEditId] = React.useState<number | null>(null);
  const [f, setF] = React.useState<Record<string, string>>({ ...EMPTY });
  const [cap, setCap] = React.useState<Cap[]>([]);
  const [team, setTeam] = React.useState<Member[]>([]);
  const [msg, setMsg] = React.useState("");
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  // 停用的赛道不能新选；正在编辑的项目原本就在的赛道仍显示
  const curTrack = editId ? (list.data ?? []).find((p) => p.id === editId)?.trackId : null;
  const usable = (tracks.data ?? []).filter((t) => !t.disabledAt || t.id === curTrack || (curTrack && (tracks.data ?? []).find((x) => x.id === curTrack)?.parentId === t.id));
  const parents = usable.filter((t) => t.parentId == null);
  const children = usable.filter((t) => f.parentTrackId && String(t.parentId) === f.parentTrackId);

  const load = (p: any) => {
    const fu = p.fundamentals ?? {};
    const { summary, tokenomics, investors, capTable, ...rest } = fu;
    const tr = (tracks.data ?? []).find((t) => t.id === p.trackId);
    setEditId(p.id);
    setF({ ...EMPTY, ...Object.fromEntries(Object.keys(EMPTY).map((k) => [k, p[k] == null ? "" : String(p[k])])),
      usersAsOf: d10(p.usersAsOf), revenueAsOf: d10(p.revenueAsOf), longgeRatedAt: d10(p.longgeRatedAt),
      parentTrackId: tr ? String(tr.parentId ?? tr.id) : "", trackId: p.trackId ? String(p.trackId) : "",
      summary: summary ?? "", tokenomics: tokenomics ?? "", investors: (investors ?? []).join(", "), extraJson: Object.keys(rest).length ? JSON.stringify(rest, null, 2) : "" });
    setCap((capTable ?? []).map((c: any) => ({ ...c, pct: String(c.pct) })));
    setTeam(p.team ?? []);
  };
  const reset = () => { setEditId(null); setF({ ...EMPTY }); setCap([]); setTeam([]); };
  const save = async () => {
    if (!f.name.trim() || !f.symbol.trim()) { setMsg("名称和 Ticker 必填"); return; }
    if (!f.trackId && !f.parentTrackId) { setMsg("赛道必填：请选择一级赛道（有细分就选细分）"); return; }
    try {
      const extra = f.extraJson.trim() ? JSON.parse(f.extraJson) : {};
      const fundamentals = { ...extra, ...(f.summary ? { summary: f.summary } : {}), ...(f.tokenomics ? { tokenomics: f.tokenomics } : {}),
        ...(f.investors.trim() ? { investors: f.investors.split(",").map((s) => s.trim()).filter(Boolean) } : {}),
        ...(cap.length ? { capTable: cap.map((c) => ({ holder: c.holder, pct: Number(c.pct), ...(c.note ? { note: c.note } : {}) })) } : {}) };
      const { parentTrackId, summary: _s, tokenomics: _t, investors: _i, extraJson: _e, ...cols } = f;
      void _s; void _t; void _i; void _e;
      const body = { ...cols, trackId: Number(cols.trackId || parentTrackId), fundamentals: Object.keys(fundamentals).length ? fundamentals : null,
        team: team.length ? team.map((m) => Object.fromEntries(Object.entries(m).filter(([, v]) => v !== ""))) : null };
      await api(editId ? `/api/m4-admin/projects/${editId}` : "/api/m4-admin/projects", { method: editId ? "PUT" : "POST", json: body });
      setMsg(editId ? "已更新" : "已新增"); reset(); list.reload();
    } catch (e) { setMsg((e as Error).message); }
  };

  return (<div>
    <Card title={`AD-01 项目资料（PD-01/02）${editId ? ` · 编辑 #${editId}` : " · 新建"}`}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0,1fr))", gap: 8 }}>
        <L t="名称*"><Input value={f.name} onChange={set("name")} /></L>
        <L t="Ticker*"><Input value={f.symbol} onChange={set("symbol")} /></L>
        <L t="CoinGecko ID"><Input value={f.coingeckoId} onChange={set("coingeckoId")} placeholder="如 solana" /></L>
        <span /><span />
        <span />
        <L t="一级赛道*"><select style={sel} value={f.parentTrackId} onChange={(e) => setF({ ...f, parentTrackId: e.target.value, trackId: "" })}><option value="">—</option>{parents.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></L>
        <L t="细分赛道（只改当前赛道，历史快照不变）"><select style={sel} value={f.trackId} onChange={set("trackId")}><option value="">（只选一级）</option>{children.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></L>
        <L t="Logo URL"><Input value={f.logoUrl} onChange={set("logoUrl")} /></L>
        <L t="官网"><Input value={f.websiteUrl} onChange={set("websiteUrl")} /></L>
        <L t="X 账号"><Input value={f.xHandle} onChange={set("xHandle")} /></L>
        <L t="文档"><Input value={f.docsUrl} onChange={set("docsUrl")} /></L>
        <L t="用户数"><Input value={f.usersCount} onChange={set("usersCount")} /></L>
        <L t="用户数截至"><Input type="date" value={f.usersAsOf} onChange={set("usersAsOf")} /></L>
        <L t="用户数来源"><Input value={f.usersSource} onChange={set("usersSource")} /></L>
        <span />
        <L t="收入 USD"><Input value={f.revenueUsd} onChange={set("revenueUsd")} /></L>
        <L t="收入周期"><select style={sel} value={f.revenuePeriod} onChange={set("revenuePeriod")}><option value="">—</option><option value="30d">30d</option><option value="quarter">quarter</option><option value="year">year</option></select></L>
        <L t="收入截至"><Input type="date" value={f.revenueAsOf} onChange={set("revenueAsOf")} /></L>
        <L t="收入来源"><Input value={f.revenueSource} onChange={set("revenueSource")} /></L>
        <L t="龙哥评级"><Input value={f.longgeRating} onChange={set("longgeRating")} /></L>
        <L t="评级日"><Input type="date" value={f.longgeRatedAt} onChange={set("longgeRatedAt")} /></L>
      </div>
      <h4>基本面 fundamentals</h4>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <L t="简介 summary"><textarea rows={3} value={f.summary} onChange={set("summary")} /></L>
        <L t="代币经济 tokenomics"><textarea rows={3} value={f.tokenomics} onChange={set("tokenomics")} /></L>
        <L t="投资方 investors（逗号分隔）"><Input value={f.investors} onChange={set("investors")} /></L>
        <L t="其他字段（JSON，可选）"><textarea rows={3} value={f.extraJson} onChange={set("extraJson")} placeholder='{"audits": ["..."]}' /></L>
      </div>
      <h5>股权结构 capTable</h5>
      {cap.map((c, i) => <div key={i} style={{ display: "flex", gap: 6, marginBottom: 4 }}>
        <Input placeholder="持有方" value={c.holder} onChange={(e) => setCap(cap.map((x, j) => (j === i ? { ...x, holder: e.target.value } : x)))} />
        <Input placeholder="占比 %" value={c.pct} onChange={(e) => setCap(cap.map((x, j) => (j === i ? { ...x, pct: e.target.value } : x)))} />
        <Input placeholder="备注" value={c.note ?? ""} onChange={(e) => setCap(cap.map((x, j) => (j === i ? { ...x, note: e.target.value } : x)))} />
        <Button onClick={() => setCap(cap.filter((_, j) => j !== i))}>×</Button></div>)}
      <Button onClick={() => setCap([...cap, { holder: "", pct: "" }])}>+ 股东</Button>
      <h4>团队 team</h4>
      {team.map((m, i) => <div key={i} style={{ display: "flex", gap: 6, marginBottom: 4 }}>
        {(["name", "role", "bio", "url"] as const).map((k) => <Input key={k} placeholder={{ name: "姓名*", role: "职位*", bio: "简介", url: "链接" }[k]} value={m[k] ?? ""} onChange={(e) => setTeam(team.map((x, j) => (j === i ? { ...x, [k]: e.target.value } : x)))} />)}
        <Button onClick={() => setTeam(team.filter((_, j) => j !== i))}>×</Button></div>)}
      <Button onClick={() => setTeam([...team, { name: "", role: "" }])}>+ 成员</Button>
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}><Button onClick={save}>{editId ? "保存修改" : "新增项目"}</Button>{editId && <Button onClick={reset}>取消</Button>}<span>{msg}</span></div>
    </Card>
    <Card title="项目列表">
      {list.data?.length ? <Table rows={list.data.map((p) => ({ ...p, tr: p.track ? `${p.track.parent ? p.track.parent.name + " / " : ""}${p.track.name}` : "-", op: <Button onClick={() => load(p)}>编辑</Button> }))}
        columns={[{ key: "id", title: "ID" }, { key: "name", title: "名称" }, { key: "symbol", title: "Ticker" }, { key: "tr", title: "赛道" }, { key: "longgeRating", title: "评级" }, { key: "op", title: "操作" }]} /> : <Empty text={list.error ?? undefined} />}
    </Card>
    <Crud title="合约地址" path="/contracts" fields={[{ key: "projectId", title: "项目ID" }, { key: "chain", title: "链" }, { key: "address", title: "地址" }]}
      columns={[{ key: "id", title: "ID" }, { key: "projectId", title: "项目" }, { key: "chain", title: "链" }, { key: "address", title: "地址" }]} />
    <ListingEditor projects={list.data ?? []} exchanges={exchanges.data ?? []} />
  </div>);
}

function ListingEditor({ projects, exchanges }: { projects: any[]; exchanges: any[] }) {
  const list = useApi<any[]>("/api/m4-admin/listings");
  const stages = useApi<string[]>("/api/m4-admin/listing-stages");
  const [f, setF] = React.useState({ projectId: "", exchangeId: "", day: "", stage: "", pair: "", announcementUrl: "" });
  const [msg, setMsg] = React.useState("");
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const add = async () => { try { await api("/api/m4-admin/listings", { method: "POST", json: f }); setMsg("已保存"); list.reload(); } catch (e) { setMsg((e as Error).message); } };
  const del = async (id: number) => { if (confirm(`删除上币事件 #${id}？`)) { await api(`/api/m4-admin/listings/${id}`, { method: "DELETE" }); list.reload(); } };
  return (<Card title="上币事件（手动录入）">
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
      <select style={sel} value={f.projectId} onChange={set("projectId")}><option value="">项目</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.symbol})</option>)}</select>
      <select style={sel} value={f.exchangeId} onChange={set("exchangeId")}><option value="">交易所</option>{exchanges.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
      <Input type="date" value={f.day} onChange={set("day")} />
      <select style={sel} value={f.stage} onChange={set("stage")}><option value="">阶段</option>{(stages.data ?? []).map((s) => <option key={s} value={s}>{s}</option>)}</select>
      <Input placeholder="交易对" value={f.pair} onChange={set("pair")} />
      <Input placeholder="公告链接" value={f.announcementUrl} onChange={set("announcementUrl")} />
      <Button onClick={add}>新增</Button><span>{msg}</span>
    </div>
    {list.data?.length ? <Table rows={list.data.map((r) => ({ ...r, p: r.project?.name, x: r.exchange?.name, d: d10(r.day), op: <Button onClick={() => del(r.id)}>删除</Button> }))}
      columns={[{ key: "id", title: "ID" }, { key: "p", title: "项目" }, { key: "x", title: "交易所" }, { key: "d", title: "日期" }, { key: "stage", title: "阶段" }, { key: "pair", title: "交易对" }, { key: "announcementUrl", title: "公告" }, { key: "op", title: "操作" }]} /> : <Empty />}
  </Card>);
}
