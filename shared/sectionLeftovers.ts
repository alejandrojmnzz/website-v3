/**
 * Typeless section leftovers vs valid shared-layout overlay patches.
 *
 * `update_field` must not create `sections[N]` when that index is missing.
 * Standalone / detached / template files own full sections (`type` required).
 * Attached overlays may store `{ section_id, …fields }` or `{ _remove: true }` without `type`.
 */

export function isInvalidSectionIndexError(err: unknown): boolean {
  return err instanceof Error && /^Section index \d+ does not exist/.test(err.message);
}

export function invalidSectionIndexMessage(index: number): string {
  return `Section index ${index} does not exist; reload and retry`;
}

/** `sections.N.field` → N, or null if the path is not a nested section field. */
export function sectionIndexFromUpdateFieldPath(pathStr: string): number | null {
  const m = pathStr.match(/^sections\.(\d+)\.(.+)$/);
  if (!m) return null;
  return Number(m[1]);
}

export function sectionSlotExists(
  content: Record<string, unknown>,
  index: number,
): boolean {
  const sections = content.sections;
  if (!Array.isArray(sections) || index < 0 || index >= sections.length) return false;
  const slot = sections[index];
  return slot != null && typeof slot === "object" && !Array.isArray(slot);
}

/**
 * Keep this list item after a typeless scrub.
 * `ownsFullStructure`: standalone page, detached entry, or `single.*.yml`.
 */
export function keepSectionAfterTypelessScrub(
  s: unknown,
  ownsFullStructure: boolean,
): s is Record<string, unknown> {
  if (!s || typeof s !== "object" || Array.isArray(s)) return false;
  const rec = s as Record<string, unknown>;
  if (ownsFullStructure) {
    return (typeof rec.type === "string" && rec.type.length > 0) || rec._remove === true;
  }
  return !!(
    (typeof rec.type === "string" && rec.type.length > 0) ||
    rec.section_id ||
    rec.id ||
    rec._remove ||
    rec._perEntrySource
  );
}

/** Attached overlay: typeless + identity/_remove is a real patch, not a leftover. */
export function isValidAttachedOverlayPatch(s: Record<string, unknown>): boolean {
  if (typeof s.type === "string" && s.type.length > 0) return false;
  return !!(s.section_id || s.id || s._remove);
}

export function isIdentityLessTypelessStub(s: Record<string, unknown>): boolean {
  if (typeof s.type === "string" && s.type.length > 0) return false;
  return !s.section_id && !s.id && !s._remove && !s._perEntrySource;
}
