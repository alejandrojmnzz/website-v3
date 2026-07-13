import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import { child } from "./logger";

const log = child({ module: "site-config" });

export interface SiteConfig {
  domain: string;
  contentFolder: string;
  githubRepoUrl?: string;
  /** When an image_id is missing locally, resolve it from this site's registry. */
  fallbackContentFolder?: string;
}

let _cached: SiteConfig[] | null = null;
let _bucketName: string | null | undefined = undefined;

const SITES_YML_EXAMPLE = `# sites.yml — required at repo root
#
# bucket_name: my-gcs-bucket   # optional — shared GCS bucket for all sites
#
# example.com:
#   content_folder: site_example-com
#   github_repo_url: https://github.com/org/example-content
#   fallback_content_folder: site_parent-com  # optional

bucket_name: my-gcs-bucket

example.com:
  content_folder: site_example-com
  github_repo_url: https://github.com/org/example-content
`;

export function formatSitesYmlRequiredError(reason: string): string {
  return [
    "sites.yml is required but could not be loaded.",
    "",
    `Reason: ${reason}`,
    "",
    "Create sites.yml at the project root with at least one site entry (copy sites.yml.example).",
    "See INSTALL.md (Site content folders) for setup steps.",
    "",
    "Expected format:",
    SITES_YML_EXAMPLE.trimEnd(),
  ].join("\n");
}

export class SitesYmlRequiredError extends Error {
  constructor(reason: string) {
    super(formatSitesYmlRequiredError(reason));
    this.name = "SitesYmlRequiredError";
  }
}

function parseSitesYmlFile(sitesYml: string): SiteConfig[] {
  if (!fs.existsSync(sitesYml)) {
    throw new SitesYmlRequiredError("sites.yml not found at project root");
  }

  let parsed: Record<string, unknown> | null;
  try {
    const raw = fs.readFileSync(sitesYml, "utf-8");
    parsed = yaml.load(raw) as Record<string, unknown> | null;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new SitesYmlRequiredError(`failed to parse sites.yml: ${msg}`);
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new SitesYmlRequiredError("sites.yml must be a YAML mapping (object), not an array or scalar");
  }

  const configs: SiteConfig[] = [];

  if (typeof parsed.bucket_name === "string" && parsed.bucket_name) {
    _bucketName = parsed.bucket_name;
  }

  for (const [domain, config] of Object.entries(parsed)) {
    if (domain === "bucket_name") continue;
    if (config && typeof config === "object") {
      const c = config as Record<string, unknown>;
      const fallbackFolder =
        (typeof c.fallback_content_folder === "string" && c.fallback_content_folder) ||
        (typeof c.fallbackContentFolder === "string" && c.fallbackContentFolder) ||
        undefined;
      configs.push({
        domain,
        contentFolder: (c.content_folder as string) || (c.contentFolder as string) || "site_default",
        githubRepoUrl: (c.github_repo_url as string) || (c.githubRepoUrl as string) || undefined,
        fallbackContentFolder: fallbackFolder || undefined,
      });
    }
  }

  if (configs.length === 0) {
    throw new SitesYmlRequiredError("sites.yml contains no site entries (add at least one domain block)");
  }

  return configs;
}

/** Load site configs from sites.yml; throws SitesYmlRequiredError when missing or invalid. */
export function requireSiteConfigs(): SiteConfig[] {
  if (_cached) return _cached;

  const sitesYml = path.join(process.cwd(), "sites.yml");
  const configs = parseSitesYmlFile(sitesYml);
  log.info(`[SiteConfig] Loaded ${configs.length} site(s) from sites.yml`);
  _cached = configs;
  return _cached;
}

export function getSiteConfigs(): SiteConfig[] {
  return requireSiteConfigs();
}

/**
 * Returns the shared GCS bucket name from the top-level `bucket_name` field
 * in `sites.yml`, or null if not set.
 *
 * Resolution chain (consumers should apply in this order):
 *   1. getBucketName() — sites.yml top-level field (new, post-migration)
 *   2. GCS_BUCKET_NAME env var — legacy fallback
 */
export function getBucketName(): string | null {
  if (_bucketName !== undefined) return _bucketName;

  const sitesYml = path.join(process.cwd(), "sites.yml");
  if (fs.existsSync(sitesYml)) {
    try {
      const raw = fs.readFileSync(sitesYml, "utf-8");
      const parsed = yaml.load(raw) as Record<string, unknown> | null;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        if (typeof parsed.bucket_name === "string" && parsed.bucket_name) {
          _bucketName = parsed.bucket_name;
          return _bucketName;
        }
      }
    } catch {}
  }

  _bucketName = null;
  return null;
}

/** True when more than one site is configured (UI-only: site switcher visibility). */
export function hasMultipleSites(): boolean {
  return getSiteConfigs().length > 1;
}

/** @deprecated Use hasMultipleSites() — kept for compatibility during migration. */
export function isMultiSiteMode(): boolean {
  return hasMultipleSites();
}

/** First site in sites.yml (the default site for unmatched hostnames). */
export function getDefaultContentFolder(): string {
  return getSiteConfigs()[0].contentFolder;
}

/** Absolute path to the default site's content folder (from sites.yml). */
export function getDefaultContentRoot(): string {
  const folder = getDefaultContentFolder();
  return path.isAbsolute(folder) ? folder : path.join(process.cwd(), folder);
}

export function resetSiteConfigs(): void {
  _cached = null;
  _bucketName = undefined;
}

/**
 * Re-read sites.yml from disk and replace the cache — but only if the fresh
 * parse succeeds. If sites.yml is missing or invalid, the previously cached
 * (valid) configs are left untouched and the parse error propagates, so a
 * failed reload never leaves the process without a usable site config.
 */
export function reloadSiteConfigs(): SiteConfig[] {
  const sitesYml = path.join(process.cwd(), "sites.yml");
  const configs = parseSitesYmlFile(sitesYml);
  log.info(`[SiteConfig] Reloaded ${configs.length} site(s) from sites.yml`);
  _cached = configs;
  _bucketName = undefined; // force re-read of bucket_name on next access
  return configs;
}

export interface SiteConfigSnapshot {
  cached: SiteConfig[] | null;
  bucketName: string | null | undefined;
}

/** Capture the current config cache so it can be restored after a failed reload. */
export function snapshotSiteConfigs(): SiteConfigSnapshot {
  return { cached: _cached, bucketName: _bucketName };
}

/** Restore a previously captured config cache (used to roll back a failed reload). */
export function restoreSiteConfigs(snap: SiteConfigSnapshot): void {
  _cached = snap.cached;
  _bucketName = snap.bucketName;
}
