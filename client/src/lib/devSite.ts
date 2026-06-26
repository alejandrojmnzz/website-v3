/**
 * DEV SITE OVERRIDE — client-side half of the file-based approach
 * ================================================================
 *
 * SINGLE SOURCE OF TRUTH: .local/dev-site-override (server-side file)
 * -----------------------------------------------------------------------
 * The active site domain is stored in a plain text file on the server.
 * siteResolutionMiddleware reads it synchronously on EVERY request, which
 * means SSR, API calls, and page navigations all resolve to the correct site.
 *
 * localStorage is a CLIENT-SIDE MIRROR only.
 * -----------------------------------------------------------------------
 * We keep a copy in localStorage so that injectDevSite() can append
 * ?__site=<domain> to all TanStack Query API fetches as belt-and-suspenders
 * (useful e.g. after HMR before a full reload clears the in-memory cache).
 * localStorage is NEVER the source of truth for site resolution — that is
 * always the server file.
 *
 * ⚠️  DO NOT REPLACE localStorage WITH COOKIES — EVER.
 * -----------------------------------------------------------------------
 * We spent significant time debugging a cookie-based approach. Here is why
 * cookies do not work in the Replit dev environment:
 *
 *   Replit's workspace embeds the app (worf.replit.dev) in an iframe inside
 *   replit.com. Modern browsers (Chrome 115+, Edge) treat the app's domain
 *   as a THIRD-PARTY origin relative to the top-level page (replit.com).
 *   In this context:
 *
 *   — document.cookie writes on the client are silently discarded.
 *   — Set-Cookie headers from server responses are silently discarded.
 *   — This applies to SameSite=Lax, SameSite=None; Secure, and every other
 *     cookie attribute combination. All were tested. All fail silently.
 *
 *   The symptom: /api/dev/set-site returns {"ok":true}, the server logs the
 *   call, but the cookie is never stored and never sent on the next request.
 *   The site switcher appears to do nothing.
 *
 *   localStorage is NOT subject to third-party cookie restrictions — it is
 *   scoped to the origin (worf.replit.dev) and always accessible from the
 *   app's own JavaScript, regardless of the iframe context.
 *
 * Write sequence (always in this order before window.location.reload()):
 *   1. localStorage.setItem(...)   ← synchronous, instant
 *   2. await fetch("/api/dev/set-site?domain=X")  ← server writes the file
 *   3. window.location.reload()   ← server now reads file on every request
 *
 * In production:
 *   getDevSiteOverride() always returns null. Site resolution is driven by
 *   req.hostname (the actual domain/subdomain). No override is possible.
 */

const IS_DEV = import.meta.env.DEV;
const LS_KEY = "__dev_site";

/**
 * Returns the active dev-site override domain, or null if none is set.
 * Reads from localStorage. Returns null in production builds.
 *
 * ⚠️  DO NOT read from document.cookie here — cookies are blocked in the
 * Replit iframe context. See the warning block at the top of this file.
 */
export function getDevSiteOverride(): string | null {
  if (!IS_DEV) return null;
  try {
    return localStorage.getItem(LS_KEY) || null;
  } catch { return null; }
}

/**
 * Sets the active dev-site override.
 *
 * Writes to localStorage (synchronous, for injectDevSite) and awaits the
 * server file write (so siteResolutionMiddleware sees the new domain on the
 * very next request). Both complete before the caller reloads the page.
 *
 * ⚠️  DO NOT change this to set a cookie. See the warning block above.
 */
export async function setDevSiteOverride(domain: string): Promise<void> {
  try { localStorage.setItem(LS_KEY, domain); } catch {}
  await fetch(`/api/dev/set-site?domain=${encodeURIComponent(domain)}`);
}

/**
 * Clears the active dev-site override.
 *
 * Removes from localStorage and awaits the server file deletion. Both
 * complete before the caller reloads the page.
 *
 * ⚠️  DO NOT change this to clear a cookie. See the warning block above.
 */
export async function clearDevSiteOverride(): Promise<void> {
  try { localStorage.removeItem(LS_KEY); } catch {}
  await fetch("/api/dev/clear-site");
}

/**
 * Appends ?__site=<domain> to a URL when a dev-site override is active.
 *
 * Called by the queryClient default fetcher on every API request. This is
 * belt-and-suspenders: the server file already handles site resolution, but
 * the query param makes explicit overrides work even in edge cases (e.g.
 * after HMR before a full reload, or for manual curl/Postman testing).
 *
 * No-ops in production (getDevSiteOverride() returns null).
 */
export function injectDevSite(url: string): string {
  const site = getDevSiteOverride();
  if (!site) return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}__site=${encodeURIComponent(site)}`;
}
