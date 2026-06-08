#!/bin/sh
# Pattern 3 Docker entrypoint: Render workflow dev server + gateway.
#
# 1. `render workflows dev` starts the local task server (:8120) and registers
#    tasks from workflow.ts (task definitions only — no HTTP).
# 2. The gateway (server.ts) dispatches via SDK → :8120 and serves the UI (:3000).

set -e

PORT="${RENDER_DEV_PORT:-8120}"
DEV_URL="http://127.0.0.1:${PORT}"

echo "[workflow-agents] starting Render workflow dev server on :${PORT}…"
render workflows dev --port "${PORT}" -- \
  node --import tsx packages/workflow-agents/src/workflow.ts &
DEV_PID=$!

echo "[workflow-agents] waiting for task server on :${PORT}…"
for _ in $(seq 1 60); do
  if curl -s --connect-timeout 1 "http://127.0.0.1:${PORT}/" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

export RENDER_USE_LOCAL_DEV=true
export RENDER_LOCAL_DEV_URL="${DEV_URL}"
export RENDER_API_KEY="${RENDER_API_KEY:-local-dev}"
export PORT=3000

echo "[workflow-agents] starting gateway on :${PORT} (dispatch → ${DEV_URL})…"
exec node --import tsx packages/workflow-agents/src/server.ts
