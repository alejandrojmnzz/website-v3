/**
 * Admin script: migrate-gcs-bucket
 *
 * Legacy media-only migration. Prefer migrate-gcs-multisite.ts for full layout unification.
 *
 * Usage:
 *   npx tsx scripts/admin/migrate-gcs-bucket.ts --to-bucket=<bucket> [options]
 *
 * Options:
 *   --from-bucket=<bucket>   Source bucket (default: GCS_BUCKET_NAME env)
 *   --to-bucket=<bucket>     Target bucket (required)
 *   --execute              Apply changes (default: dry-run)
 *   --resume                 Resume from .cache/gcs-migration-state.json
 *   --fresh                  Delete checkpoint before run
 *   --site=<content_folder>  Migrate one site only
 *   --delete-source          Delete source objects after successful copy
 *   --concurrency=<n>        Parallel copies (default: 10)
 */

import { fileURLToPath } from "url";
import * as path from "path";
import { config as loadDotenv } from "dotenv";
import { Storage } from "@google-cloud/storage";
import pLimit from "p-limit";
import {
  buildMigrationPlan,
  buildStorageOpts,
  CHECKPOINT_PATH,
  collectSuccessfulSrcKeys,
  copyGcsObject,
  countJobStatuses,
  createCheckpoint,
  deleteCheckpoint,
  isTerminalStatus,
  listBucketKeys,
  listDestKeysBySite,
  loadCheckpoint,
  MEDIA_SEGMENT,
  mergeCheckpointJobs,
  MigrationProgress,
  rewriteRegistryForSite,
  saveCheckpoint,
  type CheckpointState,
  type JobRecord,
  type JobStatus,
  type MigrationJob,
} from "./lib/gcs-migration";

loadDotenv({ quiet: true });

const __filename = fileURLToPath(import.meta.url);

// ─── Types ───────────────────────────────────────────────────────────────────

export interface MigrateGcsBucketOptions {
  fromBucket: string;
  toBucket: string;
  execute?: boolean;
  resume?: boolean;
  fresh?: boolean;
  site?: string;
  deleteSource?: boolean;
  concurrency?: number;
  onProgress?: (event: import("./lib/gcs-migration").MigrationProgressEvent) => void;
}

export interface MigrateGcsBucketResult {
  message: string;
  copiedCount: number;
  skippedExistsCount: number;
  skippedMissingCount: number;
  failedCount: number;
  registryRewriteCount: number;
  markersPlanted: number;
  dryRun: boolean;
}

// ─── Core ────────────────────────────────────────────────────────────────────

function updateJob(
  state: CheckpointState,
  job: MigrationJob,
  status: JobStatus,
  error: string | null,
  forceFlush: boolean,
): void {
  const rec: JobRecord = {
    srcKey: job.srcKey,
    destKey: job.destKey,
    site: job.site,
    status,
    error,
    updatedAt: new Date().toISOString(),
  };
  state.jobs[job.id] = rec;
  saveCheckpoint(state, forceFlush);
}

