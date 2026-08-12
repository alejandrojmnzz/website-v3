/**
 * Entry keys for the validation issue store.
 * Format: `{contentType}/{slug}/{locale}` e.g. `program/ai-engineering/en`
 */

import type { ContentFile } from "./types";

export function buildEntryKey(
  contentType: string,
  slug: string,
  locale: string,
): string {
  const loc = !locale || locale === "_common" ? "en" : locale;
  return `${contentType}/${slug}/${loc}`;
}

export function entryKeyFromContentFile(file: ContentFile): string {
  return buildEntryKey(file.type, file.slug, file.locale);
}

export function parseEntryKey(
  entryKey: string,
): { contentType: string; slug: string; locale: string } | null {
  const parts = entryKey.split("/");
  if (parts.length < 3) return null;
  const locale = parts[parts.length - 1]!;
  const slug = parts[parts.length - 2]!;
  const contentType = parts.slice(0, -2).join("/");
  if (!contentType || !slug || !locale) return null;
  return { contentType, slug, locale };
}
