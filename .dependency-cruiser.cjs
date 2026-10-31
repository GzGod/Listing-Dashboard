/** 依赖边界：模块之间禁止直接 import；底座不能 import 模块；模块只能用 @app/core / @app/shared / @app/ui */
module.exports = {
  forbidden: [
    { name: "no-cross-module-imports", severity: "error", comment: "模块之间只能通过接口或事件通信，禁止直接引用别的模块代码",
      from: { path: "^modules/([^/]+)/" }, to: { path: "^modules/([^/]+)/", pathNot: "^modules/$1/" } },
    { name: "core-must-not-import-modules", severity: "error", comment: "底座不能依赖任何模块（模块靠扫描自动加载）",
      from: { path: "^(packages|apps)/" }, to: { path: "^modules/" } },
    { name: "modules-no-direct-db-package", severity: "error", comment: "模块通过 ctx.db 访问数据库，不要直接 import @app/db / @prisma/client",
      from: { path: "^modules/" }, to: { path: "(^packages/db/|@prisma/client)" } },
    { name: "no-circular", severity: "error", from: {}, to: { circular: true } },
  ],
  options: { doNotFollow: { path: "node_modules" }, exclude: { path: "(node_modules|\\.next|generated)" }, tsConfig: { fileName: "tsconfig.json" },
    tsPreCompilationDeps: true, enhancedResolveOptions: { exportsFields: ["exports"], conditionNames: ["import", "require", "node", "default"] } },
};
