"use client";
import React from "react";
import { api, useApi, Card, Button, Input, Table, Empty } from "@app/ui";

export type Field = { key: string; title: string; placeholder?: string };
/** 通用列表 + 新增 + 删除。所有写操作走 /api/m4-admin/*，后端负责审计 */
export function Crud({ title, path, fields, columns, extra, editable }: { title: string; path: string; fields: Field[]; columns: { key: string; title: string }[]; extra?: (row: any) => Record<string, any>; editable?: string }) {
  const list = useApi<any[]>(`/api/m4-admin${path}`);
  const [form, setForm] = React.useState<Record<string, string>>({});
  const [msg, setMsg] = React.useState("");
  const add = async () => {
    try { await api(`/api/m4-admin${path}`, { method: "POST", json: form }); setForm({}); setMsg("已保存"); list.reload(); } catch (e) { setMsg(String((e as Error).message)); }
  };
  const del = async (id: number) => { if (confirm(`删除 #${id}？`)) { await api(`/api/m4-admin${path}/${id}`, { method: "DELETE" }); list.reload(); } };
  const edit = async (r: any) => { const v = prompt(`修改 ${editable}`, String(r[editable!] ?? "")); if (v == null) return; await api(`/api/m4-admin${path}/${r.id}`, { method: "PUT", json: { [editable!]: v } }); list.reload(); };
  const rows = (list.data ?? []).map((r) => ({ ...r, ...(extra ? extra(r) : {}), _op: <span>{editable && <Button onClick={() => edit(r)}>修改</Button>} <Button onClick={() => del(r.id)}>删除</Button></span> }));
  return (<Card title={title}>
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
      {fields.map((f) => <Input key={f.key} placeholder={f.placeholder ?? f.title} value={form[f.key] ?? ""} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} />)}
      <Button onClick={add}>新增</Button><span>{msg}</span>
    </div>
    {list.error ? <Empty text={list.error} /> : rows.length ? <Table rows={rows} columns={[...columns, { key: "_op", title: "操作" }]} /> : <Empty />}
  </Card>);
}
