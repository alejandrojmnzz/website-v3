/**
 * Entry keys for the validation issue store.
 * Format: `{contentType}/{slug}/{locale}` e.g. `program/ai-engineering/en`
 * Published variants: `{contentType}/{slug}/{locale}@{variantSlug}`
 * e.g. `landing/foo/es@draft`
 */

import type { ContentFile } from "./types";

export type ParsedEntryKey = {
  contentType: string;
  slug: string;
  locale: string;
  variant?: string;
};

export function buildEntryKey(
  contentType: string,
  slug: string,
  locale: string,
  variant?: string | null,
): string {
  const loc = !locale || locale === "_common" ? "en" : locale;
  const base = `${contentType}/${slug}/${loc}`;
  if (variant && variant !== "default") {
    return `${base}@${variant}`;
  }
  return base;
}

export function entryKeyFromContentFile(file: ContentFile): string {
  return buildEntryKey(file.type, file.slug, file.locale, file.variant);
}

export function parseEntryKey(entryKey: string): ParsedEntryKey | null {
  if (!entryKey) return null;
  let variant: string | undefined;
  let withoutVariant = entryKey;
  const at = entryKey.lastIndexOf("@");
  if (at >= 0) {
    variant = entryKey.slice(at + 1) || undefined;
    withoutVariant = entryKey.slice(0, at);
  }
  const parts = withoutVariant.split("/");
  if (parts.length < 3) return null;
  const locale = parts[parts.length - 1]!;
  const slug = parts[parts.length - 2]!;
  const contentType = parts.slice(0, -2).join("/");
  if (!contentType || !slug || !locale) return null;
  return { contentType, slug, locale, ...(variant ? { variant } : {}) };
}

/** Layer label for UI: live vs variant slug from entry key. */
export function entryKeyLayerLabel(entryKey: string): string {
  const parsed = parseEntryKey(entryKey);
  if (!parsed) return "live";
  return parsed.variant ? `variant: ${parsed.variant}` : "live";
}
