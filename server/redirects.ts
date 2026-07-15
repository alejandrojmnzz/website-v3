import type { Request, Response, NextFunction } from "express";
import { contentIndex, type RedirectEntry } from "./content-index";
import { databaseManager } from "./database";
import { getAllConfigs, getFullFieldMapping, getLocaleKey, resolveUrlPatternWithMapping } from "./content-types";
import { child } from "./logger";
const log = child({ module: "redirects" });

// ============================================================================
// Per-site redirect maps (multi-site isolation)
// ============================================================================

interface RedirectMaps {
  map: Map<string, RedirectEntry>;
  regexBefore: Array<{ regex: RegExp; entry: RedirectEntry }>;
  fallbackMap: Map<string, RedirectEntry>;
  regexFallback: Array<{ regex: RegExp; entry: RedirectEntry }>;
  fallbackNonCustomMap: Map<string, RedirectEntry>;
  regexFallbackNonCustom: Array<{ regex: RegExp; entry: RedirectEntry }>;
}

const _siteRedirectCache = new Map<typeof contentIndex, RedirectMaps>();

function _buildMapsFromEntries(entries: RedirectEntry[]): RedirectMaps {
  const map = new Map<string, RedirectEntry>();
  const regexBefore: Array<{ regex: RegExp; entry: RedirectEntry }> = [];
  const fbMap = new Map<string, RedirectEntry>();
  const regexFb: Array<{ regex: RegExp; entry: RedirectEntry }> = [];
  const fbNonCustomMap = new Map<string, RedirectEntry>();
  const regexFbNonCustom: Array<{ regex: RegExp; entry: RedirectEntry }> = [];

  for (const entry of entries) {
    const isFallback = entry.priority === "fallback";
    const isCustom = entry.type === "custom";

    if (isRegexPattern(entry.from)) {
      if (entry.from.length > 500) {
        log.warn(`[Redirects] Regex pattern too long, skipping: ${entry.from.substring(0, 50)}...`);
        continue;
      }
      try {
        const regex = new RegExp(`^${entry.from}$`, "i");
        if (isFallback) {
          if (isCustom) {
            regexFb.push({ regex, entry });
          } else {
            regexFbNonCustom.push({ regex, entry });
          }
        } else {
          regexBefore.push({ regex, entry });
        }
      } catch {
        log.warn(`[Redirects] Invalid regex pattern: ${entry.from}`);
      }
    } else {
      if (isFallback) {
        if (isCustom) {
          if (!fbMap.has(entry.from)) fbMap.set(entry.from, entry);
        } else {
          if (!fbNonCustomMap.has(entry.from)) fbNonCustomMap.set(entry.from, entry);
        }
      } else {
        if (!map.has(entry.from)) map.set(entry.from, entry);
      }
    }
  }

  return { map, regexBefore, fallbackMap: fbMap, regexFallback: regexFb, fallbackNonCustomMap: fbNonCustomMap, regexFallbackNonCustom: regexFbNonCustom };
}

function _getSiteRedirectMaps(ci: typeof contentIndex): RedirectMaps {
  if (_siteRedirectCache.has(ci)) return _siteRedirectCache.get(ci)!;
  const maps = _buildMapsFromEntries(ci.getRedirects());
  const totalFb = maps.fallbackMap.size + maps.regexFallback.length + maps.fallbackNonCustomMap.size + maps.regexFallbackNonCustom.length;
  log.info(`[Redirects] Per-site maps: ${maps.map.size} exact, ${maps.regexBefore.length} regex, ${totalFb} fallback`);
  _siteRedirectCache.set(ci, maps);
  return maps;
}

// ============================================================================
// Global redirect maps (single-site / backward-compat)
// ============================================================================

