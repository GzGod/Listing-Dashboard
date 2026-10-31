// 种子假数据：一条命令灌入，所有日期按 UTC。可重复执行（先清空核心表）。
import bcrypt from "bcryptjs";
import { getPrisma } from "./index.js";
import { FundamentalsSchema, TeamSchema } from "@app/shared";
const db = getPrisma();
const day = (offset: number) => { const d = new Date(); d.setUTCHours(0, 0, 0, 0); d.setUTCDate(d.getUTCDate() + offset); return d; };

async function main() {
  await db.$executeRawUnsafe(`TRUNCATE exchanges, platforms, kol_tiers, score_params, system_config, buzz_adjustments, tracks, projects, project_contracts, project_aliases, price_snapshots,
    listing_events, people, person_tags, posts, post_mentions, buzz_snapshots, volume_snapshots, project_daily, users RESTART IDENTITY CASCADE`);
  const pw = await bcrypt.hash(process.env.SEED_ADMIN_PASSWORD || "admin123", 10);
  await db.user.createMany({ data: [
    { email: "admin@local", name: "管理员", passwordHash: pw, role: "admin" },
    { email: "editor@local", name: "运营", passwordHash: pw, role: "editor" },
    { email: "viewer@local", name: "BD", passwordHash: pw, role: "viewer" },
  ] });
  const [binance, okx, bybit] = await Promise.all(["Binance", "OKX", "Bybit"].map((name) => db.exchange.create({ data: { name, type: "CEX" } })));
  const x = await db.platform.create({ data: { name: "X" } });
  const tiers = ["S", "A", "B"];
  await db.kolTier.createMany({ data: [["S", 3], ["A", 2], ["B", 1]].map(([name, weight]) => ({ version: "v1", effectiveFrom: day(-365), name: name as string, weight: weight as number })) });
  await db.scoreParams.create({ data: { version: "v1", effectiveFrom: day(-365), a: 1, b: 5, updateFrequency: "daily" } });
  const ai = await db.track.create({ data: { name: "AI" } });
  const aiAgent = await db.track.create({ data: { name: "AI Agent", parentId: ai.id } });
  const defi = await db.track.create({ data: { name: "DeFi" } });
  const dex = await db.track.create({ data: { name: "DEX", parentId: defi.id } });
  const specs = [["Alpha Agent", "ALPHA", aiAgent.id], ["Neuron", "NRN", aiAgent.id], ["SwapX", "SWX", dex.id], ["Pool Party", "POOL", dex.id]] as const;
  const projects = [];
  for (const [i, [name, symbol, trackId]] of specs.entries()) {
    const fundamentals = FundamentalsSchema.parse({ summary: `${name} 简介（假数据）`, capTable: [{ holder: "团队", pct: 20 }, { holder: "投资机构", pct: 15, note: "锁仓 12 个月" }, { holder: "社区", pct: 65 }] });
    const team = TeamSchema.parse([{ name: "Alice", role: "CEO", url: "https://x.com/alice" }, { name: "Bob", role: "CTO", bio: "前交易所工程师" }]);
    const p = await db.project.create({ data: { name, symbol, trackId, coingeckoId: `${symbol.toLowerCase()}-fake`, longgeRating: ["A", "B", "A", "C"][i], longgeRatedAt: day(-20), fundamentals: fundamentals as any, team,
      logoUrl: `https://example.com/${symbol}.png`, websiteUrl: `https://${symbol.toLowerCase()}.example`, xHandle: `${symbol.toLowerCase()}_official`, docsUrl: `https://docs.${symbol.toLowerCase()}.example`,
      usersCount: 10000 * (i + 1), usersAsOf: day(-30), usersSource: "官网披露", revenueUsd: 50000 * (i + 1), revenuePeriod: "30d", revenueAsOf: day(-30), revenueSource: "Token Terminal",
      contracts: { create: [{ chain: "ethereum", address: `0x${String(i + 1).padStart(40, "0")}` }] },
      aliases: { create: [{ alias: symbol, kind: "ticker" }, { alias: name, kind: "name" }] } } });
    projects.push(p);
  }
  for (const [i, p] of projects.entries()) {
    await db.listingEvent.create({ data: { projectId: p.id, exchangeId: [binance, okx, bybit][i % 3].id, day: day(-5 + i), stage: "spot", pair: `${p.symbol}/USDT`, announcementUrl: "https://example.com/announcement" } });
  }
  const people = [];
  for (const [i, h] of ["cz_like", "vc_partner", "whale_01", "kol_top"].entries()) {
    const person = await db.person.create({ data: { displayName: h, handle: h, platformId: x.id, kolTier: tiers[i % 3],
      tags: { create: [{ tag: ["exchange_core", "top_vc", "whale", "top_kol"][i] }] } } });
    people.push(person);
  }
  for (let d = -7; d < 0; d++) for (const [i, p] of projects.entries()) {
    const post = await db.post.create({ data: { personId: people[i].id, platformId: x.id, platformPostId: `fake-${d}-${i}`, postedAt: day(d),
      views: 1000 * (i + 1) - d * 37, bookmarks: 10 * (i + 1), url: `https://x.com/${people[i].handle}/status/${Math.abs(d)}${i}`, text: `$${p.symbol} looks good` } });
    await db.postMention.create({ data: { postId: post.id, projectId: p.id, matchMethod: "ticker", status: "confirmed" } });
    for (const ex of [binance, okx]) await db.volumeSnapshot.create({ data: { projectId: p.id, exchangeId: ex.id, day: day(d), spotVolumeUsd24h: 1e6 * (i + 1) + d * 1000 } });
    await db.priceSnapshot.create({ data: { projectId: p.id, day: day(d), priceUsd: d === -3 && i === 3 ? null : 0.5 * (i + 1) } });
    await db.projectDaily.create({ data: { projectId: p.id, day: day(d), trackId: p.trackId!, volumeTrackRank: (i % 2) + 1, totalSpotVolumeUsd: 2e6 * (i + 1), priceUsd: 0.5 * (i + 1) } });
    await db.buzzSnapshot.create({ data: { projectId: p.id, day: day(d), trackId: p.trackId, trackRank: 2 - (i % 2), kolPostCount: 1, coreExposureCount: 1, heatScore: 100 * (i + 1), paramsVersion: "v1", tiersVersion: "v1", rawTotal: 100 * (i + 1), adjustedTotal: 100 * (i + 1) } });
  }
  console.log("seed 完成：账号 admin@local / editor@local / viewer@local，密码 " + (process.env.SEED_ADMIN_PASSWORD ? "(SEED_ADMIN_PASSWORD)" : "admin123"));
}
main().finally(() => db.$disconnect());
