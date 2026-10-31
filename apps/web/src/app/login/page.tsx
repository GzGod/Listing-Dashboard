"use client";
import React from "react";
import { api, TOKEN_KEY, Button, Input, Card } from "@app/ui";
import type { LoginResponse } from "@app/shared";
export default function Login() {
  const [email, setEmail] = React.useState("admin@local");
  const [password, setPassword] = React.useState("");
  const [err, setErr] = React.useState("");
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr("");
    try { const r = await api<LoginResponse>("/api/_core/auth/login", { method: "POST", json: { email, password } });
      localStorage.setItem(TOKEN_KEY, r.token); localStorage.setItem("dashboard_user", JSON.stringify(r.user));
      location.href = r.user.permissions.includes("*") || r.user.permissions.includes("admin:access") ? "/admin" : "/";
    } catch (e: any) { setErr(e.message); }
  };
  return (<div style={{ maxWidth: 360, margin: "120px auto" }}><Card title="登录 · Crypto 上币看板">
    <form onSubmit={submit} style={{ display: "grid", gap: 10 }}>
      <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="邮箱" />
      <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="密码" />
      <Button type="submit">登录</Button>
      {err && <div style={{ color: "#dc2626" }}>{err}</div>}
    </form></Card></div>);
}
