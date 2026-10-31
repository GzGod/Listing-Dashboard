"use client";
import React from "react";
import { api, useApi, Card, Button, Input, Table, Empty } from "@app/ui";

export default function AdminPage() {
  const notes = useApi<any[]>("/api/example/notes");
  const projects = useApi<{ count: number }>("/api/example/projects-count");
  const [text, setText] = React.useState("");
  const [msg, setMsg] = React.useState("");
  const add = async () => { await api("/api/example/notes", { method: "POST", json: { text } }); setText(""); notes.reload(); };
  const emit = async () => { await api("/api/example/emit", { method: "POST" }); setMsg("已发出 recalc.requested"); };
  return (<div>
    <Card title="示例模块（后台）">核心表 projects 共 {projects.data?.count ?? "…"} 个项目（只读）。</Card>
    <Card title="自有表 m_example_notes">
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="写一条笔记" />
        <Button onClick={add}>新增（写审计日志）</Button>
        <Button onClick={emit} style={{ background: "#059669", borderColor: "#059669" }}>发事件</Button>
        <span>{msg}</span>
      </div>
      <div style={{ fontSize: 12, marginBottom: 8 }}>{notes.data?.[0] && <a href={`/m/example/notes/${notes.data[0].id}?from=admin`}>打开最新一条的详情页（动态路由）</a>}</div>
      {notes.error ? <Empty text={notes.error} /> : notes.data?.length ? <Table rows={notes.data} columns={[{ key: "id", title: "ID" }, { key: "text", title: "内容" }, { key: "source", title: "来源" }]} /> : <Empty />}
    </Card>
  </div>);
}
