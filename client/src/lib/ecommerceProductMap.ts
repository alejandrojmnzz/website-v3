/**
 * Client helper: load product map and register trackEcommerce lookup.
 */

import {
  setEcommerceProductLookup,
  type ProductLookup,
} from "@/lib/tracking";

export interface EcommerceProductMapEntry {
  product_id: string;
  name: string;
  content_type: string;
  content_slug: string;
  active: boolean;
}

let cachedMap: Map<string, EcommerceProductMapEntry> | null = null;
let loadPromise: Promise<Map<string, EcommerceProductMapEntry>> | null = null;

function buildLookup(map: Map<string, EcommerceProductMapEntry>): ProductLookup {
  return (programId: string) => {
    const bySlug = map.get(programId);
    if (bySlug) {
      return {
        product_id: bySlug.product_id,
        name: bySlug.name,
        active: bySlug.active,
        content_type: bySlug.content_type,
      };
    }
    // Also allow lookup by full product_id
    for (const entry of map.values()) {
      if (entry.product_id === programId) {
        return {
          product_id: entry.product_id,
          name: entry.name,
          active: entry.active,
          content_type: entry.content_type,
        };
      }
    }
    return undefined;
  };
}

export async function ensureEcommerceProductLookup(): Promise<Map<string, EcommerceProductMapEntry>> {
  if (cachedMap) return cachedMap;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    const map = new Map<string, EcommerceProductMapEntry>();
    try {
      const res = await fetch("/api/ecommerce/product-map");
      if (res.ok) {
        const data = await res.json();
        const entries = (data.products ?? data.map ?? []) as EcommerceProductMapEntry[];
        for (const e of entries) {
          if (e?.content_slug) map.set(e.content_slug, e);
        }
      }
    } catch {
      // non-fatal
    }
    cachedMap = map;
    setEcommerceProductLookup(buildLookup(map));
    return map;
  })();

  return loadPromise;
}

export function getCachedProductBySlug(slug: string): EcommerceProductMapEntry | undefined {
  return cachedMap?.get(slug);
}
