import type { DatabaseConfig } from "./database";
import { createQueueContext, enqueueExternalImage } from "./image-registry";
import type { MediaGallery } from "./media-gallery";
import { child } from "./logger";
const log = child({ module: "external-image-cacher" });

const PRIVATE_IP_RANGES = [
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^169\.254\./,
  /^::1$/,
  /^fc00:/i,
  /^fe80:/i,
  /^0\./,
  /^localhost$/i,
];

export function isSafeUrl(rawUrl: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
  const host = parsed.hostname.toLowerCase();
  for (const pattern of PRIVATE_IP_RANGES) {
    if (pattern.test(host)) return false;
  }
  return true;
}

function deriveSourceItem(item: Record<string, unknown>, urlFallback?: string): string {
  for (const key of ["slug", "handle", "title", "name"]) {
    const val = item[key];
    if (typeof val === "string" && val.trim().length > 0) return val.trim();
  }
  const id = item["id"];
  if (id !== undefined && id !== null) return String(id);
  if (urlFallback) {
    try {
      const pathname = new URL(urlFallback).pathname;
      const filename = pathname.split("/").filter(Boolean).pop() ?? "";
      const base = filename.replace(/\.[^.]+$/, "");
      if (base.length > 0) return base.slice(0, 60);
    } catch {
      // ignore malformed URL
    }
  }
  return "";
}

function collectCacheableUrls(
  config: DatabaseConfig,
  items: Record<string, unknown>[],
): Map<string, string | undefined> {
  const urlMap = new Map<string, string | undefined>();
  if (!config.editor) return urlMap;

  const cacheFields = Object.entries(config.editor)
    .filter(([, hint]) => hint.cache_images === true)
    .map(([field]) => field);

  if (cacheFields.length === 0) return urlMap;

  for (const item of items) {
    for (const field of cacheFields) {
      const val = item[field];
      if (typeof val === "string" && val.startsWith("http") && isSafeUrl(val)) {
        const existing = urlMap.get(val);
        const sourceItem = deriveSourceItem(item, val) || undefined;
        if (!urlMap.has(val) || (existing === undefined && sourceItem !== undefined)) {
          urlMap.set(val, sourceItem);
        }
      }
    }
  }

  return urlMap;
}

export const ExternalImageCacher = {
  scheduleItems(
    dbName: string,
    config: DatabaseConfig,
    items: Record<string, unknown>[],
    gallery: MediaGallery,
  ): void {
    const urlMap = collectCacheableUrls(config, items);
    if (urlMap.size === 0) return;

    const queueCtx = createQueueContext(gallery);
    let enqueued = 0;
    let backfilled = 0;
    const registry = gallery.getRegistry();
    for (const [url, sourceItem] of Array.from(urlMap.entries())) {
      if (sourceItem && registry) {
        for (const entry of Object.values(registry.images)) {
          if (entry.source_url === url && !entry.source_item) {
            backfilled++;
            break;
          }
        }
      }
      const result = enqueueExternalImage(queueCtx, url, dbName, [], sourceItem);
      if (result !== null) enqueued++;
    }

    if (enqueued > 0 || backfilled > 0) {
      gallery.persistRegistry();
      if (enqueued > 0) {
        log.info(
          `[ExternalImageCacher] Enqueued ${enqueued} new URL(s) for db "${dbName}" (worker will process them)`,
        );
      }
      if (backfilled > 0) {
        log.info(
          `[ExternalImageCacher] Backfilled source_item on ${backfilled} existing entry(s) for db "${dbName}"`,
        );
      }
    }
  },
};
