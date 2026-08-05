/**
 * sites.yml persistence — local cache at repo root, canonical copy in GCS (production).
 *
 * Mirrors the user-store pattern: load from GCS on startup, save to GCS on every write.
 */

import fs from "fs";
import path from "path";
import yaml from "js-yaml";
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Rename a site domain key in sites.yml while preserving comments and nested fields. */
export function renameSiteDomain(currentDomain: string, newDomain: string): void {
  const content = readSitesYmlLocal();
  if (!content) {
    throw new Error("sites.yml not found at project root");
  }

  const parsed = yaml.load(content) as Record<string, unknown> | null;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("sites.yml must be a YAML mapping (object), not an array or scalar");
  }
  if (!(currentDomain in parsed)) {
    throw new Error(`Domain "${currentDomain}" not found in sites.yml`);
  }
  if (newDomain in parsed) {
    throw new Error(`Domain "${newDomain}" already exists in sites.yml`);
  }

  const keyPattern = new RegExp(`^(${escapeRegExp(currentDomain)}):\\s*$`);
  let found = false;
  const updated = content.split("\n").map((line) => {
    if (keyPattern.test(line)) {
      found = true;
      return `${newDomain}:`;
    }
    return line;
  });

  if (!found) {
    throw new Error(`Could not locate domain key "${currentDomain}" in sites.yml`);
  }

  saveSitesYml(updated.join("\n"));
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

type ParsedSites = Record<string, unknown> | null;

