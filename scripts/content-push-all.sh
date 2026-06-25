#!/usr/bin/env bash
# content-push-all.sh
#
# Push every local 4geeks-com/ file to the configured content GitHub repo.
# Use this once to seed a new (empty) content repository from an existing folder.
#
# Usage:
#   ./scripts/content-push-all.sh
#
# Environment:
#   SITE_URL  — base URL of the running server (default: http://localhost:5000)
#
# Requirements:
#   GITHUB_SYNC_ENABLED=true must be set in the server environment.

set -euo pipefail

BASE_URL="${SITE_URL:-http://localhost:5000}"
ENDPOINT="${BASE_URL}/api/github/content/push-all"

echo "Pushing all local 4geeks-com/ files to remote via ${ENDPOINT} ..."
response=$(curl -s -w "\n%{http_code}" -X POST \
  -H "Content-Type: application/json" \
  "${ENDPOINT}")

body=$(echo "$response" | head -n -1)
status=$(echo "$response" | tail -n 1)

echo "HTTP status: ${status}"
echo "Response:    ${body}"

if [ "$status" -ge 200 ] && [ "$status" -lt 300 ]; then
  echo "Push-all complete."
else
  echo "Push-all failed (HTTP ${status})." >&2
  exit 1
fi
