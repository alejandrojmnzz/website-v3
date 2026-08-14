/**
 * Ecommerce Manager — singleton query API.
 */

import { productMap, ecommerceSettings } from "./ecommerce-index";
import type {
  EcommerceProduct,
  EcommerceSettings,
  ResolvedProduct,
  FunnelStep,
  FunnelTrafficSource,
} from "./types";

class EcommerceManager {
  private static instance: EcommerceManager;

  static getInstance(): EcommerceManager {
    if (!EcommerceManager.instance) {
      EcommerceManager.instance = new EcommerceManager();
    }
    return EcommerceManager.instance;
  }

  private constructor() {}

  getProduct(productId: string): EcommerceProduct | undefined {
    return productMap.get(productId);
  }

  getAllProducts(): EcommerceProduct[] {
    return Array.from(productMap.values()).filter((p) => p.actively_selling);
  }

  /** True when this content type has at least one purchasable product in the index. */
  contentTypeHasEcommerce(contentType: string): boolean {
    for (const product of productMap.values()) {
      if (product.content_type === contentType) return true;
    }
    return false;
  }

  /** True when the entry is in the product map (purchasable: true), regardless of actively_selling. */
  isEntryPurchasable(contentType: string, slug: string): boolean {
    return !!this.findProductByCmsEntry(contentType, slug, { includePaused: true });
  }

  listPurchasableSlugs(contentType: string): string[] {
    const slugs: string[] = [];
    const seen = new Set<string>();
    for (const product of productMap.values()) {
      if (product.content_type !== contentType) continue;
      if (seen.has(product.content_slug)) continue;
      seen.add(product.content_slug);
      slugs.push(product.content_slug);
    }
    return slugs;
  }

  findProductByCmsEntry(
    contentType: string,
    slug: string,
    opts?: { includePaused?: boolean },
  ): EcommerceProduct | undefined {
    const includePaused = opts?.includePaused === true;
    const derivedKey = `${contentType}-${slug}`;
    const byKey = productMap.get(derivedKey);
    if (byKey && (includePaused || byKey.actively_selling)) return byKey;

    // Legacy slash form
    const slashKey = `${contentType}/${slug}`;
    const bySlash = productMap.get(slashKey);
    if (bySlash && (includePaused || bySlash.actively_selling)) return bySlash;

    for (const product of productMap.values()) {
      if (product.content_type !== contentType || product.content_slug !== slug) continue;
      if (!includePaused && !product.actively_selling) continue;
      return product;
    }
    return undefined;
  }

  /** Resolve program/content slug to an actively-selling product (by content_slug or product_id). */
  findProductByProgramId(programId: string): EcommerceProduct | undefined {
    for (const product of productMap.values()) {
      if (!product.actively_selling) continue;
      if (product.content_slug === programId || product.product_id === programId) {
        return product;
      }
    }
    return undefined;
  }

  getSettings(): EcommerceSettings {
    return { ...ecommerceSettings };
  }

  resolveProduct(productId: string): ResolvedProduct | null {
    const product = this.getProduct(productId);
    if (!product) return null;
    return {
      ...product,
      funnel: {
        steps: [...product.funnel.steps],
        traffic_sources: [...(product.funnel.traffic_sources ?? [])],
      },
    };
  }

  getFunnelSteps(productId: string): FunnelStep[] {
    return this.getProduct(productId)?.funnel.steps ?? [];
  }

  getFunnelTrafficSources(productId: string): FunnelTrafficSource[] {
    return this.getProduct(productId)?.funnel.traffic_sources ?? [];
  }
}

export const ecommerceManager = EcommerceManager.getInstance();

/** Template / listing key. Computed; never authored in YAML. */
export const PURCHASABLE_FIELD = "purchasable";

export function applyPurchasableToRecord(
  record: Record<string, unknown>,
  contentType: string,
  slug?: string,
): void {
  if (!ecommerceManager.contentTypeHasEcommerce(contentType)) return;
  const s = (slug || String(record.slug ?? "")).trim();
  record[PURCHASABLE_FIELD] = s
    ? ecommerceManager.isEntryPurchasable(contentType, s)
    : false;
}
