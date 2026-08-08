/**
 * Detached empty-locale detection for public surfaces, publish gates, and admin.
 */

import { isEmptyDetachedLocale, isEmptyLocaleContent } from "@shared/isEmptyLocaleContent";
import { isEntryDetached } from "./shared-layout-entry";
import type { ContentIndex } from "./content-index";

export { isEmptyLocaleContent, isEmptyDetachedLocale };

export function isEmptyDetachedLocaleEntry(opts: {
  contentType: string;
  slug: string;
  locale: string;
  contentRoot?: string;
  /** Required when `merged` is omitted (avoids circular import with ContentIndex). */
  ci?: ContentIndex;
  /** Preloaded merged data; if omitted, loads via `ci`. */
  merged?: Record<string, unknown> | null;
}): boolean {
  const { contentType, slug, locale, contentRoot } = opts;
  const detached = isEntryDetached(contentType, slug, contentRoot);
  if (!detached) return false;

  let merged = opts.merged;
  if (merged === undefined) {
    if (!opts.ci) {
      throw new Error("isEmptyDetachedLocaleEntry: pass ci or merged");
    }
    try {
      const result = opts.ci.loadMergedContent(contentType, slug, locale);
      merged = (result?.data as Record<string, unknown> | null) ?? null;
    } catch {
      merged = null;
    }
  }
  return isEmptyDetachedLocale({ detached: true, merged });
}

export type LocaleUnavailablePayload = {
  error: "locale_unavailable";
  code: "EMPTY_LOCALE";
  message: string;
  contentType: string;
  slug: string;
  locale: string;
  available_locales: Record<string, string>;
  robots: "noindex";
};

export function buildLocaleUnavailablePayload(opts: {
  contentType: string;
  slug: string;
  locale: string;
  availableUrls: Record<string, string>;
}): LocaleUnavailablePayload {
  const available = { ...opts.availableUrls };
  delete available[opts.locale];
  return {
    error: "locale_unavailable",
    code: "EMPTY_LOCALE",
    message: `This content is not available in "${opts.locale}". Choose another language.`,
    contentType: opts.contentType,
    slug: opts.slug,
    locale: opts.locale,
    available_locales: available,
    robots: "noindex",
  };
}
