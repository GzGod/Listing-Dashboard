// 每次启动把 ADMIN_EMAIL(默认 admin@local) 的密码同步为 SEED_ADMIN_PASSWORD；改密码只需改变量并重启
import bcrypt from "bcryptjs";
import { getPrisma } from "./index";
const pw = process.env.SEED_ADMIN_PASSWORD;
const email = process.env.ADMIN_EMAIL || "admin@local";
if (pw && process.env.SYNC_ADMIN_PASSWORD !== "0") {
  const db = getPrisma();
  const r = await db.user.updateMany({ where: { email }, data: { passwordHash: await bcrypt.hash(pw, 10) } });
  console.log(`admin 密码已同步 (${r.count})`);
  await db.$disconnect();
}
