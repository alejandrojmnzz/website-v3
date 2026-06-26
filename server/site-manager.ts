import path from "path";
import fs from "fs";
import type { Request, Response, NextFunction } from "express";
import { getSiteConfigs, isMultiSiteMode, type SiteConfig } from "./site-config";
import { ContentIndex } from "./content-index";
import { ValidationCacheService } from "./services/validationCacheService";
import { AutoCommitQueue } from "./auto-commit";
import { VersioningManager } from "./versioning/VersioningManager";
import { DatabaseManager } from "./database";
import { child } from "./logger";

const log = child({ module: "site-manager" });

export interface SiteContext {
  config: SiteConfig;
  contentIndex: ContentIndex;
  contentRoot: string;
  contentRootName: string;
  validationCache: ValidationCacheService;
  autoCommitQueue: AutoCommitQueue;
  versioningManager: VersioningManager;
  database: DatabaseManager;
  isDevOverride?: boolean;
}

declare global {
  namespace Express {
    interface Locals {
      site: SiteContext;
    }
  }
}

let _siteMap: Map<string, SiteContext> | null = null;
let _defaultSite: SiteContext | null = null;

export function buildSiteContextMap(): Map<string, SiteContext> {
  if (_siteMap) return _siteMap;

  const configs = getSiteConfigs();
  const map = new Map<string, SiteContext>();

  for (const config of configs) {
    const contentRoot = path.isAbsolute(config.contentFolder)
      ? config.contentFolder
      : path.join(process.cwd(), config.contentFolder);
    const contentRootName = path.relative(process.cwd(), contentRoot);
    const ci = new ContentIndex(config.contentFolder);
    const validationCache = new ValidationCacheService(contentRoot);
    const autoCommitQueue = new AutoCommitQueue(contentRootName);
    const versioningManager = new VersioningManager(contentRoot);
    const database = new DatabaseManager(contentRoot);
    const ctx: SiteContext = { config, contentIndex: ci, contentRoot, contentRootName, validationCache, autoCommitQueue, versioningManager, database };
    map.set(config.domain, ctx);
    log.info(`[SiteManager] Registered site domain="${config.domain}" contentFolder="${config.contentFolder}"`);
  }

  _siteMap = map;
  _defaultSite = map.values().next().value ?? null;
  return map;
}

export function getSiteContextMap(): Map<string, SiteContext> {
  return _siteMap ?? buildSiteContextMap();
}

export function getDefaultSite(): SiteContext {
  if (!_defaultSite) buildSiteContextMap();
  if (!_defaultSite) throw new Error("[SiteManager] No sites configured");
  return _defaultSite;
}

export function resetSiteContextMap(): void {
  _siteMap = null;
  _defaultSite = null;
}

// Path to the dev-site override file. Written by /api/dev/set-site and read
// here synchronously on every request. This is the single source of truth for
// the active site in the dev environment — no cookies, no query-param guessing.
const DEV_SITE_FILE = path.join(process.cwd(), ".local", "dev-site-override");

/** Read the active dev-site override from disk. Returns null when not set. */
export function readDevSiteFile(): string | null {
  try {
    const value = fs.readFileSync(DEV_SITE_FILE, "utf8").trim();
    return value || null;
  } catch {
    return null;
  }
}

/** Write the active dev-site override to disk. */
export function writeDevSiteFile(domain: string): void {
  fs.mkdirSync(path.dirname(DEV_SITE_FILE), { recursive: true });
  fs.writeFileSync(DEV_SITE_FILE, domain, "utf8");
}

/** Delete the dev-site override file. */
export function clearDevSiteFile(): void {
  try { fs.unlinkSync(DEV_SITE_FILE); } catch {}
}

export function siteResolutionMiddleware(req: Request, res: Response, next: NextFunction): void {
  const sites = getSiteContextMap();
  let domain = req.hostname;
  let isDevOverride = false;

  // DEV SITE OVERRIDE (non-production only)
  //
  // Single source of truth: .local/dev-site-override file on disk.
  // Written by POST /api/dev/set-site, deleted by POST /api/dev/clear-site.
  // The client mirrors the value in localStorage so injectDevSite() can also
  // append ?__site= to API calls — but the file is what drives SSR and every
  // server-side resolution. No cookies are used.
  //
  // In production req.hostname is always used (no override possible).
  if (process.env.NODE_ENV !== "production") {
    const fileSite = readDevSiteFile();
    if (fileSite) {
      domain = fileSite;
      isDevOverride = true;
    }
  }

  let ctx = sites.get(domain);
  if (!ctx) {
    if (sites.size > 1) {
      log.warn(`[SiteManager] Unknown hostname "${domain}" — falling back to default site`);
    }
    ctx = getDefaultSite();
  }

  res.locals.site = { ...ctx, isDevOverride };
  next();
}

export function getSiteInfo(req: Request, res: Response): { domain: string; contentFolder: string; isMultiSite: boolean; isDevOverride: boolean; githubRepoUrl?: string } {
  const site = res.locals.site ?? getDefaultSite();
  return {
    domain: site.config.domain,
    contentFolder: site.config.contentFolder,
    isMultiSite: isMultiSiteMode(),
    isDevOverride: site.isDevOverride ?? false,
    githubRepoUrl: site.config.githubRepoUrl,
  };
}
