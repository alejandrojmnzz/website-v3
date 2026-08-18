/**
 * Probe a recorded 404: walk YAML redirects, then HTTP-follow until they stop.
 * Green check only when HTTP is 2xx and the final URL is the expected entry (or a live external URL).
 */

import type { DatabaseManager } from "./database";
import type { ContentIndex } from "./content-index";
import { queryEntries } from "./query-entries";
import {
  testRedirect,
  toPublicUrlPath,
  type RedirectTestResult,
} from "./redirects";
import {
  normalizeRuntimePath,
  type RuntimeIssueProbe,
  type RuntimeIssueProbeStatus,
} from "@shared/runtime-issues";

export const MAX_PROBE_HOPS = 8;
export const PROBE_HTTP_TIMEOUT_MS = 5_000;
export const PROBE_USER_AGENT = "curl/8.0 (runtime-issues-probe)";

export type ProbeMatchType = "exact" | "regex" | "canonical";

export interface ProbeContentIndex {
  resolveUrl(url: string): {
    contentType: string;
    slug: string;
    fromDatabase?: boolean;
  } | null;
}

export type QuerySlugExists = (contentType: string, slug: string) => Promise<boolean>;

export interface DestinationLookup {
  exists: boolean;
  external: boolean;
  entry?: { contentType: string; slug: string };
}

export function isExternalUrl(url: string): boolean {
  return /^https?:\/\//i.test(url.trim());
}

/** Compare index vs HTTP finals (pathname when either side is relative). Case-insensitive. */
export function probePathsMatch(a: string, b: string): boolean {
  const aExt = isExternalUrl(a);
  const bExt = isExternalUrl(b);
  if (aExt && bExt) return probeUrlKey(a) === probeUrlKey(b);
  const pathA = aExt ? new URL(a).pathname : a;
  const pathB = bExt ? new URL(b).pathname : b;
  return (
    normalizeRuntimePath(pathA).toLowerCase() === normalizeRuntimePath(pathB).toLowerCase()
  );
}

export function probeUrlKey(url: string): string {
  const trimmed = url.trim();
  if (isExternalUrl(trimmed)) {
    try {
      const u = new URL(trimmed);
      return `${u.origin}${normalizeRuntimePath(u.pathname)}`.toLowerCase();
    } catch {
      return trimmed.toLowerCase();
    }
  }
  return normalizeRuntimePath(trimmed).toLowerCase();
}

export async function lookupDestination(
  url: string,
  ci: ProbeContentIndex,
  querySlugExists?: QuerySlugExists,
): Promise<DestinationLookup> {
  const trimmed = url.trim();
  if (isExternalUrl(trimmed)) {
    return { exists: true, external: true };
  }
  const path = toPublicUrlPath(trimmed);
  const resolved = ci.resolveUrl(path);
  if (!resolved) return { exists: false, external: false };
  const entry = { contentType: resolved.contentType, slug: resolved.slug };
  if (resolved.fromDatabase) {
    if (!querySlugExists) return { exists: false, external: false, entry };
    const exists = await querySlugExists(resolved.contentType, resolved.slug);
    return { exists, external: false, entry };
  }
  return { exists: true, external: false, entry };
}

/** Same destinationExists enrichment as Redirects → Test a URL. */
export async function enrichRedirectDestinationExists(
  result: RedirectTestResult,
  ci: ProbeContentIndex,
  querySlugExists?: QuerySlugExists,
): Promise<RedirectTestResult> {
  if (!result.match || !result.resolvedTo) return result;
  const lookup = await lookupDestination(result.resolvedTo, ci, querySlugExists);
  return { ...result, destinationExists: lookup.exists };
}

export function makeQuerySlugExists(opts: {
  ci: ContentIndex;
  db: DatabaseManager;
  contentRoot: string;
}): QuerySlugExists {
  return async (contentType, slug) => {
    try {
      const { items } = await queryEntries(
        { from: { contentType } },
        { db: opts.db, contentIndex: opts.ci, contentRoot: opts.contentRoot },
      );
      return items.some((item) => String(item.slug) === slug);
    } catch {
      return false;
    }
  };
}

export interface IndexWalkResult {
  hops: string[];
  finalUrl: string;
  pageExists: boolean;
  matchedRedirect: boolean;
  matchType?: ProbeMatchType;
  destExists: boolean;
  external: boolean;
  entry?: { contentType: string; slug: string };
  loop: boolean;
}

