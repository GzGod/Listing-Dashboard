"use client";
import React from "react";
import { Crud } from "./Crud.js";
export default function PeoplePage() {
  return (<div>
    <Crud title="AD-02 人物池" path="/people" fields={[{ key: "displayName", title: "名称" }, { key: "handle", title: "账号 handle" }, { key: "platformId", title: "平台ID" }, { key: "kolTier", title: "KOL 等级名（如 S/A/B）" }]}
      columns={[{ key: "id", title: "ID" }, { key: "displayName", title: "名称" }, { key: "handle", title: "handle" }, { key: "tierName", title: "分级" }, { key: "tagList", title: "标签" }, { key: "on", title: "启用" }]}
      extra={(r) => ({ tierName: r.kolTier ?? "-", tagList: (r.tags ?? []).map((t: any) => t.tag).join(", "), on: r.enabled ? "是" : "否" })} />
    <Crud title="人物标签（exchange_core | top_vc | whale | top_kol）" path="/person-tags" fields={[{ key: "personId", title: "人物ID" }, { key: "tag", title: "标签" }]}
      columns={[{ key: "id", title: "ID" }, { key: "personId", title: "人物" }, { key: "tag", title: "标签" }]} />
  </div>);
}
