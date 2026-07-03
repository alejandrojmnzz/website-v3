/**
 * Admin script: migrate-gcs-multisite
 *
 * Unified multisite GCS migration:
 *  - flat media/ → {site}/media/ (registry-driven)
 *  - sync/{site}/* → {site}/sync/*
 *  - conversations/{site}/* → {site}/conversations/*
 *  - reports/lighthouse/* → {defaultSite}/reports/lighthouse/*
 *  - sync/users-state.json → multisite-user-store/users-state.json
 *
 * Usage:
 *   npx tsx scripts/admin/migrate-gcs-multisite.ts --to-bucket=<bucket> [options]
 */

import { fileURLToPath } from "url";
import { config as loadDotenv } from "dotenv";
import { Storage } from "@google-cloud/storage";
import pLimit from "p-limit";
import { migrateGcsBucket } from "./migrate-gcs-bucket";
import { buildLayoutMigrationPlan } from "./lib/gcs-layout-migration";
import {
  buildStorageOpts,
  copyGcsObject,
  countJobStatuses,
  createCheckpoint,
  deleteCheckpoint,
  isTerminalStatus,
  loadCheckpoint,
  mergeCheckpointJobs,
  MigrationProgress,
  MULTISITE_CHECKPOINT_PATH,
  saveCheckpoint,
  type CheckpointState,
  type JobStatus,
  type MigrationJob,
} from "./lib/gcs-migration-core";
import { getDefaultContentFolder } from "../../server/site-config";

loadDotenv({ quiet: true });

const __filename = fileURLToPath(import.meta.url);

export interface MigrateGcsMultisiteOptions {
  fromBucket: string;
  toBucket: string;
  execute?: boolean;
  resume?: boolean;
  fresh?: boolean;
  site?: string;
  deleteSource?: boolean;
  skipMedia?: boolean;
  skipLayout?: boolean;
  concurrency?: number;
}

export interface MigrateGcsMultisiteResult {
  message: string;
  mediaResult?: Awaited<ReturnType<typeof migrateGcsBucket>>;
  layoutCopied: number;
  layoutFailed: number;
  layoutCleaned: number;
  dryRun: boolean;
}

function updateJob(
  state: CheckpointState,
  job: MigrationJob,
  status: JobStatus,
  error: string | null,
  forceFlush: boolean,
): void {
  state.jobs[job.id] = {
    srcKey: job.srcKey,
    destKey: job.destKey,
    site: job.site,
    phase: job.phase,
    status,
    error,
    updatedAt: new Date().toISOString(),
  };
  saveCheckpoint(state, MULTISITE_CHECKPOINT_PATH, forceFlush);
}

async function runDeleteJobs(options: {
  keys: string[];
  checkpoint: CheckpointState;
  bucket: ReturnType<Storage["bucket"]>;
  progress: MigrationProgress;
  phaseLabel: string;
  site: string;
}): Promise<number> {
  const { keys, checkpoint, bucket, progress, phaseLabel, site } = options;
  if (keys.length === 0) return 0;

  progress.printPhase(phaseLabel);
  let deleted = 0;
  for (const key of keys) {
    const id = `delete:${key}`;
    try {
      const [exists] = await bucket.file(key).exists();
      if (!exists) continue;
      await bucket.file(key).delete();
      checkpoint.jobs[id] = {
        srcKey: key,
        destKey: key,
        site,
        phase: "layout_cleanup",
        status: "copied",
        error: null,
        updatedAt: new Date().toISOString(),
      };
      deleted++;
      progress.auditLine("[DEL]", key);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      checkpoint.jobs[id] = {
        srcKey: key,
        destKey: key,
        site,
        phase: "layout_cleanup",
        status: "failed",
        error: msg,
        updatedAt: new Date().toISOString(),
      };
      progress.auditLine("[ERR]", key, msg);
    }
  }
  saveCheckpoint(checkpoint, MULTISITE_CHECKPOINT_PATH, true);
  progress.finish();
  return deleted;
}