export async function walkIndexRedirects(opts: {
  path: string;
  locale: string;
  test: (url: string, locale: string) => RedirectTestResult;
  lookup: (url: string) => Promise<DestinationLookup>;
}): Promise<IndexWalkResult> {
  const start = isExternalUrl(opts.path) ? opts.path.trim() : normalizeRuntimePath(opts.path);
  const seen = new Set<string>();
  const hops: string[] = [start];
  let current = start;
  let matchedRedirect = false;
  let matchType: ProbeMatchType | undefined;

  for (let i = 0; i < MAX_PROBE_HOPS; i++) {
    const key = probeUrlKey(current);
    if (seen.has(key)) {
      return {
        hops,
        finalUrl: current,
        pageExists: false,
        matchedRedirect,
        matchType,
        destExists: false,
        external: isExternalUrl(current),
        loop: true,
      };
    }
    seen.add(key);

    const result = opts.test(current, opts.locale);
    if (result.match && result.resolvedTo) {
      matchedRedirect = true;
      matchType ??= result.matchType;
      const next = result.resolvedTo.trim();
      hops.push(next);
      if (isExternalUrl(next)) {
        const lookup = await opts.lookup(next);
        return {
          hops,
          finalUrl: next,
          pageExists: false,
          matchedRedirect,
          matchType,
          destExists: lookup.exists,
          external: true,
          entry: lookup.entry,
          loop: false,
        };
      }
      const nextPath = normalizeRuntimePath(next);
      // Case-only canonicalization (Colombia → colombia): same probe key must not
      // count as a cycle — settle on the destination and evaluate it once.
      if (probeUrlKey(nextPath) === key) {
        const destResult = opts.test(nextPath, opts.locale);
        const lookup = await opts.lookup(nextPath);
        if (destResult.pageExists) {
          return {
            hops,
            finalUrl: nextPath,
            pageExists: true,
            matchedRedirect,
            matchType,
            destExists: lookup.exists,
            external: false,
            entry: lookup.entry,
            loop: false,
          };
        }
        return {
          hops,
          finalUrl: nextPath,
          pageExists: false,
          matchedRedirect,
          matchType,
          destExists: lookup.exists,
          external: lookup.external,
          entry: lookup.entry,
          loop: false,
        };
      }
      current = nextPath;
      continue;
    }

    if (result.pageExists) {
      const lookup = await opts.lookup(current);
      return {
        hops,
        finalUrl: current,
        pageExists: true,
        matchedRedirect,
        matchType,
        destExists: lookup.exists,
        external: false,
        entry: lookup.entry,
        loop: false,
      };
    }

    const lookup = await opts.lookup(current);
    return {
      hops,
      finalUrl: current,
      pageExists: false,
      matchedRedirect,
      matchType,
      destExists: lookup.exists,
      external: lookup.external,
      entry: lookup.entry,
      loop: false,
    };
  }

  return {
    hops,
    finalUrl: current,
    pageExists: false,
    matchedRedirect,
    matchType,
    destExists: false,
    external: isExternalUrl(current),
    loop: true,
  };
}

export interface HttpWalkResult {
  hops: string[];
  finalUrl: string;
  status: number | null;
  loop: boolean;
  error?: string;
}

function probeFetchHeaders(locale?: string): Record<string, string> {
  const headers: Record<string, string> = {
    "User-Agent": PROBE_USER_AGENT,
    Accept: "text/html,*/*",
  };
  const loc = locale?.trim().toLowerCase();
  if (loc) headers["Accept-Language"] = loc;
  return headers;
}

