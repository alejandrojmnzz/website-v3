---
name: Gitignored site registry imports can break builds after pulls
description: shared/schema.ts imports .ts files from gitignored site_*/component-registry; a git pull can desync them and break deploy builds.
---

**Rule:** Tracked code (notably `shared/schema.ts`) re-exports Zod schemas from `site_4geeks-com/component-registry/**/schema.ts`, but the entire `site_*/` tree is gitignored (content synced separately, not via this repo). After a git pull, tracked files can reference exports that don't exist locally.

**Why:** A teammate commit updated `shared/schema.ts` to import new cta_banner variant schemas (strip/promotion/resourceShowcase); the registry file never arrived, so the deployment build and dev server both crashed with "does not provide an export named ...". Startup auto-pull runs only after Express loads — too late when the crash is at `shared/schema` import time.

**How to apply:**

1. Run `npm run check:registry` (or rely on `predev`/`prebuild` → `ensure:registry`).
2. If it fails: `npm run content:pull` (needs `GITHUB_TOKEN` + `github_repo_url` in `sites.yml`; no server/UI required). Then re-check.
3. `npm run ensure:registry` does check → pull on failure → re-check in a fresh process.
4. If still failing after pull: remote also lacks the export — land schema in the content repo first, or remove the premature re-export from `shared/schema.ts`. Infer shapes from `client/src/components/<type>/variants/*.tsx` if patching locally as a last resort.

**Agents:** missing registry export → `next_actions`: `npm run content:pull` then `npm run check:registry`. Non-effect: does not commit app code. Path: `site_*/component-registry/.../schema.ts`. See `.cursor/rules/registry-content-sync.mdc`.