async function runCopyJobs(options: {
  jobs: MigrationJob[];
  checkpoint: CheckpointState;
  sourceBucket: ReturnType<Storage["bucket"]>;
  targetBucket: ReturnType<Storage["bucket"]>;
  execute: boolean;
  fromBucket: string;
  concurrency: number;
  progress: MigrationProgress;
  phaseLabel: string;
}): Promise<{ copied: number; failed: number }> {
  const {
    jobs,
    checkpoint,
    sourceBucket,
    targetBucket,
    execute,
    fromBucket,
    concurrency,
    progress,
    phaseLabel,
  } = options;

  if (jobs.length === 0) return { copied: 0, failed: 0 };

  progress.printPhase(phaseLabel);

  if (!execute) {
    for (const job of jobs.slice(0, 20)) {
      console.log(`  [DRY-RUN] Would copy: ${job.srcKey}  →  ${job.destKey}`);
    }
    if (jobs.length > 20) console.log(`  … and ${jobs.length - 20} more`);
    return { copied: 0, failed: 0 };
  }

  const pendingJobs = jobs.filter((job) => {
    const rec = checkpoint.jobs[job.id];
    return !rec || !isTerminalStatus(rec.status);
  });

  let processed = jobs.length - pendingJobs.length;
  const limit = pLimit(concurrency);

  await Promise.all(
    pendingJobs.map((job) =>
      limit(async () => {
        const destExists = await targetBucket.file(job.destKey).exists();
        if (destExists[0]) {
          updateJob(checkpoint, job, "skipped_exists", null, false);
          progress.auditLine("[SKIP]", job.destKey, "already exists");
          return;
        }

        const srcExists = await sourceBucket.file(job.srcKey).exists();
        if (!srcExists[0]) {
          updateJob(checkpoint, job, "skipped_missing", "source not found", false);
          progress.auditLine("[SKIP]", job.srcKey, "missing");
          return;
        }

        try {
          await copyGcsObject(sourceBucket, targetBucket, job.srcKey, job.destKey);
          updateJob(checkpoint, job, "copied", null, false);
          progress.auditLine("[OK]", `${job.srcKey} → ${job.destKey}`);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          updateJob(checkpoint, job, "failed", msg, true);
          progress.auditLine("[ERR]", job.destKey, msg);
        } finally {
          processed++;
          const counts = countJobStatuses(checkpoint.jobs);
          progress.updateCopyLine(processed, jobs.length, counts, job.destKey);
        }
      }),
    ),
  );

  progress.finish();
  const counts = countJobStatuses(checkpoint.jobs);
  return { copied: counts.copied, failed: counts.failed };
}

