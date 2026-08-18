/**
 * Page-level funnel fields on `{slug}/_common.yml`.
 * Source of truth for journey stage + product membership (not section ecommerce_products).
 */

export const FUNNEL_YAML_KEY = "funnel";

export const FUNNEL_STAGES = [
  "awareness",
  "consideration",
  "decision",
  "post-enrollment",
] as const;

export type FunnelStage = (typeof FUNNEL_STAGES)[number];

export type FunnelProducts = string[] | "all";

export type FunnelBlock = {
  stage?: FunnelStage | string | null;
  products?: FunnelProducts | null;
};

export type ProductScope = FunnelProducts;

export function isFunnelStage(value: unknown): value is FunnelStage {
  return typeof value === "string" && (FUNNEL_STAGES as readonly string[]).includes(value);
}

export function normalizeFunnelProducts(raw: unknown): FunnelProducts | undefined {
  if (raw === "all") return "all";
  if (!Array.isArray(raw)) return undefined;
  const slugs = [...new Set(raw.filter((x): x is string => typeof x === "string" && x.trim().length > 0))];
  return slugs.length > 0 ? slugs : undefined;
}

export function normalizeFunnelBlock(raw: unknown): FunnelBlock {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const o = raw as Record<string, unknown>;
  const stageRaw = o.stage;
  const stage =
    typeof stageRaw === "string" && stageRaw.trim()
      ? isFunnelStage(stageRaw.trim())
        ? stageRaw.trim()
        : stageRaw.trim()
      : undefined;
  const products = normalizeFunnelProducts(o.products);
  const out: FunnelBlock = {};
  if (stage) out.stage = stage;
  if (products !== undefined) out.products = products;
  return out;
}

/** Raw products from YAML before program self-union. */
export function readFunnelProducts(block: FunnelBlock | undefined | null): FunnelProducts | undefined {
  if (!block?.products) return undefined;
  if (block.products === "all") return "all";
  if (Array.isArray(block.products) && block.products.length > 0) return block.products;
  return undefined;
}

/**
 * Effective purchasable scope for tracking / Store (1B: program always includes self).
 */
export function effectiveProducts(
  funnel: FunnelBlock | undefined | null,
  ctx: { contentType?: string; contentSlug?: string },
): ProductScope | undefined {
  const raw = readFunnelProducts(funnel);
  if (ctx.contentType === "program" && typeof ctx.contentSlug === "string" && ctx.contentSlug) {
    if (raw === "all") return "all";
    const list = raw ? [...raw] : [];
    if (!list.includes(ctx.contentSlug)) list.push(ctx.contentSlug);
    return list.length > 0 ? list : [ctx.contentSlug];
  }
  return raw;
}

export function scopeIncludesProduct(scope: ProductScope, productSlug: string): boolean {
  if (scope === "all") return true;
  return scope.includes(productSlug);
}

export function funnelHasProductsWithoutStage(funnel: FunnelBlock | undefined | null): boolean {
  const products = readFunnelProducts(funnel);
  const hasProducts = products === "all" || (Array.isArray(products) && products.length > 0);
  const stage = funnel?.stage;
  const hasStage = typeof stage === "string" && stage.trim().length > 0;
  return hasProducts && !hasStage;
}

/** Enrollment card ids not covered by page effective products (5B). */
export function enrollmentIdsOutsideFunnel(
  cardIds: string[],
  funnel: FunnelBlock | undefined | null,
  ctx: { contentType?: string; contentSlug?: string },
): string[] {
  const effective = effectiveProducts(funnel, ctx);
  if (effective === "all") return [];
  if (!effective) return cardIds.filter(Boolean);
  return cardIds.filter((id) => id && !effective.includes(id));
}
