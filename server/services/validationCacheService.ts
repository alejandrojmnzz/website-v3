/**
 * Validation Cache Service
 *
 * Per-site class that persists page validation results to
 * <contentRoot>/validation-cache.json (local cache) and, in production,
 * to GCS at {site}/sync/validation-cache.json.
 *
 * Concurrent flush writes are serialized via a Promise chain (write queue).
 */

import * as fs from "fs";
import { getDefaultContentRoot } from "../site-config";
import * as path from "path";
import type {
  PageCacheEntry,
  DatabaseCacheEntry,
  ValidationCacheFile,
} from "../../scripts/validation/shared/types";
import { siteSyncGcsKey, SYNC_FILENAMES, validationCacheReadKeys } from "@shared/gcsKeys";
import { gcs } from "../gcs";
import { getSiteContextMap } from "../site-manager";
import { child } from "../logger";

const log = child({ module: "validationCacheService" });

const IS_PRODUCTION = process.env.NODE_ENV === "production";
const CACHE_VERSION = 3;

function emptyCache(): ValidationCacheFile {
  return {
    meta: { lastFullRunAt: null, version: CACHE_VERSION },
    pages: {},
    databases: {},
  };
}

function migrateCache(parsed: ValidationCacheFile): ValidationCacheFile {
  const version = parsed.meta?.version ?? 0;
  if (version >= CACHE_VERSION) {
    return {
      ...parsed,
      databases: parsed.databases ?? {},
    };
  }
  if (version === 2 && parsed.pages) {
    log.info("[ValidationCache] Migrating v2 cache to v3 (adding databases section)");
    return {
      meta: { lastFullRunAt: parsed.meta?.lastFullRunAt ?? null, version: CACHE_VERSION },
      pages: parsed.pages,
      databases: {},
    };
  }
  log.info("[ValidationCache] Stale cache version — discarding and starting fresh");
  return emptyCache();
}

function readFromDisk(cacheFile: string): ValidationCacheFile {
  try {
    if (fs.existsSync(cacheFile)) {
      const raw = fs.readFileSync(cacheFile, "utf-8");
      const parsed = JSON.parse(raw) as ValidationCacheFile;
      if (parsed && typeof parsed === "object" && parsed.pages) {
        return migrateCache(parsed);
      }
    }
  } catch (err) {
    log.warn({ err }, "Failed to read validation-cache.json, starting fresh");
  }
  return emptyCache();
}

export class ValidationCacheService {
  private map: Map<string, PageCacheEntry> = new Map();
  private dbMap: Map<string, DatabaseCacheEntry> = new Map();
  private lastFullRunAt: string | null = null;
  private writeQueue: Promise<void> = Promise.resolve();
  private cacheFile: string;
  private contentFolder: string;

  constructor(contentRoot: string) {
    this.cacheFile = path.join(contentRoot, "validation-cache.json");
    this.contentFolder = path.relative(process.cwd(), contentRoot);
    this.loadFromDisk();
  }

  private gcsKey(): string {
    return siteSyncGcsKey(this.contentFolder, SYNC_FILENAMES.validationCache);
  }

  private applyLoadedData(data: ValidationCacheFile): void {
    this.lastFullRunAt = data.meta?.lastFullRunAt ?? null;
    this.map = new Map(Object.entries(data.pages ?? {}));
    this.dbMap = new Map(Object.entries(data.databases ?? {}));
  }

  private loadFromDisk(): void {
    const data = readFromDisk(this.cacheFile);
    this.applyLoadedData(data);
    log.info(
      `[ValidationCache] Loaded ${this.map.size} page entries, ${this.dbMap.size} database entries from disk`,
    );
  }

  /** Load cached validation results from GCS (production only). */
  async loadFromBucket(): Promise<void> {
    if (!IS_PRODUCTION || !gcs.available) {
      if (!IS_PRODUCTION) {
        log.info("[ValidationCache] Development mode, using local file only");
      }
      return;
    }

    try {
      const result = await gcs.downloadFirstExisting(validationCacheReadKeys(this.contentFolder));
      if (!result) {
        log.info("[ValidationCache] No cache found in bucket, using local file");
        return;
      }

      const parsed = JSON.parse(result.data.toString("utf-8")) as ValidationCacheFile;
      if (!parsed || typeof parsed !== "object" || !parsed.pages) {
        log.warn("[ValidationCache] Invalid cache in bucket, keeping local file");
        return;
      }

      this.applyLoadedData(migrateCache(parsed));
      this.writeLocalFile();
      log.info(
        `[ValidationCache] Loaded ${this.map.size} page entries, ${this.dbMap.size} database entries from GCS`,
      );
    } catch (err) {
      log.error({ err }, "[ValidationCache] Error loading from bucket:");
    }
  }

