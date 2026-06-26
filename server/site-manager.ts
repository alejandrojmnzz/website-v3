import path from "path";
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

export function siteResolutionMiddleware(req: Request, res: Response, next: NextFunction): void {
  const sites = getSiteContextMap();
  let domain = req.hostname;
  let isDevOverride = false;

  // DEV SITE OVERRIDE — resolution priority (non-production only):
  //
  // 1. ?__site= query param  — set by injectDevSite() on individual API calls
  //                             as belt-and-suspenders; takes priority so ad-hoc
  //                             curl/Postman requests can also target a specific site.
  //
  // 2. __dev_site cookie     — THE canonical source of truth for the active dev
  //                             override. Set by setDevSiteOverride() in
  //                             client/src/lib/devSite.ts. Sent automatically on
  //                             every HTTP request, including the initial HTML GET
  //                             that produces SSR output. This is why the override
  //                             MUST be a cookie — localStorage is invisible here.
  //
  //                             DO NOT remove the cookie check or replace it with
  //                             a session/header approach without also updating the
  //                             client devSite.ts and verifying SSR still works.
  if (process.env.NODE_ENV !== "production" && req.query.__site) {
    domain = req.query.__site as string;
    isDevOverride = true;
  } else if (process.env.NODE_ENV !== "production" && req.cookies?.__dev_site) {
    domain = req.cookies.__dev_site as string;
    isDevOverride = true;
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
