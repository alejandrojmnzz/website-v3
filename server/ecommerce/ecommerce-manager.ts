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
    return Array.from(productMap.values()).filter((p) => p.active);
  }

  findProductByCmsEntry(contentType: string, slug: string): EcommerceProduct | undefined {
    const derivedKey = `${contentType}-${slug}`;
    const byKey = productMap.get(derivedKey);
    if (byKey) return byKey;

    // Legacy slash form
    const slashKey = `${contentType}/${slug}`;
    const bySlash = productMap.get(slashKey);
    if (bySlash) return bySlash;

    for (const product of productMap.values()) {
      if (product.active && product.content_type === contentType && product.content_slug === slug) {
        return product;
      }
    }
    return undefined;
  }

  /** Resolve program/content slug to an active product (by content_slug or product_id). */
  findProductByProgramId(programId: string): EcommerceProduct | undefined {
    for (const product of productMap.values()) {
      if (!product.active) continue;
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
