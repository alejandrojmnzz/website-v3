# Multi-site content repo separation

This platform supports running the **same code** across multiple sites, each with its
own `marketing-content/` stored in a dedicated GitHub repository.  The platform code
repo does **not** contain any content — `marketing-content/` is gitignored (except for
`.gitkeep` and `README.md`).

---

## Architecture

```
platform-repo (shared across all sites)
└── marketing-content/   ← gitignored; populated at runtime from GITHUB_REPO_URL

site-a-content-repo      ← GITHUB_REPO_URL for site A
└── marketing-content/

site-b-content-repo      ← GITHUB_REPO_URL for site B
└── marketing-content/
```

---

## Setting up a new site

### 1. Fork (or copy) the platform repo

Create a new Replit project from the platform repo.  No content files are included.

### 2. Create a content-only GitHub repository

Create a new GitHub repository that will hold only `marketing-content/` for this site.
You can seed it from an existing folder — see **Seeding a new content repo** below.

### 3. Configure environment variables

Set the following secrets in the new Replit project:

| Variable | Value |
|---|---|
| `GITHUB_REPO_URL` | URL of the **content-only** repo (e.g. `https://github.com/org/site-a-content`) |
| `GITHUB_TOKEN` | Personal access token with `repo` and `admin:repo_hook` scopes |
| `GITHUB_BRANCH` | Branch to sync against (default: `main`) |
| `GITHUB_SYNC_ENABLED` | `true` |
| `GITHUB_AUTO_PULL_ENABLED` | `true` |
| `GITHUB_AUTO_COMMIT_ENABLED` | `true` _(optional — enables auto-commit of editor changes)_ |

### 4. Start the server

On the first start the server detects that `marketing-content/` contains no YAML files
and automatically runs a **bootstrap pull** — downloading every file from the content
repo before the normal reconcile/auto-pull logic starts.  No manual step is required.

You can also trigger a bootstrap pull at any time via the CLI helper:

```bash
./scripts/content-bootstrap.sh
```

Or directly via the API:

```bash
curl -X POST http://localhost:5000/api/github/content/bootstrap
```

---

## Seeding a new content repo

If you have an existing `marketing-content/` folder and want to copy it into a fresh
GitHub repo, run the push-all helper **while the server is running** with
`GITHUB_SYNC_ENABLED=true` pointing at the new (empty) repo:

```bash
./scripts/content-push-all.sh
```

This commits every local file to the remote one at a time.  For large content
collections this may take a few minutes.

---

## Ongoing sync

After the initial bootstrap the existing sync machinery takes over:

- **Auto-commit** — editor saves are automatically committed back to the content repo.
- **Webhook** — the server registers a GitHub webhook so push events from other
  instances (or direct repo edits) are pulled immediately.
- **Auto-pull** — on startup and via the webhook, non-conflicting remote changes are
  pulled automatically.

Refer to the GitHub Sync modal in the CMS for live status and manual controls.
