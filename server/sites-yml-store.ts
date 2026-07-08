/**
 * sites.yml persistence — local cache at repo root, canonical copy in GCS (production).
 *
 * Mirrors the user-store pattern: load from GCS on startup, save to GCS on every write.
 */

import fs from "fs";
import path from "path";
import {
  platformSitesYmlGcsKey,
  platformSitesYmlLocalFilename,
  platformSitesYmlReadKeys,
} from "@shared/gcsKeys";
import { gcs } from "./gcs";
import { resetSiteConfigs, SitesYmlRequiredError } from "./site-config";
import { resetSiteContextMap } from "./site-manager";
import { child } from "./logger";

const log = child({ module: "sites-yml-store" });
const IS_PRODUCTION = process.env.NODE_ENV === "production";
const GCS_KEY = platformSitesYmlGcsKey();
const SITES_YML_EXAMPLE = "sites.yml.example";

export function getSitesYmlLocalPath(): string {
  return path.join(process.cwd(), platformSitesYmlLocalFilename());
}

export function readSitesYmlLocal(): string | null {
  const filePath = getSitesYmlLocalPath();
  try {
    if (!fs.existsSync(filePath)) return null;
    return fs.readFileSync(filePath, "utf-8");
  } catch (err) {
    log.error({ err }, "[SitesYml] Error reading local file:");
    return null;
  }
}

export function writeSitesYmlLocal(content: string): void {
  const filePath = getSitesYmlLocalPath();
  fs.writeFileSync(filePath, content, "utf-8");
}

async function uploadSitesYmlToBucket(content: string): Promise<void> {
  if (!IS_PRODUCTION || !gcs.available) return;
  try {
    await gcs.upload(GCS_KEY, Buffer.from(content, "utf-8"), "application/x-yaml");
    log.info("[SitesYml] Uploaded site registry to GCS");
  } catch (err) {
    log.error({ err }, "[SitesYml] Error uploading to GCS:");
    throw err;
  }
}

function debouncedUploadSitesYmlToBucket(content: string): void {
  if (!IS_PRODUCTION || !gcs.available) return;
  try {
    gcs.debouncedUpload(GCS_KEY, Buffer.from(content, "utf-8"), "application/x-yaml");
  } catch (err) {
    log.error({ err }, "[SitesYml] Error queueing GCS upload:");
  }
}

/** Write local cache and upload to GCS (debounced in production). */
export function saveSitesYml(content: string): void {
  writeSitesYmlLocal(content);
  debouncedUploadSitesYmlToBucket(content);
}

export interface ReuploadSitesYmlResult {
  success: boolean;
  uploaded: boolean;
  gcsKey: string;
  reason?: string;
}

/**
 * Force-upload the local sites.yml to GCS immediately (no debounce).
 * Used by the Cloud Sync admin action to seed a missing bucket object.
 */
export async function reuploadSitesYmlToBucket(): Promise<ReuploadSitesYmlResult> {
  const gcsKey = GCS_KEY;

  if (!IS_PRODUCTION) {
    return {
      success: false,
      uploaded: false,
      gcsKey,
      reason: "GCS sync only runs in production (NODE_ENV=production).",
    };
  }

  if (!gcs.available) {
    gcs.initBootstrapFromEnv();
  }
  if (!gcs.available) {
    return {
      success: false,
      uploaded: false,
      gcsKey,
      reason: "GCS is unavailable — missing GCS_BUCKET_NAME or credentials.",
    };
  }

  const local = readSitesYmlLocal();
  if (!local) {
    return {
      success: false,
      uploaded: false,
      gcsKey,
      reason: "No local sites.yml found to upload.",
    };
  }

  await gcs.upload(gcsKey, Buffer.from(local, "utf-8"), "application/x-yaml");
  log.info("[SitesYml] Re-uploaded site registry to GCS via admin action");
  return { success: true, uploaded: true, gcsKey };
}

function missingSitesYmlError(reason: string): SitesYmlRequiredError {
  return new SitesYmlRequiredError(
    `${reason}. Copy ${SITES_YML_EXAMPLE} to ${platformSitesYmlLocalFilename()} for local setup.`,
  );
}

/**
 * Load sites.yml before site context is built.
 * Production: GCS is canonical; local file is a cache.
 * Development: local file only.
 */
export type SitesYmlRefreshSource = "gcs" | "local";

/** Re-fetch sites.yml (from GCS in production) and rebuild in-memory site config. */
export async function refreshSitesYmlConfig(): Promise<SitesYmlRefreshSource> {
  const hadGcs =
    IS_PRODUCTION &&
    Boolean(process.env.GCS_BUCKET_NAME) &&
    (gcs.available || (gcs.initBootstrapFromEnv(), gcs.available));

  await loadSitesYmlFromBucket();
  resetSiteConfigs();
  resetSiteContextMap();

  return hadGcs ? "gcs" : "local";
}

export async function loadSitesYmlFromBucket(): Promise<void> {
  if (!IS_PRODUCTION) {
    log.info("[SitesYml] Development mode — using local sites.yml only");
    if (!readSitesYmlLocal()) {
      throw missingSitesYmlError("sites.yml not found at project root");
    }
    return;
  }

  const envBucket = process.env.GCS_BUCKET_NAME;
  if (!envBucket) {
    log.info("[SitesYml] GCS_BUCKET_NAME not set — using local sites.yml only");
    if (!readSitesYmlLocal()) {
      throw missingSitesYmlError("sites.yml not found and GCS_BUCKET_NAME is not set");
    }
    return;
  }

  gcs.initBootstrapFromEnv();
  if (!gcs.available) {
    log.info("[SitesYml] GCS unavailable after bootstrap — using local sites.yml");
    if (!readSitesYmlLocal()) {
      throw missingSitesYmlError("sites.yml not found and GCS is unavailable");
    }
    return;
  }

  try {
    const result = await gcs.downloadFirstExisting(platformSitesYmlReadKeys());
    if (result) {
      writeSitesYmlLocal(result.data.toString("utf-8"));
      log.info("[SitesYml] Loaded site registry from GCS");
      return;
    }

    const local = readSitesYmlLocal();
    if (local) {
      log.info("[SitesYml] No GCS copy found — seeding site registry from local sites.yml");
      await uploadSitesYmlToBucket(local);
      return;
    }

    throw missingSitesYmlError("sites.yml not found locally or in GCS");
  } catch (err) {
    if (err instanceof SitesYmlRequiredError) throw err;
    log.error({ err }, "[SitesYml] Error loading from GCS — falling back to local file");
    if (readSitesYmlLocal()) return;
    throw missingSitesYmlError("sites.yml not found after GCS load failure");
  }
}
