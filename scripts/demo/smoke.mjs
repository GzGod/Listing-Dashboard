const A = "http://127.0.0.1:4300/api", W = "http://127.0.0.1:3300", [email, password] = process.argv.slice(2);
let tok; const j = async (m, p, b) => { const r = await fetch(A + p, { method: m, headers: { "content-type": "application/json", authorization: tok ? "Bearer " + tok : "" }, body: b ? JSON.stringify(b) : undefined }); const t = await r.text(); if (!r.ok) throw new Error(`${m} ${p} ${r.status} ${t.slice(0,300)}`); return t ? JSON.parse(t) : null; };
const ok = (n, v) => console.log("PASS", n, v ?? "");
tok = (await j("POST", "/_core/auth/login", { email, password })).token;
const q = await j("GET", "/m4-admin/review-queue"); const items = q.items ?? q; ok("M4 review-queue", JSON.stringify(items).slice(0, 250));
const first = Array.isArray(items) ? items[0] : null;
if (first) { const pid = first.postId ?? first.post?.id; const cands = (first.candidates ?? []).map((c) => c.projectId ?? c.id);
  ok("M4 per-post submit", JSON.stringify(await j("POST", `/m4-admin/review/posts/${pid}`, { projectIds: cands.slice(0, 1) }))); }
const today = new Date().toISOString().slice(0, 10), from = new Date(Date.now() - 30 * 86400e3).toISOString().slice(0, 10);
ok("M4 backfill(recalc.requested manual_backfill)", JSON.stringify(await j("POST", "/m4-admin/backfill", { dateFrom: from, dateTo: today })));
await new Promise((r) => setTimeout(r, 15000));
const tracks = await j("GET", "/m5-rankings/rankings/tracks"); ok("M5 tracks", JSON.stringify(tracks).slice(0, 200));
let pid;
for (const t of [2, 4, 6, 8]) for (const w of [1, 7, 30]) { const r = await j("GET", `/m5-rankings/rankings?track=${t}&window=${w}`); const it = r.items ?? r.data ?? []; pid ??= it[0]?.projectId; ok(`M5 track${t} w${w}`, it.length + " rows; top=" + JSON.stringify(it[0] ?? null).slice(0, 120)); }
pid ??= 1;
for (const p of ["", "/series", "/posts"]) ok(`M6 /projects/${pid}${p}`, JSON.stringify(await j("GET", `/m6-project/projects/${pid}${p}`)).slice(0, 120));
for (const p of ["/login", "/m/m5-rankings", `/m/m6-project/${pid}`, ...["projects","people","weights","adjust","aliases","review","tracks"].map((x) => "/admin/m/m4-admin/" + x)]) { const r = await fetch(W + p); console.log(r.status === 200 ? "PASS" : "FAIL", "web", p, r.status); }