export async function migrateGcsMultisite(
  options: MigrateGcsMultisiteOptions,
): Promise<MigrateGcsMultisiteResult> {
  const {
    fromBucket,
    toBucket,
    execute = false,
    resume = false,
    fresh = false,
    site,
    deleteSource = false,
    skipMedia = false,
    skipLayout = false,
    concurrency = 10,
  } = options;

  const dryRun = !execute;
  const progress = new MigrationProgress();

  if (fresh) deleteCheckpoint(MULTISITE_CHECKPOINT_PATH);

  process.env.LOG_LEVEL = "silent";
  const { getSiteConfigs, resetSiteConfigs } = await import("../../server/site-config");
  resetSiteConfigs();
  const siteConfigs = getSiteConfigs();
  if (siteConfigs.length === 0) {
    throw new Error("No sites found in sites.yml");
  }

  const sites = siteConfigs.map((s) => s.contentFolder);
  const defaultSite = getDefaultContentFolder();

  console.log(`GCS Multisite Migration [${dryRun ? "DRY RUN" : "EXECUTE"}]`);
  console.log(`  From: gs://${fromBucket}`);
  console.log(`  To:   gs://${toBucket}`);
  if (site) console.log(`  Site: ${site}`);
  console.log("");

  let mediaResult: Awaited<ReturnType<typeof migrateGcsBucket>> | undefined;
  if (!skipMedia) {
    mediaResult = await migrateGcsBucket({
      fromBucket,
      toBucket,
      execute,
      resume,
      fresh,
      site,
      deleteSource,
      concurrency,
    });
  }

  let layoutCopied = 0;
  let layoutFailed = 0;
  let layoutCleaned = 0;

  if (!skipLayout) {
    const storage = new Storage(buildStorageOpts());
    const sourceBucket = storage.bucket(fromBucket);
    const targetBucket = storage.bucket(toBucket);

    const layoutJobs = await buildLayoutMigrationPlan({
      bucket: sourceBucket,
      sites,
      defaultSite,
      siteFilter: site,
    });

    let checkpoint =
      loadCheckpoint(MULTISITE_CHECKPOINT_PATH, fromBucket, toBucket, resume) ??
      createCheckpoint(fromBucket, toBucket);
    checkpoint.fromBucket = fromBucket;
    checkpoint.toBucket = toBucket;
    checkpoint = mergeCheckpointJobs(layoutJobs, checkpoint);
    checkpoint.phase = "layout_copy";
    saveCheckpoint(checkpoint, MULTISITE_CHECKPOINT_PATH, true);

    const copyResult = await runCopyJobs({
      jobs: layoutJobs,
      checkpoint,
      sourceBucket,
      targetBucket,
      execute,
      fromBucket,
      concurrency,
      progress,
      phaseLabel: "Layout copy (sync prefix unification)",
    });
    layoutCopied = copyResult.copied;
    layoutFailed = copyResult.failed;

    if (execute && deleteSource) {
      const keysToDelete = layoutJobs
        .filter((j) => {
          const rec = checkpoint.jobs[j.id];
          return rec?.status === "copied" || rec?.status === "skipped_exists";
        })
        .map((j) => j.srcKey);
      checkpoint.phase = "layout_cleanup";
      saveCheckpoint(checkpoint, MULTISITE_CHECKPOINT_PATH, true);
      layoutCleaned = await runDeleteJobs({
        keys: keysToDelete,
        checkpoint,
        bucket: sourceBucket,
        progress,
        phaseLabel: "Layout cleanup (delete legacy keys)",
        site: defaultSite,
      });
    }

    checkpoint.phase = "done";
    saveCheckpoint(checkpoint, MULTISITE_CHECKPOINT_PATH, true);
  }

  console.log("");
  console.log("═".repeat(60));
  console.log(
    dryRun
      ? "DRY RUN complete — re-run with --execute to apply."
      : `Done. layout copied=${layoutCopied} failed=${layoutFailed} cleaned=${layoutCleaned}`,
  );
  console.log("═".repeat(60));

  return {
    message: dryRun ? "Dry run complete" : "Multisite migration complete",
    mediaResult,
    layoutCopied,
    layoutFailed,
    layoutCleaned,
    dryRun,
  };
}

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
    skipMedia: flags.has("--skip-media"),
    skipLayout: flags.has("--skip-layout"),
    concurrency: Math.max(1, parseInt(getVal("--concurrency=") || "10", 10) || 10),
  };
}

if (process.argv[1] === __filename) {
  const args = parseArgs(process.argv.slice(2));

  if (!args.toBucket) {
    console.error("Error: --to-bucket=<name> is required.");
    process.exit(1);
  }
  if (!args.fromBucket) {
    console.error("Error: --from-bucket or GCS_BUCKET_NAME env var is required.");
    process.exit(1);
  }

  migrateGcsMultisite({
    fromBucket: args.fromBucket,
    toBucket: args.toBucket,
    execute: args.execute,
    resume: args.resume,
    fresh: args.fresh,
    site: args.site,
    deleteSource: args.deleteSource,
    skipMedia: args.skipMedia,
    skipLayout: args.skipLayout,
    concurrency: args.concurrency,
  })
    .then((result) => {
      if (result.layoutFailed > 0 || (result.mediaResult?.failedCount ?? 0) > 0) {
        process.exit(1);
      }
    })
    .catch((err) => {
      console.error("Unexpected error:", err);
      process.exit(1);
    });
}
