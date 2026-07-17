/** In-memory cache for static content-type listing projections. */

interface StaticCacheEntry {
  items: Record<string, unknown>[];
  builtAt: number;
}

const staticListingCache = new Map<string, StaticCacheEntry>();

export function staticListingCacheKey(contentRoot: string, contentType: string): string {
  return `${contentRoot}::${contentType}`;
}

export function getStaticListingCache(
  contentRoot: string,
  contentType: string,
): Record<string, unknown>[] | null {
  const entry = staticListingCache.get(staticListingCacheKey(contentRoot, contentType));
  if (!entry) return null;
  return entry.items.map((item) => ({ ...item }));
}

export function setStaticListingCache(
  contentRoot: string,
  contentType: string,
  items: Record<string, unknown>[],
): void {
  staticListingCache.set(staticListingCacheKey(contentRoot, contentType), {
    items,
    builtAt: Date.now(),
  });
}

export function invalidateStaticListingCache(contentType?: string, contentRoot?: string): void {
  if (!contentType && !contentRoot) {
    staticListingCache.clear();
    return;
  }
  for (const key of staticListingCache.keys()) {
    const [root, type] = key.split("::");
    if (contentRoot && root !== contentRoot) continue;
    if (contentType && type !== contentType) continue;
    staticListingCache.delete(key);
  }
}
