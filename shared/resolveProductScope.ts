/**
 * Resolve which purchasable product(s) an ecommerce section tracks.
 * Page-level funnel.products on _common.yml is the source of truth (not section ecommerce_products).
 */

import {
  effectiveProducts,
  type FunnelBlock,
  type ProductScope,
  scopeIncludesProduct,
} from "./funnel";

export type { ProductScope, FunnelBlock };
export { effectiveProducts, scopeIncludesProduct };

export type ProductScopeContext = {
  contentType?: string;
  contentSlug?: string;
  /** Merged entry funnel block from _common.yml */
  funnel?: FunnelBlock | null;
};

export type ResolveProductScopeResult = {
  scope: ProductScope | null;
  bindPath: string;
  source: "funnel.products" | "programs[].id" | "inherit" | "none";
};

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/**
 * Resolve product scope for ecommerce tracking on a section.
 * Enrollment programs[].id is for card rendering only — tracking uses page funnel.
 */
export function resolveProductScope(
  section: Record<string, unknown>,
  ctx: ProductScopeContext = {},
): ResolveProductScopeResult {
  const pageScope = effectiveProducts(ctx.funnel ?? undefined, {
    contentType: ctx.contentType,
    contentSlug: ctx.contentSlug,
  });

  if (pageScope) {
    return { scope: pageScope, bindPath: "funnel.products", source: "funnel.products" };
  }

  if (ctx.contentType === "program" && typeof ctx.contentSlug === "string" && ctx.contentSlug) {
    return {
      scope: [ctx.contentSlug],
      bindPath: "inherit (content entry slug)",
      source: "inherit",
    };
  }

  return { scope: null, bindPath: "funnel.products", source: "none" };
}

/** Active purchasable slugs only — inactive ids are skipped (4B). */
export function filterActiveProductScope(
  scope: ProductScope,
  resolveProduct: (slug: string) => { active: boolean } | undefined,
): ProductScope | null {
  if (scope === "all") return "all";
  const active = scope.filter((id) => resolveProduct(id)?.active);
  return active.length > 0 ? active : null;
}

export function sectionNeedsProductScope(
  section: Record<string, unknown>,
  opts: { hasEcommerceBehavior: boolean; ctaPaths: string[]; fieldEditors: Record<string, string> },
): boolean {
  if (!opts.hasEcommerceBehavior) return false;
  return true;
}

export type ProductResolveFn = (programId: string) => { product_id: string; active: boolean } | undefined;

export function validateProductScope(
  section: Record<string, unknown>,
  opts: {
    contentSlug?: string;
    contentType?: string;
    funnel?: FunnelBlock | null;
    hasEcommerceBehavior: boolean;
    ctaPaths: string[];
    fieldEditors: Record<string, string>;
    resolveProduct: ProductResolveFn;
    sectionIndex?: number;
  },
): string | null {
  if (
    !sectionNeedsProductScope(section, {
      hasEcommerceBehavior: opts.hasEcommerceBehavior,
      ctaPaths: opts.ctaPaths,
      fieldEditors: opts.fieldEditors,
    })
  ) {
    return null;
  }

  const { scope, source } = resolveProductScope(section, {
    contentType: opts.contentType,
    contentSlug: opts.contentSlug,
    funnel: opts.funnel,
  });

  const prefix =
    typeof opts.sectionIndex === "number" ? `sections[${opts.sectionIndex}].` : "sections[].";

  if (source === "inherit") return null;

  if (source === "none" || !scope) {
    const type = String(section.type ?? "section");
    return (
      `${prefix}Page funnel.products is required for ecommerce on ${type}. ` +
      `Set funnel.stage and funnel.products on _common.yml (Funnel tab), or place this section on a program entry (inherit).`
    );
  }

  if (scope === "all") return null;

  const activeIds = scope.filter((id) => opts.resolveProduct(id)?.active);
  if (activeIds.length === 0) {
    return (
      `funnel.products on _common.yml references no active purchasable products for this page. ` +
      `Fix slugs on the Funnel tab or add programs/{slug}/_ecommerce.yml with purchasable: true.`
    );
  }

  return null;
}

/** Collect enrollment card program ids from a section (for 5B warnings). */
export function enrollmentCardIds(section: Record<string, unknown>): string[] {
  if (!Array.isArray(section.programs)) return [];
  const ids: string[] = [];
  for (const p of section.programs) {
    const rec = asRecord(p);
    if (rec && typeof rec.id === "string" && rec.id) ids.push(rec.id);
  }
  return ids;
}
