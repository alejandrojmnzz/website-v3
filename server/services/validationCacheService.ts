/**
 * Validation Cache Service
 *
 * Singleton that persists per-page validation results to
 * 4geeks-com/validation-cache.json and optionally auto-commits
 * the file to GitHub using the existing queue mechanism.
 *
 * Concurrent flush writes are serialized via a Promise chain (write queue).
 */

import * as fs from "fs";
import * as path from "path";
import type { PageCacheEntry, ValidationCacheFile } from "../../scripts/validation/shared/types";
import { child } from "../logger";

const log = child({ module: "validationCacheService" });

const CACHE_FILE = path.join(process.cwd(), process.env.CONTENT_FOLDER || "content", "validation-cache.json");
const CACHE_VERSION = 2;

function emptyCache(): ValidationCacheFile {
  return {
    meta: { lastFullRunAt: null, version: CACHE_VERSION },
    pages: {},
  };
}

function readFromDisk(): ValidationCacheFile {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const raw = fs.readFileSync(CACHE_FILE, "utf-8");
      const parsed = JSON.parse(raw) as ValidationCacheFile;
      if (parsed && typeof parsed === "object" && parsed.pages) {
        if ((parsed.meta?.version ?? 0) < CACHE_VERSION) {
          log.info("[ValidationCache] Stale cache version — discarding and starting fresh");
          return emptyCache();
        }
        return parsed;
      }
    }
  } catch (err) {
    log.warn({ err }, "Failed to read validation-cache.json, starting fresh");
  }
  return emptyCache();
}

class ValidationCacheService {
  private map: Map<string, PageCacheEntry> = new Map();
  private lastFullRunAt: string | null = null;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor() {
    this.loadFromDisk();
  }

  private loadFromDisk(): void {
    const data = readFromDisk();
    this.lastFullRunAt = data.meta?.lastFullRunAt ?? null;
    this.map = new Map(Object.entries(data.pages ?? {}));
    log.info(`[ValidationCache] Loaded ${this.map.size} page entries from disk`);
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

  private async doFlush(): Promise<void> {
    const data: ValidationCacheFile = {
      meta: { lastFullRunAt: this.lastFullRunAt, version: CACHE_VERSION },
      pages: Object.fromEntries(this.map.entries()),
    };

    try {
      fs.writeFileSync(CACHE_FILE, JSON.stringify(data, null, 2) + "\n", "utf-8");
      log.info(`[ValidationCache] Flushed ${this.map.size} page entries to disk`);
    } catch (err) {
      log.error({ err }, "[ValidationCache] Failed to write cache file");
      return;
    }

    try {
      const { queueFileChange, isAutoCommitEnabled } = await import("../auto-commit");
      if (isAutoCommitEnabled()) {
        queueFileChange("4geeks-com/validation-cache.json", "System");
      }
    } catch (err) {
      log.warn({ err }, "[ValidationCache] Could not queue auto-commit (non-fatal)");
    }
  }
}

let instance: ValidationCacheService | null = null;

export function getValidationCacheService(): ValidationCacheService {
  if (!instance) {
    instance = new ValidationCacheService();
  }
  return instance;
}
