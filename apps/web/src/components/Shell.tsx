"use client";
import React from "react";
import { useApi, getToken, useConfig } from "@app/ui";
import { ds } from "@app/ui/tokens";
import type { MenuItem } from "@app/shared";

export function Shell({ area, children }: { area: "front" | "admin"; children: React.ReactNode }) {
  const [ready, setReady] = React.useState(false);
  const [path, setPath] = React.useState("");
  const [mobile, setMobile] = React.useState(false);
  const [sideOpen, setSideOpen] = React.useState(false);
  React.useEffect(() => {
    if (!getToken()) { location.href = "/login"; return; }
    setPath(window.location.pathname);
    const mq = window.matchMedia("(max-width: 767px)");
    setMobile(mq.matches);
    const onChange = (e: MediaQueryListEvent) => { setMobile(e.matches); if (!e.matches) setSideOpen(false); };
    mq.addEventListener("change", onChange);
    setReady(true);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  const menu = useApi<MenuItem[]>(ready ? "/api/_core/menu" : null);
  const sourceConfig = useConfig();
  const user = typeof window !== "undefined" ? JSON.parse(localStorage.getItem("dashboard_user") ?? "null") : null;
  const base = area === "admin" ? "/admin" : "";
  const items = (menu.data ?? []).filter((m) => m.area === area && !m.hidden);
  const hasMock =
    sourceConfig.all?.["m1-collector.marketSource"] === "mock" ||
    sourceConfig.all?.["m1-collector.xSource"] === "mock";

  if (!ready) return null;

  const isActive = (href: string) => path === href || path.startsWith(href + "/");

  const sidebarContent = (
    <>
      {/* Wordmark */}
      <div style={{
        padding: "18px 20px 16px",
        borderBottom: `1px solid ${ds.sidebarBorder}`,
        display: "flex", alignItems: "center", gap: 10,
      }}>
        <div style={{
          width: 28, height: 28, borderRadius: ds.r,
          background: ds.accent, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
        }}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <rect x="1" y="1" width="5" height="5" rx="1" fill="white" fillOpacity="0.9"/>
            <rect x="8" y="1" width="5" height="5" rx="1" fill="white" fillOpacity="0.5"/>
            <rect x="1" y="8" width="5" height="5" rx="1" fill="white" fillOpacity="0.5"/>
            <rect x="8" y="8" width="5" height="5" rx="1" fill="white" fillOpacity="0.9"/>
          </svg>
        </div>
        <span style={{ fontSize: ds.txMd, fontWeight: 600, color: ds.sidebarTextActive, letterSpacing: "-0.01em", flex: 1 }}>
          {area === "admin" ? "看板后台" : "上币看板"}
        </span>
        {mobile && (
          <button onClick={() => setSideOpen(false)} aria-label="关闭菜单" style={{
            background: "none", border: "none", cursor: "pointer", padding: 4,
            color: ds.sidebarText, lineHeight: 1,
          }}>✕</button>
        )}
      </div>

      {/* Area toggle */}
      <div style={{ padding: "8px 12px", borderBottom: `1px solid ${ds.sidebarBorder}` }}>
        <div style={{ display: "flex", gap: 2, background: "rgba(255,255,255,0.06)", borderRadius: ds.r, padding: 2 }}>
          {(["front", "admin"] as const).map((a) => (
            <a key={a} href={a === "admin" ? "/admin" : "/"}
              style={{
                flex: 1, textAlign: "center", textDecoration: "none",
                padding: "4px 0", borderRadius: ds.rSm, fontSize: ds.txSm,
                fontWeight: area === a ? 600 : 400,
                color: area === a ? ds.sidebarTextActive : ds.sidebarText,
                background: area === a ? "rgba(255,255,255,0.1)" : "transparent",
              }}
            >{a === "admin" ? "后台" : "前台"}</a>
          ))}
        </div>
      </div>

      {/* Nav items */}
      <div style={{ flex: 1, padding: "8px 8px 0", overflowY: "auto" }}>
        <NavItem href={base || "/"} label="首页" active={isActive(base || "/")} icon={
          <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
            <path d="M7.5 1.5L1.5 7H3V13h4V9h1v4h4V7h1.5L7.5 1.5z" fill="currentColor"/>
          </svg>
        }/>
        {items.map((m) => {
          const href = `${base}/m/${m.module}${m.path === "/" ? "" : m.path}`;
          return (
            <NavItem key={m.module + m.path} href={href} label={m.title}
              active={isActive(href)} disabled={!m.available}/>
          );
        })}
      </div>

      {/* Footer */}
      <div style={{ padding: "8px 8px 0", borderTop: `1px solid ${ds.sidebarBorder}`, marginTop: 8 }}>
        <button
          onClick={() => { localStorage.clear(); location.href = "/login"; }}
          style={{
            width: "100%", textAlign: "left", background: "none", border: "none",
            padding: "7px 12px", borderRadius: ds.r, cursor: "pointer",
            fontSize: ds.txSm, color: ds.sidebarText,
            display: "flex", alignItems: "center", gap: 8,
          }}
        >
          <span style={{
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            width: 22, height: 22, borderRadius: ds.rFull,
            background: "rgba(255,255,255,0.1)",
            fontSize: ds.txXs, color: ds.sidebarText2, fontWeight: 600, flexShrink: 0,
          }}>
            {(user?.name ?? "U")[0].toUpperCase()}
          </span>
          <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {user?.name ?? "退出"}
          </span>
        </button>
      </div>
    </>
  );

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: ds.bg, fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif" }}>
      {/* ── Sidebar desktop ── */}
      {!mobile && (
        <nav style={{
          width: 220, flexShrink: 0,
          background: ds.sidebarBg, borderRight: `1px solid ${ds.sidebarBorder}`,
          display: "flex", flexDirection: "column", padding: "0 0 16px",
        }}>
          {sidebarContent}
        </nav>
      )}

      {/* ── Sidebar mobile drawer ── */}
      {mobile && sideOpen && (
        <>
          <div onClick={() => setSideOpen(false)} style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 40,
          }} />
          <nav style={{
            position: "fixed", top: 0, left: 0, bottom: 0, width: 260, zIndex: 50,
            background: ds.sidebarBg, borderRight: `1px solid ${ds.sidebarBorder}`,
            display: "flex", flexDirection: "column", padding: "0 0 16px",
            overflowY: "auto",
          }}>
            {sidebarContent}
          </nav>
        </>
      )}

      {/* ── Main ── */}
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        {/* Mobile topbar */}
        {mobile && (
          <div style={{
            display: "flex", alignItems: "center", gap: 12,
            padding: "12px 16px", background: ds.sidebarBg,
            borderBottom: `1px solid ${ds.sidebarBorder}`,
          }}>
            <button onClick={() => setSideOpen(true)} aria-label="打开菜单" style={{
              background: "none", border: "none", cursor: "pointer", padding: 4,
              color: ds.sidebarText2, display: "flex", alignItems: "center",
            }}>
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                <rect y="3" width="18" height="2" rx="1" fill="currentColor"/>
                <rect y="8" width="18" height="2" rx="1" fill="currentColor"/>
                <rect y="13" width="18" height="2" rx="1" fill="currentColor"/>
              </svg>
            </button>
            <div style={{
              width: 22, height: 22, borderRadius: ds.rSm,
              background: ds.accent, display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <svg width="11" height="11" viewBox="0 0 14 14" fill="none">
                <rect x="1" y="1" width="5" height="5" rx="1" fill="white" fillOpacity="0.9"/>
                <rect x="8" y="1" width="5" height="5" rx="1" fill="white" fillOpacity="0.5"/>
                <rect x="1" y="8" width="5" height="5" rx="1" fill="white" fillOpacity="0.5"/>
                <rect x="8" y="8" width="5" height="5" rx="1" fill="white" fillOpacity="0.9"/>
              </svg>
            </div>
            <span style={{ fontSize: ds.txBase, fontWeight: 600, color: ds.sidebarTextActive }}>
              {area === "admin" ? "看板后台" : "上币看板"}
            </span>
          </div>
        )}

        {hasMock && (
          <div role="status" style={{
            background: ds.warningBg, color: ds.warning,
            borderBottom: `1px solid ${ds.warningBorder}`,
            fontSize: ds.txSm, padding: "7px 24px",
          }}>
            当前含演示数据，仅用于内部功能演示。管理员可在数据源管理中切换采集来源。
          </div>
        )}
        <main style={{ flex: 1, padding: mobile ? "20px 16px" : "28px 32px", maxWidth: 1120 }}>
          {children}
        </main>
      </div>
    </div>
  );
}

function NavItem({ href, label, active, disabled, icon }: {
  href: string; label: string; active: boolean; disabled?: boolean; icon?: React.ReactNode;
}) {
  return (
    <a href={disabled ? undefined : href} style={{
      display: "flex", alignItems: "center", gap: 8,
      padding: "7px 12px", borderRadius: ds.r, marginBottom: 1,
      textDecoration: "none",
      fontSize: ds.txBase,
      fontWeight: active ? 500 : 400,
      color: active ? ds.sidebarTextActive : disabled ? ds.sidebarText : ds.sidebarText2,
      background: active ? ds.sidebarActive : "transparent",
      opacity: disabled ? 0.45 : 1,
      cursor: disabled ? "default" : "pointer",
      borderLeft: active ? `2px solid ${ds.sidebarAccent}` : "2px solid transparent",
      transition: "background 0.12s, color 0.12s",
    }}>
      {icon && <span style={{ opacity: 0.7, flexShrink: 0 }}>{icon}</span>}
      <span>{label}</span>
      {disabled && <span style={{ marginLeft: "auto", fontSize: ds.txXs, color: ds.sidebarText, background: "rgba(255,255,255,0.07)", padding: "1px 6px", borderRadius: ds.rFull }}>不可用</span>}
    </a>
  );
}
