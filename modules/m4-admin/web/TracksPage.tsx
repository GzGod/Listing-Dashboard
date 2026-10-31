"use client";
import React from "react";
import { api, useApi, Card, Button, Input, Table, Empty } from "@app/ui";
export default function TracksPage() {
  return (<div>
    <TrackEditor />
    <Users />
  </div>);
}

function TrackEditor() {
  const list = useApi<any[]>("/api/m4-admin/tracks");
  const [name, setName] = React.useState(""); const [parentId, setParentId] = React.useState(""); const [msg, setMsg] = React.useState("");
  const rows = list.data ?? [];
  const parents = rows.filter((t) => t.parentId == null);
  const parentOpts = parents.filter((t) => !t.disabledAt);
  const add = async () => { try { await api("/api/m4-admin/tracks", { method: "POST", json: { name, parentId: parentId || null } }); setName(""); setMsg("已保存"); list.reload(); } catch (e) { setMsg((e as Error).message); } };
  const feat = useApi<{ disable: boolean }>("/api/m4-admin/tracks/features");
  const del = async (id: number) => { if (!confirm(`删除赛道 #${id}？`)) return; try { await api(`/api/m4-admin/tracks/${id}`, { method: "DELETE" }); setMsg("已删除"); list.reload(); } catch (e) { setMsg((e as Error).message); } };
  const toggle = async (t: any) => { const act = t.disabledAt ? "enable" : "disable"; if (!confirm(`${act === "disable" ? "停用" : "启用"}赛道「${t.name}」？`)) return;
    try { await api(`/api/m4-admin/tracks/${t.id}/${act}`, { method: "POST" }); list.reload(); } catch (e) { setMsg((e as Error).message); } };
  const ordered = parents.flatMap((p) => [p, ...rows.filter((c) => c.parentId === p.id)]);
  return (<Card title="AD-07 赛道（两级：一级 / 细分）">
    <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
      <Input placeholder="赛道名" value={name} onChange={(e) => setName(e.target.value)} />
      <select value={parentId} onChange={(e) => setParentId(e.target.value)}><option value="">（作为一级赛道）</option>{parentOpts.map((p) => <option key={p.id} value={p.id}>上级：{p.name}</option>)}</select>
      <Button onClick={add}>新增</Button><span>{msg}</span>
    </div>
    {ordered.length ? <Table rows={ordered.map((t) => ({ ...t, n: t.parentId == null ? t.name : `└ ${t.name}`, lv: t.parentId == null ? "一级" : "细分", st: t.disabledAt ? "已停用" : "启用",
      op: <span>{feat.data?.disable && <Button onClick={() => toggle(t)}>{t.disabledAt ? "启用" : "停用"}</Button>} <Button onClick={() => del(t.id)}>删除</Button></span> }))}
      columns={[{ key: "id", title: "ID" }, { key: "n", title: "名称" }, { key: "lv", title: "层级" }, ...(feat.data?.disable ? [{ key: "st", title: "状态" }] : []), { key: "op", title: "操作" }]} /> : <Empty />}
  </Card>);
}

const ROLES = ["admin", "editor", "viewer"] as const;
/** 账号管理：只调底座 /api/_core/users（需要 users:manage，默认只有 admin），users 表由底座写 */
function Users() {
  const users = useApi<any[]>("/api/_core/users");
  const [f, setF] = React.useState({ email: "", name: "", role: "viewer" });
  const [msg, setMsg] = React.useState("");
  const run = async (fn: () => Promise<any>, ok: (r: any) => string) => { try { const r = await fn(); setMsg(ok(r)); users.reload(); } catch (e) { setMsg((e as Error).message); } };
  const create = () => run(() => api("/api/_core/users", { method: "POST", json: f }), (r) => `已创建 ${r.email ?? f.email}${r.initialPassword ? `，初始密码：${r.initialPassword}` : ""}`);
  const role = (u: any, v: string) => run(() => api(`/api/_core/users/${u.id}/role`, { method: "PATCH", json: { role: v } }), () => `已把 ${u.email} 改为 ${v}`);
  const toggle = (u: any) => { if (confirm(`${u.enabled ? "停用" : "启用"} ${u.email}？`)) run(() => api(`/api/_core/users/${u.id}/${u.enabled ? "disable" : "enable"}`, { method: "POST" }), () => "已更新"); };
  const reset = (u: any) => { if (confirm(`重置 ${u.email} 的密码？`)) run(() => api(`/api/_core/users/${u.id}/reset-password`, { method: "POST", json: {} }), (r) => `新密码：${r.newPassword ?? "（已设置）"}`); };
  const rows = (users.data ?? []).map((u) => ({ ...u, st: u.enabled ? "启用" : "停用",
    r: <select value={u.role} onChange={(e) => role(u, e.target.value)}>{ROLES.map((x) => <option key={x}>{x}</option>)}</select>,
    op: <span><Button onClick={() => toggle(u)}>{u.enabled ? "停用" : "启用"}</Button> <Button onClick={() => reset(u)}>重置密码</Button></span> }));
  return (<Card title="账号管理（底座 /api/_core/users）">
    <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
      <Input placeholder="邮箱" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
      <Input placeholder="姓名" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
      <select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>{ROLES.map((x) => <option key={x}>{x}</option>)}</select>
      <Button onClick={create}>新建账号</Button><span>{msg}</span>
    </div>
    {users.error ? <Empty text={users.error} /> : rows.length ? <Table rows={rows} columns={[{ key: "id", title: "ID" }, { key: "email", title: "邮箱" }, { key: "name", title: "姓名" }, { key: "r", title: "角色" }, { key: "st", title: "状态" }, { key: "op", title: "操作" }]} /> : <Empty />}
  </Card>);
}
