/**
 * Helpers for schema_org sections: leading order, type checks, companion counting.
 */

export const SCHEMA_ORG_SECTION_TYPE = "schema_org";

/** Section types that contribute JSON-LD via server/schema-components. */
export const SCHEMA_ORG_CONTRIBUTOR_TYPES = new Set([
  SCHEMA_ORG_SECTION_TYPE,
  "faq",
  "article",
  "breadcrumb",
]);

export function isSchemaOrgSection(section: unknown): boolean {
  return (
    !!section &&
    typeof section === "object" &&
    String((section as Record<string, unknown>).type ?? "") === SCHEMA_ORG_SECTION_TYPE
  );
}

/** True if any section can emit structured data (schema_org / faq / article / breadcrumb). */
export function hasSchemaOrgContributors(sections: Array<unknown> | undefined | null): boolean {
  if (!Array.isArray(sections)) return false;
  return sections.some((s) => {
    if (!s || typeof s !== "object") return false;
    return SCHEMA_ORG_CONTRIBUTOR_TYPES.has(String((s as Record<string, unknown>).type ?? ""));
  });
}

export function getSchemaOrgType(section: Record<string, unknown>): string {
  const raw = section.schema_type ?? (section as { schemaType?: unknown }).schemaType;
  return typeof raw === "string" ? raw : "";
}

/** Count merged schema_org sections whose schema_type matches (bindings/merged list). */
export function countSchemaOrgOfType(
  sections: Array<Record<string, unknown>>,
  schemaType: string,
): number {
  let n = 0;
  for (const s of sections) {
    if (!isSchemaOrgSection(s)) continue;
    if (getSchemaOrgType(s) === schemaType) n += 1;
  }
  return n;
}

/**
 * Move all schema_org sections to a contiguous leading block, preserving
 * relative order among schema_org and among non-schema_org sections.
 */
export function clampSchemaOrgSectionsLeading<T>(sections: T[]): T[] {
  if (!Array.isArray(sections) || sections.length === 0) return sections;
  const leading: T[] = [];
  const rest: T[] = [];
  for (const s of sections) {
    if (isSchemaOrgSection(s)) leading.push(s);
    else rest.push(s);
  }
  if (leading.length === 0) return sections;
  // Already contiguous at front?
  let i = 0;
  while (i < sections.length && isSchemaOrgSection(sections[i])) i += 1;
  const alreadyLeading = i === leading.length;
  if (alreadyLeading) return sections;
  return [...leading, ...rest];
}

/** Index where a new schema_org section should be inserted (after existing leading ones). */
export function schemaOrgInsertIndex(sections: Array<unknown>): number {
  let i = 0;
  while (i < sections.length && isSchemaOrgSection(sections[i])) i += 1;
  return i;
}
