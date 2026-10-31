// writes demo x-fixtures.json for deploy copy
import fs from "fs";
const handles = ["cz_like","vc_partner","whale_01","alpha_hunter","degen_research","onchain_ana"];
const tick = ["ALPHA","NRN","ORB","ZKP","MEME9","GRID","VOLT","LUMA","PIXL","DRIP"];
const names = ["Nova"]; // ambiguous name alias -> review queue
let id = 1900000000000100000n, posts = [], seed = 7;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const now = Date.now();
for (const h of handles) for (let i = 0; i < 18; i++) {
  const d = new Date(now - Math.floor(rnd() * 30 * 86400e3) - 3600e3);
  const k = Math.floor(Math.pow(rnd(), 1.6) * tick.length); // skewed popularity
  let text = rnd() < 0.12 ? `${names[0]} is cooking something big` : `$${tick[k]} looks strong here` + (rnd() < .3 ? ` and $${tick[(k+3)%10]} too` : "");
  posts.push({ id: (id++).toString(), handle: h, postedAt: d.toISOString(), text, url: `https://x.com/${h}/status/${id}`, views: Math.floor(1000 + rnd() * 50000), bookmarks: Math.floor(rnd() * 400) });
}
posts.sort((a, b) => (BigInt(b.id) > BigInt(a.id) ? 1 : -1));
fs.writeFileSync(process.argv[2], JSON.stringify({ posts }, null, 1));
console.log(posts.length, "posts");
