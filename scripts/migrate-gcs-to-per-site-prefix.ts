/**
 * @migration migrate-gcs-to-per-site-prefix
 * @description
 * Moves existing flat `media/<file>` GCS objects to the per-site prefix
 * `{siteName}/media/<file>`, then rewrites the affected image-registry.json
 * entries with the new public URLs, and finally deletes the original objects.
 *
 * Usage:
 *   npx tsx scripts/migrate-gcs-to-per-site-prefix.ts [--execute] [--site=<name>]
 *
 * Flags:
 *   --execute    Apply changes (copy objects, update registry, delete originals).
 *                Default is dry-run — only shows what would happen.
 *   --site=NAME  Migrate only the named site folder (e.g. --site=4geeks-com).
 *                Default: uses the CONTENT_FOLDER env var or discovers all
 *                top-level directories that contain an image-registry.json.
 *
 * Prerequisites:
 *   GCS_BUCKET_NAME (and optional GCS_PROJECT_ID / GCS_CREDENTIALS_JSON /
 *   GCS_KEY_FILENAME) must be set in the environment.
 *   GCS_BASE_PATH defaults to "media" — override if your deployment uses a
 *   different inner segment name.
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { Storage } from "@google-cloud/storage";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const EXECUTE = process.argv.includes("--execute");
const SITE_ARG = process.argv.find((a) => a.startsWith("--site="))?.slice("--site=".length);

// ─── GCS setup ───────────────────────────────────────────────────────────────

const BUCKET_NAME = process.env.GCS_BUCKET_NAME;
if (!BUCKET_NAME) {
  console.error("ERROR: GCS_BUCKET_NAME is not set.");
  process.exit(1);
}

const storageOpts: Record<string, any> = {};
if (process.env.GCS_PROJECT_ID) storageOpts.projectId = process.env.GCS_PROJECT_ID;
if (process.env.GCS_CREDENTIALS_JSON) {
  try {
    storageOpts.credentials = JSON.parse(process.env.GCS_CREDENTIALS_JSON);
  } catch {
    console.warn("WARN: Failed to parse GCS_CREDENTIALS_JSON — using default auth.");
  }
} else if (process.env.GCS_KEY_FILENAME) {
  storageOpts.keyFilename = process.env.GCS_KEY_FILENAME;
}

const storage = new Storage(storageOpts);
const bucket = storage.bucket(BUCKET_NAME);

const MEDIA_SEGMENT = process.env.GCS_BASE_PATH || "media";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function publicUrl(key: string): string {
  return `https://storage.googleapis.com/${BUCKET_NAME}/${key}`;
}

async function listObjects(prefix: string): Promise<string[]> {
  const [files] = await bucket.getFiles({ prefix, versions: false });
  return files.map((f) => f.name);
}

async function copyObject(srcKey: string, destKey: string): Promise<void> {
  await bucket.file(srcKey).copy(bucket.file(destKey));
}

async function deleteObject(key: string): Promise<void> {
  try {
    await bucket.file(key).delete();
  } catch (err: any) {
    if (err?.code !== 404) throw err;
  }
}

function discoverSites(): string[] {
  // A site folder is a top-level directory that has an image-registry.json.
  const entries = fs.readdirSync(ROOT, { withFileTypes: true });
  return entries
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(ROOT, e.name, "image-registry.json")))
    .map((e) => e.name);
}

// ─── Per-site migration ───────────────────────────────────────────────────────

interface SiteResult {
  site: string;
  moved: Array<{ from: string; to: string }>;
  skipped: Array<{ key: string; reason: string }>;
  registryEntriesUpdated: number;
  errors: Array<{ key: string; error: string }>;
}

async function migrateSite(siteName: string): Promise<SiteResult> {
  const result: SiteResult = { site: siteName, moved: [], skipped: [], registryEntriesUpdated: 0, errors: [] };

  const registryPath = path.join(ROOT, siteName, "image-registry.json");
  if (!fs.existsSync(registryPath)) {
    result.skipped.push({ key: "(registry)", reason: "image-registry.json not found" });
    return result;
  }

  const registry = JSON.parse(fs.readFileSync(registryPath, "utf8")) as {
    images: Record<string, { src: string; [k: string]: unknown }>;
    presets: Record<string, unknown>;
  };

  // Flat prefix (old location): `media/`
  const flatPrefix = `${MEDIA_SEGMENT}/`;
  // Per-site prefix (new location): `{siteName}/media/`
  const sitePrefix = `${siteName}/${MEDIA_SEGMENT}/`;

  // Collect which registry entries currently point to flat prefix URLs.
  const entriesToMigrate: Array<{ id: string; oldKey: string; filename: string }> = [];
  for (const [id, entry] of Object.entries(registry.images)) {
    const src = entry.src;
    if (!src || typeof src !== "string") continue;
    const flatUrl = publicUrl(flatPrefix);
    if (!src.startsWith(flatUrl)) continue;
    const filename = src.slice(flatUrl.length);
    entriesToMigrate.push({ id, oldKey: `${flatPrefix}${filename}`, filename });
  }

  if (entriesToMigrate.length === 0) {
    result.skipped.push({ key: "(all entries)", reason: "no entries under the flat media/ prefix" });
    return result;
  }

  // Also list all objects that actually exist under the flat prefix in GCS.
  let existingFlatKeys: Set<string>;
  try {
    const listed = await listObjects(flatPrefix);
    existingFlatKeys = new Set(listed);
  } catch (err: any) {
    result.errors.push({ key: flatPrefix, error: `list failed: ${err.message}` });
    return result;
  }

  let registryDirty = false;

  for (const { id, oldKey, filename } of entriesToMigrate) {
    const newKey = `${sitePrefix}${filename}`;
    const oldUrl = publicUrl(oldKey);
    const newUrl = publicUrl(newKey);

    if (!existingFlatKeys.has(oldKey)) {
      result.skipped.push({ key: oldKey, reason: "object not found in GCS (may already be at new location or deleted)" });
      continue;
    }

    if (!EXECUTE) {
      result.moved.push({ from: oldKey, to: newKey });
      continue;
    }

    try {
      // 1. Copy to new location.
      await copyObject(oldKey, newKey);

      // 2. Update registry entry.
      registry.images[id].src = newUrl;
      // Also update srcset URLs if present.
      const entry = registry.images[id] as any;
      if (Array.isArray(entry.srcset)) {
        for (const variant of entry.srcset) {
          if (typeof variant.url === "string" && variant.url.startsWith(publicUrl(flatPrefix))) {
            const variantFilename = variant.url.slice(publicUrl(flatPrefix).length);
            const variantNewKey = `${sitePrefix}${variantFilename}`;
            if (existingFlatKeys.has(`${flatPrefix}${variantFilename}`)) {
              await copyObject(`${flatPrefix}${variantFilename}`, variantNewKey);
              await deleteObject(`${flatPrefix}${variantFilename}`);
            }
            variant.url = publicUrl(variantNewKey);
          }
        }
      }
      registryDirty = true;

      // 3. Delete original.
      await deleteObject(oldKey);

      result.moved.push({ from: oldKey, to: newKey });
    } catch (err: any) {
      result.errors.push({ key: oldKey, error: err.message || String(err) });
      // Restore registry entry URL on error.
      registry.images[id].src = oldUrl;
    }
  }

  if (EXECUTE && registryDirty) {
    fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2) + "\n", "utf8");
    result.registryEntriesUpdated = result.moved.length;
    console.log(`  [${siteName}] Wrote updated image-registry.json (${result.registryEntriesUpdated} entries)`);
  }

  return result;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const mode = EXECUTE ? "EXECUTE" : "DRY RUN";
  console.log(`\n=== GCS per-site prefix migration (${mode}) ===`);
  console.log(`Bucket:        ${BUCKET_NAME}`);
  console.log(`Media segment: ${MEDIA_SEGMENT}`);
  console.log(`Old prefix:    ${MEDIA_SEGMENT}/<file>`);
  console.log(`New prefix:    {site}/${MEDIA_SEGMENT}/<file>\n`);

  const sites = SITE_ARG
    ? [SITE_ARG]
    : process.env.CONTENT_FOLDER
      ? [process.env.CONTENT_FOLDER]
      : discoverSites();

  if (sites.length === 0) {
    console.error("No site folders found containing image-registry.json.");
    process.exit(1);
  }

  console.log(`Sites to migrate: ${sites.join(", ")}\n`);

  let totalMoved = 0;
  let totalErrors = 0;

  for (const site of sites) {
    console.log(`--- Site: ${site} ---`);
    const result = await migrateSite(site);

    if (result.moved.length > 0) {
      console.log(`  ${EXECUTE ? "Moved" : "Would move"}: ${result.moved.length} object(s)`);
      result.moved.slice(0, 10).forEach(({ from, to }) => console.log(`    ${from}  →  ${to}`));
      if (result.moved.length > 10) console.log(`    ... and ${result.moved.length - 10} more`);
      totalMoved += result.moved.length;
    }

    if (result.skipped.length > 0) {
      console.log(`  Skipped: ${result.skipped.length}`);
      result.skipped.forEach(({ key, reason }) => console.log(`    ${key}: ${reason}`));
    }

    if (result.errors.length > 0) {
      console.log(`  Errors: ${result.errors.length}`);
      result.errors.forEach(({ key, error }) => console.log(`    ${key}: ${error}`));
      totalErrors += result.errors.length;
    }

    if (EXECUTE && result.registryEntriesUpdated > 0) {
      console.log(`  Registry entries updated: ${result.registryEntriesUpdated}`);
    }

    console.log();
  }

  console.log(`=== Summary ===`);
  console.log(`${EXECUTE ? "Moved" : "Would move"}: ${totalMoved} object(s) across ${sites.length} site(s)`);
  if (totalErrors > 0) console.log(`Errors: ${totalErrors}`);

  if (!EXECUTE) {
    console.log(`\nRun with --execute to apply changes.`);
  } else {
    console.log(`\nMigration complete.`);
    if (totalErrors > 0) {
      console.log(`WARNING: ${totalErrors} error(s) occurred. Review above and re-run for failed objects.`);
    }
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
