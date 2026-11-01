"use client";
import React, { useState } from "react";
import { api, useApi } from "@app/ui";
import { ds } from "@app/ui/tokens";

// ─── types ────────────────────────────────────────────────────────────────────
interface Project { id: number; name: string; symbol: string; coingeckoId: string | null }
interface Exchange { id: number; name: string; enabled: boolean }
interface Sources {
  config: { xSource: string; marketSource: string; tz: string };
  projects: Project[];
  exchanges: Exchange[];
  sources: { id: string; name: string; mode: string; status: string; detail: string }[];
}
interface Mapping { project_id: number; exchange_id: number; base_symbol: string; note: string }
interface Run {
  kind: string; day: string; count: number; done: boolean; updated_at: string;
  detail?: { source?: string; failed?: (string | { personId: number; error: string })[]; missingPriceIds?: number[]; missing?: string[]; pending?: number[] };
}

const RUN_KIND_LABEL: Record<string, string> = {
  posts: "帖子采集", metrics: "指标更新", market: "行情采集", x_calls: "X 调用预算",
};

// ─── design helpers ────────────────────────────────────────────────────────────
type StatusVariant = "live" | "mock" | "error" | "neutral" | "pending";

function resolveVariant(mode: string, status: string): StatusVariant {
  if (mode === "mock" || mode === "placeholder") return "mock";
  if (mode === "manual") return "neutral";
  if (status.includes("错") || status.includes("失败") || status.includes("缺少")) return "error";
  if (status === "未接入" || status === "disabled" || status === "待接入") return "neutral";
  if (status === "已配置" || status === "正常" || status === "公开接口" || status === "手动录入") return "live";
  return "neutral";
}

const VARIANT_META: Record<StatusVariant, { dot: string; text: string; bg: string; border: string }> = {
  live:    { dot: ds.success,  text: ds.success,  bg: ds.successBg,  border: ds.successBorder },
  error:   { dot: ds.error,    text: ds.error,    bg: ds.errorBg,    border: ds.errorBorder },
  mock:    { dot: ds.mock,     text: ds.mock,     bg: ds.mockBg,     border: ds.mockBorder },
  neutral: { dot: ds.neutral,  text: ds.neutral,  bg: ds.neutralBg,  border: ds.neutralBorder },
  pending: { dot: ds.warning,  text: ds.warning,  bg: ds.warningBg,  border: ds.warningBorder },
};

function StatusDot({ variant, label }: { variant: StatusVariant; label: string }) {
  const m = VARIANT_META[variant];
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: ds.txSm, color: m.text, fontWeight: 500 }}>
      <span style={{ width: 6, height: 6, borderRadius: ds.rFull, background: m.dot, flexShrink: 0 }} />
      {label}
    </span>
  );
}

function Tag({ variant, children }: { variant: StatusVariant; children: React.ReactNode }) {
  const m = VARIANT_META[variant];
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      padding: "2px 8px", borderRadius: ds.rFull,
      fontSize: ds.txXs, fontWeight: 500,
      background: m.bg, color: m.text, border: `1px solid ${m.border}`,
    }}>
      <span style={{ width: 5, height: 5, borderRadius: ds.rFull, background: m.dot }} />
      {children}
    </span>
  );
}

// ─── shared primitives ─────────────────────────────────────────────────────────
const Btn = ({
  variant = "primary", size = "md", disabled, onClick, children, type = "button",
}: {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
  disabled?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
  type?: "button" | "submit";
}) => {
  const styles: Record<string, React.CSSProperties> = {
    primary:   { background: ds.accent, color: "#fff", border: `1px solid ${ds.accent}` },
    secondary: { background: ds.surface, color: ds.text, border: `1px solid ${ds.border}` },
    ghost:     { background: "transparent", color: ds.text2, border: "1px solid transparent" },
    danger:    { background: ds.surface, color: ds.error, border: `1px solid ${ds.border}` },
  };
  const pad = size === "sm" ? "4px 10px" : "6px 14px";
  return (
    <button type={type} disabled={disabled} onClick={onClick} style={{
      ...styles[variant],
      padding: pad,
      borderRadius: ds.r,
      fontSize: ds.txBase,
      fontWeight: 500,
      cursor: disabled ? "not-allowed" : "pointer",
      opacity: disabled ? 0.55 : 1,
      whiteSpace: "nowrap",
      lineHeight: 1.4,
    }}>{children}</button>
  );
};

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: ds.txSm, color: ds.text2, fontWeight: 500 }}>
    {label}
    {children}
  </label>
);

