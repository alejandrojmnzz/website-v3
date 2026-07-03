import * as fs from "fs";
import * as path from "path";
import type { Bucket, Storage } from "@google-cloud/storage";

// ─── Types ───────────────────────────────────────────────────────────────────

export type JobStatus =
  | "pending"
  | "copied"
  | "skipped_exists"
  | "skipped_missing"
  | "failed";

export interface MigrationJob {
  id: string;
  srcKey: string;
  destKey: string;
  site: string;
}

export interface JobRecord {
  srcKey: string;
  destKey: string;
  site: string;
  status: JobStatus;
  error: string | null;
  updatedAt: string;
}

export interface CheckpointState {
  version: 1;
  fromBucket: string;
  toBucket: string;
  startedAt: string;
  updatedAt: string;
  phase: "plan" | "copy" | "registry" | "markers" | "done";
  jobs: Record<string, JobRecord>;
}

export interface MigrationPlan {
  jobs: MigrationJob[];
  sites: string[];
  skippedMissing: number;
}

export interface MigrationCounts {
  copied: number;
  skipped_exists: number;
  skipped_missing: number;
  failed: number;
  pending: number;
}

export interface MigrationProgressEvent {
  phase: "plan" | "copy" | "registry" | "markers" | "done";
  total: number;
  processed: number;
  counts: MigrationCounts;
  currentKey?: string;
  message?: string;
  done?: boolean;
}

export const CHECKPOINT_PATH = path.join(process.cwd(), ".cache", "gcs-migration-state.json");
export const CHECKPOINT_FLUSH_EVERY = 10;
export const BAR_WIDTH = 24;
export const MEDIA_SEGMENT = process.env.GCS_BASE_PATH || "media";

// ─── Storage ─────────────────────────────────────────────────────────────────

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

export function publicUrl(bucket: string, key: string): string {
  return `https://storage.googleapis.com/${bucket}/${key}`;
}

export function jobId(srcKey: string, destKey: string): string {
  return `${srcKey}→${destKey}`;
}

// ─── Checkpoint ──────────────────────────────────────────────────────────────

export function loadCheckpoint(
  fromBucket: string,
  toBucket: string,
  resume: boolean,
): CheckpointState | null {
  if (!resume || !fs.existsSync(CHECKPOINT_PATH)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(CHECKPOINT_PATH, "utf-8")) as CheckpointState;
    if (raw.fromBucket !== fromBucket || raw.toBucket !== toBucket) return null;
    return raw;
  } catch {
    return null;
  }
}

export function createCheckpoint(fromBucket: string, toBucket: string): CheckpointState {
  const now = new Date().toISOString();
  return {
    version: 1,
    fromBucket,
    toBucket,
    startedAt: now,
    updatedAt: now,
    phase: "plan",
    jobs: {},
  };
}

let pendingCheckpointFlush = 0;

export function saveCheckpoint(state: CheckpointState, force = false): void {
  pendingCheckpointFlush++;
  if (!force && pendingCheckpointFlush < CHECKPOINT_FLUSH_EVERY) return;
  pendingCheckpointFlush = 0;
  state.updatedAt = new Date().toISOString();
  const dir = path.dirname(CHECKPOINT_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(CHECKPOINT_PATH, JSON.stringify(state, null, 2) + "\n", "utf-8");
}

export function deleteCheckpoint(): void {
  if (fs.existsSync(CHECKPOINT_PATH)) fs.unlinkSync(CHECKPOINT_PATH);
}

export function isTerminalStatus(status: JobStatus): boolean {
  return status === "copied" || status === "skipped_exists" || status === "skipped_missing";
}

// ─── Plan ────────────────────────────────────────────────────────────────────

interface SrcsetEntry {
  w: number;
  url: string;
}

interface ImageEntry {
  src: string;
  srcset?: SrcsetEntry[];
  source_url?: string;
  [key: string]: unknown;
}

interface ImageRegistry {
  images: Record<string, ImageEntry>;
  [key: string]: unknown;
}

function collectFlatKeysFromUrl(
  url: string,
  fromBucket: string,
  flatPrefix: string,
): string | null {
  const prefix = publicUrl(fromBucket, flatPrefix);
  if (!url.startsWith(prefix)) return null;
  const filename = url.slice(prefix.length);
  if (!filename || filename.includes("..")) return null;
  return `${flatPrefix}${filename}`;
}

function collectJobsFromRegistry(
  registryPath: string,
  site: string,
  fromBucket: string,
  flatPrefix: string,
  sitePrefix: string,
): MigrationJob[] {
  if (!fs.existsSync(registryPath)) return [];

  let registry: ImageRegistry;
  try {
    registry = JSON.parse(fs.readFileSync(registryPath, "utf-8")) as ImageRegistry;
  } catch {
    return [];
  }

  const destByKey = new Map<string, MigrationJob>();

  for (const entry of Object.values(registry.images)) {
    const urls: string[] = [];
    if (typeof entry.src === "string") urls.push(entry.src);
    if (Array.isArray(entry.srcset)) {
      for (const v of entry.srcset) {
        if (typeof v.url === "string") urls.push(v.url);
      }
    }
    if (typeof entry.source_url === "string") urls.push(entry.source_url);

    for (const url of urls) {
      const srcKey = collectFlatKeysFromUrl(url, fromBucket, flatPrefix);
      if (!srcKey) continue;
      const filename = srcKey.slice(flatPrefix.length);
      const destKey = `${sitePrefix}${filename}`;
      destByKey.set(destKey, {
        id: jobId(srcKey, destKey),
        srcKey,
        destKey,
        site,
      });
    }
  }

  return Array.from(destByKey.values());
}

export function buildMigrationPlan(options: {
  sites: Array<{ contentFolder: string }>;
  fromBucket: string;
  siteFilter?: string;
}): MigrationPlan {
  const flatPrefix = `${MEDIA_SEGMENT}/`;
  const jobsByDest = new Map<string, MigrationJob>();
  const sites: string[] = [];

  for (const { contentFolder } of options.sites) {
    if (options.siteFilter && contentFolder !== options.siteFilter) continue;
    sites.push(contentFolder);
    const sitePrefix = `${contentFolder}/${MEDIA_SEGMENT}/`;
    const registryPath = path.join(process.cwd(), contentFolder, "image-registry.json");
    const siteJobs = collectJobsFromRegistry(
      registryPath,
      contentFolder,
      options.fromBucket,
      flatPrefix,
      sitePrefix,
    );
    for (const job of siteJobs) {
      jobsByDest.set(job.destKey, job);
    }
  }

  return {
    jobs: Array.from(jobsByDest.values()),
    sites,
    skippedMissing: 0,
  };
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
        status: "pending",
        error: null,
        updatedAt: new Date().toISOString(),
      };
    }
  }
  return state;
}

