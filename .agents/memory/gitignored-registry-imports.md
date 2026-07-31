---
name: Gitignored site registry imports can break builds after pulls
description: shared/schema.ts imports .ts files from gitignored site_*/component-registry; a git pull can desync them and break deploy builds.
---

**Rule:** Tracked code (notably `shared/schema.ts`) re-exports Zod schemas from `site_4geeks-com/component-registry/**/schema.ts`, but the entire `site_*/` tree is gitignored (content synced separately, not via this repo). After a git pull, tracked files can reference exports that don't exist locally.

**Why:** A teammate commit updated `shared/schema.ts` to import new cta_banner variant schemas (strip/promotion/resourceShowcase); the registry file never arrived, so the deployment build and dev server both crashed with "does not provide an export named ...".

**How to apply:** When a build/dev crash says a `site_*/component-registry/.../schema.ts` module "does not provide an export", diff `shared/schema.ts` re-exports against the local registry file and add the missing schemas locally (infer shapes from the matching `client/src/components/<type>/variants/*.tsx`). Quick preflight: `npx tsx -e 'import("./shared/schema")'`.
