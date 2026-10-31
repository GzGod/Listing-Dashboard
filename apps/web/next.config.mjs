/** 前台 + 后台外壳。/api/* 转发给 Fastify 后端 */
export default {
  
  transpilePackages: ["@app/ui", "@app/shared"],
  experimental: { externalDir: true },
  outputFileTracingRoot: new URL("../..", import.meta.url).pathname,
  // 服务端/共享代码里的 ESM 写法 import "./x.js" 实际是 .ts/.tsx 文件
  webpack(config) {
    config.resolve.extensionAlias = { ...(config.resolve.extensionAlias ?? {}), ".js": [".ts", ".tsx", ".js"], ".mjs": [".mts", ".mjs"] };
    // 模块的 web/ 在 apps/web 之外，自己没有 node_modules：react / next/* 等回落到 web 壳的 node_modules 解析
    config.resolve.modules = [...(config.resolve.modules ?? ["node_modules"]), new URL("./node_modules", import.meta.url).pathname];
    return config;
  },
  async rewrites() { return [{ source: "/api/:path*", destination: `${process.env.API_URL ?? "http://localhost:4000"}/api/:path*` }]; },
};
