// Railway 启动用：库里没有用户才灌种子数据（seed.ts 会清空核心表，所以不能每次跑）
import { getPrisma } from "@app/db";
const db = getPrisma();
const n = await db.user.count();
await db.$disconnect();
process.exit(n === 0 ? 10 : 0); // 10 = 需要 seed