let redirectMap: Map<string, RedirectEntry> | null = null;
let regexRedirectsBefore: Array<{ regex: RegExp; entry: RedirectEntry }> | null = null;
let fallbackMap: Map<string, RedirectEntry> | null = null;
let regexRedirectsFallback: Array<{ regex: RegExp; entry: RedirectEntry }> | null = null;
let fallbackNonCustomMap: Map<string, RedirectEntry> | null = null;
let regexRedirectsFallbackNonCustom: Array<{ regex: RegExp; entry: RedirectEntry }> | null = null;

export function isRegexPattern(path: string): boolean {
  return /\(.*\)|\[.*\]|\.\*|\.\+|\\d|\\w|\\s|\{\d+[,}]/.test(path);
}

function buildRedirectMap(): Map<string, RedirectEntry> {
  const maps = _buildMapsFromEntries(contentIndex.getRedirects());
  redirectMap = maps.map;
  regexRedirectsBefore = maps.regexBefore;
  fallbackMap = maps.fallbackMap;
  regexRedirectsFallback = maps.regexFallback;
  fallbackNonCustomMap = maps.fallbackNonCustomMap;
  regexRedirectsFallbackNonCustom = maps.regexFallbackNonCustom;
  const totalFallback = maps.fallbackMap.size + maps.regexFallback.length + maps.fallbackNonCustomMap.size + maps.regexFallbackNonCustom.length;
  log.info(`[Redirects] Loaded ${maps.map.size} exact redirects, ${maps.regexBefore.length} regex redirects (before), ${totalFallback} fallback redirects (${maps.fallbackNonCustomMap.size + maps.regexFallbackNonCustom.length} non-custom)`);
  return maps.map;
}

function getRedirectMap(): Map<string, RedirectEntry> {
  if (!redirectMap) {
    redirectMap = buildRedirectMap();
  }
  return redirectMap;
}

