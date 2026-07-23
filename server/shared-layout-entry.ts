/**
 * Shared-layout + detach helpers used by versioning, loaders, and editors.
 * DB-backed and single_template types share the same rules.
 */

import fs from "fs";
import path from "path";
import { getContentTypeConfig, getFolder } from "./content-types";
import { contentIndex } from "./content-index";
import { getDefaultContentRoot } from "./site-config";

/** Sentinel content slug for type-level (template) versioning APIs and paths. */
export const TEMPLATE_VERSIONING_SLUG = "single";

export function isSharedLayoutType(
  contentType: string,
  contentRoot?: string,
): boolean {
  const config = getContentTypeConfig(contentType, contentRoot);
  if (!config) return false;
  // DB always implies shared layout even if single_template flag is missing
  return !!(config.database?.slug || config.single_template);
}

export function getEntryCommonPath(
  contentType: string,
  slug: string,
  contentRoot?: string,
): string {
  const root = contentRoot ?? getDefaultContentRoot();
  const folder = getFolder(contentType, root);
  return path.join(root, folder, slug, "_common.yml");
}

/**
 * True when `{slug}/_common.yml` has `detached: true`.
 * Detached entries own full structure and use entry-level Page Versions.
 */
export function isEntryDetached(
  contentType: string,
  slug: string,
  contentRoot?: string,
): boolean {
  if (!slug || slug === TEMPLATE_VERSIONING_SLUG) return false;
  if (!isSharedLayoutType(contentType, contentRoot)) return false;

  const commonPath = getEntryCommonPath(contentType, slug, contentRoot);
  if (!fs.existsSync(commonPath)) return false;

  try {
    const raw = fs.readFileSync(commonPath, "utf-8");
    const parsed = contentIndex.safeYamlLoad(raw) as Record<string, unknown> | null;
    return parsed?.detached === true;
  } catch {
    return false;
  }
}

/**
 * Versioning identity for an entry page:
 * - attached shared-layout → template (`single`)
 * - detached or non-shared → entry slug
 */
export function versioningContentSlug(
  contentType: string,
  entrySlug: string,
  contentRoot?: string,
): string {
  if (
    isSharedLayoutType(contentType, contentRoot) &&
    !isEntryDetached(contentType, entrySlug, contentRoot)
  ) {
    return TEMPLATE_VERSIONING_SLUG;
  }
  return entrySlug;
}

/** True when versioning APIs should use type-root paths (template mode). */
export function isTemplateVersioningSlug(contentSlug: string): boolean {
  return contentSlug === TEMPLATE_VERSIONING_SLUG;
}

/**
 * Attached shared-layout entries must not carry structural overlays.
 * Returns an error message if `sections` or `layout` are present.
 */
export function attachedOverlayStructureError(
  data: Record<string, unknown> | null | undefined,
): string | null {
  if (!data || typeof data !== "object") return null;
  if (Array.isArray(data.sections) && data.sections.length > 0) {
    return "Attached shared-layout entries cannot include sections; detach the entry or edit the shared template.";
  }
  if (data.layout !== undefined && data.layout !== null) {
    return "Attached shared-layout entries cannot override layout/menu; detach the entry or edit the content-type default.";
  }
  return null;
}

/** Strip sections + layout for hard re-attach / compliance. */
export function stripStructuralOverlayKeys<T extends Record<string, unknown>>(
  data: T,
): T {
  const { sections: _s, layout: _l, ...rest } = data;
  return rest as T;
}

const ATTACHED_STRUCTURAL_MSG =
  "Attached shared-layout entries cannot change structure or layout; detach the entry or edit the shared template.";

/**
 * When attached (shared-layout and not detached), returns an error message
 * for structural overlay ops. Otherwise null.
 */
export function rejectAttachedStructuralEdit(
  contentType: string,
  slug: string,
  contentRoot?: string,
): string | null {
  if (!slug || isTemplateVersioningSlug(slug)) return null;
  if (!isSharedLayoutType(contentType, contentRoot)) return null;
  if (isEntryDetached(contentType, slug, contentRoot)) return null;
  return ATTACHED_STRUCTURAL_MSG;
}

/** True when entry may receive per-entry section overlays / layout overrides. */
export function allowEntryStructuralOverrides(
  contentType: string,
  slug: string,
  contentRoot?: string,
): boolean {
  return rejectAttachedStructuralEdit(contentType, slug, contentRoot) == null;
}
