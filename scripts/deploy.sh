#!/usr/bin/env bash
set -euo pipefail
cd /opt/website-v3
git pull --ff-only
# npm omits devDependencies when NODE_ENV=production (tsx/vite live there).
# Unset inherited shell env, then force-include dev so `npm run build` works.
unset NODE_ENV
npm ci --include=dev
ln -sfn "$(pwd)/shared" node_modules/@shared
set -a
# shellcheck disable=SC1091
source .env
set +a
if [[ -z "${TURNSTILE_SITE_KEY:-}" || -z "${TURNSTILE_SECRET_KEY:-}" ]]; then
  echo "ERROR: TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY are required." >&2
  exit 1
fi
npm run build
if systemctl cat website.service >/dev/null 2>&1; then
  sudo systemctl restart website
else
  echo "[deploy] website.service still not installed — build OK, start later"
fi
