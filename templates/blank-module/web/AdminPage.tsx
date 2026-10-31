"use client";
import React from "react";
import { api, useApi, Card, Button, Input, Table, Empty } from "@app/ui";
export default function AdminPage() {
  const items = useApi<any[]>("/api/__NAME__/items");
  const [title, setTitle] = React.useState("");
  const add = async () => { await api("/api/__NAME__/items", { method: "POST", json: { title } }); setTitle(""); items.reload(); };
  return (<Card title="__NAME__">
    <div style={{ display: "flex", gap: 8, marginBottom: 12 }}><Input value={title} onChange={(e) => setTitle(e.target.value)} /><Button onClick={add}>新增</Button></div>
    {items.data?.length ? <Table rows={items.data} columns={[{ key: "id", title: "ID" }, { key: "title", title: "标题" }]} /> : <Empty />}
  </Card>);
}