export async function walkHttpRedirects(opts: {
  startUrl: string;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
  /** Aligns live HTTP with index walk locale (path prefix + Accept-Language). */
  locale?: string;
}): Promise<HttpWalkResult> {
  const fetchFn = opts.fetchFn ?? fetch;
  const timeoutMs = opts.timeoutMs ?? PROBE_HTTP_TIMEOUT_MS;
  const fetchHeaders = probeFetchHeaders(opts.locale);
  const hops: string[] = [];
  const seen = new Set<string>();
  let current = opts.startUrl;

  for (let i = 0; i < MAX_PROBE_HOPS; i++) {
    const key = probeUrlKey(current);
    if (seen.has(key)) {
      return { hops, finalUrl: current, status: null, loop: true };
    }
    seen.add(key);
    hops.push(current);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchFn(current, {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        headers: fetchHeaders,
      });
      const status = res.status;
      if (status >= 300 && status < 400) {
        const location = res.headers.get("location");
        if (!location) {
          return { hops, finalUrl: current, status, loop: false, error: "redirect-without-location" };
        }
        const next = new URL(location, current).href;
        // Case-only Location (…/Colombia → …/colombia): fetch destination once
        // instead of treating the shared probe key as a redirect cycle.
        if (probeUrlKey(next) === key) {
          hops.push(next);
          const settleController = new AbortController();
          const settleTimer = setTimeout(() => settleController.abort(), timeoutMs);
          try {
            const settled = await fetchFn(next, {
              method: "GET",
              redirect: "manual",
              signal: settleController.signal,
              headers: fetchHeaders,
            });
            const settledStatus = settled.status;
            if (settledStatus >= 300 && settledStatus < 400) {
              const settledLoc = settled.headers.get("location");
              if (!settledLoc) {
                return {
                  hops,
                  finalUrl: next,
                  status: settledStatus,
                  loop: false,
                  error: "redirect-without-location",
                };
              }
              const next2 = new URL(settledLoc, next).href;
              if (probeUrlKey(next2) === probeUrlKey(next)) {
                return { hops, finalUrl: next, status: settledStatus, loop: false };
              }
              current = next2;
              continue;
            }
            return { hops, finalUrl: next, status: settledStatus, loop: false };
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return { hops, finalUrl: next, status: null, loop: false, error: message };
          } finally {
            clearTimeout(settleTimer);
          }
        }
        current = next;
        continue;
      }
      return { hops, finalUrl: current, status, loop: false };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { hops, finalUrl: current, status: null, loop: false, error: message };
    } finally {
      clearTimeout(timer);
    }
  }

  return { hops, finalUrl: current, status: null, loop: true };
}

export function combineProbeWalks(
  index: IndexWalkResult,
  http: HttpWalkResult,
  at = Date.now(),
): RuntimeIssueProbe {
  const chained = index.hops.length > 2;
  const httpOk = http.status != null && http.status >= 200 && http.status < 300;
  const pathsMatch = probePathsMatch(index.finalUrl, http.finalUrl);

  const base = {
    at,
    destination: index.finalUrl,
    chained: chained || undefined,
    hops: index.hops,
    httpStatus: http.status ?? undefined,
    matchType: index.matchType,
    entry: index.entry,
  };

  const done = (status: RuntimeIssueProbeStatus): RuntimeIssueProbe => ({
    ...base,
    status,
    destination:
      status === "not_found" && !index.matchedRedirect ? undefined : index.finalUrl,
  });

  if (index.loop || http.loop) return done("loop");

  if (index.external) {
    return httpOk ? done("redirect") : done("broken_redirect");
  }

  if (index.matchedRedirect && !index.destExists) {
    return done("broken_redirect");
  }

  if (!index.matchedRedirect && !index.pageExists) {
    if (!httpOk) return done("not_found");
    return done("mismatch");
  }

  if (!index.matchedRedirect && index.pageExists) {
    if (httpOk && pathsMatch) return done("page");
    return done("mismatch");
  }

  if (httpOk && pathsMatch && index.destExists) return done("redirect");
  return done("mismatch");
}

export interface ProbeRuntimePathInput {
  path: string;
  locale: string;
  origin: string;
  ci: ContentIndex;
  querySlugExists: QuerySlugExists;
  test?: (url: string, locale: string) => RedirectTestResult;
  fetchFn?: typeof fetch;
  now?: number;
}

export async function probeRuntimePath(input: ProbeRuntimePathInput): Promise<RuntimeIssueProbe> {
  const lookup = (url: string) => lookupDestination(url, input.ci, input.querySlugExists);
  const test = input.test ?? ((url, locale) => testRedirect(url, locale, input.ci));
  const index = await walkIndexRedirects({
    path: input.path,
    locale: input.locale,
    test,
    lookup,
  });
  const startPath = normalizeRuntimePath(input.path);
  const startUrl = isExternalUrl(input.path)
    ? input.path.trim()
    : `${input.origin.replace(/\/$/, "")}${startPath}`;
  const http = await walkHttpRedirects({
    startUrl,
    fetchFn: input.fetchFn,
    locale: input.locale,
  });
  return combineProbeWalks(index, http, input.now ?? Date.now());
}

export function requestOrigin(req: { protocol?: string; get: (name: string) => string | undefined }): string {
  const host = req.get("x-forwarded-host") || req.get("host") || "localhost:5000";
  const proto = req.get("x-forwarded-proto") || req.protocol || "http";
  return `${proto}://${host}`;
}
