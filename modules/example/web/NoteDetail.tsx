"use client";
import { useApi, useConfig, Card, Empty, type ModulePageProps } from "@app/ui";
// 动态路由示例：/m/example/notes/:id，参数从 props.params 拿，查询参数从 props.searchParams 拿
export default function NoteDetail({ params, searchParams }: ModulePageProps) {
  const note = useApi<any>(`/api/example/notes/${encodeURIComponent(params.id)}`);
  const tz = useConfig<string>("time.dayCutTimezone");
  return (<Card title={`笔记 #${params.id}`}>
    {note.data ? <div data-testid="note-text">{note.data.text}</div> : <Empty text={note.loading ? "加载中" : "没有这条笔记"} />}
    <div style={{ color: "#6b7280", fontSize: 12, marginTop: 8 }}>from={searchParams.from ?? "-"} · 切日时区 {tz.value ?? "…"}</div>
  </Card>);
}
