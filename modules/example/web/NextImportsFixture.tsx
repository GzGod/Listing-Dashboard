// 回归用例：模块前端可以 import next/link、next/navigation（pnpm typecheck / pnpm check --module 都会检查）
"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
export default function NextImportsFixture() {
  const router = useRouter();
  const q = useSearchParams();
  return <Link href={`/notes?x=${q.get("x") ?? ""}`} onClick={() => router.refresh()}>notes</Link>;
}
