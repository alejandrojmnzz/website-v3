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

// =============================================================================
// DEV SITE OVERRIDE — FILE-BASED APPROACH
// =============================================================================
//
// The active dev site is stored in a plain text file on disk:
//   .local/dev-site-override
//
// ⚠️  DO NOT REPLACE THIS WITH COOKIES — EVER.
//
// We tried cookies. They do not work reliably in the Replit dev environment.
// Here is exactly why:
//
//   Replit's workspace embeds the app (worf.replit.dev) inside an iframe on
//   replit.com. Modern browsers treat the embedded domain as a THIRD-PARTY
//   context relative to the top-level page (replit.com). This means:
//
//   • document.cookie writes from the app are silently ignored by Chrome/Edge
//     when third-party cookie blocking is active (Chrome 115+).
//
//   • Set-Cookie response headers from the server (even with SameSite=None;
//     Secure) are also blocked — the browser receives the header but does NOT
//     store the cookie for future requests.
//
//   • The result: the server calls /api/dev/set-site, gets {"ok":true}, but
//     the cookie is never sent on the next request. The site never switches.
//
//   We tested SameSite=Lax, SameSite=None; Secure, and server-side Set-Cookie.
//   All three fail silently in the Replit iframe context.
//
// The file-based approach bypasses all of this:
//   • The file is written by the server (no browser involved).
//   • The file is read by the server synchronously on every request.
//   • No cookies, no iframe restrictions, no browser policy issues.
//
// localStorage is used as a CLIENT-SIDE MIRROR only — written in lockstep
// with the file so injectDevSite() can append ?__site= to API calls. The file
// is still the canonical server-side truth; localStorage is never the source
// of truth for site resolution.
//
// =============================================================================

const DEV_SITE_FILE = path.join(process.cwd(), ".local", "dev-site-override");

/**
 * Read the active dev-site override from disk.
 * Returns null when the file is absent (no override active).
 * DO NOT replace this with a cookie read — see the warning block above.
 */
export function readDevSiteFile(): string | null {
  try {
    const value = fs.readFileSync(DEV_SITE_FILE, "utf8").trim();
    return value || null;
  } catch {
    return null;
  }
}

/**
 * Write the active dev-site override to disk.
 * Called by GET /api/dev/set-site. Creates .local/ if needed.
 */
export function writeDevSiteFile(domain: string): void {
  fs.mkdirSync(path.dirname(DEV_SITE_FILE), { recursive: true });
  fs.writeFileSync(DEV_SITE_FILE, domain, "utf8");
}

/**
 * Delete the dev-site override file (reverts to req.hostname resolution).
 * Called by GET /api/dev/clear-site.
 */
export function clearDevSiteFile(): void {
  try { fs.unlinkSync(DEV_SITE_FILE); } catch {}
}

export function siteResolutionMiddleware(req: Request, res: Response, next: NextFunction): void {
  const sites = getSiteContextMap();
  let domain = req.hostname;
  let isDevOverride = false;

  // DEV SITE OVERRIDE — reads .local/dev-site-override (non-production only).
  //
  // In PRODUCTION this block is skipped entirely. Site resolution is driven
  // by req.hostname (the actual subdomain/domain of the incoming request).
  // There is no override mechanism in production — and there should never be.
  //
  // In DEVELOPMENT the file is the single source of truth. If absent, falls
  // through to req.hostname (which on Replit dev URLs is the worf.replit.dev
  // hostname, not a real site domain, so the default site is used instead).
  //
  // ⚠️  DO NOT add a cookie-based fallback here. See the warning block above.
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
