/**
 * DEV SITE OVERRIDE
 *
 * Storage strategy in the Replit dev environment:
 *
 *   localStorage  — primary storage for the active override domain.
 *                   localStorage is NOT affected by cross-origin iframe cookie
 *                   restrictions (the Replit workspace embeds the app at
 *                   worf.replit.dev inside replit.com). Cookies set by both
 *                   document.cookie and server Set-Cookie headers are blocked
 *                   by the browser's third-party cookie policy in this context.
 *
 *   __dev_site    — server-side cookie set by /api/dev/set-site as
 *   cookie          belt-and-suspenders for environments where cookies DO work
 *                   (e.g. non-iframe opens of the dev URL, local dev without
 *                   Replit workspace). The server reads it in
 *                   siteResolutionMiddleware for SSR site resolution.
 *
 * HOW SITE SWITCHING WORKS IN THE REPLIT IFRAME:
 *   1. User selects a site in SwitchSiteModal
 *   2. setDevSiteOverride(domain) → localStorage.setItem + /api/dev/set-site
 *   3. window.location.reload()
 *   4. On reload, getDevSiteOverride() → reads localStorage → "4geeks.com"
 *   5. injectDevSite() appends ?__site=4geeks.com to ALL API fetches (via
 *      queryClient default fetcher)
 *   6. /api/site/info?__site=4geeks.com → {domain:"4geeks.com",isDevOverride:true}
 *   7. DebugBubble shows correct site ✅
 *
 * NOTE: SSR will still render the default site (fl.4geeks.com) on first load
 * because the initial HTML GET doesn't carry the override (cookies are blocked).
 * This is acceptable for a dev-only tool — the content loaded via client API
 * calls will be from the correct site.
 *
 * PRODUCTION:
 *   getDevSiteOverride() returns null when import.meta.env.DEV is false,
 *   so none of this runs in production builds.
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
 * Writes to localStorage (primary, works in iframe) and calls the server
 * endpoint to also set a cookie (belt-and-suspenders for non-iframe contexts).
 */
export async function setDevSiteOverride(domain: string): Promise<void> {
  try { localStorage.setItem(LS_KEY, domain); } catch {}
  try { await fetch(`/api/dev/set-site?domain=${encodeURIComponent(domain)}`); } catch {}
}

/**
 * Clears the active dev-site override.
 */
export async function clearDevSiteOverride(): Promise<void> {
  try { localStorage.removeItem(LS_KEY); } catch {}
  try { await fetch("/api/dev/clear-site"); } catch {}
}

/**
 * Appends ?__site=<domain> to a URL when a dev-site override is active.
 * Called by the queryClient default fetcher on every API request so the
 * server resolves the correct site regardless of cookie availability.
 */
export function injectDevSite(url: string): string {
  const site = getDevSiteOverride();
  if (!site) return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}__site=${encodeURIComponent(site)}`;
}
