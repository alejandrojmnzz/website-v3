/**
 * Admin script: migrate-to-new-bucket
 *
 * One-time migration from the old flat GCS bucket layout (media/…) to a fresh
 * bucket that uses the new per-site prefix layout ({site}/media/…).
 *
 * This script bypasses the `gcs` singleton so the write-block imposed by
 * `gcs.migrationRequired` does not interfere with the migration itself.
 * It uses two raw `@google-cloud/storage` SDK clients — source and target.
 *
 * Usage:
 *   npx tsx scripts/admin/migrate-to-new-bucket.ts --to-bucket=<new-bucket-name> [--dry-run]
 *
 * Examples:
 *   npx tsx scripts/admin/migrate-to-new-bucket.ts --to-bucket=my-new-multisite-bucket --dry-run
 *   npx tsx scripts/admin/migrate-to-new-bucket.ts --to-bucket=my-new-multisite-bucket
 *
 * After a successful migration:
 *   1. Add `bucket_name: <new-bucket-name>` as the first line of sites.yml.
 *   2. Redeploy. The server will pick up the new bucket automatically.
 *   3. Verify the new bucket is serving media correctly.
 *   4. Archive (do not delete) the old bucket.
 *
 * Environment variables (same as the server):
 *   GCS_BUCKET_NAME        – source bucket (old)
 *   GCS_PROJECT_ID         – optional
 *   GCS_KEY_FILENAME       – optional (path to service-account JSON)
 *   GCS_CREDENTIALS_JSON   – optional (inline service-account JSON)
 */

import { fileURLToPath } from "url";
import * as fs from "fs";
import * as path from "path";
import { Storage } from "@google-cloud/storage";

const __filename = fileURLToPath(import.meta.url);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildStorageOpts(): Record<string, unknown> {
  const opts: Record<string, unknown> = {};
  if (process.env.GCS_PROJECT_ID) opts.projectId = process.env.GCS_PROJECT_ID;
  if (process.env.GCS_CREDENTIALS_JSON) {
    try {
      opts.credentials = JSON.parse(process.env.GCS_CREDENTIALS_JSON);
    } catch {
      console.warn("Warning: failed to parse GCS_CREDENTIALS_JSON, using default auth");
    }
  } else if (process.env.GCS_KEY_FILENAME) {
    opts.keyFilename = process.env.GCS_KEY_FILENAME;
  }
  return opts;
}

interface SrcsetEntry {
  w: number;
  url: string;
}

interface ImageEntry {
  src: string;
  alt: string;
  srcset?: SrcsetEntry[];
  [key: string]: unknown;
}

interface ImageRegistry {
  presets: Record<string, unknown>;
  images: Record<string, ImageEntry>;
  [key: string]: unknown;
}

/**
 * Rewrite GCS storage URLs in image-registry.json from oldBucket → newBucket.
 * Parses the registry as structured JSON, updates src + srcset entries, and
 * writes back with the same formatting used by the server's registry writer.
 */