  getByUrl(url: string): PageCacheEntry | undefined {
    return this.map.get(url);
  }

  setByUrl(url: string, entry: PageCacheEntry): void {
    this.map.set(url, entry);
  }

  getAll(): Map<string, PageCacheEntry> {
    return this.map;
  }

  getByDatabase(name: string): DatabaseCacheEntry | undefined {
    return this.dbMap.get(name);
  }

  setByDatabase(name: string, entry: DatabaseCacheEntry): void {
    this.dbMap.set(name, entry);
  }

  getAllDatabases(): Map<string, DatabaseCacheEntry> {
    return this.dbMap;
  }

  markFullRunAt(ts: string): void {
    this.lastFullRunAt = ts;
  }

  /**
   * Serialize writes through a Promise chain so concurrent flushes
   * never interleave writes to the same file.
   */
  flush(): Promise<void> {
    this.writeQueue = this.writeQueue.then(() => this.doFlush()).catch((err) => {
      log.error({ err }, "[ValidationCache] Flush error");
    });
    return this.writeQueue;
  }

  private buildCacheFile(): ValidationCacheFile {
    return {
      meta: { lastFullRunAt: this.lastFullRunAt, version: CACHE_VERSION },
      pages: Object.fromEntries(this.map.entries()),
      databases: Object.fromEntries(this.dbMap.entries()),
    };
  }

  private writeLocalFile(): void {
    const data = this.buildCacheFile();
    fs.writeFileSync(this.cacheFile, JSON.stringify(data, null, 2) + "\n", "utf-8");
  }

  private saveToBucket(): void {
    if (!IS_PRODUCTION || !gcs.available) return;

    const content = JSON.stringify(this.buildCacheFile(), null, 2) + "\n";
    gcs.debouncedUpload(this.gcsKey(), Buffer.from(content, "utf-8"), "application/json", 30_000);
  }

  private async doFlush(): Promise<void> {
    try {
      this.writeLocalFile();
      log.info(
        `[ValidationCache] Flushed ${this.map.size} page entries, ${this.dbMap.size} database entries to disk`,
      );
    } catch (err) {
      log.error({ err }, "[ValidationCache] Failed to write cache file");
      return;
    }

    this.saveToBucket();
  }

  /** Force-upload the cache to GCS (e.g. on graceful shutdown). */
  async shutdown(): Promise<void> {
    try {
      this.writeLocalFile();
    } catch (err) {
      log.error({ err }, "[ValidationCache] Failed to write cache file on shutdown");
      return;
    }

    if (!IS_PRODUCTION || !gcs.available) return;

    await gcs.flushPending();
    try {
      const content = JSON.stringify(this.buildCacheFile(), null, 2) + "\n";
      await gcs.upload(this.gcsKey(), Buffer.from(content, "utf-8"), "application/json");
    } catch (err) {
      log.error({ err }, "[ValidationCache] Error saving to bucket on shutdown");
    }
  }
}

let _defaultInstance: ValidationCacheService | null = null;

/** Returns the ValidationCacheService for the default site. */
export function getValidationCacheService(): ValidationCacheService {
  if (!_defaultInstance) {
    const contentRoot = getDefaultContentRoot();
    _defaultInstance = new ValidationCacheService(contentRoot);
  }
  return _defaultInstance;
}

/** Load per-site validation caches from GCS before startup validation runs. */
export async function loadValidationCachesFromBucket(): Promise<void> {
  await Promise.all(
    [...getSiteContextMap().values()].map((ctx) => ctx.validationCache.loadFromBucket()),
  );
}

/** Flush all per-site validation caches to GCS on shutdown. */
export async function shutdownValidationCaches(): Promise<void> {
  await Promise.all(
    [...getSiteContextMap().values()].map((ctx) => ctx.validationCache.shutdown()),
  );
}
