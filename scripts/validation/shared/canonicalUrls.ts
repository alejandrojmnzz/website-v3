/**
 * Canonical URL Helpers
 * 
 * Utilities for generating and validating canonical URLs for content.
 */

import type { ContentFile } from "./types";
import { contentIndex } from "../../../server/content-index";

export function getCanonicalUrl(file: ContentFile): string {
  if (file.url) return file.url;
  const locale = file.locale === "_common" ? "en" : file.locale;
  // Prefer locale URLs that resolve pattern params (e.g. blog :category).
  const localeUrls = contentIndex.getLocaleUrls(file.slug, file.type);
  if (localeUrls[locale]) return localeUrls[locale];
  return contentIndex.buildUrl(file.type, locale, file.slug);
}

/** Path-only key for public URL lookups (drops query/hash, trailing slash, case). */
export function normalizeUrl(url: string): string {
  let normalized = url.split("?")[0].split("#")[0];
  normalized = normalized.startsWith("/") ? normalized : `/${normalized}`;
  normalized = normalized.toLowerCase();
  if (normalized.length > 1 && normalized.endsWith("/")) {
    normalized = normalized.slice(0, -1);
  }
  return normalized || "/";
}

/**
 * Resolve content files for a diagnostics / run-page URL.
 * Matches canonical public paths first, then type+slug+locale from parseContentUrl
 * (covers unpublished drafts whose sitemap loc is /private/preview/...).
 *
 * When `variant` is set, prefer the published-variant row (`file.variant`);
 * when absent, prefer live rows (no `file.variant`).
 */
export function matchContentFilesForUrl(
  files: ContentFile[],
  url: string,
  parsed?: { contentType: string; slug: string; locale: string } | null,
  variant?: string | null,
): ContentFile[] {
  const normalizedTarget = normalizeUrl(url);
  let matched = files.filter((file) => normalizeUrl(getCanonicalUrl(file)) === normalizedTarget);
  if (matched.length === 0 && parsed) {
    const byLocale = files.filter(
      (f) =>
        f.type === parsed.contentType &&
        f.slug === parsed.slug &&
        f.locale === parsed.locale,
    );
    matched = byLocale.length > 0
      ? byLocale
      : files.filter((f) => f.type === parsed.contentType && f.slug === parsed.slug);
  }
  if (matched.length === 0) return [];

  if (variant) {
    const forVariant = matched.filter((f) => f.variant === variant);
    if (forVariant.length > 0) return forVariant;
    // Variant requested but not loaded as ContentFile (allocation 0 / missing)
    return [];
  }

  const live = matched.filter((f) => !f.variant);
  return live.length > 0 ? live : matched.filter((f) => f.isDraft);
}

/**
 * Live URLs for redirect overwrite checks come from content files / content index only.
 * Locale-home aliases (`/`, `/en`, `/es`, `/us`) are never injected here — see
 * `@shared/public-app-routes` and `isLiveContentUrl`.
 */
export function buildValidUrlSet(contentFiles: ContentFile[]): Set<string> {
  const validUrls = new Set<string>();

  const add = (url: string | undefined) => {
    if (!url) return;
    validUrls.add(url);
    validUrls.add(normalizeUrl(url));
  };

  // Folder slug plus any per-locale YAML slug override. Routing resolves both
  // (localeSlugMap), so /en/apply and /es/aplica must both count as known.
  const slugsByEntry = new Map<string, Set<string>>();
  for (const file of contentFiles) {
    const key = `${file.type}:${file.slug}`;
    const slugs = slugsByEntry.get(key) ?? new Set<string>();
    slugs.add(file.slug);
    const localeSlug = file.entryFields?.slug;
    if (typeof localeSlug === "string" && localeSlug.trim()) {
      slugs.add(localeSlug.trim());
    }
    slugsByEntry.set(key, slugs);
  }

  for (const file of contentFiles) {
    add(getCanonicalUrl(file));
    const locale = file.locale === "_common" ? "en" : file.locale;
    for (const slug of slugsByEntry.get(`${file.type}:${file.slug}`) ?? [file.slug]) {
      add(contentIndex.buildUrl(file.type, locale, slug));
    }
  }

  return validUrls;
}
