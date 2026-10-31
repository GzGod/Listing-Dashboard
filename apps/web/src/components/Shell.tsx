"use client";
import React from "react";
import { useApi, getToken } from "@app/ui";
import type { MenuItem } from "@app/shared";

/** 统一外壳：顶栏 + 左侧菜单。菜单来自 /api/_core/menu（各模块 manifest 自动生成） */
export function Shell({ area, children }: { area: "front" | "admin"; children: React.ReactNode }) {
  const [ready, setReady] = React.useState(false);
  React.useEffect(() => { if (!getToken() && process.env.NEXT_PUBLIC_AUTH_DISABLED !== "1") location.href = "/login"; else setReady(true); }, []);
  const menu = useApi<MenuItem[]>(ready ? "/api/_core/menu" : null);
  const user = typeof window !== "undefined" ? JSON.parse(localStorage.getItem("dashboard_user") ?? "null") : null;
  const base = area === "admin" ? "/admin" : "";
  const items = (menu.data ?? []).filter((m) => m.area === area && !m.hidden); // hidden 路由（含动态路由）不进菜单
  if (!ready) return null;
  return (<div style={{ display: "flex", minHeight: "100vh" }}>
    <nav style={{ width: 210, background: area === "admin" ? "#111827" : "#1e3a8a", color: "#fff", padding: 16 }}>
      <div style={{ fontWeight: 700, marginBottom: 16 }}>{area === "admin" ? "看板后台" : "Crypto 上币看板"}</div>
      <a href={base || "/"} style={link}>首页</a>
      {items.map((m) => (<a key={m.module + m.path} href={`${base}/m/${m.module}${m.path === "/" ? "" : m.path}`} style={{ ...link, opacity: m.available ? 1 : 0.5 }}>
        {m.title}{m.available ? "" : "（不可用）"}</a>))}
      <hr style={{ borderColor: "#374151" }} />
      <a href={area === "admin" ? "/" : "/admin"} style={link}>{area === "admin" ? "去前台" : "去后台"}</a>
      <a href="#" onClick={() => { localStorage.clear(); location.href = "/login"; }} style={link}>退出 {user?.name ?? ""}</a>
    </nav>
    <main style={{ flex: 1, padding: 24 }}>{children}</main>
  </div>);
}
const link: React.CSSProperties = { display: "block", color: "#e5e7eb", textDecoration: "none", padding: "6px 0" };
