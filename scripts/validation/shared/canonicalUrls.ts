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
 */
export function matchContentFilesForUrl(
  files: ContentFile[],
  url: string,
  parsed?: { contentType: string; slug: string; locale: string } | null,
): ContentFile[] {
  const normalizedTarget = normalizeUrl(url);
  const byCanonical = files.filter((file) => normalizeUrl(getCanonicalUrl(file)) === normalizedTarget);
  if (byCanonical.length > 0) return byCanonical;
  if (!parsed) return [];
  const byLocale = files.filter(
    (f) =>
      f.type === parsed.contentType &&
      f.slug === parsed.slug &&
      f.locale === parsed.locale,
  );
  if (byLocale.length > 0) return byLocale;
  return files.filter((f) => f.type === parsed.contentType && f.slug === parsed.slug);
}

export const STATIC_ROUTES = [
  "/",
  "/us",
  "/es",
  "/en/career-programs",
  "/es/programas-de-carrera",
  "/en/locations",
  "/es/ubicaciones",
  "/en/apply",
  "/es/aplica",
  "/dashboard",
  "/component-showcase",
];

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

  STATIC_ROUTES.forEach((route) => add(route));

  return validUrls;
}
