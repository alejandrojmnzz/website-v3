# marketing-content/

This folder is **not** part of the platform code repository.

Its contents are managed by a dedicated **content-only GitHub repository** configured via
`GITHUB_REPO_URL`. Each site that runs this platform has its own content repo; the platform
code is shared across all sites.

## How it works

- On startup the server checks whether this folder is empty (no YAML files).  
- If it is empty **and** GitHub sync is configured (`GITHUB_SYNC_ENABLED=true`), the server
  automatically runs a full bootstrap pull — downloading every file from the content repo
  before the normal reconcile/auto-pull logic starts.
- Ongoing edits are synced back to the content repo automatically via the existing
  auto-commit and webhook infrastructure.

## Setup for a new site

See `docs/multi-site.md` for the full walkthrough.

## CLI helpers

| Script | Purpose |
|---|---|
| `scripts/content-bootstrap.sh` | Trigger a full re-pull from the content repo via the API |
| `scripts/content-push-all.sh` | Push all local files to the content repo (seed a new repo) |
