"use client";
import { Shell } from "../../components/Shell";
import { Card, Table, useApi } from "@app/ui";
export default function AdminHome() {
  const mods = useApi<{ core: string; modules: any[] }>("/api/_core/modules");
  return (<Shell area="admin"><Card title={`已接入模块（底座 v${mods.data?.core ?? ""}）`}>
    <Table rows={mods.data?.modules ?? []} columns={[{ key: "id", title: "模块" }, { key: "version", title: "版本" }, { key: "kind", title: "类型" }, { key: "status", title: "状态" }, { key: "error", title: "说明" }]} />
  </Card></Shell>);
}
