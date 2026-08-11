/**
 * FAQ listing contract: reject section-level related_features.
 * Topics belong in dynamic_entries.permanent_filters.
 */

export function validateFaqListingSections(
  doc: Record<string, unknown>,
): string | null {
  const sections = doc.sections;
  if (!Array.isArray(sections)) return null;

  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];
    if (!section || typeof section !== "object" || Array.isArray(section)) continue;
    const sec = section as Record<string, unknown>;
    if (sec.type !== "faq") continue;
    if (
      Object.prototype.hasOwnProperty.call(sec, "related_features") &&
      sec.related_features != null
    ) {
      return (
        `FAQ section at index ${i} has root "related_features". ` +
        `Use dynamic_entries.permanent_filters with item_property_slug "related_features" instead ` +
        `(listing contract). Section-level related_features is rejected.`
      );
    }
  }
  return null;
}
