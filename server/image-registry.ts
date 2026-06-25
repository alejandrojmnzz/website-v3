import * as fs from "fs";
import * as path from "path";
import type { ImageEntry, ImageRegistry } from "@shared/schema";
import { mediaGallery } from "./media-gallery";
import {
  getQueueState,
  setQueueState,
  clearQueueState,
  getAllQueueState,
} from "./image-queue-state";

const REGISTRY_PATH = path.join(process.cwd(), process.env.CONTENT_FOLDER || "content", "image-registry.json");

const RETRY_FAILED_AFTER_MS = 24 * 60 * 60 * 1000;

let registryCache: ImageRegistry | null = null;
let lastModified: number = 0;

export function loadImageRegistry(): ImageRegistry | null {
  try {
    const stats = fs.statSync(REGISTRY_PATH);
    const currentModified = stats.mtimeMs;

    if (registryCache && currentModified === lastModified) {
      return registryCache;
    }

    const content = fs.readFileSync(REGISTRY_PATH, "utf8");
    registryCache = JSON.parse(content) as ImageRegistry;
    lastModified = currentModified;

    log.info(`[Image Registry] Loaded ${Object.keys(registryCache.images).length} images, ${Object.keys(registryCache.presets).length} presets`);
    return registryCache;
  } catch (error) {
    log.error({ err: error }, "[Image Registry] Failed to load:");
    return null;
  }
}

export function getImage(id: string): { src: string; alt: string } | null {
  const registry = loadImageRegistry();
  if (!registry) return null;

  const entry = registry.images[id];
  if (!entry) return null;

  return {
    src: entry.src,
    alt: entry.alt,
  };
}

export function getPreset(name: string) {
  const registry = loadImageRegistry();
  if (!registry) return null;

  return registry.presets[name] || null;
}

export function listImages() {
  const registry = loadImageRegistry();
  if (!registry) return [];

  return Object.entries(registry.images).map(([id, entry]) => ({
    id,
    ...entry,
  }));
}

export function listPresets() {
  const registry = loadImageRegistry();
  if (!registry) return [];

  return Object.entries(registry.presets).map(([name, preset]) => ({
    name,
    ...preset,
  }));
}

export function resolveBySourceUrl(url: string): string | null {
  const registry = mediaGallery.getRegistry();
  if (!registry) return null;

  for (const [id, entry] of Object.entries(registry.images)) {
    const { failed_at } = getQueueState(id);
    if (entry.source_url === url && !failed_at) {
      return entry.src;
    }
  }
  return null;
}

export function clearImageRegistryCache() {
  registryCache = null;
  lastModified = 0;
}

// ─── Queue helpers ────────────────────────────────────────────────────────────

/**
 * Enqueue an external image for caching.
 * Returns the entry id if a new job was queued (or re-queued after 24h failure).
 * Returns null if skipped (already cached, already queued, or failed recently).
 */
export function enqueueExternalImage(
  sourceUrl: string,
  dbName: string,
  extraTags: string[] = [],
  sourceItem?: string
): string | null {
  const registry = mediaGallery.getRegistry();
  if (!registry) return null;

  // Check for existing entry by source_url
  for (const [id, entry] of Object.entries(registry.images)) {
    if (entry.source_url !== sourceUrl) continue;

    const qs = getQueueState(id);

    // Always backfill source_item on any existing entry that's missing it
    if (sourceItem && !entry.source_item) {
      entry.source_item = sourceItem;
    }

    // Already successfully cached — skip
    if (entry.src && !qs.failed_at) return null;
    // Already pending in the queue — skip
    if (qs.queued_at && !qs.failed_at) return null;
    // Failed recently — skip
    if (qs.failed_at) {
      const ageMs = Date.now() - new Date(qs.failed_at).getTime();
      if (ageMs < RETRY_FAILED_AFTER_MS) return null;
    }
    // Retry after 24h: clear failed state and re-queue
    setQueueState(id, { queued_at: new Date().toISOString() });
    // Clear src so getPendingExternalImages can pick this entry up
    entry.src = "";
    return id;
  }

  // No existing entry — create one
  const id = _urlToId(sourceUrl, dbName);
  const tags = Array.from(new Set([dbName, ...extraTags]));
  const newEntry: ImageEntry = {
    src: "",
    alt: `Image from ${dbName}`,
    tags,
    source_url: sourceUrl,
    usage_count: 0,
    ...(sourceItem ? { source_item: sourceItem } : {}),
  };
  registry.images[id] = newEntry;
  setQueueState(id, { queued_at: new Date().toISOString() });
  return id;
}

/**
 * Returns pending external-cache entries:
 * source_url set + queued_at set + no src + not recently failed.
 */
export function getPendingExternalImages(
  limit = 20
): Array<{ id: string } & ImageEntry> {
  const registry = mediaGallery.getRegistry();
  if (!registry) return [];

  const results: Array<{ id: string } & ImageEntry> = [];
  for (const [id, entry] of Object.entries(registry.images)) {
    if (!entry.source_url) continue;
    const qs = getQueueState(id);
    if (!qs.queued_at) continue;
    if (entry.src) continue;
    if (qs.failed_at) continue;
    results.push({ id, ...entry });
    if (results.length >= limit) break;
  }
  return results;
}

/**
 * Mark an external image as successfully downloaded + processed.
 */
export function markExternalImageDone(
  id: string,
  src: string,
  metadata: Partial<ImageEntry>
): void {
  const registry = mediaGallery.getRegistry();
  if (!registry) return;

  const entry = registry.images[id];
  if (!entry) return;

  Object.assign(entry, metadata, { src });
  clearQueueState(id);
}

/**
 * In-memory session for the current optimization batch.
 * Reset when a new batch is triggered. Not durable across restarts.
 */
