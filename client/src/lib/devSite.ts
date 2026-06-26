/**
 * DEV SITE OVERRIDE — COOKIE-BASED (single source of truth)
 *
 * IMPORTANT: Do NOT replace this with localStorage or any other client-only
 * storage mechanism. Here is why cookies are required:
 *
 *   The server reads `req.cookies.__dev_site` in siteResolutionMiddleware
 *   (server/site-manager.ts) on EVERY request, including the initial HTML
 *   GET that produces SSR output. Only a cookie is sent automatically with
 *   every HTTP request — localStorage is invisible to the server.
 *
 *   If you switch to localStorage, the server will always SSR the default
 *   site regardless of the override, so the page will flash wrong content
 *   on every load. This was the exact regression introduced in commit
 *   20a8d9ee ("Replace cookie-based dev site overrides with localStorage")
 *   and subsequently fixed.
 *
 * HOW IT WORKS:
 *   setDevSiteOverride(domain) → writes cookie → page reloads
 *   Server reads cookie on GET / → SSRs correct site from first byte
 *   getDevSiteOverride() reads same cookie → client and server always agree
 *   injectDevSite() appends ?__site= as belt-and-suspenders for API calls
 *   (redundant since the cookie is already sent, but harmless)
 *
 * PRODUCTION:
 *   getDevSiteOverride() returns null when import.meta.env.DEV is false,
 *   so none of this runs in production builds.
 */

const IS_DEV = import.meta.env.DEV;

/** Returns the active dev-site override domain, or null if none is set. */
export function getDevSiteOverride(): string | null {
  if (!IS_DEV) return null;
  try {
    const match = document.cookie.match(/(?:^|;)\s*__dev_site=([^;]*)/);
    return match ? decodeURIComponent(match[1]) : null;
  } catch { return null; }
}

/**
 * Sets the active dev-site override.
 * Uses a server-side endpoint so Set-Cookie headers bypass any browser
 * restrictions on document.cookie writes in iframe environments (e.g. Replit
 * workspace preview). Returns a promise that resolves when the cookie is set.
 */
export async function setDevSiteOverride(domain: string): Promise<void> {
  await fetch(`/api/dev/set-site?domain=${encodeURIComponent(domain)}`);
}

/**
 * Clears the active dev-site override cookie.
 * Server-side, same reason as setDevSiteOverride.
 */
export async function clearDevSiteOverride(): Promise<void> {
  await fetch("/api/dev/clear-site");
}

/**
 * Appends ?__site=<domain> to a URL when a dev-site override is active.
 * This is belt-and-suspenders — the cookie is already sent with every
 * request so the server would resolve the correct site without this param.
 * Kept to make the override explicit and debuggable in network logs.
 */
export function injectDevSite(url: string): string {
  const site = getDevSiteOverride();
  if (!site) return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}__site=${encodeURIComponent(site)}`;
}
