import path from "path";
import type { Request, Response, NextFunction } from "express";
import { getSiteConfigs, isMultiSiteMode, type SiteConfig } from "./site-config";
import { ContentIndex } from "./content-index";
import { child } from "./logger";

const log = child({ module: "site-manager" });

export interface SiteContext {
  config: SiteConfig;
  contentIndex: ContentIndex;
  contentRoot: string;
  contentRootName: string;
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
    const ctx: SiteContext = { config, contentIndex: ci, contentRoot, contentRootName };
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

  if (process.env.NODE_ENV !== "production" && req.query.__site) {
    domain = req.query.__site as string;
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
