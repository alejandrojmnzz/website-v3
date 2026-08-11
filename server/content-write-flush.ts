/**
 * Shared post-write flush for content edits (single-edit and bulk-meta).
 * Call immediately after one successful edit, or once at end of a bulk batch.
 */

import type { ContentIndex } from "./content-index";
import { clearRedirectCache } from "./redirects";
import {
  refreshSitemapEntry,
  refreshSitemapEntriesForContentKey,
} from "./sitemap";
import { invalidateContentCaches } from "./routes/_helpers";
import { getSupportedLocales } from "./settings";

export type SitemapFlushEntry = {
  contentType: string;
  slug: string;
  locale: string;
};

export type FlushAfterContentWritesOpts = {
  ci: ContentIndex;
  /** Distinct content types touched (cache invalidation). */
  contentTypes: Iterable<string>;
  /** Entries that need sitemap refresh. */
  sitemapEntries: SitemapFlushEntry[];
  /**
   * When true (common-meta / _common.yml touched), refresh all locales per
   * content key instead of a single locale row.
   */
  commonMetaTouched?: boolean;
};

/**
 * Coalesce expensive post-write side effects: redirect cache, CI refresh,
 * content caches, sitemap. Does not mark files modified or enqueue previews.
 */
export function flushAfterContentWrites(opts: FlushAfterContentWritesOpts): void {
  const types = [...new Set([...opts.contentTypes].filter(Boolean))];
  clearRedirectCache();
  opts.ci.refresh();
  if (types.length === 0) {
    invalidateContentCaches(undefined, opts.ci);
  } else {
    for (const contentType of types) {
      invalidateContentCaches(contentType, opts.ci);
    }
  }

  const locales = getSupportedLocales();
  const seenKeys = new Set<string>();
  for (const entry of opts.sitemapEntries) {
    if (opts.commonMetaTouched) {
      const key = `${entry.contentType}/${entry.slug}`;
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      refreshSitemapEntriesForContentKey(entry.contentType, entry.slug, locales);
    } else {
      const key = `${entry.contentType}/${entry.slug}/${entry.locale}`;
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      refreshSitemapEntry(entry.contentType, entry.slug, entry.locale);
    }
  }
}
