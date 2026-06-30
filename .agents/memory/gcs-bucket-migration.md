---
name: GCS bucket migration architecture
description: Bucket name resolution from sites.yml, old-layout detection, write-block semantics, and migration script conventions.
---

# GCS Bucket Migration Architecture

## Key Decision: Bucket Name Resolution
Bucket name comes from `sites.yml` top-level `bucket_name` field first, then falls back to `GCS_BUCKET_NAME` env var. All consumers use the `gcs` singleton — no other code needs to change when the bucket changes.

**Why:** The bucket is shared across all sites; centralizing it in `sites.yml` avoids per-site env var sprawl and makes multi-site deployments self-documenting.

## Write-Block Semantics
When `gcs.migrationRequired` is true, `upload()` throws an error (not a silent fake-URL return). Callers surface the failure via their existing error handling. `debouncedUpload()` emits a warning log and returns silently (fire-and-forget nature makes this safe).

**Why:** Returning a phantom URL from `upload()` would cause callers to persist references to objects that don't exist, creating broken media assets. Throwing is the correct contract for a synchronous write operation.

## Migration Script Convention
The migration script (`scripts/admin/migrate-to-new-bucket.ts`) uses two raw `@google-cloud/storage` clients (source + target) to bypass the `gcs` singleton and its write-block. Registry URL rewrites parse the JSON structurally (not string-replace) and write back with `JSON.stringify(..., null, 2) + "\n"` — matching the server's registry format.

**How to apply:** Any future admin migration script that needs to write to GCS while the write-block is active should follow the same pattern: raw SDK clients, bypass the singleton.
