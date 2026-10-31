"use client";
import React from "react";
import { api, useApi, Empty, matchRoute } from "@app/ui";
import type { MenuItem } from "@app/shared";
import { modulePages } from "../generated/modules";
import { ModuleErrorBoundary } from "./ModuleErrorBoundary";

/** 按 /m/<module>/<path> 找到模块页面并渲染：代码内模块 = 打包进来的组件；外部模块 = 拉它的 HTML 放进同源 iframe */
export function ModulePage({ area, module, path }: { area: "front" | "admin"; module: string; path: string }) {
  const menu = useApi<(MenuItem & { url?: string })[]>("/api/_core/menu");
  // 支持动态路由：manifest 里写 "/notes/:id"，实际路径 "/notes/12" -> params { id: "12" }
  let params: Record<string, string> = {};
  const entry = menu.data?.find((m) => { if (m.area !== area || m.module !== module) return false; const p = matchRoute(m.path, path); if (p) params = p; return !!p; });
  const searchParams = typeof window === "undefined" ? {} : Object.fromEntries(new URLSearchParams(window.location.search));
  if (menu.loading) return null;
  if (!entry) return <Empty text="页面不存在或没有权限" />;
  if (!entry.available) return <ModuleErrorBoundary module={module}><Broken msg="模块当前不可用" /></ModuleErrorBoundary>;
  const Comp = entry ? modulePages[module]?.[area]?.[entry.path] : undefined;
  return (<ModuleErrorBoundary module={module}>
    {entry.url ? <ExternalFrame url={entry.url} /> : Comp ? <React.Suspense fallback={null}><Comp params={params} searchParams={searchParams} /></React.Suspense> : <Broken msg="前端页面未打包，请重新构建 web" />}
  </ModuleErrorBoundary>);
}
function Broken({ msg }: { msg: string }): React.ReactNode { throw new Error(msg); }
function ExternalFrame({ url }: { url: string }) {
  const [html, setHtml] = React.useState<string>();
  const [err, setErr] = React.useState<Error>();
  React.useEffect(() => { api<string>(url).then(setHtml).catch(setErr); }, [url]);
  if (err) throw err;
  return html ? <iframe srcDoc={html} style={{ width: "100%", height: "80vh", border: 0, background: "#fff" }} /> : null;
}
