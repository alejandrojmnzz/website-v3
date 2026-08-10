/**
 * Pure check: merged locale payload has no sections and no body content.
 * Callers decide detached-only / public filtering using isEntryDetached.
 */

export function isEmptyLocaleContent(merged: Record<string, unknown> | null | undefined): boolean {
  if (!merged || typeof merged !== "object") return true;

  const sections = merged.sections;
  const hasSections = Array.isArray(sections) && sections.length > 0;

  const content = merged.content;
  const hasContent =
    typeof content === "string" && content.trim().length > 0;

  return !hasSections && !hasContent;
}

/**
 * Empty for public/publish purposes: detached entry + empty merged locale content.
 */
export function isEmptyDetachedLocale(args: {
  detached: boolean;
  merged: Record<string, unknown> | null | undefined;
}): boolean {
  if (!args.detached) return false;
  return isEmptyLocaleContent(args.merged);
}