// ─── GCS listing & copy ──────────────────────────────────────────────────────

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

// ─── Registry rewrite ────────────────────────────────────────────────────────

function rewriteUrl(
  url: string,
  fromBucket: string,
  toBucket: string,
  flatPrefix: string,
  sitePrefix: string,
  successfulSrcKeys: Set<string>,
): string | null {
  const oldPrefix = publicUrl(fromBucket, flatPrefix);
  if (!url.startsWith(oldPrefix)) return null;
  const filename = url.slice(oldPrefix.length);
  const srcKey = `${flatPrefix}${filename}`;
  if (!successfulSrcKeys.has(srcKey)) return null;
  return publicUrl(toBucket, `${sitePrefix}${filename}`);
}

export function rewriteRegistryForSite(options: {
  registryPath: string;
  site: string;
  fromBucket: string;
  toBucket: string;
  successfulSrcKeys: Set<string>;
  dryRun: boolean;
}): number {
  const { registryPath, site, fromBucket, toBucket, successfulSrcKeys, dryRun } = options;
  if (!fs.existsSync(registryPath)) return 0;

  const flatPrefix = `${MEDIA_SEGMENT}/`;
  const sitePrefix = `${site}/${MEDIA_SEGMENT}/`;

  let registry: ImageRegistry;
  try {
    registry = JSON.parse(fs.readFileSync(registryPath, "utf-8")) as ImageRegistry;
  } catch {
    console.error(`  [WARN] Failed to parse ${registryPath} — skipping URL rewrite`);
    return 0;
  }

  let count = 0;

  const apply = (url: string): string => {
    const next = rewriteUrl(url, fromBucket, toBucket, flatPrefix, sitePrefix, successfulSrcKeys);
    if (next) {
      count++;
      return next;
    }
    return url;
  };

  for (const entry of Object.values(registry.images)) {
    if (typeof entry.src === "string") entry.src = apply(entry.src);
    if (Array.isArray(entry.srcset)) {
      for (const variant of entry.srcset) {
        if (typeof variant.url === "string") variant.url = apply(variant.url);
      }
    }
    if (typeof entry.source_url === "string") {
      entry.source_url = apply(entry.source_url);
    }
  }

  if (count > 0 && !dryRun) {
    fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2) + "\n", "utf-8");
  }

  return count;
}

// ─── Progress ────────────────────────────────────────────────────────────────

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

  printPhase(phase: number, total: number, label: string): void {
    this.clearLine();
    console.log(`Phase ${phase}/${total}  ${label}`);
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
export function collectSuccessfulSrcKeys(
  jobs: Record<string, JobRecord>,
): Map<string, Set<string>> {
  const bySite = new Map<string, Set<string>>();
  for (const rec of Object.values(jobs)) {
    if (rec.status !== "copied" && rec.status !== "skipped_exists") continue;
    if (!bySite.has(rec.site)) bySite.set(rec.site, new Set());
    bySite.get(rec.site)!.add(rec.srcKey);
  }
  return bySite;
}

export async function listDestKeysBySite(
  bucket: Bucket,
  sites: string[],
): Promise<Map<string, Set<string>>> {
  const map = new Map<string, Set<string>>();
  for (const site of sites) {
    const prefix = `${site}/${MEDIA_SEGMENT}/`;
    map.set(site, await listBucketKeys(bucket, prefix));
  }
  return map;
}

