#!/usr/bin/env bash
# Materialize /opt/website-v3/.env from process env vars prefixed _WEBSITE_.
# GitHub Actions cannot store secrets named GITHUB_*; prefix avoids that and
# namespaces runtime config. Empty prefix set → leave existing .env alone.
set -euo pipefail
ROOT="${1:-/opt/website-v3}"
export WRITE_RUNTIME_ENV_ROOT="$ROOT"
python3 - << 'PY'
import os
import sys
from pathlib import Path

prefix = "_WEBSITE_"
root = Path(os.environ["WRITE_RUNTIME_ENV_ROOT"])
dest = root / ".env"

rows = []
for key, value in sorted(os.environ.items()):
    if not key.startswith(prefix):
        continue
    name = key[len(prefix) :]
    if not name or value == "":
        continue
    rows.append((name, value))

if not rows:
    print("[write-runtime-env] no _WEBSITE_* env vars; leaving .env unchanged")
    sys.exit(0)

def bash_assign(name: str, value: str) -> str:
    escaped = value.replace("'", "'\"'\"'")
    return f"{name}='{escaped}'"

text = "\n".join(bash_assign(n, v) for n, v in rows) + "\n"
tmp = dest.with_name(".env.tmp")
tmp.write_text(text, encoding="utf-8")
os.chmod(tmp, 0o600)
os.replace(tmp, dest)
print("[write-runtime-env] wrote", dest, "keys:", ", ".join(n for n, _ in rows))
PY
