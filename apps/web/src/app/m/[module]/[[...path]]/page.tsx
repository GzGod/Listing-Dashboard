"use client";
import { use } from "react";
import { Shell } from "../../../../components/Shell";
import { ModulePage } from "../../../../components/ModulePage";
export default function Page({ params }: { params: Promise<{ module: string; path?: string[] }> }) {
  const p = use(params);
  return <Shell area="front"><ModulePage area="front" module={p.module} path={"/" + (p.path ?? []).join("/")} /></Shell>;
}
