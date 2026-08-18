export type SitemapLocaleEntry = {
  locale?: string;
};

/**
 * Keep rows whose sitemap `locale` matches. URL prefixes like `/us/` are
 * ignored — English pages tagged `locale: "en"` stay in the EN list even when
 * their path is `/us/...`. Rows with no locale (e.g. Home) stay in every list.
 */
export function filterSitemapUrlsByLocale<T extends SitemapLocaleEntry>(
  urls: T[],
  locale: string | undefined,
): T[] {
  const wanted = locale?.trim().toLowerCase();
  if (!wanted) return urls;
  return urls.filter((entry) => {
    const entryLocale = entry.locale?.toLowerCase();
    return !entryLocale || entryLocale === wanted;
  });
}
