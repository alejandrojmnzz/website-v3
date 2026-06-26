/**
 * DEV SITE OVERRIDE
 *
 * Single source of truth: .local/dev-site-override file on the server.
 * Written by setDevSiteOverride() via /api/dev/set-site (server writes the file).
 * Deleted by clearDevSiteOverride() via /api/dev/clear-site.
 * Read by siteResolutionMiddleware on every request — drives SSR + all API routing.
 *
 * localStorage mirror: written in lockstep with the server file so that
 * injectDevSite() can append ?__site= to API calls as belt-and-suspenders
 * (e.g. after HMR when TanStack Query re-fetches before a full reload clears
 * the cache). Both are always written together before window.location.reload().
 *
 * In production: getDevSiteOverride() always returns null — no override possible.
 * Production site resolution is driven entirely by req.hostname (subdomain/domain).
 */

const IS_DEV = import.meta.env.DEV;
const LS_KEY = "__dev_site";

/** Returns the active dev-site override domain, or null if none is set. */
export function getDevSiteOverride(): string | null {
  if (!IS_DEV) return null;
  try {
    return localStorage.getItem(LS_KEY) || null;
  } catch { return null; }
}

/**
 * Sets the active dev-site override.
 * 1. Writes to localStorage immediately (synchronous).
 * 2. Calls /api/dev/set-site so the server writes .local/dev-site-override.
 * Both must complete before the caller reloads the page.
 */
export async function setDevSiteOverride(domain: string): Promise<void> {
  try { localStorage.setItem(LS_KEY, domain); } catch {}
  await fetch(`/api/dev/set-site?domain=${encodeURIComponent(domain)}`);
}

/**
 * Clears the active dev-site override.
 * 1. Removes from localStorage immediately (synchronous).
 * 2. Calls /api/dev/clear-site so the server deletes .local/dev-site-override.
 * Both must complete before the caller reloads the page.
 */
export async function clearDevSiteOverride(): Promise<void> {
  try { localStorage.removeItem(LS_KEY); } catch {}
  await fetch("/api/dev/clear-site");
}

/**
 * Appends ?__site=<domain> to a URL when a dev-site override is active.
 * Called by the queryClient default fetcher on every API request so the
 * server resolves the correct site even if a cached query fires before
 * the next full page reload.
 */
export function injectDevSite(url: string): string {
  const site = getDevSiteOverride();
  if (!site) return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}__site=${encodeURIComponent(site)}`;
}