function rewriteRegistryUrls(registryPath: string, oldBucket: string, newBucket: string, dryRun: boolean): number {
  if (!fs.existsSync(registryPath)) return 0;

  const raw = fs.readFileSync(registryPath, "utf-8");
  const oldUrl = `https://storage.googleapis.com/${oldBucket}/`;
  const newUrl = `https://storage.googleapis.com/${newBucket}/`;

  let registry: ImageRegistry;
  try {
    registry = JSON.parse(raw) as ImageRegistry;
  } catch (err) {
    console.error(`  [WARN] Failed to parse ${registryPath} — skipping URL rewrite`);
    return 0;
  }

  let count = 0;

  const rewrite = (url: string): string => {
    if (url.startsWith(oldUrl)) {
      count++;
      return newUrl + url.slice(oldUrl.length);
    }
    return url;
  };

  for (const entry of Object.values(registry.images)) {
    if (typeof entry.src === "string") {
      entry.src = rewrite(entry.src);
    }
    if (Array.isArray(entry.srcset)) {
      for (const variant of entry.srcset) {
        if (typeof variant.url === "string") {
          variant.url = rewrite(variant.url);
        }
      }
    }
    if (typeof entry.source_url === "string") {
      entry.source_url = rewrite(entry.source_url as string);
    }
  }

  if (count === 0) return 0;

  if (!dryRun) {
    fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2) + "\n", "utf-8");
  }

  return count;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function run(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const toBucketArg = args.find((a) => a.startsWith("--to-bucket="));

  if (!toBucketArg) {
    console.error("Error: --to-bucket=<name> is required.");
    console.error("");
    console.error("Usage: npx tsx scripts/admin/migrate-to-new-bucket.ts --to-bucket=<new-bucket> [--dry-run]");
    process.exit(1);
  }

  const targetBucket = toBucketArg.split("=")[1].trim();
  const sourceBucket = process.env.GCS_BUCKET_NAME;

  if (!sourceBucket) {
    console.error("Error: GCS_BUCKET_NAME env var is required (source bucket).");
    process.exit(1);
  }

  const sameBucket = sourceBucket === targetBucket;

  console.log(`GCS Bucket Migration${dryRun ? " [DRY RUN]" : ""}${sameBucket ? " [IN-PLACE]" : ""}`);
  console.log(`  Source : gs://${sourceBucket}`);
  console.log(`  Target : gs://${targetBucket}`);
  if (sameBucket) {
    console.log("  Mode   : in-place (same bucket — file copy and URL rewrite skipped)");
  }
  console.log("");

  const storageOpts = buildStorageOpts();
  const sourceStorage = new Storage(storageOpts);
  const targetStorage = new Storage(storageOpts);

  // ── Step 1: List / copy objects ───────────────────────────────────────────
  let copied = 0;
  let failed = 0;

  if (sameBucket) {
    console.log("Step 1: Skipped — source and target are the same bucket.");
    console.log("  Existing files at media/… will coexist with new site-prefixed uploads.");
    console.log("");
  } else {
    console.log("Step 1: Listing all objects in source bucket…");
    let allFiles: string[] = [];
    try {
      const [files] = await sourceStorage.bucket(sourceBucket).getFiles({ versions: false });
      allFiles = files.map((f) => f.name);
    } catch (err) {
      console.error("Failed to list source bucket:", err);
      process.exit(1);
    }
    console.log(`  Found ${allFiles.length} object(s).`);
    console.log("");

    if (allFiles.length === 0) {
      console.log("Source bucket is empty — nothing to migrate.");
      process.exit(0);
    }

    // ── Step 2: Copy each object to the target bucket ───────────────────────
    console.log(`Step 2: Copying objects to gs://${targetBucket}…`);

    for (const key of allFiles) {
      if (dryRun) {
        console.log(`  [DRY-RUN] Would copy: ${key}`);
        copied++;
        continue;
      }

      try {
        const sourceFile = sourceStorage.bucket(sourceBucket).file(key);
        const targetFile = targetStorage.bucket(targetBucket).file(key);

        try {
          await sourceFile.copy(targetFile);
          console.log(`  [OK] ${key}`);
          copied++;
        } catch (copyErr: any) {
          // Cross-bucket rewrite may be unavailable; fall back to download → upload
          if (copyErr?.code === 403 || copyErr?.code === 400) {
            const [data] = await sourceFile.download();
            const [meta] = await sourceFile.getMetadata();
            const contentType = (meta as Record<string, unknown>).contentType as string || "application/octet-stream";
            await targetFile.save(data, { contentType, resumable: false });
            console.log(`  [OK (download→upload fallback)] ${key}`);
            copied++;
          } else {
            throw copyErr;
          }
        }
      } catch (err) {
        console.error(`  [ERR] ${key}:`, err);
        failed++;
      }
    }

    console.log("");
    console.log(`  Copied: ${copied}  Failed: ${failed}`);
    console.log("");
  }

  // ── Step 3: Rewrite image-registry.json URLs ──────────────────────────────
  if (sameBucket) {
    console.log("Step 3: Skipped — bucket name unchanged, no URL rewrite needed.");
    console.log("");
  } else {
    console.log("Step 3: Rewriting image-registry.json URLs…");

    const cwd = process.cwd();
    let siteContentFolders: string[] = [];
    try {
      const yaml = await import("js-yaml");
      const sitesYmlPath = path.join(cwd, "sites.yml");
      if (fs.existsSync(sitesYmlPath)) {
        const raw = fs.readFileSync(sitesYmlPath, "utf-8");
        const parsed = yaml.load(raw) as Record<string, unknown> | null;
        if (parsed && typeof parsed === "object") {
          for (const [key, val] of Object.entries(parsed)) {
            if (key === "bucket_name") continue;
            if (val && typeof val === "object") {
              const cfg = val as Record<string, unknown>;
              const folder = (cfg.content_folder ?? cfg.contentFolder) as string | undefined;
              if (folder) siteContentFolders.push(folder);
            }
          }
        }
      }
    } catch {}

    if (siteContentFolders.length === 0) {
      const envFolder = process.env.CONTENT_FOLDER;
      if (envFolder) siteContentFolders = [envFolder];
    }

    if (siteContentFolders.length === 0) {
      console.log("  No site content folders found — skipping registry URL rewrite.");
    } else {
      let totalRewrites = 0;
      for (const folder of siteContentFolders) {
        const registryPath = path.join(cwd, folder, "image-registry.json");
        const rewrites = rewriteRegistryUrls(registryPath, sourceBucket, targetBucket, dryRun);
        if (rewrites > 0) {
          console.log(`  ${dryRun ? "[DRY-RUN] Would rewrite" : "Rewrote"} ${rewrites} URL(s) in ${folder}/image-registry.json`);
          totalRewrites += rewrites;
        } else {
          console.log(`  No GCS URLs to rewrite in ${folder}/image-registry.json`);
        }
      }
      console.log(`  Total URL rewrites: ${totalRewrites}`);
    }

    console.log("");
  }

  // ── Summary & next steps ──────────────────────────────────────────────────
  console.log("═".repeat(60));
  if (dryRun) {
    console.log("DRY RUN complete — no files were written or copied.");
    console.log("Re-run without --dry-run to perform the actual migration.");
  } else if (sameBucket) {
    console.log("In-place migration ready.");
    console.log("");
    console.log("Next steps:");
    console.log(`  1. Add the following line to the TOP of sites.yml:`);
    console.log(`       bucket_name: ${targetBucket}`);
    console.log("  2. Redeploy the server — new uploads will use site-prefixed paths automatically.");
    console.log("  3. Old files at media/… remain in the bucket and continue to serve correctly.");
    console.log("     They can be archived or deleted once all references have been updated.");
  } else {
    console.log(`Migration complete: ${copied} object(s) copied, ${failed} failed.`);
    console.log("");
    console.log("Next steps:");
    console.log(`  1. Add the following line to the TOP of sites.yml:`);
    console.log(`       bucket_name: ${targetBucket}`);
    console.log("  2. Redeploy the server — it will use the new bucket automatically.");
    console.log("  3. Verify media is serving correctly from the new bucket.");
    console.log(`  4. Archive (do not delete) the old bucket: gs://${sourceBucket}`);
  }
  console.log("═".repeat(60));

  if (failed > 0) {
    process.exit(1);
  }
}

if (process.argv[1] === __filename) {
  run().catch((err) => {
    console.error("Unexpected error:", err);
    process.exit(1);
  });
}
