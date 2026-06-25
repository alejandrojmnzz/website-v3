#!/usr/bin/env bash
# content-bootstrap.sh
#
# Trigger a full bootstrap pull from the configured content GitHub repo.
# Downloads every 4geeks-com/ file from the remote branch and writes
# it to the local filesystem.
#
# Usage:
#   ./scripts/content-bootstrap.sh
#
# Environment:
#   SITE_URL  — base URL of the running server (default: http://localhost:5000)

set -euo pipefail

BASE_URL="${SITE_URL:-http://localhost:5000}"
ENDPOINT="${BASE_URL}/api/github/content/bootstrap"

echo "Triggering content bootstrap pull from ${ENDPOINT} ..."
response=$(curl -s -w "\n%{http_code}" -X POST \
  -H "Content-Type: application/json" \
  "${ENDPOINT}")

body=$(echo "$response" | head -n -1)
status=$(echo "$response" | tail -n 1)

echo "HTTP status: ${status}"
echo "Response:    ${body}"

if [ "$status" -ge 200 ] && [ "$status" -lt 300 ]; then
  echo "Bootstrap complete."
else
  echo "Bootstrap failed (HTTP ${status})." >&2
  exit 1
fi
