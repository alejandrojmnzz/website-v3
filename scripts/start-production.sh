#!/usr/bin/env bash
# Production entrypoint: main Express app + MCP server (proxied via /mcp).
# MCP is best-effort — if it fails to start, the website still comes up.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

export NODE_ENV="${NODE_ENV:-production}"

MCP_PID=""

cleanup() {
  if [[ -n "${MCP_PID}" ]] && kill -0 "${MCP_PID}" 2>/dev/null; then
    kill "${MCP_PID}" 2>/dev/null || true
    wait "${MCP_PID}" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

if [[ -f dist/mcp-server.js ]]; then
  node dist/mcp-server.js &
  MCP_PID=$!
  sleep 0.5
  if ! kill -0 "${MCP_PID}" 2>/dev/null; then
    echo "[start] MCP server exited early — continuing with main app only" >&2
    MCP_PID=""
  else
    echo "[start] MCP server started (pid ${MCP_PID}) on port ${MCP_PORT:-3001}"
  fi
else
  echo "[start] dist/mcp-server.js not found — skipping MCP" >&2
fi

node dist/index.js
