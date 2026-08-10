/**
 * E-commerce domain types.
 * These are the canonical contracts used by ecommerce-index, ecommerce-manager,
 * ecommerce-resolver, and the REST routes.
 *
 * Billing plans / SKUs are not part of the CMS ecommerce model.
 */

export interface FunnelStep {
  content_type: string;
  slug: string;
  role?: string;
}

/** Documented inbound demand by content type (not a URL step). One row per content_type. */
export interface FunnelTrafficSource {
  content_type: string;
  role: string;
}

export interface EcommerceProduct {
  product_id: string;
  name: string;
  content_type: string;
  content_slug: string;
  active: boolean;
  description?: string;
  /**
   * Authored conversion path after the locked product entry (not including auto `all` pages),
   * plus optional type-level traffic_sources for top-of-funnel documentation.
   */
  funnel: { steps: FunnelStep[]; traffic_sources: FunnelTrafficSource[] };
}

export interface EcommerceSettings {
  currency: string;
  locale: string;
  tax_inclusive: boolean;
}

/** A product as returned from resolve APIs (no plan catalog). */
export type ResolvedProduct = EcommerceProduct;

/** Shape injected into the CMS render context under the `ecommerce` key. */
export interface EcommerceRenderContext {
  product: ResolvedProduct;
  settings: EcommerceSettings;
}
