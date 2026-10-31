#!/bin/sh
# Railway server 启动：迁移 → (空库时)种子 → [可选]同进程起 worker → server
# 用 node --import tsx 而不是 tsx CLI（tsx CLI 在无 TTY 的容器里会静默退出）
set -e
pnpm db:migrate
if [ "${SEED_ON_EMPTY:-1}" = "1" ]; then
  rc=0; node --import tsx deploy/railway/seed-if-empty.ts || rc=$?
  if [ "$rc" = "10" ]; then (cd packages/db && node --import tsx src/seed.ts); elif [ "$rc" != "0" ]; then exit "$rc"; fi
fi
(cd packages/db && node --import tsx src/sync-admin-password.ts) || echo 'admin 密码同步失败'
# worker 等 server 跑完模块迁移再起（compose 里同样是等 server healthy）
if [ "${RUN_WORKER:-1}" = "1" ]; then (sleep "${WORKER_DELAY_S:-20}"; exec node --import tsx apps/worker/src/main.ts) & fi
exec node --import tsx apps/server/src/main.ts
