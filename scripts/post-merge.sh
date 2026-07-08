#!/bin/bash
set -e

# ── Conflict auto-resolver ────────────────────────────────────────────────────
# Task agents forked from commit 28c483b7 introduce the same merge conflicts
# on every merge into main.  We resolve them automatically by always keeping
# the HEAD (our) side of the conflict, then validating any JSON files.

resolve_conflicts() {
  python3 - << 'PYEOF'
import re, sys, os, json

pattern = re.compile(
    r'<<<<<<< HEAD\n(.*?)=======\n.*?>>>>>>> [0-9a-f]+\n',
    re.DOTALL
)

roots = ["client/src", "server", "4geeks-com"]
extensions = {".ts", ".tsx", ".js", ".json", ".yml", ".yaml"}

total_files = 0
total_conflicts = 0

for root in roots:
    for dirpath, _, filenames in os.walk(root):
        for fname in filenames:
            if os.path.splitext(fname)[1] not in extensions:
                continue
            fpath = os.path.join(dirpath, fname)
            try:
                with open(fpath, "r", encoding="utf-8", errors="replace") as f:
                    content = f.read()
            except Exception:
                continue

            if "<<<<<<< HEAD" not in content:
                continue

            count = len(pattern.findall(content))
            resolved = pattern.sub(lambda m: m.group(1), content)
            remaining = resolved.count("<<<<<<<")

            # If we didn't resolve everything cleanly, warn but don't abort
            if remaining > 0:
                print(f"  WARNING: {fpath} still has {remaining} unresolved conflict(s)", flush=True)
                continue

            with open(fpath, "w", encoding="utf-8") as f:
                f.write(resolved)

            # Validate JSON files after resolving
            if fname.endswith(".json"):
                try:
                    json.loads(resolved)
                except json.JSONDecodeError as e:
                    print(f"  ERROR: {fpath} is invalid JSON after resolution: {e}", flush=True)
                    sys.exit(1)

            total_files += 1
            total_conflicts += count
            print(f"  Resolved {count} conflict(s) in {fpath}", flush=True)

if total_conflicts > 0:
    print(f"[post-merge] Auto-resolved {total_conflicts} conflict(s) across {total_files} file(s).", flush=True)
else:
    print("[post-merge] No conflict markers found.", flush=True)
PYEOF
}

echo "[post-merge] Scanning for merge conflict markers..."
resolve_conflicts

# ── Version bump ──────────────────────────────────────────────────────────────
python3 - << 'PYEOF'
import json, os, re

version_path = os.path.join(os.getcwd(), "version.json")
try:
    with open(version_path, "r") as f:
        data = json.load(f)
    version = data.get("version", "1.0.0")
    parts = version.split(".")
    if len(parts) == 3:
        parts[2] = str(int(parts[2]) + 1)
        new_version = ".".join(parts)
        data["version"] = new_version
        with open(version_path, "w") as f:
            json.dump(data, f)
            f.write("\n")
        print(f"[post-merge] Version bumped: {version} → {new_version}", flush=True)
    else:
        print(f"[post-merge] WARNING: Unexpected version format '{version}', skipping bump.", flush=True)
except Exception as e:
    print(f"[post-merge] WARNING: Could not bump version: {e}", flush=True)
PYEOF

# ── Dependencies & DB ─────────────────────────────────────────────────────────
# Guardrail: a node_modules/@shared symlink pointing at the real shared/ folder
# lets npm install delete real source files through the link. Remove it first.
if [ -L node_modules/@shared ]; then
  echo "[post-merge] Removing dangerous node_modules/@shared symlink before npm install"
  rm node_modules/@shared
fi

npm install
npm run db:push
