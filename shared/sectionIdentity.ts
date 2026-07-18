/**
 * Canonical section identity.
 *
 * Historically sections carried two identifiers:
 *   - `section_id` — the original, public `#anchor` id (links, DOM, bindings)
 *   - `id`         — a later internal id used by the shared-template merge model
 *
 * They are now consolidated: `section_id` is the single canonical identity for
 * both roles. `id` remains supported as a read-only legacy alias so that
 * not-yet-migrated YAML keeps working; nothing should write `id` anymore.
 */

type SectionLike = Record<string, unknown> | null | undefined;

/** Canonical identity of a section: `section_id`, falling back to legacy `id`. */
export function canonicalSectionId(s: SectionLike): string | undefined {
  if (!s || typeof s !== "object") return undefined;
  if (typeof s.section_id === "string" && s.section_id) return s.section_id;
  if (typeof s.id === "string" && s.id) return s.id;
  return undefined;
}

/**
 * All identity values a section answers to (canonical first, legacy alias second).
 * Useful when matching references that may have been written against either field.
 */
export function sectionIdCandidates(s: SectionLike): string[] {
  if (!s || typeof s !== "object") return [];
  const out: string[] = [];
  if (typeof s.section_id === "string" && s.section_id) out.push(s.section_id);
  if (typeof s.id === "string" && s.id && !out.includes(s.id)) out.push(s.id);
  return out;
}

/** True when the section carries `id` under either identity field. */
export function sectionMatchesId(s: SectionLike, id: string | null | undefined): boolean {
  if (!id) return false;
  return sectionIdCandidates(s).includes(id);
}