function normalizePath(urlPath: string): string {
  let normalized = urlPath.toLowerCase();
  if (normalized.length > 1 && normalized.endsWith("/")) {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
}

function detectLocale(req: Request): string {
  const acceptLang = req.headers["accept-language"];
  if (acceptLang && typeof acceptLang === "string") {
    const primary = acceptLang.split(",")[0]?.trim().toLowerCase() || "";
    if (primary.startsWith("es")) return "es";
  }
  return "en";
}

function resolveRedirectTarget(entry: RedirectEntry, req: Request, captureGroups?: string[]): string {
  let target: string;
  if (typeof entry.to === "string") {
    target = entry.to;
  } else {
    const locale = detectLocale(req);
    target = entry.to[locale] || entry.to["en"] || Object.values(entry.to)[0] || "/";
  }

  if (captureGroups && captureGroups.length > 0) {
    for (let i = 0; i < captureGroups.length; i++) {
      target = target.replace(new RegExp(`\\$${i + 1}`, "g"), captureGroups[i]);
    }
  }

  return target;
}

function getQueryString(req: Request): string {
  const url = req.originalUrl;
  const qIndex = url.indexOf('?');
  return qIndex >= 0 ? url.slice(qIndex) : '';
}

export function redirectMiddleware(req: Request, res: Response, next: NextFunction): void {
  const siteCi = (res.locals.site as any)?.contentIndex as typeof contentIndex | undefined;
  const siteMaps = siteCi ? _getSiteRedirectMaps(siteCi) : null;
  const map = siteMaps ? siteMaps.map : getRedirectMap();
  const regexBefore = siteMaps ? siteMaps.regexBefore : (regexRedirectsBefore || []);
  const normalizedPath = normalizePath(req.path);

  const entry = map.get(normalizedPath);
  if (entry) {
    const status = entry.status || 301;
    const target = resolveRedirectTarget(entry, req);
    const qs = getQueryString(req);
    log.info(`[Redirects] ${status}: ${req.path} -> ${target}${qs}`);
    res.redirect(status, target + qs);
    return;
  }

  for (const { regex, entry: regexEntry } of regexBefore) {
    const match = req.path.match(regex);
    if (match) {
      const captureGroups = match.slice(1);
      const status = regexEntry.status || 301;
      const target = resolveRedirectTarget(regexEntry, req, captureGroups);
      const qs = getQueryString(req);
      log.info(`[Redirects] ${status} (regex): ${req.path} -> ${target}${qs}`);
      res.redirect(status, target + qs);
      return;
    }
  }

  next();
}

export function fallbackRedirectMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (req.path.startsWith("/api/") || req.path.startsWith("/assets/") || req.path.startsWith("/@")) {
    next();
    return;
  }

  const siteCi = (res.locals.site as any)?.contentIndex as typeof contentIndex | undefined;
  const siteMaps = siteCi ? _getSiteRedirectMaps(siteCi) : null;
  if (!siteMaps) getRedirectMap(); // ensure global maps are built for single-site mode
  const activeFallbackNonCustomMap = siteMaps ? siteMaps.fallbackNonCustomMap : fallbackNonCustomMap;
  const activeRegexFbNonCustom = siteMaps ? siteMaps.regexFallbackNonCustom : regexRedirectsFallbackNonCustom;
  const activeFallbackMap = siteMaps ? siteMaps.fallbackMap : fallbackMap;
  const activeRegexFb = siteMaps ? siteMaps.regexFallback : regexRedirectsFallback;
  const activeCi = siteCi ?? contentIndex;
  const normalizedPath = normalizePath(req.path);

  // Non-custom (content-defined) fallback redirects fire before the page check —
  // they take priority over any active page at the same URL.
  if (activeFallbackNonCustomMap) {
    const entry = activeFallbackNonCustomMap.get(normalizedPath);
    if (entry) {
      const status = entry.status || 301;
      const target = resolveRedirectTarget(entry, req);
      const qs = getQueryString(req);
      log.info(`[Redirects] ${status} (fallback non-custom): ${req.path} -> ${target}${qs}`);
      res.redirect(status, target + qs);
      return;
    }
  }

  if (activeRegexFbNonCustom) {
    for (const { regex, entry: regexEntry } of activeRegexFbNonCustom) {
      const match = req.path.match(regex);
      if (match) {
        const captureGroups = match.slice(1);
        const status = regexEntry.status || 301;
        const target = resolveRedirectTarget(regexEntry, req, captureGroups);
        const qs = getQueryString(req);
        log.info(`[Redirects] ${status} (fallback non-custom regex): ${req.path} -> ${target}${qs}`);
        res.redirect(status, target + qs);
        return;
      }
    }
  }

  // Custom fallback redirects only fire when no real page exists at this URL.
  const cleanUrl = req.path.split("?")[0].split("#")[0];
  try {
    if (activeCi.isKnownUrl(cleanUrl)) {
      next();
      return;
    }
  } catch {}

  // Generic DB canonical redirect: for any DB-backed content type with a multi-param URL
  // pattern, if the URL is not known, check if the last segment matches a slug in that DB.
  // If so, redirect to the canonical URL (handles wrong category, missing category, etc.)
  try {
    const segments = cleanUrl.split("/").filter(Boolean);
    const lastSegment = segments[segments.length - 1];
    const localeMatch = cleanUrl.match(/^\/([a-z]{2})\//);
    const locale = localeMatch?.[1] ?? "en";

    if (lastSegment) {
      for (const [typeName, typeConfig] of Object.entries(getAllConfigs())) {
        if (!typeConfig.database?.slug || !typeConfig.url_pattern) continue;
        const items = databaseManager.getMappedItems(typeConfig.database.slug);
        if (!items) continue;
        const record = items.find((item) => String(item.slug || "") === lastSegment);
        if (!record) continue;
        // Use the record's own locale if available — handles articles served under the wrong language prefix.
        // Try the content-type's declared locale field first, then common field names as fallback.
        const localeField = getLocaleKey(typeName);
        const rawLocale =
          (localeField && record[localeField]) ||
          record["language"] ||
          record["lang"] ||
          record["locale"];
        const recordLocale = rawLocale ? String(rawLocale) : locale;
        const canonicalLocale = typeConfig.url_pattern[recordLocale] ? recordLocale : locale;
        const urlPattern = typeConfig.url_pattern[canonicalLocale] ?? typeConfig.url_pattern["en"];
        if (!urlPattern) continue;
        const fieldMapping = getFullFieldMapping(typeName);
        const canonicalUrl = resolveUrlPatternWithMapping(urlPattern, record, canonicalLocale, fieldMapping);
        if (canonicalUrl && canonicalUrl !== cleanUrl) {
          const qs = getQueryString(req);
          log.info(`[Redirects] 301 (canonical ${typeName}): ${cleanUrl} -> ${canonicalUrl}${qs}`);
          res.redirect(301, canonicalUrl + qs);
          return;
        }
        break;
      }
    }
  } catch {}

  if (activeFallbackMap) {
    const entry = activeFallbackMap.get(normalizedPath);
    if (entry) {
      const status = entry.status || 301;
      const target = resolveRedirectTarget(entry, req);
      const qs = getQueryString(req);
      log.info(`[Redirects] ${status} (fallback): ${req.path} -> ${target}${qs}`);
      res.redirect(status, target + qs);
      return;
    }
  }

  if (activeRegexFb) {
    for (const { regex, entry: regexEntry } of activeRegexFb) {
      const match = req.path.match(regex);
      if (match) {
        const captureGroups = match.slice(1);
        const status = regexEntry.status || 301;
        const target = resolveRedirectTarget(regexEntry, req, captureGroups);
        const qs = getQueryString(req);
        log.info(`[Redirects] ${status} (fallback regex): ${req.path} -> ${target}${qs}`);
        res.redirect(status, target + qs);
        return;
      }
    }
  }

  next();
}

export function getRedirects(): Array<{ from: string; to: string | Record<string, string>; type: string; status: number; source: string; priority?: string }> {
  const map = getRedirectMap();
  const result: Array<{ from: string; to: string | Record<string, string>; type: string; status: number; source: string; priority?: string }> = [];

  for (const [from, entry] of map) {
    result.push({
      from,
      to: entry.to,
      type: entry.type,
      status: entry.status || 301,
      source: entry.source,
      priority: entry.priority,
    });
  }

  if (fallbackMap) {
    for (const [from, entry] of fallbackMap) {
      result.push({
        from,
        to: entry.to,
        type: entry.type,
        status: entry.status || 301,
        source: entry.source,
        priority: entry.priority,
      });
    }
  }

  if (regexRedirectsBefore) {
    for (const { entry } of regexRedirectsBefore) {
      result.push({
        from: entry.from,
        to: entry.to,
        type: entry.type,
        status: entry.status || 301,
        source: entry.source,
        priority: entry.priority,
      });
    }
  }

  if (regexRedirectsFallback) {
    for (const { entry } of regexRedirectsFallback) {
      result.push({
        from: entry.from,
        to: entry.to,
        type: entry.type,
        status: entry.status || 301,
        source: entry.source,
        priority: entry.priority,
      });
    }
  }

  return result;
}

export function lookupRedirect(urlPath: string): RedirectEntry | undefined {
  const map = getRedirectMap();
  const normalized = normalizePath(urlPath);

  const exact = map.get(normalized);
  if (exact) return exact;

  if (fallbackMap) {
    const fbExact = fallbackMap.get(normalized);
    if (fbExact) return fbExact;
  }

  if (regexRedirectsBefore) {
    for (const { regex, entry } of regexRedirectsBefore) {
      if (regex.test(urlPath)) {
        return entry;
      }
    }
  }

  if (regexRedirectsFallback) {
    for (const { regex, entry } of regexRedirectsFallback) {
      if (regex.test(urlPath)) {
        return entry;
      }
    }
  }

  return undefined;
}

export interface RedirectTestResult {
  match: boolean;
  from?: string;
  to?: string | Record<string, string>;
  resolvedTo?: string;
  status?: number;
  priority?: string;
  source?: string;
  matchType?: "exact" | "regex";
  captureGroups?: string[];
  pageExists?: boolean;
  destinationExists?: boolean;
}

function resolveTarget(entry: RedirectEntry, locale: string, captureGroups?: string[]): string {
  let target = typeof entry.to === "string" ? entry.to : (entry.to[locale] || entry.to["en"] || Object.values(entry.to)[0] || "/");
  if (captureGroups) {
    for (let i = 0; i < captureGroups.length; i++) {
      target = target.replace(new RegExp(`\\$${i + 1}`, "g"), captureGroups[i]);
    }
  }
  return target;
}

function makeResult(entry: RedirectEntry, locale: string, matchType: "exact" | "regex", priority?: string, captureGroups?: string[]): RedirectTestResult {
  const resolvedTo = resolveTarget(entry, locale, captureGroups);
  return {
    match: true,
    from: entry.from,
    to: entry.to,
    resolvedTo,
    status: entry.status || 301,
    priority: priority || entry.priority || "before",
    source: entry.source,
    matchType,
    captureGroups,
  };
}

/**
 * Fresh redirect entries for debug tools: re-reads custom-redirects.yml from disk.
 * Does not touch the live middleware redirect cache.
 */
export function getFreshRedirectEntries(
  ci: typeof contentIndex = contentIndex,
): RedirectEntry[] {
  try {
    return ci.refreshCustomRedirects();
  } catch (err) {
    log.warn({ err }, "[Redirects] refreshCustomRedirects failed in getFreshRedirectEntries");
    return ci.getRedirects();
  }
}

export function testRedirect(
  rawInput: string,
  locale: string = "en",
  /** Active site's content index — must match live middleware / add-redirect checks. */
  ci: typeof contentIndex = contentIndex,
): RedirectTestResult {
  let urlPath = rawInput;
  try {
    if (/^https?:\/\//i.test(urlPath)) {
      urlPath = new URL(urlPath).pathname;
    }
  } catch {}
  urlPath = urlPath.split("?")[0].split("#")[0];
  if (!urlPath.startsWith("/")) urlPath = "/" + urlPath;

  // Debug tester prioritizes correctness over speed: always re-read from disk and
  // build maps from scratch (never the live request cache).
  const maps = _buildMapsFromEntries(getFreshRedirectEntries(ci));
  const normalized = normalizePath(urlPath);

  const exact = maps.map.get(normalized);
  if (exact) return makeResult(exact, locale, "exact");

  for (const { regex, entry } of maps.regexBefore) {
    const m = urlPath.match(regex);
    if (m) return makeResult(entry, locale, "regex", undefined, m.slice(1));
  }

  const fbNc = maps.fallbackNonCustomMap.get(normalized);
  if (fbNc) return makeResult(fbNc, locale, "exact", "fallback");

  for (const { regex, entry } of maps.regexFallbackNonCustom) {
    const m = urlPath.match(regex);
    if (m) return makeResult(entry, locale, "regex", "fallback", m.slice(1));
  }

  const isKnown = ci.isKnownUrl(urlPath);

  if (!isKnown) {
    const fb = maps.fallbackMap.get(normalized);
    if (fb) return makeResult(fb, locale, "exact", "fallback");

    for (const { regex, entry } of maps.regexFallback) {
      const m = urlPath.match(regex);
      if (m) return makeResult(entry, locale, "regex", "fallback", m.slice(1));
    }
  }

  return { match: false, pageExists: isKnown };
}

export function clearRedirectCache(): void {
  redirectMap = null;
  regexRedirectsBefore = null;
  fallbackMap = null;
  regexRedirectsFallback = null;
  fallbackNonCustomMap = null;
  regexRedirectsFallbackNonCustom = null;
  _siteRedirectCache.clear();
  log.info("[Redirects] Cache cleared (global + all per-site)");
}
