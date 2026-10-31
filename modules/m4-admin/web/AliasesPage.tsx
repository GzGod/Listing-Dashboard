"use client";
import React from "react";
import { Crud } from "./Crud.js";
export default function AliasesPage() {
  return <Crud title="AD-05 别名维护（M2 匹配时直接读取）" path="/aliases" fields={[{ key: "projectId", title: "项目ID" }, { key: "alias", title: "别名" }, { key: "kind", title: "ticker|name|contract" }]}
    columns={[{ key: "id", title: "ID" }, { key: "projectName", title: "项目" }, { key: "alias", title: "别名" }, { key: "kind", title: "类型" }]} extra={(r) => ({ projectName: r.project?.name })} />;
}
