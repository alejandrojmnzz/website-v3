# Atomic deploy (VPS)

## Layout

```text
/opt/website-v3/
  persistent/          # sites.yml, site_*, data, .cache, .local, …
  releases/<sha>/      # app tree + .env for that deploy
  current -> releases/<sha>
  .git/                # object store for fetch/archive (not the live app)
```

Live process must use `current` (see systemd below). Mutable content stays in `persistent/`; each release only symlinks into it. `.env` is **per release** (written by `scripts/deploy.sh` from `_WEBSITE_*` secrets, or copied from the previous release if the pack is empty).

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

## Deploy path

GitHub Actions (`deploy-vps.yml`) exports `DEPLOY_SHA` + `WEBSITE_RUNTIME_B64`, fetches that commit on the VPS, extracts `scripts/deploy.sh` from that SHA, and runs it. The script:

1. `git archive` → `releases/<sha>/`
2. Symlinks → `persistent/`
3. Writes `.env`
4. `npm ci` + build
5. Flips `current`, restarts, health-checks (rollback `current` on failure)
6. Prunes old releases (keeps active + 5 others; never deletes `readlink current`)

## Manual rollback

```bash
ln -sfn releases/<old-sha> /opt/website-v3/current
sudo systemctl restart website
```

Prefer a normal Actions deploy to an older SHA if you also need a fresh `.env` from secrets.