const inputStyle: React.CSSProperties = {
  padding: "6px 10px", borderRadius: ds.r,
  border: `1px solid ${ds.border}`,
  fontSize: ds.txBase, color: ds.text,
  background: ds.surface, outline: "none",
  width: "100%", boxSizing: "border-box",
};

const selStyle: React.CSSProperties = { ...inputStyle, appearance: "none", paddingRight: 28,
  backgroundImage: `url("data:image/svg+xml,%3Csvg width='10' height='6' viewBox='0 0 10 6' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%239099a8' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")`,
  backgroundRepeat: "no-repeat", backgroundPosition: "right 10px center",
};

// ─── tabs ──────────────────────────────────────────────────────────────────────
type Tab = "overview" | "mappings" | "runs";
const TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "概览" },
  { id: "mappings", label: "资产映射" },
  { id: "runs",     label: "运行记录 / 设置" },
];

// ─── page ──────────────────────────────────────────────────────────────────────
export default function SourcesPage() {
  const sources = useApi<Sources>("/api/m1-collector/sources");
  const status  = useApi<{ runs: Run[]; pendingEvents: number }>("/api/m1-collector/status");
  const maps    = useApi<Mapping[]>("/api/m1-collector/asset-mappings");

  const [tab, setTab]       = useState<Tab>("overview");
  const [x, setX]           = useState<string | null>(null);
  const [market, setMarket] = useState<string | null>(null);
  const [date, setDate]     = useState("");
  const [busy, setBusy]     = useState(false);
  const [toast, setToast]   = useState<{ msg: string; ok: boolean } | null>(null);
  const [mapping, setMapping] = useState({ projectId: "", exchangeId: "", baseSymbol: "", note: "" });

  const refresh = () => { sources.reload(); status.reload(); maps.reload(); };

  const act = async (work: () => Promise<unknown>, success: string) => {
    setBusy(true); setToast(null);
    try { await work(); setToast({ msg: success, ok: true }); }
    catch (e) { setToast({ msg: (e as Error).message, ok: false }); }
    finally { setBusy(false); refresh(); }
  };

  // ── loading / error guards ──────────────────────────────────────
  if (sources.loading && !sources.data) return (
    <div style={{ padding: 40, color: ds.text2, fontSize: ds.txBase }}>正在加载数据源…</div>
  );
  if (sources.error || !sources.data) return (
    <div style={{ padding: 40, color: ds.error, fontSize: ds.txBase }}>{sources.error ?? "数据源信息不可用"}</div>
  );

  const data = sources.data;
  const pName = (id: number) => data.projects.find((p) => p.id === id)?.name ?? `项目 ${id}`;
  const eName = (id: number) => data.exchanges.find((p) => p.id === id)?.name ?? `交易所 ${id}`;
  const errorSources = data.sources.filter((s) => resolveVariant(s.mode, s.status) === "error");
  const missingCgIds = data.projects.filter((p) => !p.coingeckoId);
  const pendingEvents = status.data?.pendingEvents ?? 0;
  const actionableCount = errorSources.length + missingCgIds.length + (pendingEvents > 0 ? 1 : 0);

  return (
    <div style={{ fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif", color: ds.text }}>
      {/* ── page header ── */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: ds.txXl, fontWeight: 600, color: ds.text, letterSpacing: "-0.02em" }}>
              数据源管理
            </h1>
            <p style={{ margin: "4px 0 0", fontSize: ds.txSm, color: ds.text2 }}>
              按 {data.config.tz} 切日 · 缺失数据不填零，不进入排名
            </p>
          </div>
          {actionableCount > 0 && (
            <div style={{
              display: "flex", alignItems: "center", gap: 8,
              padding: "7px 14px", borderRadius: ds.rMd,
              background: ds.errorBg, border: `1px solid ${ds.errorBorder}`,
              fontSize: ds.txSm, color: ds.error, fontWeight: 500,
            }}>
              <span style={{ width: 6, height: 6, borderRadius: ds.rFull, background: ds.error }} />
              {actionableCount} 个问题待处理
            </div>
          )}
        </div>
      </div>

      {/* ── toast ── */}
      {toast && (
        <div role="status" aria-live="polite" style={{
          marginBottom: 16,
          padding: "9px 14px",
          borderRadius: ds.rMd,
          fontSize: ds.txBase,
          background: toast.ok ? ds.successBg : ds.errorBg,
          color: toast.ok ? ds.success : ds.error,
          border: `1px solid ${toast.ok ? ds.successBorder : ds.errorBorder}`,
          display: "flex", alignItems: "center", gap: 8,
        }}>
          <span style={{ width: 6, height: 6, borderRadius: ds.rFull, background: toast.ok ? ds.success : ds.error, flexShrink: 0 }} />
          {toast.msg}
        </div>
      )}

      {/* ── tabs ── */}
      <div style={{ display: "flex", gap: 0, borderBottom: `1px solid ${ds.border}`, marginBottom: 24 }}>
        {TABS.map((t) => (
          <button key={t.id} type="button" onClick={() => setTab(t.id)} style={{
            padding: "9px 18px",
            background: "none", border: "none",
            borderBottom: tab === t.id ? `2px solid ${ds.accent}` : "2px solid transparent",
            marginBottom: -1,
            fontSize: ds.txBase, fontWeight: tab === t.id ? 600 : 400,
            color: tab === t.id ? ds.accent : ds.text2,
            cursor: "pointer",
          }}>{t.label}</button>
        ))}
      </div>

      {/* ══════════════ TAB: overview ══════════════ */}
      {tab === "overview" && (
        <div>
          {/* actionable issues */}
          {(errorSources.length > 0 || missingCgIds.length > 0 || pendingEvents > 0) && (
            <div style={{
              background: ds.warningBg, border: `1px solid ${ds.warningBorder}`,
              borderRadius: ds.rMd, padding: "12px 16px", marginBottom: 20,
            }}>
              <p style={{ margin: "0 0 8px", fontSize: ds.txBase, fontWeight: 600, color: ds.warning }}>待处理</p>
              <ul style={{ margin: 0, padding: "0 0 0 18px", fontSize: ds.txBase, color: ds.text, lineHeight: 1.8 }}>
                {errorSources.map((s) => (
                  <li key={s.id}>{s.name} 采集失败：{s.detail}</li>
                ))}
                {missingCgIds.length > 0 && (
                  <li>
                    {missingCgIds.map((p) => p.name).join("、")} 缺少 CoinGecko ID，
                    <a href="/admin/m/m4-admin/projects" style={{ color: ds.accent, textDecoration: "none" }}>前往项目与上币维护</a>
                  </li>
                )}
                {pendingEvents > 0 && <li>{pendingEvents} 个同步事件待投递</li>}
              </ul>
            </div>
          )}

          {/* source grid */}
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
            gap: 12,
          }}>
            {data.sources.map((s) => {
              const variant = resolveVariant(s.mode, s.status);
              return (
                <div key={s.id} style={{
                  background: ds.surface,
                  border: `1px solid ${variant === "error" ? ds.errorBorder : ds.border}`,
                  borderRadius: ds.rMd,
                  padding: "14px 16px",
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8, marginBottom: 6 }}>
                    <span style={{ fontSize: ds.txMd, fontWeight: 600, color: ds.text, lineHeight: 1.3 }}>{s.name}</span>
                    <Tag variant={variant}>{s.status}</Tag>
                  </div>
                  <p style={{ margin: 0, fontSize: ds.txSm, color: ds.text2, lineHeight: 1.6 }}>{s.detail}</p>
                </div>
              );
            })}
          </div>

          {/* last run summary */}
          {status.data && (
            <div style={{ marginTop: 24, background: ds.surface, border: `1px solid ${ds.border}`, borderRadius: ds.rMd }}>
              <div style={{
                padding: "12px 16px",
                borderBottom: `1px solid ${ds.borderLight}`,
                display: "flex", alignItems: "center", justifyContent: "space-between",
              }}>
                <span style={{ fontSize: ds.txBase, fontWeight: 600, color: ds.text }}>最近同步</span>
                <span style={{ fontSize: ds.txSm, color: ds.text2 }}>
                  {pendingEvents > 0
                    ? <StatusDot variant="pending" label={`${pendingEvents} 个事件待投递`} />
                    : <StatusDot variant="live" label="事件队列空" />}
                </span>
              </div>
              <div style={{ padding: "4px 0" }}>
                {(status.data.runs ?? []).slice(0, 5).map((r) => {
                  const isDone   = r.kind === "x_calls" || r.done;
                  const hasError = !!r.detail?.failed?.length || !!r.detail?.missingPriceIds?.length;
                  const runVariant: StatusVariant = hasError ? "error" : isDone ? "live" : "pending";
                  const runLabel  = r.kind === "x_calls" ? "已使用" : r.done ? "已完成" : "待补齐";
                  return (
                    <div key={`${r.kind}:${r.day}`} style={{
                      display: "flex", alignItems: "baseline", flexWrap: "wrap",
                      gap: "4px 12px", padding: "10px 16px",
                      borderBottom: `1px solid ${ds.borderLight}`,
                      fontSize: ds.txBase,
                    }}>
                      <span style={{ fontWeight: 500, color: ds.text, minWidth: 80 }}>{RUN_KIND_LABEL[r.kind] ?? r.kind}</span>
                      <span style={{ color: ds.text2, fontSize: ds.txSm, fontVariantNumeric: "tabular-nums" }}>{r.day}</span>
                      <span style={{ color: ds.text2, fontSize: ds.txSm }}>{r.count} 条</span>
                      <StatusDot variant={runVariant} label={runLabel} />
                      {r.detail?.source === "mock" && <Tag variant="mock">演示</Tag>}
                      {!!r.detail?.failed?.length && (
                        <span style={{ width: "100%", fontSize: ds.txSm, color: ds.error, marginTop: 2 }}>
                          {r.detail.failed.map((f) => typeof f === "string" ? f : `账号 ${f.personId}：${f.error}`).join("；")}
                        </span>
                      )}
                      {!!r.detail?.missing?.length && (
                        <span style={{ width: "100%", fontSize: ds.txSm, color: ds.text2, marginTop: 2 }}>
                          本次有 {r.detail.missing.length} 条帖子未返回指标，保留已有值。
                        </span>
                      )}
                      {!!r.detail?.missingPriceIds?.length && (
                        <span style={{ width: "100%", fontSize: ds.txSm, color: ds.error, marginTop: 2 }}>
                          {r.detail.missingPriceIds.length} 个项目缺少 CoinGecko ID，未采集币价。
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ══════════════ TAB: mappings ══════════════ */}
      {tab === "mappings" && (
        <div>
          {missingCgIds.length > 0 && (
            <div style={{
              padding: "10px 14px", marginBottom: 20,
              background: ds.warningBg, border: `1px solid ${ds.warningBorder}`,
              borderRadius: ds.rMd, fontSize: ds.txSm, color: ds.warning,
            }}>
              {missingCgIds.map((p) => p.name).join("、")} 缺少 CoinGecko ID，请在{" "}
              <a href="/admin/m/m4-admin/projects" style={{ color: ds.accent, textDecoration: "none", fontWeight: 500 }}>项目与上币</a>
              {" "}中维护。
            </div>
          )}

          {/* form panel */}
          <div style={{ background: ds.surface, border: `1px solid ${ds.border}`, borderRadius: ds.rMd, padding: "20px 20px 16px", marginBottom: 16 }}>
            <p style={{ margin: "0 0 14px", fontSize: ds.txBase, fontWeight: 600, color: ds.text }}>新增资产映射</p>
            <p style={{ margin: "0 0 16px", fontSize: ds.txSm, color: ds.text2, lineHeight: 1.6 }}>
              同名 ticker 或交易所使用不同符号的代币，请核实合约与官方信息后设置映射。同一交易所资产只能绑定一个项目。
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(180px,1fr))", gap: 12, marginBottom: 14 }}>
              <Field label="项目">
                <select style={selStyle} value={mapping.projectId}
                  onChange={(e) => setMapping({ ...mapping, projectId: e.target.value })}>
                  <option value="">请选择</option>
                  {data.projects.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.symbol})</option>)}
                </select>
              </Field>
              <Field label="交易所">
                <select style={selStyle} value={mapping.exchangeId}
                  onChange={(e) => setMapping({ ...mapping, exchangeId: e.target.value })}>
                  <option value="">请选择</option>
                  {data.exchanges.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </Field>
              <Field label="基础币符号">
                <input style={inputStyle} placeholder="如 BTC" value={mapping.baseSymbol}
                  aria-label="交易所基础币符号"
                  onChange={(e) => setMapping({ ...mapping, baseSymbol: e.target.value })} />
              </Field>
              <Field label="确认依据">
                <input style={inputStyle} placeholder="来源链接或说明" value={mapping.note}
                  aria-label="确认依据"
                  onChange={(e) => setMapping({ ...mapping, note: e.target.value })} />
              </Field>
            </div>
            <Btn disabled={busy} onClick={() =>
              act(() => api("/api/m1-collector/asset-mappings", { method: "PUT", json: mapping }), "资产映射已保存，下次采集生效")
            }>保存映射</Btn>
          </div>

          {/* existing mappings */}
          {maps.error && <p role="alert" style={{ color: ds.error, fontSize: ds.txSm, marginBottom: 12 }}>{maps.error}</p>}
          {maps.loading && !maps.data && <p style={{ color: ds.text2, fontSize: ds.txSm }}>加载中…</p>}
          {(maps.data ?? []).length > 0 && (
            <div style={{ background: ds.surface, border: `1px solid ${ds.border}`, borderRadius: ds.rMd, overflow: "hidden" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ds.txBase }}>
                <thead>
                  <tr style={{ background: ds.bg }}>
                    {["项目", "交易所", "符号", "确认依据", ""].map((h) => (
                      <th key={h} style={{
                        textAlign: "left", padding: "9px 14px",
                        fontSize: ds.txSm, fontWeight: 600, color: ds.text2,
                        borderBottom: `1px solid ${ds.border}`,
                        whiteSpace: "nowrap",
                      }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(maps.data ?? []).map((m) => (
                    <tr key={`${m.project_id}:${m.exchange_id}`} style={{ borderBottom: `1px solid ${ds.borderLight}` }}>
                      <td style={{ padding: "10px 14px", color: ds.text }}>{pName(m.project_id)}</td>
                      <td style={{ padding: "10px 14px", color: ds.text }}>{eName(m.exchange_id)}</td>
                      <td style={{ padding: "10px 14px", fontFamily: "monospace", color: ds.text }}>{m.base_symbol}</td>
                      <td style={{ padding: "10px 14px", color: ds.text2, maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.note}</td>
                      <td style={{ padding: "10px 14px", textAlign: "right" }}>
                        <Btn variant="danger" size="sm" disabled={busy}
                          onClick={() => act(() => api(`/api/m1-collector/asset-mappings/${m.project_id}/${m.exchange_id}`, { method: "DELETE" }), "映射已删除")}>
                          删除
                        </Btn>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {(maps.data ?? []).length === 0 && !maps.loading && (
            <p style={{ color: ds.text3, fontSize: ds.txSm, textAlign: "center", padding: "24px 0" }}>暂无资产映射</p>
          )}
        </div>
      )}

      {/* ══════════════ TAB: runs / settings ══════════════ */}
      {tab === "runs" && (
        <div>
          {/* settings panel */}
          <div style={{ background: ds.surface, border: `1px solid ${ds.border}`, borderRadius: ds.rMd, marginBottom: 16 }}>
            <div style={{ padding: "14px 20px", borderBottom: `1px solid ${ds.borderLight}` }}>
              <span style={{ fontSize: ds.txBase, fontWeight: 600, color: ds.text }}>采集设置</span>
            </div>
            <div style={{ padding: "16px 20px" }}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end", marginBottom: 14 }}>
                <Field label="X 数据来源">
                  <select style={{ ...selStyle, width: 160 }} value={x ?? data.config.xSource} onChange={(e) => setX(e.target.value)}>
                    <option value="disabled">未接入</option>
                    <option value="xapi">官方 X API</option>
                    <option value="mock">演示数据</option>
                  </select>
                </Field>
                <Field label="行情来源">
                  <select style={{ ...selStyle, width: 140 }} value={market ?? data.config.marketSource} onChange={(e) => setMarket(e.target.value)}>
                    <option value="live">公开接口</option>
                    <option value="mock">演示数据</option>
                  </select>
                </Field>
                <Btn disabled={busy} onClick={() => act(async () => {
                  if (x != null) await api("/api/_core/config/m1-collector.xSource", { method: "PUT", json: { value: x } });
                  if (market != null) await api("/api/_core/config/m1-collector.marketSource", { method: "PUT", json: { value: market } });
                  setX(null); setMarket(null);
                }, "采集设置已保存")}>保存设置</Btn>
              </div>
              <p style={{ margin: 0, fontSize: ds.txSm, color: ds.text2, lineHeight: 1.6 }}>
                X 密钥和 CoinGecko 密钥通过服务器环境变量设置；演示数据会明确标记来源。更改采集频率后需重启 worker。
              </p>
            </div>
            <div style={{ padding: "14px 20px", borderTop: `1px solid ${ds.borderLight}` }}>
              <p style={{ margin: "0 0 12px", fontSize: ds.txSm, fontWeight: 600, color: ds.text }}>手动触发</p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "flex-end" }}>
                <Btn variant="secondary" disabled={busy}
                  onClick={() => act(() => api("/api/m1-collector/run/posts", { method: "POST" }), "帖子采集完成")}>
                  采集帖子
                </Btn>
                <Btn variant="secondary" disabled={busy}
                  onClick={() => act(() => api("/api/m1-collector/run/refetch", { method: "POST" }), "指标回抓完成")}>
                  更新帖子指标
                </Btn>
                <Field label="行情日期">
                  <input type="date" style={{ ...inputStyle, width: 160 }} value={date} onChange={(e) => setDate(e.target.value)} />
                </Field>
                <Btn variant="secondary" disabled={busy}
                  onClick={() => act(() => api("/api/m1-collector/run/market", { method: "POST", json: date ? { date } : {} }), "行情采集完成")}>
                  采集行情
                </Btn>
              </div>
              <p style={{ margin: "10px 0 0", fontSize: ds.txSm, color: ds.text2, lineHeight: 1.6 }}>
                不填日期时采集最近完整日；当天未结束的行情不能写入每日快照。
              </p>
            </div>
          </div>

          {/* full run log */}
          <div style={{ background: ds.surface, border: `1px solid ${ds.border}`, borderRadius: ds.rMd, overflow: "hidden" }}>
            <div style={{ padding: "12px 16px", borderBottom: `1px solid ${ds.borderLight}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: ds.txBase, fontWeight: 600, color: ds.text }}>运行记录</span>
              <span style={{ fontSize: ds.txSm, color: ds.text2 }}>
                等待同步事件：<strong style={{ color: pendingEvents > 0 ? ds.warning : ds.success, fontWeight: 600 }}>{pendingEvents}</strong>
              </span>
            </div>
            {status.error && <p role="alert" style={{ color: ds.error, fontSize: ds.txSm, padding: "12px 16px", margin: 0 }}>{status.error}</p>}
            {(status.data?.runs ?? []).map((r) => {
              const isDone   = r.kind === "x_calls" || r.done;
              const hasError = !!r.detail?.failed?.length || !!r.detail?.missingPriceIds?.length;
              const runVariant: StatusVariant = hasError ? "error" : isDone ? "live" : "pending";
              const runLabel  = r.kind === "x_calls" ? "已使用" : r.done ? "已完成" : "待补齐";
              return (
                <div key={`${r.kind}:${r.day}`} style={{
                  padding: "11px 16px",
                  borderBottom: `1px solid ${ds.borderLight}`,
                  fontSize: ds.txBase,
                }}>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 16px", alignItems: "baseline" }}>
                    <span style={{ fontWeight: 500, color: ds.text, minWidth: 80 }}>{RUN_KIND_LABEL[r.kind] ?? r.kind}</span>
                    <span style={{ color: ds.text2, fontSize: ds.txSm, fontVariantNumeric: "tabular-nums" }}>{r.day}</span>
                    <span style={{ color: ds.text2, fontSize: ds.txSm }}>{r.count} 条</span>
                    <StatusDot variant={runVariant} label={runLabel} />
                    {r.detail?.source === "mock" && <Tag variant="mock">演示</Tag>}
                  </div>
                  {!!r.detail?.failed?.length && (
                    <p style={{ color: ds.error, fontSize: ds.txSm, margin: "4px 0 0" }}>
                      {r.detail.failed.map((f) => typeof f === "string" ? f : `账号 ${f.personId}：${f.error}`).join("；")}
                    </p>
                  )}
                  {!!r.detail?.missing?.length && (
                    <p style={{ color: ds.text2, fontSize: ds.txSm, margin: "4px 0 0" }}>
                      本次有 {r.detail.missing.length} 条帖子未返回指标，保留已有值。
                    </p>
                  )}
                  {!!r.detail?.missingPriceIds?.length && (
                    <p style={{ color: ds.error, fontSize: ds.txSm, margin: "4px 0 0" }}>
                      {r.detail.missingPriceIds.length} 个项目缺少 CoinGecko ID，未采集币价。
                    </p>
                  )}
                  {!!r.detail?.pending?.length && (
                    <p style={{ color: ds.text2, fontSize: ds.txSm, margin: "4px 0 0" }}>
                      仍有 {r.detail.pending.length} 个账号待继续分页。
                    </p>
                  )}
                </div>
              );
            })}
            {(status.data?.runs ?? []).length === 0 && (
              <p style={{ color: ds.text3, fontSize: ds.txSm, textAlign: "center", padding: "24px 0" }}>暂无运行记录</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
