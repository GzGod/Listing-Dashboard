"use client";
import { use } from "react";
import { Shell } from "../../../../../components/Shell";
import { ModulePage } from "../../../../../components/ModulePage";
export default function Page({ params }: { params: Promise<{ module: string; path?: string[] }> }) {
  const p = use(params);
  return <Shell area="admin"><ModulePage area="admin" module={p.module} path={"/" + (p.path ?? []).join("/")} /></Shell>;
}
