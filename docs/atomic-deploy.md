# Atomic deploy (VPS)

## Layout

```text
/opt/website-v3/
  persistent/          # sites.yml, site_*, data, .cache, .local, …
  releases/<sha>/      # app tree + .env for that deploy
  current -> releases/<sha>
  .git/                # object store for fetch/archive (not the live app)
```

Live process must use `current` (see systemd below). Mutable content stays in `persistent/`. `.env` is **per release** (written by `scripts/deploy.sh` from `_WEBSITE_*` secrets, or copied from the previous release if the pack is empty).

### Per-site hybrid (important)

`shared/schema.ts` imports Zod schemas from `site_*/component-registry/**/*.ts` via relative paths. If the whole `site_*` directory is a symlink into `persistent/`, Node resolves those `../` against the **realpath** and looks for `persistent/shared/…`, which breaks the build.

So each release gets:

| Path under `site_*` | Treatment |
|---------------------|-----------|
| Everything except `component-registry/` | Symlink → `persistent/site_*/…` (YAML, blog, images, sync state, …) |
| `component-registry/` | **Copied** into the release (real files next to `shared/`) |

YAML/content via symlink is live immediately.

**Sync / GitHub pull and registry:** pull still writes/deletes under `cwd` (the release copy). After a change under `component-registry/`, the server mirrors that tree **release → `persistent/`** (`server/component-registry-persistent.ts`) so the next deploy’s `cp -a` does not resurrect deleted or stale registry files. Without `persistent/` (local dev), the mirror is a no-op.

## One-time: point systemd at `current`

Requires root/sudo. After the first successful atomic deploy (or after creating `current` manually):

```bash
# /etc/systemd/system/website.service
WorkingDirectory=/opt/website-v3/current
EnvironmentFile=/opt/website-v3/current/.env
ExecStart=/opt/website-v3/current/scripts/start-production.sh
```

Keep `ReadWritePaths=/opt/website-v3` so `persistent/` remains writable.

```bash
sudo systemctl daemon-reload
sudo systemctl restart website
curl -fsS http://127.0.0.1:5000/health
```

Until this flip, `deploy.sh` still builds releases and updates `current`, but the running service may keep using the legacy root tree — the script prints a WARNING if `WorkingDirectory` ≠ `…/current`.

## Site adopt (new `site_*` created at runtime)

The app writes to `cwd/site_…` and does not know about `persistent/`. On each deploy, before building the new release, `deploy.sh`:

1. Finds real (non-symlink) `site_*` dirs under `current/` (and legacy app root)
2. `mv` them into `persistent/`
3. Puts an absolute symlink back at the old path so the live process keeps working
4. Then materializes each site into the new release (hybrid link/copy above)

If `persistent/site_…` already exists, adopt skips (does not overwrite). Empty `persistent` folders are still created for new `content_folder` entries in `sites.yml` when nothing exists yet.

## Deploy path

GitHub Actions (`deploy-vps.yml`) exports `DEPLOY_SHA` + `WEBSITE_RUNTIME_B64`, fetches that commit on the VPS, extracts `scripts/deploy.sh` from that SHA, and runs it. The script:

1. Adopt real `site_*` dirs into `persistent/` (symlink back on live tree)
2. `git archive` → `releases/<sha>/`
3. Symlinks for `data` / `.cache` / `sites.yml` / …
4. Per site: content symlinks + **copy** `component-registry/`
5. Writes `.env`
6. `npm ci` + build
7. Flips `current`, restarts, health-checks (rollback `current` on failure)
8. Prunes old releases (keeps active + 5 others; never deletes `readlink current`)

## Manual rollback

```bash
ln -sfn releases/<old-sha> /opt/website-v3/current
sudo systemctl restart website
```

Prefer a normal Actions deploy to an older SHA if you also need a fresh `.env` from secrets.
