import * as fs from "fs";
import * as path from "path";
import type { Bucket } from "@google-cloud/storage";

export type JobStatus =
  | "pending"
  | "copied"
  | "skipped_exists"
  | "skipped_missing"
  | "failed";

export type MigrationPhase =
  | "media_copy"
  | "media_registry"
  | "media_markers"
  | "layout_copy"
  | "layout_cleanup"
  | "done";

export interface MigrationJob {
  id: string;
  srcKey: string;
  destKey: string;
  site: string;
  phase: MigrationPhase;
}

export interface JobRecord {
  srcKey: string;
  destKey: string;
  site: string;
  phase: MigrationPhase;
  status: JobStatus;
  error: string | null;
  updatedAt: string;
}

export interface CheckpointState {
  version: 2;
  fromBucket: string;
  toBucket: string;
  startedAt: string;
  updatedAt: string;
  phase: MigrationPhase;
  jobs: Record<string, JobRecord>;
}

export interface MigrationCounts {
  copied: number;
  skipped_exists: number;
  skipped_missing: number;
  failed: number;
  pending: number;
}

export const MULTISITE_CHECKPOINT_PATH = path.join(
  process.cwd(),
  ".cache",
  "gcs-multisite-migration-state.json",
);
export const CHECKPOINT_FLUSH_EVERY = 10;
export const BAR_WIDTH = 24;
export const MEDIA_SEGMENT = process.env.GCS_BASE_PATH || "media";

export function buildStorageOpts(): Record<string, unknown> {
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

export function jobId(srcKey: string, destKey: string): string {
  return `${srcKey}→${destKey}`;
}

export function publicUrl(bucket: string, key: string): string {
  return `https://storage.googleapis.com/${bucket}/${key}`;
}

export function loadCheckpoint(
  pathName: string,
  fromBucket: string,
  toBucket: string,
  resume: boolean,
): CheckpointState | null {
  if (!resume || !fs.existsSync(pathName)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(pathName, "utf-8")) as CheckpointState;
    if (raw.fromBucket !== fromBucket || raw.toBucket !== toBucket) return null;
    return raw;
  } catch {
    return null;
  }
}

export function createCheckpoint(fromBucket: string, toBucket: string): CheckpointState {
  const now = new Date().toISOString();
  return {
    version: 2,
    fromBucket,
    toBucket,
    startedAt: now,
    updatedAt: now,
    phase: "media_copy",
    jobs: {},
  };
}

let pendingCheckpointFlush = 0;

export function saveCheckpoint(state: CheckpointState, pathName: string, force = false): void {
  pendingCheckpointFlush++;
  if (!force && pendingCheckpointFlush < CHECKPOINT_FLUSH_EVERY) return;
  pendingCheckpointFlush = 0;
  state.updatedAt = new Date().toISOString();
  const dir = path.dirname(pathName);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(pathName, JSON.stringify(state, null, 2) + "\n", "utf-8");
}

export function deleteCheckpoint(pathName: string): void {
  if (fs.existsSync(pathName)) fs.unlinkSync(pathName);
}

export function isTerminalStatus(status: JobStatus): boolean {
  return status === "copied" || status === "skipped_exists" || status === "skipped_missing";
}

export async function listBucketKeys(bucket: Bucket, prefix: string): Promise<Set<string>> {
  const keys = new Set<string>();
  const [files] = await bucket.getFiles({ prefix, versions: false });
  for (const f of files) keys.add(f.name);
  return keys;
}

export async function copyGcsObject(
  sourceBucket: Bucket,
  destBucket: Bucket,
  srcKey: string,
  destKey: string,
): Promise<"server-side" | "fallback"> {
  const sourceFile = sourceBucket.file(srcKey);
  const destFile = destBucket.file(destKey);

  try {
    await sourceFile.copy(destFile);
    return "server-side";
  } catch (copyErr: unknown) {
    const err = copyErr as { code?: number };
    if (err?.code === 403 || err?.code === 400) {
      const [data] = await sourceFile.download();
      const [meta] = await sourceFile.getMetadata();
      const contentType =
        ((meta as Record<string, unknown>).contentType as string) || "application/octet-stream";
      await destFile.save(data, { contentType, resumable: false });
      return "fallback";
    }
    throw copyErr;
  }
}

export function countJobStatuses(jobs: Record<string, JobRecord>): MigrationCounts {
  const counts: MigrationCounts = {
    copied: 0,
    skipped_exists: 0,
    skipped_missing: 0,
    failed: 0,
    pending: 0,
  };
  for (const rec of Object.values(jobs)) {
    if (rec.status === "pending") counts.pending++;
    else if (rec.status in counts) counts[rec.status as keyof Omit<MigrationCounts, "pending">]++;
  }
  return counts;
}

export function renderProgressBar(processed: number, total: number): string {
  if (total <= 0) return `[${"░".repeat(BAR_WIDTH)}] 0/0 (0%)`;
  const pct = Math.min(100, Math.round((processed / total) * 100));
  const filled = Math.round((processed / total) * BAR_WIDTH);
  const bar = "█".repeat(filled) + "░".repeat(BAR_WIDTH - filled);
  return `[${bar}] ${processed}/${total} (${pct}%)`;
}

export function truncateKey(key: string, max = 56): string {
  if (key.length <= max) return key;
  return "…" + key.slice(-(max - 1));
}

export class MigrationProgress {
  private lastLine = "";
  private auditCounter = 0;

  printPhase(label: string): void {
    this.clearLine();
    console.log(label);
  }

  updateCopyLine(
    processed: number,
    total: number,
    counts: MigrationCounts,
    currentKey: string,
  ): void {
    const bar = renderProgressBar(processed, total);
    const line = `  ${bar}  ${truncateKey(currentKey)}\n  copied: ${counts.copied}  skipped: ${counts.skipped_exists + counts.skipped_missing}  failed: ${counts.failed}  pending: ${counts.pending}`;
    if (line !== this.lastLine) {
      process.stdout.write(`\r${line}`);
      this.lastLine = line;
    }
  }

  auditLine(prefix: string, key: string, detail?: string): void {
    this.auditCounter++;
    if (this.auditCounter % 50 !== 0 && prefix !== "[ERR]") return;
    this.clearLine();
    console.log(`  ${prefix} ${key}${detail ? ` — ${detail}` : ""}`);
  }

  clearLine(): void {
    if (this.lastLine) {
      process.stdout.write(`\r${" ".repeat(this.lastLine.length + 4)}\r`);
      this.lastLine = "";
    }
  }

  finish(): void {
    this.clearLine();
  }
}

export function mergeCheckpointJobs(
  jobs: MigrationJob[],
  checkpoint: CheckpointState | null,
): CheckpointState {
  const state = checkpoint ?? createCheckpoint("", "");
  for (const job of jobs) {
    if (!state.jobs[job.id]) {
      state.jobs[job.id] = {
        srcKey: job.srcKey,
        destKey: job.destKey,
        site: job.site,
        phase: job.phase,
        status: "pending",
        error: null,
        updatedAt: new Date().toISOString(),
      };
    }
  }
  return state;
}