interface OptimizeSession {
  initial: number;
  processed: number;
}

let optimizeSession: OptimizeSession = { initial: 0, processed: 0 };

export function resetOptimizeSession(initial: number): void {
  optimizeSession = { initial, processed: 0 };
}

export function getOptimizeSession(): OptimizeSession {
  return optimizeSession;
}

/**
 * Mark existing entries that have src but no srcset as pending optimization.
 */
export function enqueueOptimization(id: string): void {
  const registry = mediaGallery.getRegistry();
  if (!registry) return;

  const entry = registry.images[id];
  if (!entry) return;
  if (!entry.src) return;

  const hasSrcset = Array.isArray(entry.srcset) && entry.srcset.length > 0;
  if (hasSrcset) return;

  setQueueState(id, { queued_at: new Date().toISOString() });
}

/**
 * Returns pending optimization entries (src set, queued_at set, no srcset).
 */
export function getPendingOptimizations(
  limit = 10
): Array<{ id: string } & ImageEntry> {
  const registry = mediaGallery.getRegistry();
  if (!registry) return [];

  const results: Array<{ id: string } & ImageEntry> = [];
  for (const [id, entry] of Object.entries(registry.images)) {
    if (!entry.src) continue;
    const qs = getQueueState(id);
    if (!qs.queued_at) continue;
    const hasSrcset = Array.isArray(entry.srcset) && entry.srcset.length > 0;
    if (hasSrcset) continue;
    results.push({ id, ...entry });
    if (results.length >= limit) break;
  }
  return results;
}

/**
 * Generic: merge updates into entry, clear queued_at and failed_at.
 * For optimize-type jobs, increments the in-memory session counter.
 */
export function markJobDone(id: string, updates: Partial<ImageEntry>, jobType: "optimize" | "external" = "external"): void {
  const registry = mediaGallery.getRegistry();
  if (!registry) return;

  const entry = registry.images[id];
  if (!entry) return;

  Object.assign(entry, updates);
  clearQueueState(id);

  if (jobType === "optimize") {
    optimizeSession.processed += 1;
  }
}

/**
 * Mark a job as failed, storing the error message.
 * For optimize-type jobs, increments the in-memory session counter.
 */
export function markJobFailed(id: string, message: string, jobType: "optimize" | "external" = "external"): void {
  const registry = mediaGallery.getRegistry();
  if (!registry) return;

  const entry = registry.images[id];
  if (!entry) return;

  setQueueState(id, { failed_at: new Date().toISOString(), error: message });
  log.warn(`[ImageRegistry] Job failed for "${id}": ${message}`);

  if (jobType === "optimize") {
    optimizeSession.processed += 1;
  }
}

/**
 * Returns all failed entries, optionally filtered by tag.
 */
export function getFailedEntries(
  tag?: string
): Array<{ id: string; source_url: string; failed_at: string; tags: string[]; source_item?: string }> {
  const registry = mediaGallery.getRegistry();
  if (!registry) return [];

  const allState = getAllQueueState();
  const results = [];
  for (const [id, entry] of Object.entries(registry.images)) {
    const qs = allState[id];
    if (!qs?.failed_at) continue;
    if (!entry.source_url) continue;
    if (tag && !(entry.tags ?? []).includes(tag)) continue;
    results.push({
      id,
      source_url: entry.source_url,
      failed_at: qs.failed_at,
      tags: entry.tags ?? [],
      ...(entry.source_item ? { source_item: entry.source_item } : {}),
    });
  }
  return results;
}

/**
 * Clears failed_at and sets queued_at on all failed entries for a tag,
 * so the queue worker will retry them. Returns the count re-queued.
 */
export function retryFailedImages(tag?: string): number {
  const registry = mediaGallery.getRegistry();
  if (!registry) return 0;

  const allState = getAllQueueState();
  let count = 0;
  for (const [id, entry] of Object.entries(registry.images)) {
    const qs = allState[id];
    if (!qs?.failed_at) continue;
    if (!entry.source_url) continue;
    if (tag && !(entry.tags ?? []).includes(tag)) continue;
    setQueueState(id, { queued_at: new Date().toISOString() });
    // Clear src so getPendingExternalImages picks it up
    entry.src = "";
    count++;
  }
  return count;
}

/**
 * Returns queue statistics, optionally filtered by tag.
 */
export function getQueueStats(tag?: string): { queued: number; cached: number; failed: number } {
  const registry = mediaGallery.getRegistry();
  if (!registry) return { queued: 0, cached: 0, failed: 0 };

  const allState = getAllQueueState();
  let queued = 0;
  let cached = 0;
  let failed = 0;

  for (const [id, entry] of Object.entries(registry.images)) {
    if (tag && !(entry.tags ?? []).includes(tag)) continue;

    const qs = allState[id];
    if (qs?.failed_at) {
      failed++;
    } else if (qs?.queued_at) {
      queued++;
    } else if (entry.src) {
      cached++;
    }
  }

  return { queued, cached, failed };
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

import crypto from "crypto";
import { child } from "./logger";
const log = child({ module: "image-registry" });



function _urlToId(url: string, dbName: string): string {
  const hash = crypto.createHash("sha1").update(url).digest("hex").slice(0, 8);
  try {
    const parsed = new URL(url);
    const base =
      parsed.pathname
        .split("/")
        .filter(Boolean)
        .pop()
        ?.replace(/\.[^.]+$/, "")
        .replace(/[^a-z0-9_-]/gi, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "")
        .toLowerCase()
        .slice(0, 40) || "img";
    return `${dbName}-${base}-${hash}`;
  } catch {
    return `${dbName}-img-${hash}`;
  }
}
