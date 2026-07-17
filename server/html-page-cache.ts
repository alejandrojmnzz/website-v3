/**
 * In-memory LRU cache for fully rendered anonymous HTML pages.
 * Keyed by site + path (+ locale when present in the path).
 * Invalidated on content sync / cache clear; TTL is a safety net.
 */

export interface CachedHtmlPage {
  html: string;
  status: number;
  expiresAt: number;
}

const TTL_MS = 5 * 60 * 1000;
const MAX_ENTRIES = 250;

const cache = new Map<string, CachedHtmlPage>();

export function buildHtmlCacheKey(
  siteId: string,
  pathname: string,
): string {
  const clean = pathname.split("?")[0].split("#")[0] || "/";
  return `${siteId}::${clean}`;
}

export function getCachedHtml(key: string): CachedHtmlPage | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  // Refresh LRU order
  cache.delete(key);
  cache.set(key, entry);
  return entry;
}

export function setCachedHtml(
  key: string,
  html: string,
  status: number,
): void {
  if (cache.has(key)) cache.delete(key);
  cache.set(key, {
    html,
    status,
    expiresAt: Date.now() + TTL_MS,
  });
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

export function invalidateHtmlPageCache(): void {
  cache.clear();
}

export function htmlPageCacheSize(): number {
  return cache.size;
}

/** Skip caching personalized / editor / authenticated document requests. */
export function shouldBypassHtmlCache(req: {
  method?: string;
  headers: Record<string, unknown> | { get?(name: string): string | undefined; cookie?: string; authorization?: string };
  originalUrl?: string;
  url?: string;
}): boolean {
  const method = (req.method || "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD") return true;

  const url = req.originalUrl || req.url || "";
  if (url.includes("edit_mode=") || url.includes("edit=1") || url.includes("__site=")) {
    return true;
  }

  const headers = req.headers as {
    get?(name: string): string | undefined;
    cookie?: string | string[];
    authorization?: string | string[];
  };

  const cookieRaw =
    typeof headers.get === "function"
      ? headers.get("cookie")
      : Array.isArray(headers.cookie)
        ? headers.cookie.join("; ")
        : headers.cookie;
  const cookie = typeof cookieRaw === "string" ? cookieRaw : "";
  if (
    cookie &&
    (/debug[_-]?token/i.test(cookie) ||
      /session/i.test(cookie) ||
      /auth/i.test(cookie) ||
      /edit[_-]?mode/i.test(cookie))
  ) {
    return true;
  }

  const authRaw =
    typeof headers.get === "function"
      ? headers.get("authorization")
      : Array.isArray(headers.authorization)
        ? headers.authorization[0]
        : headers.authorization;
  if (authRaw) return true;

  const debugToken =
    typeof headers.get === "function"
      ? headers.get("x-debug-token")
      : undefined;
  if (debugToken) return true;

  return false;
}
