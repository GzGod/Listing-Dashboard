const A = "http://127.0.0.1:4300/api", [email, password] = process.argv.slice(2);
let tok; const j = async (m, p, b) => { const r = await fetch(A + p, { method: m, headers: { "content-type": "application/json", ...(tok ? { authorization: "Bearer " + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }); const t = await r.text(); if (!r.ok) throw new Error(`${m} ${p} ${r.status} ${t.slice(0,300)}`); return t ? JSON.parse(t) : null; };
tok = (await j("POST", "/_core/auth/login", { email, password })).token;
const M = "/m4-admin";
const tr = async (name, parentId) => (await j("POST", M + "/tracks", { name, parentId })).id;
const infra = await tr("Infra"), zk = await tr("ZK", infra), meme = await tr("Meme"), memeAI = await tr("AI Meme", meme);
const projs = [["Orbit","ORB",infra],["ZK Proof Net","ZKP",zk],["Meme Nine","MEME9",memeAI],["GridFi","GRID",4],["Volt","VOLT",zk],["Luma Chain","LUMA",infra],["Pixel","PIXL",meme],["Drip","DRIP",4],["Nova Labs","NOVA",2],["Nova Swap","NVS",4]];
const ids = {};
for (const [name, symbol, trackId] of projs) { const p = await j("POST", M + "/projects", { name, symbol, trackId, coingeckoId: symbol.toLowerCase() + "-fake" }); ids[symbol] = p.id;
  await j("POST", M + "/aliases", { projectId: p.id, alias: symbol, kind: "ticker" }); }
await j("POST", M + "/aliases", { projectId: ids.NOVA, alias: "Nova", kind: "name" });
await j("POST", M + "/aliases", { projectId: ids.NVS, alias: "Nova", kind: "name" });
for (const [h, t] of [["alpha_hunter","A"],["degen_research","B"],["onchain_ana","S"]]) await j("POST", M + "/people", { displayName: h, handle: h, platformId: 1, kolTier: t, enabled: true });
console.log("posts", JSON.stringify(await j("POST", "/m1-collector/run/posts", {})).slice(0,200));
for (let i = 31; i >= 0; i--) { const d = new Date(Date.now() - i * 86400e3).toISOString().slice(0, 10); await j("POST", "/m1-collector/run/market", { date: d }); }
console.log("market done");
