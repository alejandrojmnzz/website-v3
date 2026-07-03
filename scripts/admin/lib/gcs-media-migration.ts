import * as fs from "fs";
import * as path from "path";
import type { Bucket } from "@google-cloud/storage";
import { jobId, listBucketKeys, MEDIA_SEGMENT, publicUrl } from "./gcs-migration-core";

export interface MediaMigrationJob {
  id: string;
  srcKey: string;
  destKey: string;
  site: string;
}

export interface MediaJobRecord {
  srcKey: string;
  destKey: string;
  site: string;
  status: "pending" | "copied" | "skipped_exists" | "skipped_missing" | "failed";
  error: string | null;
  updatedAt: string;
}

export interface MigrationPlan {
  jobs: MediaMigrationJob[];
  sites: string[];
  skippedMissing: number;
}

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
): MediaMigrationJob[] {
  if (!fs.existsSync(registryPath)) return [];

  let registry: ImageRegistry;
  try {
    registry = JSON.parse(fs.readFileSync(registryPath, "utf-8")) as ImageRegistry;
  } catch {
    return [];
  }

  const destByKey = new Map<string, MediaMigrationJob>();

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
  const jobsByDest = new Map<string, MediaMigrationJob>();
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

export function collectSuccessfulSrcKeys(
  jobs: Record<string, MediaJobRecord>,
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
