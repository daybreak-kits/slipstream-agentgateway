#!/usr/bin/env bash
# Slipstream 前端质量闸门：tsc -> eslint -> route-audit（vite build 由 Lead 统一执行），逐项 PASS/FAIL 与耗时。
# 用法：bash ops/checks/verify_web.sh   日志：ops/checks/.logs/<check>.log
set -u
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
WEB="$ROOT/web"
LOGS="$ROOT/ops/checks/.logs"
mkdir -p "$LOGS"
cd "$WEB" || { echo "FAIL cd $WEB 不存在"; exit 2; }

fail=0
run() {
  local name="$1"; shift
  local start end ms
  start=$(date +%s%3N)
  if "$@" >"$LOGS/$name.log" 2>&1; then
    end=$(date +%s%3N); ms=$((end - start))
    echo "PASS $name ${ms}ms"
  else
    end=$(date +%s%3N); ms=$((end - start))
    echo "FAIL $name ${ms}ms  （详情: ops/checks/.logs/$name.log，末 30 行如下）"
    tail -n 30 "$LOGS/$name.log"
    fail=1
  fi
}

run typecheck npx tsc --noEmit
run eslint    npx eslint src
# build 由 Lead 统一执行（沙箱内 esbuild spawn 受限）；如需本机尝试，取消下一行注释：
# run build     npx vite build
node "$ROOT/ops/checks/route-audit.mjs" || fail=1

if [ "$fail" -eq 0 ]; then echo "RESULT PASS（tsc/eslint/route 3/3）"; else echo "RESULT FAIL"; fi
exit $fail
