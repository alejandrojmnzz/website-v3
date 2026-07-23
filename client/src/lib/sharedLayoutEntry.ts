/** Client helpers mirroring server shared-layout / versioning slug rules. */

export const TEMPLATE_VERSIONING_SLUG = "single";

export function isSharedLayoutType(info: {
  has_database?: boolean;
  single_template?: boolean;
} | null | undefined): boolean {
  return !!(info?.has_database || info?.single_template);
}

/**
 * Versioning API slug for an entry:
 * - attached shared-layout → `single`
 * - detached or non-shared → entry slug
 */
export function versioningContentSlug(
  entrySlug: string,
  opts: { isSharedLayout: boolean; isDetached: boolean },
): string {
  if (opts.isSharedLayout && !opts.isDetached) {
    return TEMPLATE_VERSIONING_SLUG;
  }
  return entrySlug;
}

/** True when entry may receive per-entry section overlays / layout overrides. */
export function allowEntryStructuralOverrides(opts: {
  isSharedLayout: boolean;
  isDetached: boolean;
}): boolean {
  if (!opts.isSharedLayout) return true;
  return opts.isDetached;
}
