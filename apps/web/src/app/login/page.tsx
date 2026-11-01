"use client";
import React from "react";
import { api, TOKEN_KEY } from "@app/ui";
import { ds } from "@app/ui/tokens";
import type { LoginResponse } from "@app/shared";

export default function Login() {
  const [email, setEmail] = React.useState("admin@local");
  const [password, setPassword] = React.useState("");
  const [err, setErr] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(""); setBusy(true);
    try {
      const r = await api<LoginResponse>("/api/_core/auth/login", { method: "POST", json: { email, password } });
      localStorage.setItem(TOKEN_KEY, r.token);
      localStorage.setItem("dashboard_user", JSON.stringify(r.user));
      location.href = r.user.permissions.includes("*") || r.user.permissions.includes("admin:access") ? "/admin" : "/";
    } catch (e: any) { setErr(e.message); setBusy(false); }
  };

  const inputStyle: React.CSSProperties = {
    padding: "8px 12px",
    borderRadius: ds.r,
    border: `1px solid ${ds.border}`,
    background: ds.surface,
    color: ds.text,
    fontSize: ds.txBase,
    outline: "none",
    width: "100%",
    boxSizing: "border-box",
    fontFamily: "inherit",
  };

  return (
    <div style={{
      minHeight: "100vh",
      background: ds.bg,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif",
    }}>
      <div style={{ width: "100%", maxWidth: 380, padding: "0 16px" }}>
        {/* Logo */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 32, justifyContent: "center" }}>
          <div style={{
            width: 32, height: 32, borderRadius: ds.r,
            background: ds.accent, display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <svg width="16" height="16" viewBox="0 0 14 14" fill="none">
              <rect x="1" y="1" width="5" height="5" rx="1" fill="white" fillOpacity="0.9"/>
              <rect x="8" y="1" width="5" height="5" rx="1" fill="white" fillOpacity="0.5"/>
              <rect x="1" y="8" width="5" height="5" rx="1" fill="white" fillOpacity="0.5"/>
              <rect x="8" y="8" width="5" height="5" rx="1" fill="white" fillOpacity="0.9"/>
            </svg>
          </div>
          <span style={{ fontSize: ds.txLg, fontWeight: 600, color: ds.text, letterSpacing: "-0.01em" }}>
            Crypto 上币看板
          </span>
        </div>

        {/* Card */}
        <div style={{
          background: ds.surface,
          border: `1px solid ${ds.border}`,
          borderRadius: ds.rLg,
          padding: "28px 28px 24px",
        }}>
          <h1 style={{ margin: "0 0 20px", fontSize: ds.txLg, fontWeight: 600, color: ds.text }}>登录</h1>

          <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: ds.txSm, fontWeight: 500, color: ds.text2 }}>
              邮箱
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@local"
                required
                style={inputStyle}
              />
            </label>

            <label style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: ds.txSm, fontWeight: 500, color: ds.text2 }}>
              密码
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                style={inputStyle}
              />
            </label>

            {err && (
              <div role="alert" style={{
                padding: "8px 12px", borderRadius: ds.r,
                background: ds.errorBg, border: `1px solid ${ds.errorBorder}`,
                color: ds.error, fontSize: ds.txSm,
              }}>{err}</div>
            )}

            <button
              type="submit"
              disabled={busy}
              style={{
                marginTop: 4,
                padding: "9px 0",
                borderRadius: ds.r,
                border: "none",
                background: busy ? ds.accentHover : ds.accent,
                color: "#fff",
                fontSize: ds.txBase,
                fontWeight: 600,
                cursor: busy ? "not-allowed" : "pointer",
                opacity: busy ? 0.75 : 1,
                fontFamily: "inherit",
              }}
            >
              {busy ? "登录中…" : "登录"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
