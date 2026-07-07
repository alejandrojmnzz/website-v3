---
name: node_modules/@shared symlink hazard
description: Why a node_modules/@shared symlink must never exist in the dev workspace, and how drizzle owns the error_log table
---

# Never symlink node_modules/@shared → shared/ in the dev workspace

**Rule:** Do not create `node_modules/@shared` as a symlink to the real `shared/` folder in the working environment. If needed for a production build, create it only inside the deployment build command (see prod-build-shared-alias.md).

**Why:** `npm install` prunes unknown entries in `node_modules` and follows the symlink, deleting the *real* files in `shared/` (all 13 source files were wiped this way in July 2026; restored from git HEAD).

**How to apply:** `scripts/post-merge.sh` removes the symlink before `npm install` as a guardrail. If `shared/` files ever vanish, check for this symlink first and restore via `git show HEAD:<file>`.

# error_log table is drizzle-declared but raw-SQL-created

The `error_log` SQLite table is created at runtime by raw SQL in `server/db.ts` (`CREATE TABLE IF NOT EXISTS`). It is *also* declared in `shared/schema.ts` (`errorLog`) solely so `drizzle-kit push` doesn't propose a destructive DROP (which triggers a TTY prompt that fails in non-interactive post-merge runs).

**How to apply:** Keep the two definitions in sync if the table ever changes. Don't add `--force` to `db:push` in post-merge — failing loudly on data-loss statements is intentional.