export async function migrateGcsBucket(
  options: MigrateGcsBucketOptions,
): Promise<MigrateGcsBucketResult> {
  const {
    fromBucket,
    toBucket,
    execute = false,
    resume = false,
    fresh = false,
    site,
    deleteSource = false,
    concurrency = 10,
  } = options;

  const dryRun = !execute;
  const progress = new MigrationProgress();
  const storage = new Storage(buildStorageOpts());
  const sourceBucket = storage.bucket(fromBucket);
  const targetBucket = storage.bucket(toBucket);

  if (fresh) deleteCheckpoint();

  process.env.LOG_LEVEL = "silent";
  const { getSiteConfigs, resetSiteConfigs } = await import("../../server/site-config");
  resetSiteConfigs();
  const siteConfigs = getSiteConfigs();

  if (siteConfigs.length === 0) {
    throw new Error("No sites found in sites.yml");
  }

  const mode = dryRun ? "DRY RUN" : "EXECUTE";
  console.log(`GCS Bucket Migration [${mode}]`);
  console.log(`  From: gs://${fromBucket}`);
  console.log(`  To:   gs://${toBucket}`);
  if (site) console.log(`  Site: ${site}`);
  console.log("");

  // ── Phase 1: Plan ─────────────────────────────────────────────────────────
  progress.printPhase(1, 4, "Planning…");

  const plan = buildMigrationPlan({
    sites: siteConfigs.map((s) => ({ contentFolder: s.contentFolder })),
    fromBucket,
    siteFilter: site,
  });

  if (plan.jobs.length === 0) {
    progress.finish();
    return {
      message: "No migration jobs found — no flat media/ URLs in registries.",
      copiedCount: 0,
      skippedExistsCount: 0,
      skippedMissingCount: 0,
      failedCount: 0,
      registryRewriteCount: 0,
      markersPlanted: 0,
      dryRun,
    };
  }

  let checkpoint =
    loadCheckpoint(fromBucket, toBucket, resume) ??
    createCheckpoint(fromBucket, toBucket);
  checkpoint.fromBucket = fromBucket;
  checkpoint.toBucket = toBucket;
  checkpoint = mergeCheckpointJobs(plan.jobs, checkpoint);
  checkpoint.phase = "copy";
  saveCheckpoint(checkpoint, true);

  console.log(`  found ${plan.jobs.length} copy job(s) across ${plan.sites.length} site(s)`);
  console.log("");

  if (dryRun) {
    let wouldCopy = 0;
    let wouldSkip = 0;
    for (const job of plan.jobs) {
      const existing = checkpoint.jobs[job.id];
      if (existing && isTerminalStatus(existing.status)) {
        wouldSkip++;
      } else {
        wouldCopy++;
        if (wouldCopy <= 15) {
          console.log(`  [DRY-RUN] Would copy: ${job.srcKey}  →  ${job.destKey}`);
        }
      }
    }
    if (wouldCopy > 15) console.log(`  … and ${wouldCopy - 15} more`);
    console.log("");
    console.log(`  Would copy: ${wouldCopy}  Already done: ${wouldSkip}`);
    console.log("");
    progress.printPhase(3, 4, "Registry rewrite (planned)…");
    console.log(`  Would rewrite URLs in ${plan.sites.length} registry file(s) after copy`);
    console.log("");
    progress.printPhase(4, 4, "Markers (planned)…");
    for (const s of plan.sites) {
      console.log(`  [DRY-RUN] Would plant: gs://${toBucket}/${s}/${MEDIA_SEGMENT}/.migrated`);
    }
    progress.finish();
    console.log("");
    console.log("═".repeat(60));
    console.log("DRY RUN complete — re-run with --execute to apply.");
    console.log("═".repeat(60));
    return {
      message: `Dry run: ${wouldCopy} job(s) would be copied`,
      copiedCount: 0,
      skippedExistsCount: 0,
      skippedMissingCount: 0,
      failedCount: 0,
      registryRewriteCount: 0,
      markersPlanted: 0,
      dryRun: true,
    };
  }

  // ── Phase 2: Copy ─────────────────────────────────────────────────────────
  progress.printPhase(2, 4, "Copying…");

  const flatPrefix = `${MEDIA_SEGMENT}/`;
  const sourceKeys = await listBucketKeys(sourceBucket, flatPrefix);
  const destKeysBySite = await listDestKeysBySite(targetBucket, plan.sites);

  const pendingJobs = plan.jobs.filter((job) => {
    const rec = checkpoint.jobs[job.id];
    return !rec || !isTerminalStatus(rec.status);
  });

  const total = plan.jobs.length;
  let processed = plan.jobs.length - pendingJobs.length;
  const limit = pLimit(concurrency);

  const runJob = async (job: MigrationJob): Promise<void> => {
    const siteDest = destKeysBySite.get(job.site) ?? new Set<string>();

    if (siteDest.has(job.destKey)) {
      updateJob(checkpoint, job, "skipped_exists", null, false);
      siteDest.add(job.destKey);
      progress.auditLine("[SKIP]", job.destKey, "already exists");
      return;
    }

    if (!sourceKeys.has(job.srcKey)) {
      updateJob(checkpoint, job, "skipped_missing", "source not found in bucket", false);
      progress.auditLine("[SKIP]", job.srcKey, "missing in source bucket");
      return;
    }

    try {
      const method = await copyGcsObject(sourceBucket, targetBucket, job.srcKey, job.destKey);
      if (method === "fallback") {
        progress.auditLine("[WARN]", job.destKey, "fallback: download→upload");
      }

      if (deleteSource && fromBucket === toBucket) {
        try {
          await sourceBucket.file(job.srcKey).delete();
        } catch {
          // non-fatal — copy succeeded
        }
      } else if (deleteSource && fromBucket !== toBucket) {
        try {
          await sourceBucket.file(job.srcKey).delete();
        } catch {
          // non-fatal
        }
      }

      siteDest.add(job.destKey);
      updateJob(checkpoint, job, "copied", null, false);
      progress.auditLine("[OK]", `${job.srcKey} → ${job.destKey}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      updateJob(checkpoint, job, "failed", msg, true);
      progress.auditLine("[ERR]", job.destKey, msg);
    }
  };

  await Promise.all(
    pendingJobs.map((job) =>
      limit(async () => {
        await runJob(job);
        processed++;
        const counts = countJobStatuses(checkpoint.jobs);
        progress.updateCopyLine(processed, total, counts, job.destKey);
        options.onProgress?.({
          phase: "copy",
          total,
          processed,
          counts,
          currentKey: job.destKey,
        });
      }),
    ),
  );

  saveCheckpoint(checkpoint, true);
  progress.finish();

  const counts = countJobStatuses(checkpoint.jobs);
  console.log("");

  // ── Phase 3: Registry rewrite ─────────────────────────────────────────────
  progress.printPhase(3, 4, "Rewriting registries…");
  checkpoint.phase = "registry";
  saveCheckpoint(checkpoint, true);

  const successfulBySite = collectSuccessfulSrcKeys(checkpoint.jobs);
  let registryRewriteCount = 0;

  for (const siteFolder of plan.sites) {
    const srcKeys = successfulBySite.get(siteFolder) ?? new Set<string>();
    const registryPath = path.join(process.cwd(), siteFolder, "image-registry.json");
    const rewrites = rewriteRegistryForSite({
      registryPath,
      site: siteFolder,
      fromBucket,
      toBucket,
      successfulSrcKeys: srcKeys,
      dryRun: false,
    });
    if (rewrites > 0) {
      console.log(`  Rewrote ${rewrites} URL(s) in ${registryPath}`);
      registryRewriteCount += rewrites;
    } else {
      console.log(`  No URLs to rewrite in ${registryPath}`);
    }
  }
  console.log("");

  // ── Phase 4: Markers ────────────────────────────────────────────────────────
  progress.printPhase(4, 4, "Planting markers…");
  checkpoint.phase = "markers";
  saveCheckpoint(checkpoint, true);

  let markersPlanted = 0;
  for (const siteFolder of plan.sites) {
    const markerKey = `${siteFolder}/${MEDIA_SEGMENT}/.migrated`;
    const destSet = destKeysBySite.get(siteFolder) ?? new Set();
    if (destSet.has(markerKey)) {
      console.log(`  [SKIP] gs://${toBucket}/${markerKey} (already exists)`);
      continue;
    }
    try {
      await targetBucket.file(markerKey).save(
        Buffer.from(`migrated=${new Date().toISOString()}\n`),
        { contentType: "text/plain", resumable: false },
      );
      console.log(`  [OK] gs://${toBucket}/${markerKey}`);
      markersPlanted++;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  [ERR] Failed to plant ${markerKey}: ${msg}`);
    }
  }

  checkpoint.phase = "done";
  saveCheckpoint(checkpoint, true);
  progress.finish();

  console.log("");
  console.log("═".repeat(60));
  console.log(
    `Done. copied=${counts.copied} skipped_exists=${counts.skipped_exists} ` +
      `skipped_missing=${counts.skipped_missing} failed=${counts.failed}`,
  );
  if (counts.failed > 0) {
    console.log(`Re-run with --execute --resume to retry ${counts.failed} failed job(s).`);
    console.log(`Checkpoint: ${CHECKPOINT_PATH}`);
  }
  console.log("═".repeat(60));

  return {
    message:
      counts.failed > 0
        ? `Migration completed with ${counts.failed} failure(s)`
        : "Migration completed successfully",
    copiedCount: counts.copied,
    skippedExistsCount: counts.skipped_exists,
    skippedMissingCount: counts.skipped_missing,
    failedCount: counts.failed,
    registryRewriteCount,
    markersPlanted,
    dryRun: false,
  };
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

function parseArgs(argv: string[]) {
  const flags = new Set(argv.filter((a) => a.startsWith("--")));
  const getVal = (prefix: string) =>
    argv.find((a) => a.startsWith(prefix))?.split("=").slice(1).join("=")?.trim();

  return {
    execute: flags.has("--execute"),
    resume: flags.has("--resume"),
    fresh: flags.has("--fresh"),
    fromBucket: getVal("--from-bucket=") || process.env.GCS_BUCKET_NAME || "",
    toBucket: getVal("--to-bucket=") || "",
    site: getVal("--site="),
    deleteSource: flags.has("--delete-source"),
    concurrency: Math.max(1, parseInt(getVal("--concurrency=") || "10", 10) || 10),
  };
}

if (process.argv[1] === __filename) {
  const args = parseArgs(process.argv.slice(2));

  if (!args.toBucket) {
    console.error("Error: --to-bucket=<name> is required.");
    console.error("");
    console.error("Usage: npx tsx scripts/admin/migrate-gcs-bucket.ts --to-bucket=<bucket> [options]");
    console.error("");
    console.error("Options:");
    console.error("  --from-bucket=<bucket>   Source (default: GCS_BUCKET_NAME)");
    console.error("  --execute                Apply changes (default: dry-run)");
    console.error("  --resume                 Resume from checkpoint");
    console.error("  --fresh                  Clear checkpoint before run");
    console.error("  --site=<content_folder>  Single site only");
    console.error("  --delete-source          Delete source after copy");
    console.error("  --concurrency=<n>        Parallel copies (default: 10)");
    process.exit(1);
  }

  if (!args.fromBucket) {
    console.error("Error: --from-bucket or GCS_BUCKET_NAME env var is required.");
    process.exit(1);
  }

  migrateGcsBucket({
    fromBucket: args.fromBucket,
    toBucket: args.toBucket,
    execute: args.execute,
    resume: args.resume,
    fresh: args.fresh,
    site: args.site,
    deleteSource: args.deleteSource,
    concurrency: args.concurrency,
  })
    .then((result) => {
      if (result.failedCount > 0) process.exit(1);
    })
    .catch((err) => {
      console.error("Unexpected error:", err);
      process.exit(1);
    });
}
