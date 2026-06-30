/**
 * Shared GCS (Google Cloud Storage) bucket client.
 *
 * Provides a single Storage instance initialized from environment variables
 * or the sites.yml `bucket_name` field.
 * Any module that needs bucket access imports from here — no basePath is
 * baked in, so each consumer supplies its own key prefix.
 *
 * Bucket name resolution chain:
 *   1. `bucket_name` from top-level of sites.yml (new — post-migration)
 *   2. GCS_BUCKET_NAME env var (legacy fallback — pre-migration or deployments without sites.yml)
 *
 * Environment variables:
 *   GCS_BUCKET_NAME        – fallback when sites.yml has no bucket_name
 *   GCS_PROJECT_ID         – optional
 *   GCS_KEY_FILENAME       – optional (path to service-account JSON)
 *   GCS_CREDENTIALS_JSON   – optional (inline service-account JSON)
 */

import { Storage } from "@google-cloud/storage";
import { child as loggerChild } from "./logger";

const gcsLogger = loggerChild({ module: "gcs", worker: "gcs" });

export interface GCSConfig {
  bucketName: string;
  projectId?: string;
  keyFilename?: string;
  credentialsJson?: string;
}

interface PendingUpload {
  timer: ReturnType<typeof setTimeout>;
  data: Buffer;
  contentType: string;
  options?: { cacheControl?: string };
}

const UPLOAD_MAX_RETRIES = 3;
const UPLOAD_RETRY_BASE_MS = 2_000;
const DEBOUNCE_DEFAULT_MS = 4_000;

class GCSClient {
  private storage: Storage | null = null;
  private bucketName: string = "";
  private _available = false;
  private _pendingUploads = new Map<string, PendingUpload>();

  /** True when the bucket still uses the old flat layout (media/… without site prefix). */
  migrationRequired = false;

  init(config: GCSConfig): void {
    this.bucketName = config.bucketName;

    const opts: Record<string, any> = {};
    if (config.projectId) opts.projectId = config.projectId;

    if (config.credentialsJson) {
      try {
        opts.credentials = JSON.parse(config.credentialsJson);
      } catch {
        gcsLogger.error("failed to parse GCS_CREDENTIALS_JSON, falling back to default auth");
      }
    } else if (config.keyFilename) {
      opts.keyFilename = config.keyFilename;
    }

    this.storage = new Storage(opts);
    this._available = true;
    gcsLogger.info({ bucket: this.bucketName }, "initialized");
  }

  initFromEnv(): void {
    let bucket: string | undefined;

    try {
      const { getBucketName } = require("./site-config") as typeof import("./site-config");
      const fromYml = getBucketName();
      if (fromYml) {
        bucket = fromYml;
        gcsLogger.info({ bucket }, "bucket name resolved from sites.yml");
      }
    } catch {
      // site-config unavailable — fall through to env var
    }

    if (!bucket) {
      bucket = process.env.GCS_BUCKET_NAME;
    }

    if (!bucket) {
      gcsLogger.info("No bucket name configured (sites.yml bucket_name or GCS_BUCKET_NAME) — GCS unavailable");
      return;
    }

    this.init({
      bucketName: bucket,
      projectId: process.env.GCS_PROJECT_ID,
      keyFilename: process.env.GCS_KEY_FILENAME,
      credentialsJson: process.env.GCS_CREDENTIALS_JSON,
    });
  }

  /**
   * Architecture check — call once after initFromEnv() during server startup.
   *
   * Detects the old flat layout (objects at `media/…` without a site prefix).
   * When found and no new-style `{site}/media/…` objects exist, sets
   * `migrationRequired = true` and blocks all writes until migration is done.
   */
  async checkArchitecture(): Promise<void> {
    if (!this.storage) return;

    try {
      let knownSitePrefixes: string[] = [];
      try {
        const { getSiteConfigs } = require("./site-config") as typeof import("./site-config");
        knownSitePrefixes = getSiteConfigs().map((s) => s.contentFolder);
      } catch {}

      const [oldFiles] = await this.storage
        .bucket(this.bucketName)
        .getFiles({ prefix: "media/", maxResults: 1 });

      if (oldFiles.length === 0) {
        gcsLogger.info("GCS architecture check passed — no old flat-layout objects found");
        return;
      }

      let hasNewLayout = false;
      for (const sitePrefix of knownSitePrefixes) {
        const [newFiles] = await this.storage
          .bucket(this.bucketName)
          .getFiles({ prefix: `${sitePrefix}/media/`, maxResults: 1 });
        if (newFiles.length > 0) {
          hasNewLayout = true;
          break;
        }
      }

      if (!hasNewLayout) {
        this.migrationRequired = true;
        gcsLogger.warn(
          { bucket: this.bucketName },
          "GCS migration required: old flat layout detected. " +
          "All GCS writes are blocked. Run: npx tsx scripts/admin/migrate-to-new-bucket.ts --to-bucket=<new-bucket>"
        );
      } else {
        gcsLogger.info("GCS architecture check: old and new layouts coexist — migration in progress or already done");
      }
    } catch (err) {
      gcsLogger.warn({ err }, "GCS architecture check failed — skipping (bucket may not yet exist or credentials missing)");
    }
  }

