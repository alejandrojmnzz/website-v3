/**
 * Public HTML 200/404 for the SPA catch-all.
 * Uses the per-request site content index (same catalog as redirects), not the
 * global contentIndex singleton.
 */

export const STATIC_HTML_ROUTES = new Set([
  "/",
  "/en",
  "/en/",
  "/es",
  "/es/",
  "/en/apply",
  "/es/aplica",
  "/terms-conditions",
  "/terminos-condiciones",
  "/privacy-policy",
  "/politica-privacidad",
  "/preview-frame",
]);

const STATIC_PREFIXES = ["/private/", "/api/"];

export interface KnownUrlIndex {
  isKnownUrl(url: string): boolean;
}

function cleanPath(url: string): string {
  return url.split("?")[0].split("#")[0];
}

/** True when this path should be HTTP 200 without asking the content index. */
export function isStaticPublicHtmlRoute(url: string): boolean {
  const path = cleanPath(url);
  if (STATIC_HTML_ROUTES.has(path)) return true;
  for (const prefix of STATIC_PREFIXES) {
    if (path.startsWith(prefix)) return true;
  }
  return false;
}

/**
 * Whether the catch-all should send 200 for this public HTML path.
 * Missing `contentIndex` is unknown (false) — do not fall back to a global catalog.
 */
export function isKnownPublicHtmlRoute(
  url: string,
  contentIndex?: KnownUrlIndex | null,
): boolean {
  if (isStaticPublicHtmlRoute(url)) return true;
  if (!contentIndex) return false;
  try {
    return contentIndex.isKnownUrl(cleanPath(url));
  } catch {
    return false;
  }
}

export function resolvePublicHtmlStatus(opts: {
  url: string;
  httpStatus?: number;
  contentIndex?: KnownUrlIndex | null;
}): number {
  if (typeof opts.httpStatus === "number") return opts.httpStatus;
  return isKnownPublicHtmlRoute(opts.url, opts.contentIndex) ? 200 : 404;
}
