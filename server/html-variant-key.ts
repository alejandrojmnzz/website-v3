/**
 * Resolve the effective HTML-cache variant key for a document request.
 * Must run before HTML cache lookup so HIT/MISS is per A/B variant.
 */

import type { Request, Response } from "express";
import { contentIndex } from "./content-index";
import { versioningContentSlug } from "./shared-layout-entry";
import {
  getVersioningManager,
  readUserId,
  getVersioningCookie,
  setVersioningCookie,
} from "./versioning";

function getQueryParam(url: string, name: string): string | null {
  const q = url.includes("?") ? url.slice(url.indexOf("?") + 1) : "";
  if (!q) return null;
  try {
    return new URLSearchParams(q).get(name);
  } catch {
    return null;
  }
}

function requestHasAuthToken(req: Request): boolean {
  const auth = req.headers.authorization;
  if (typeof auth === "string" && auth.trim()) return true;
  const debug = req.headers["x-debug-token"];
  if (typeof debug === "string" && debug.trim()) return true;
  return false;
}

/**
 * Returns `live` or a traffic-assigned / force_variant slug for cache keying.
 * Sets sticky cookie when assigning (same as page loaders).
 */
export function resolveHtmlVariantKey(req: Request, res: Response): string {
  const url = req.originalUrl || req.url || "/";
  const force =
    getQueryParam(url, "force_variant") || getQueryParam(url, "variant");
  if (force) return force;

  // Editors / authenticated: always live cache bucket (and usually bypass anyway)
  if (requestHasAuthToken(req)) return "live";

  const clean = url.split("?")[0].split("#")[0] || "/";
  const ci =
    ((res.locals as { site?: { contentIndex?: typeof contentIndex } }).site
      ?.contentIndex as typeof contentIndex | undefined) ?? contentIndex;

  let parsed: { contentType: string; slug: string; locale: string } | null = null;
  try {
    const resolved = ci.resolveUrl(clean);
    if (resolved) {
      parsed = {
        contentType: resolved.contentType,
        slug: resolved.slug,
        locale: resolved.patternLocale || "en",
      };
    } else {
      parsed = ci.parseContentUrl(clean);
    }
  } catch {
    parsed = null;
  }

  if (!parsed?.contentType || !parsed.slug) return "live";

  const root = (res.locals as { site?: { contentRoot?: string } }).site?.contentRoot;
  const versioningSlug = versioningContentSlug(parsed.contentType, parsed.slug, root);
  const locale = parsed.locale || "en";

  const userId = readUserId(req, res);
  const versioningCookie = getVersioningCookie(req);
  const existingAssignments = versioningCookie?.assignments || [];
  const existing = existingAssignments.find(
    (a) =>
      a.contentType === parsed!.contentType &&
      a.slug === versioningSlug &&
      a.locale === locale,
  );

  const versioningManager =
    ((res.locals as { site?: { versioningManager?: ReturnType<typeof getVersioningManager> } })
      .site?.versioningManager) ?? getVersioningManager();

  const assigned = versioningManager.getAssignment(
    parsed.contentType,
    versioningSlug,
    locale,
    userId,
    existing?.variantSlug,
  );

  if (!assigned) return "live";

  // Confirm variant file exists
  const content = versioningManager.getVariantContent(
    parsed.contentType,
    versioningSlug,
    assigned,
    locale,
  );
  if (!content) return "live";

  const updatedAssignments = [
    ...existingAssignments.filter(
      (a) =>
        !(
          a.contentType === parsed!.contentType &&
          a.slug === versioningSlug &&
          a.locale === locale
        ),
    ),
    {
      contentType: parsed.contentType,
      slug: versioningSlug,
      locale,
      variantSlug: assigned,
      assignedAt: Date.now(),
    },
  ];
  setVersioningCookie(res, userId, updatedAssignments);

  return assigned;
}
