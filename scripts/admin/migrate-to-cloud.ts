/**
 * Admin script: migrate-to-cloud
 *
 * Migrates images between media providers (e.g. local → GCS or GCS → local).
 *
 * Usage:
 *   npx tsx scripts/admin/migrate-to-cloud.ts <from> <to> [--dry-run] [--prefix=<path>]
 *
 * Examples:
 *   npx tsx scripts/admin/migrate-to-cloud.ts local gcs --dry-run
 *   npx tsx scripts/admin/migrate-to-cloud.ts local gcs --prefix=4geeks-com/images
 *   npx tsx scripts/admin/migrate-to-cloud.ts gcs local
 *
 * Available providers: local, gcs
 */

import { fileURLToPath } from "url";
import { media } from "../../server/media";
import { mediaGallery } from "../../server/media-gallery";

export interface MigrateToCloudOptions {
  from: string;
  to: string;
  dryRun?: boolean;
  prefix?: string;
}

export interface MigrateResultItem {
  id: string;
  oldSrc?: string;
  newSrc?: string;
  status: string;
  reason?: string;
}

export interface MigrateToCloudResult {
  message: string;
  results: MigrateResultItem[];
  totalProcessed: number;
  migratedCount: number;
  skippedCount: number;
  errorCount: number;
}

export async function migrateToCloud(options: MigrateToCloudOptions): Promise<MigrateToCloudResult> {
  const { from, to, dryRun = false, prefix } = options;

  const providers = media.getAllProviderNames();
  if (!providers.includes(from)) {
    return {
      message: `Provider "${from}" is not configured. Available: ${providers.join(", ")}`,
      results: [],
      totalProcessed: 0,
      migratedCount: 0,
      skippedCount: 0,
      errorCount: 0,
    };
  }
  if (!providers.includes(to)) {
    return {
      message: `Provider "${to}" is not configured. Available: ${providers.join(", ")}`,
      results: [],
      totalProcessed: 0,
      migratedCount: 0,
      skippedCount: 0,
      errorCount: 0,
    };
  }

  const rawResults = await mediaGallery.migrate(from, to, { dryRun, prefix });

  const results: MigrateResultItem[] = [];
  let migratedCount = 0;
  let skippedCount = 0;
  let errorCount = 0;

  for (const r of rawResults) {
    if (r.status === "migrated" || r.status === "dry-run") {
      migratedCount++;
      results.push({ id: r.id, oldSrc: r.oldSrc, newSrc: r.newSrc, status: r.status });
    } else if (r.status.startsWith("skipped")) {
      skippedCount++;
      results.push({ id: r.id, status: "skipped", reason: r.status });
    } else {
      errorCount++;
      results.push({ id: r.id, status: "error", reason: r.status });
    }
  }

  const message = dryRun
    ? `Dry run: ${migratedCount} image(s) would be migrated from ${from} to ${to}`
    : `Done. ${migratedCount} migrated, ${skippedCount} skipped, ${errorCount} failed (${rawResults.length} total)`;

  return {
    message,
    results,
    totalProcessed: rawResults.length,
    migratedCount,
    skippedCount,
    errorCount,
  };
}

const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] === __filename) {
  const args = process.argv.slice(2);
  const flags = new Set(args.filter(a => a.startsWith("--") && !a.includes("=")));
  const positional = args.filter(a => !a.startsWith("--"));

  const from = positional[0];
  const to = positional[1];
  const dryRun = flags.has("--dry-run");
  const prefix = args.find(a => a.startsWith("--prefix="))?.split("=")[1];

  if (!from || !to) {
    console.log("Usage: npx tsx scripts/admin/migrate-to-cloud.ts <from> <to> [--dry-run] [--prefix=images]");
    console.log("");
    console.log("Examples:");
    console.log("  npx tsx scripts/admin/migrate-to-cloud.ts local gcs --dry-run");
    console.log("  npx tsx scripts/admin/migrate-to-cloud.ts local gcs --prefix=4geeks-com/images");
    console.log("  npx tsx scripts/admin/migrate-to-cloud.ts gcs local");
    console.log("");
    console.log("Available providers: local, gcs");
    process.exit(1);
  }

  media.initFromEnv();

  const providers = media.getAllProviderNames();
  if (!providers.includes(from)) {
    console.error(`Provider "${from}" is not configured. Available: ${providers.join(", ")}`);
    process.exit(1);
  }
  if (!providers.includes(to)) {
    console.error(`Provider "${to}" is not configured. Available: ${providers.join(", ")}`);
    process.exit(1);
  }

  console.log(`Migrating images from "${from}" to "${to}"${dryRun ? " (DRY RUN)" : ""}${prefix ? ` with prefix "${prefix}"` : ""}`);
  console.log("");

  migrateToCloud({ from, to, dryRun, prefix }).then(result => {
    for (const r of result.results) {
      if (r.status === "migrated" || r.status === "dry-run") {
        console.log(`  [OK] ${r.id}: ${r.oldSrc} -> ${r.newSrc}`);
      } else if (r.status === "skipped") {
        console.log(`  [SKIP] ${r.id}: ${r.reason}`);
      } else {
        console.log(`  [ERR] ${r.id}: ${r.reason}`);
      }
    }
    console.log("");
    console.log(result.message);
  }).catch(err => {
    console.error("Migration failed:", err);
    process.exit(1);
  });
}
