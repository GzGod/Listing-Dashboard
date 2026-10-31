"use client";
// 底座基础组件 + 接口调用工具。模块页面只用这里的组件和 api()，不要各写一套。
import React from "react";
import type { ApiError } from "@app/shared"; // 统一错误体的类型

/** 登录 token 在 localStorage 里的键名（可用 NEXT_PUBLIC_TOKEN_KEY 改） */
export const TOKEN_KEY: string = process.env.NEXT_PUBLIC_TOKEN_KEY || "dashboard_token";
export function getToken() { return typeof window === "undefined" ? null : window.localStorage.getItem(TOKEN_KEY); }
/** api() 出错时抛出：status = HTTP 状态码，code = 统一错误体里的 code（如 FORBIDDEN、MODULE_TIMEOUT） */
export class ApiRequestError extends Error {
  constructor(public status: number, public code: string, message: string, public module?: string, public requestId?: string) { super(message); this.name = "ApiError"; }
}
export { ApiRequestError as ApiError };
/** 调后端接口：自动带登录 token；出错抛出统一错误格式里的 message */
export async function api<T = any>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = { ...(init.headers as any) };
  const t = getToken(); if (t) headers.authorization = `Bearer ${t}`;
  if (init.json !== undefined) { headers["content-type"] = "application/json"; init.body = JSON.stringify(init.json); }
  const res = await fetch(path, { ...init, headers });
  if (res.status === 401 && typeof window !== "undefined" && !path.includes("/auth/login")) { window.location.href = "/login"; }
  const body = res.headers.get("content-type")?.includes("json") ? await res.json() : await res.text();
  if (!res.ok) { const e = (body as ApiError)?.error; throw new ApiRequestError(res.status, e?.code ?? `HTTP_${res.status}`, e?.message ?? `HTTP ${res.status}`, e?.module, e?.requestId); }
  return body as T;
}
export function useApi<T = any>(path: string | null) {
  const [state, set] = React.useState<{ data?: T; error?: string; loading: boolean }>({ loading: !!path });
  const load = React.useCallback(() => { if (!path) return; set((s) => ({ ...s, loading: true }));
    api<T>(path).then((data) => set({ data, loading: false })).catch((e) => set({ error: e.message, loading: false })); }, [path]);
  React.useEffect(load, [load]);
  return { ...state, reload: load };
}
const box: React.CSSProperties = { background: "#fff", border: "1px solid #e5e7eb", borderRadius: 8, padding: 16, marginBottom: 16 };
export const Card = ({ title, children }: { title?: string; children: React.ReactNode }) => (
  <section style={box}>{title && <h3 style={{ margin: "0 0 12px", fontSize: 16 }}>{title}</h3>}{children}</section>);
export const Button = (p: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
  <button {...p} style={{ padding: "6px 14px", borderRadius: 6, border: "1px solid #2563eb", background: "#2563eb", color: "#fff", cursor: "pointer", ...p.style }} />);
export const Input = (p: React.InputHTMLAttributes<HTMLInputElement>) => (
  <input {...p} style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #d1d5db", ...p.style }} />);
export function Table<T extends Record<string, any>>({ rows, columns }: { rows: T[]; columns: { key: keyof T & string; title: string }[] }) {
  return (<table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
    <thead><tr>{columns.map((c) => <th key={c.key} style={{ textAlign: "left", borderBottom: "1px solid #e5e7eb", padding: 6 }}>{c.title}</th>)}</tr></thead>
    <tbody>{rows.map((r, i) => <tr key={i}>{columns.map((c) => <td key={c.key} style={{ borderBottom: "1px solid #f3f4f6", padding: 6 }}>{String(r[c.key] ?? "")}</td>)}</tr>)}</tbody>
  </table>);
}
export const Empty = ({ text = "暂无数据" }: { text?: string }) => <div style={{ color: "#9ca3af", padding: 24, textAlign: "center" }}>{text}</div>;

/** 前端可读配置（/api/_core/config/public：time.dayCutTimezone、ranking.windows、ranking.defaultWindow + 模块 public 键）。带缓存 */
let configPromise: Promise<Record<string, unknown>> | null = null;
export function getConfig(): Promise<Record<string, unknown>> { return (configPromise ??= api<Record<string, unknown>>("/api/_core/config/public").catch((e) => { configPromise = null; throw e; })); }
export function useConfig<T = unknown>(key?: string): { value?: T; all?: Record<string, unknown>; error?: string; loading: boolean } {
  const [st, set] = React.useState<{ all?: Record<string, unknown>; error?: string; loading: boolean }>({ loading: true });
  React.useEffect(() => { getConfig().then((all) => set({ all, loading: false })).catch((e) => set({ error: e.message, loading: false })); }, []);
  return { ...st, value: key ? (st.all?.[key] as T) : undefined };
}
/** 模块页面组件收到的 props（动态路由参数 + 查询参数） */
export interface ModulePageProps { params: Record<string, string>; searchParams: Record<string, string> }
/** 把 manifest 里的路由模式（如 "/notes/:id"）和实际路径匹配，返回参数；不匹配返回 null */
export function matchRoute(pattern: string, path: string): Record<string, string> | null {
  const names: string[] = [];
  const re = new RegExp("^" + pattern.replace(/\/+$/, "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, (_m, n) => { names.push(n); return "([^/]+)"; }) + "/?$");
  const m = re.exec(path.replace(/\/+$/, "") || "/"); if (!m) return null;
  return Object.fromEntries(names.map((n, i) => [n, decodeURIComponent(m[i + 1])]));
}
