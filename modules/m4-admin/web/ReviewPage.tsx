"use client";
import React from "react";
import { api, useApi, Card, Button, Empty } from "@app/ui";
const STATUSES = ["pending", "confirmed", "rejected", "all"] as const;
const LABEL: Record<string, string> = { pending: "待确认", confirmed: "已确认", rejected: "已驳回", all: "全部" };

/** 按帖子分组；组内候选多选：勾选 = 确认，未勾选 = 驳回；一个都不勾 = 整组驳回 */
function Group({ it, onDone }: { it: any; onDone: (msg?: string) => void }) {
  const id = it.postId ?? it.post_id;
  const cands: any[] = it.candidates ?? [];
  const [sel, setSel] = React.useState<number[]>([]);
  const [msg, setMsg] = React.useState("");
  const pending = (it.status ?? "pending") === "pending";
  const submit = async () => {
    const tip = sel.length ? `确认 ${sel.length} 个、驳回 ${cands.length - sel.length} 个候选？` : "一个都没勾，该帖待确认候选全部驳回？";
    if (!confirm(tip)) return;
    try { const r = await api<any>(`/api/m4-admin/review/posts/${id}`, { method: "POST", json: { projectIds: sel } }); onDone(`帖子 #${id}：确认 ${r.result?.confirmed?.length ?? 0}、驳回 ${r.result?.rejected?.length ?? 0}`); }
    catch (e: any) { if (e?.status === 404) onDone(e.message); else setMsg(e?.message ?? String(e)); } // 404 = 已审核/不存在：提示并刷新队列
  };
  return (<div style={{ borderBottom: "1px solid #eee", padding: 8 }}>
    <div>帖子 #{id} {it.status && <b>[{LABEL[it.status] ?? it.status}]</b>} 「{it.matchedAlias ?? it.matched_alias ?? it.alias}」 <a href={it.postUrl ?? it.post_url} target="_blank" rel="noreferrer">原帖</a> {it.postText ?? it.post_text ?? it.text}</div>
    <div style={{ display: "flex", gap: 12, marginTop: 6, flexWrap: "wrap", alignItems: "center" }}>
      {cands.map((c) => <label key={c.projectId}>
        {pending ? <input type="checkbox" checked={sel.includes(c.projectId)} onChange={(e) => setSel(e.target.checked ? [...sel, c.projectId] : sel.filter((x) => x !== c.projectId))} /> : null}
        {" "}{c.name}{c.symbol ? ` (${c.symbol})` : ""} #{c.projectId} · <code>{c.matchedText ?? c.alias ?? it.matchedAlias ?? it.matched_alias}</code>{!pending && c.status ? ` · ${LABEL[c.status] ?? c.status}` : ""}
      </label>)}
      {pending && <Button onClick={submit}>{sel.length ? `提交（确认 ${sel.length} 个）` : "整组驳回"}</Button>}
      <span>{msg}</span>
    </div>
  </div>);
}

export default function ReviewPage() {
  const [status, setStatus] = React.useState<string>("pending");
  const q = useApi<{ source: string; items: any[] }>(`/api/m4-admin/review-queue?status=${status}`);
  const items = q.data?.items ?? [];
  const [note, setNote] = React.useState("");
  const done = (m?: string) => { setNote(m ?? ""); q.reload(); };
  return (<Card title={`AD-06 确认队列（数据来源：${q.data?.source ?? "…"}）`}>
    <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>{note && <span style={{ marginRight: 8 }}>{note}</span>}{STATUSES.map((s) => <Button key={s} onClick={() => setStatus(s)} style={s === status ? {} : { background: "#fff", color: "#111" }}>{LABEL[s]}</Button>)}</div>
    {q.error ? <Empty text={q.error} /> : !items.length ? <Empty text="没有记录" /> : items.map((it: any) => <Group key={it.post_id ?? it.postId} it={it} onDone={done} />)}
  </Card>);
}