  get available(): boolean {
    return this._available;
  }

  getBucketName(): string {
    return this.bucketName;
  }

  getStorage(): Storage | null {
    return this.storage;
  }

  async exists(key: string): Promise<boolean> {
    if (!this.storage) return false;
    try {
      const [exists] = await this.storage.bucket(this.bucketName).file(key).exists();
      return exists;
    } catch {
      return false;
    }
  }

  async upload(
    key: string,
    data: Buffer,
    contentType?: string,
    options?: { cacheControl?: string }
  ): Promise<string> {
    if (!this.storage) throw new Error("[GCS] Not initialized");

    if (this.migrationRequired) {
      const msg = `[GCS] Upload blocked for key "${key}" — bucket migration required. Run: npx tsx scripts/admin/migrate-to-new-bucket.ts --to-bucket=<new-bucket>`;
      gcsLogger.warn({ key }, msg);
      throw new Error(msg);
    }

    const file = this.storage.bucket(this.bucketName).file(key);
    const saveOpts = {
      contentType: contentType || "application/octet-stream",
      resumable: false,
      metadata: {
        cacheControl: options?.cacheControl ?? "public, max-age=31536000",
      },
    };

    let attempt = 0;
    while (true) {
      try {
        await file.save(data, saveOpts);
        return this.getPublicUrl(key);
      } catch (err: any) {
        const is429 = err?.code === 429 || err?.response?.statusCode === 429;
        attempt++;
        if (!is429 || attempt >= UPLOAD_MAX_RETRIES) throw err;
        const delayMs = UPLOAD_RETRY_BASE_MS * Math.pow(2, attempt - 1);
        gcsLogger.warn({ key, attempt, maxRetries: UPLOAD_MAX_RETRIES - 1, delayMs }, "429 on upload, retrying");
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  debouncedUpload(
    key: string,
    data: Buffer,
    contentType?: string,
    delayMs: number = DEBOUNCE_DEFAULT_MS,
    options?: { cacheControl?: string }
  ): void {
    if (this.migrationRequired) {
      gcsLogger.warn({ key }, "[GCS] Debounced write blocked — bucket migration required.");
      return;
    }

    const existing = this._pendingUploads.get(key);
    if (existing) clearTimeout(existing.timer);

    const timer = setTimeout(async () => {
      this._pendingUploads.delete(key);
      try {
        await this.upload(key, data, contentType, options);
      } catch (err) {
        gcsLogger.error({ err, key }, "debouncedUpload failed");
      }
    }, delayMs);

    this._pendingUploads.set(key, { timer, data, contentType: contentType || "application/octet-stream", options });
  }

  async flushPending(): Promise<void> {
    if (this._pendingUploads.size === 0) return;

    gcsLogger.info({ count: this._pendingUploads.size }, "flushing pending uploads before shutdown");
    const entries = Array.from(this._pendingUploads.entries());
    this._pendingUploads.clear();

    await Promise.allSettled(
      entries.map(async ([key, pending]) => {
        clearTimeout(pending.timer);
        try {
          await this.upload(key, pending.data, pending.contentType, pending.options);
          gcsLogger.info({ key }, "flushed pending upload");
        } catch (err) {
          gcsLogger.error({ err, key }, "failed to flush pending upload");
        }
      })
    );
  }

  async list(prefix: string): Promise<string[]> {
    if (!this.storage) return [];
    try {
      const [files] = await this.storage
        .bucket(this.bucketName)
        .getFiles({ prefix, versions: false });
      return files.map((f) => f.name);
    } catch {
      return [];
    }
  }

  async download(key: string): Promise<Buffer | null> {
    if (!this.storage) return null;
    try {
      const [data] = await this.storage.bucket(this.bucketName).file(key).download();
      return data;
    } catch (err: any) {
      if (err?.code === 404) return null;
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    if (!this.storage) return;
    try {
      await this.storage.bucket(this.bucketName).file(key).delete();
    } catch (err: any) {
      if (err?.code !== 404) throw err;
    }
  }

  getPublicUrl(key: string): string {
    return `https://storage.googleapis.com/${this.bucketName}/${key}`;
  }
}

export const gcs = new GCSClient();