function safeParseYaml(content: string): ParsedSites {
  try {
    const parsed = yaml.load(content);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

function extractAliases(siteBlock: unknown): string[] {
  if (!siteBlock || typeof siteBlock !== "object") return [];
  const c = siteBlock as Record<string, unknown>;
  const raw = c.aliases ?? c.alias;
  if (Array.isArray(raw)) {
    return raw
      .filter((a): a is string => typeof a === "string" && a.trim() !== "")
      .map((a) => a.trim().toLowerCase());
  }
  if (typeof raw === "string" && raw.trim() !== "") return [raw.trim().toLowerCase()];
  return [];
}

function siteDomains(parsed: Record<string, unknown>): string[] {
  return Object.keys(parsed).filter((k) => k !== "bucket_name");
}

export interface AliasMergeResult {
  content: string;
  changed: boolean;
  /** domain → aliases that were added to the canonical copy */
  added: Record<string, string[]>;
}

/**
 * Merge aliases defined in the repo's sites.yml into the canonical (GCS)
 * copy when they are missing there. Line-based insertion so comments and
 * any production-edited fields in the canonical copy are preserved.
 * Only ADDS missing aliases — never removes or rewrites other fields.
 */
export function mergeMissingAliases(repoContent: string, canonicalContent: string): AliasMergeResult {
  const repoParsed = safeParseYaml(repoContent);
  const gcsParsed = safeParseYaml(canonicalContent);
  const noop: AliasMergeResult = { content: canonicalContent, changed: false, added: {} };
  if (!repoParsed || !gcsParsed) return noop;

  const gcsDomains = new Set(siteDomains(gcsParsed).map((d) => d.toLowerCase()));
  const gcsAliasOwners = new Map<string, string>();
  for (const d of siteDomains(gcsParsed)) {
    for (const a of extractAliases(gcsParsed[d])) gcsAliasOwners.set(a, d);
  }

  let lines = canonicalContent.split("\n");
  const added: Record<string, string[]> = {};

  for (const domain of siteDomains(repoParsed)) {
    if (!(domain in gcsParsed)) continue; // domain not in canonical copy — don't add sites here
    const existing = new Set(extractAliases(gcsParsed[domain]));
    const missing = extractAliases(repoParsed[domain]).filter((a) => {
      if (existing.has(a)) return false;
      if (gcsDomains.has(a)) return false; // would create a redirect loop
      const owner = gcsAliasOwners.get(a);
      if (owner && owner !== domain) return false; // claimed by another site
      return true;
    });
    if (missing.length === 0) continue;

    // Locate the domain block in the canonical copy.
    const keyPattern = new RegExp(`^${escapeRegExp(domain)}:\\s*(#.*)?$`);
    const startIdx = lines.findIndex((l) => keyPattern.test(l));
    if (startIdx === -1) continue;
    let endIdx = lines.length;
    for (let i = startIdx + 1; i < lines.length; i++) {
      const l = lines[i];
      if (l.trim() !== "" && !/^\s/.test(l) ) { endIdx = i; break; }
    }

    // Find an existing `aliases:` key inside the block, else insert one.
    let aliasKeyIdx = -1;
    for (let i = startIdx + 1; i < endIdx; i++) {
      if (/^\s{2}aliases:\s*(#.*)?$/.test(lines[i])) { aliasKeyIdx = i; break; }
    }

    const newAliasLines = missing.map((a) => `    - ${a}`);
    if (aliasKeyIdx === -1) {
      lines = [
        ...lines.slice(0, startIdx + 1),
        "  aliases:",
        ...newAliasLines,
        ...lines.slice(startIdx + 1),
      ];
    } else {
      // Append after the last existing list item under aliases:
      let insertAt = aliasKeyIdx + 1;
      while (insertAt < endIdx && /^\s{4}-\s/.test(lines[insertAt])) insertAt++;
      lines = [...lines.slice(0, insertAt), ...newAliasLines, ...lines.slice(insertAt)];
    }
    added[domain] = missing;
    for (const a of missing) gcsAliasOwners.set(a, domain);
  }

  const changed = Object.keys(added).length > 0;
  return { content: changed ? lines.join("\n") : canonicalContent, changed, added };
}

/**
 * Compare structural fields between the repo sites.yml and the canonical
 * (GCS) copy, returning human-readable divergence descriptions. Used to
 * warn loudly when repo config changes are being shadowed by the GCS copy.
 */
export function diffSitesYmlStructure(repoContent: string, canonicalContent: string): string[] {
  const repoParsed = safeParseYaml(repoContent);
  const gcsParsed = safeParseYaml(canonicalContent);
  if (!repoParsed || !gcsParsed) return [];

  const diffs: string[] = [];
  const repoDomains = siteDomains(repoParsed);
  const gcsDomains = siteDomains(gcsParsed);

  for (const d of repoDomains) {
    if (!gcsDomains.includes(d)) diffs.push(`site "${d}" exists in repo sites.yml but not in the GCS copy`);
  }
  for (const d of gcsDomains) {
    if (!repoDomains.includes(d)) diffs.push(`site "${d}" exists in the GCS copy but not in repo sites.yml`);
  }

  const FIELDS = ["content_folder", "github_repo_url", "fallback_content_folder"] as const;
  for (const d of repoDomains) {
    if (!gcsDomains.includes(d)) continue;
    const repoSite = (repoParsed[d] ?? {}) as Record<string, unknown>;
    const gcsSite = (gcsParsed[d] ?? {}) as Record<string, unknown>;
    for (const f of FIELDS) {
      const rv = repoSite[f];
      const gv = gcsSite[f];
      if ((rv ?? null) !== (gv ?? null)) {
        diffs.push(`site "${d}" field "${f}" differs (repo: ${JSON.stringify(rv ?? null)}, GCS: ${JSON.stringify(gv ?? null)})`);
      }
    }
    const repoAliases = extractAliases(repoSite).sort();
    const gcsAliases = extractAliases(gcsSite).sort();
    if (JSON.stringify(repoAliases) !== JSON.stringify(gcsAliases)) {
      diffs.push(`site "${d}" aliases differ (repo: [${repoAliases.join(", ")}], GCS: [${gcsAliases.join(", ")}])`);
    }
  }

  const rb = repoParsed.bucket_name ?? null;
  const gb = gcsParsed.bucket_name ?? null;
  if (rb !== gb) diffs.push(`bucket_name differs (repo: ${JSON.stringify(rb)}, GCS: ${JSON.stringify(gb)})`);

  return diffs;
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
  try {
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
      // Capture the repo's own sites.yml BEFORE it gets overwritten by the
      // GCS copy, so repo-defined aliases can be reconciled into the
      // canonical copy instead of being silently lost.
      const repoContent = readSitesYmlLocal();

      const result = await gcs.downloadFirstExisting(platformSitesYmlReadKeys());
      if (result) {
        let canonical = result.data.toString("utf-8");

        if (repoContent && repoContent !== canonical) {
          const merge = mergeMissingAliases(repoContent, canonical);
          if (merge.changed) {
            canonical = merge.content;
            log.warn(
              { added: merge.added },
              "[SitesYml] Repo-defined aliases were missing in the canonical GCS copy — merged and re-uploading",
            );
            try {
              await uploadSitesYmlToBucket(canonical);
            } catch (err) {
              log.error({ err }, "[SitesYml] Failed to re-upload merged sites.yml — continuing with merged local copy");
            }
          }

          const diffs = diffSitesYmlStructure(repoContent, canonical);
          if (diffs.length > 0) {
            log.warn(
              { diffs },
              "[SitesYml] Repo sites.yml diverges from the canonical GCS copy — the GCS copy wins. Review whether repo changes need to be synced (Cloud Sync admin action re-uploads the local file).",
            );
          }
        }

        writeSitesYmlLocal(canonical);
        log.info("[SitesYml] Loaded site registry from GCS");
        return;
      }

      const local = repoContent;
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
  } finally {
    // Other modules (content-index, database, settings, …) may have parsed
    // sites.yml at import time, before this GCS load runs. Always invalidate
    // the in-memory cache so the next getSiteConfigs() reads the file we just
    // resolved on disk (canonical in production).
    resetSiteConfigs();
  }
}
