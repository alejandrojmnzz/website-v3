/**
 * Resolve which purchasable product(s) an ecommerce section is about.
 * Prefer field-editor binds / domain lists over URL heuristics.
 */

export type ProductScope = string[] | "all";

export type ProductScopeContext = {
  contentType?: string;
  contentSlug?: string;
};

export type ResolveProductScopeResult = {
  scope: ProductScope | null;
  /** Dot-path under section data (or synthetic inherit) for errors/explain */
  bindPath: string;
  source: "ecommerce_products" | "programs[].id" | "inherit" | "none" | "off";
};

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/**
 * Resolve product scope from section instance data + page context.
 * Precedence: ecommerce_products (incl. null = explicit off) → programs[].id → inherit (program entry).
 */
export function resolveProductScope(
  section: Record<string, unknown>,
  ctx: ProductScopeContext = {},
): ResolveProductScopeResult {
  if ("ecommerce_products" in section && section.ecommerce_products === null) {
    return { scope: null, bindPath: "ecommerce_products", source: "off" };
  }

  const explicit = section.ecommerce_products;
  if (explicit === "all") {
    return { scope: "all", bindPath: "ecommerce_products", source: "ecommerce_products" };
  }
  if (Array.isArray(explicit)) {
    const ids = explicit.filter((x): x is string => typeof x === "string" && x.length > 0);
    if (ids.length > 0) {
      return { scope: ids, bindPath: "ecommerce_products", source: "ecommerce_products" };
    }
  }

  if (Array.isArray(section.programs)) {
    const ids: string[] = [];
    for (const p of section.programs) {
      const rec = asRecord(p);
      if (rec && typeof rec.id === "string" && rec.id) ids.push(rec.id);
    }
    if (ids.length > 0) {
      return { scope: ids, bindPath: "programs[].id", source: "programs[].id" };
    }
  }

  if (ctx.contentType === "program" && typeof ctx.contentSlug === "string" && ctx.contentSlug) {
    return {
      scope: [ctx.contentSlug],
      bindPath: "inherit (content entry slug)",
      source: "inherit",
    };
  }

  return { scope: null, bindPath: "ecommerce_products", source: "none" };
}

export function scopeIncludesProduct(scope: ProductScope, productSlug: string): boolean {
  if (scope === "all") return true;
  return scope.includes(productSlug);
}

/**
 * True when section must have an explicit ecommerce product-scope decision
 * (ecommerce_products list/"all"/null, programs[].id, or inherit).
 * Any section with behaviors.ecommerce needs a decision when not inheriting.
 */
export function sectionNeedsProductScope(
  section: Record<string, unknown>,
  opts: { hasEcommerceBehavior: boolean; ctaPaths: string[]; fieldEditors: Record<string, string> },
): boolean {
  if (!opts.hasEcommerceBehavior) return false;
  return true;
}

export type ProductResolveFn = (programId: string) => { product_id: string; active: boolean } | undefined;

/**
 * Validate ecommerce product scope for a section. Returns error message or null.
 * Message always cites bindPath.
 *
 * Missing ecommerce_products (after wipe) fails when ecommerce behavior applies and
 * the page does not inherit. Explicit `ecommerce_products: null` turns scope off.
 */
export function validateProductScope(
  section: Record<string, unknown>,
  opts: {
    contentSlug?: string;
    contentType?: string;
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

  const { scope, bindPath, source } = resolveProductScope(section, {
    contentType: opts.contentType,
    contentSlug: opts.contentSlug,
  });

  const prefix =
    typeof opts.sectionIndex === "number" ? `sections[${opts.sectionIndex}].` : "sections[].";

  if (source === "off") return null;
  if (source === "inherit") return null;

  if (source === "none") {
    const type = String(section.type ?? "section");
    return (
      `${prefix}data.ecommerce_products is required for ecommerce on ${type}. ` +
      `Set a product slug list or "all", use null to turn product scope off, ` +
      `provide programs[].id (enrollment_selector), or place this section on a program entry (inherit). ` +
      `Missing after duplicate wipe is invalid.`
    );
  }

  if (!scope) {
    return (
      `${prefix}data.${bindPath === "inherit (content entry slug)" ? "ecommerce_products" : bindPath} ` +
      `is required for ecommerce scope on ${String(section.type ?? "section")}. ` +
      `Set ecommerce_products to a product slug list or "all", null to turn off, or provide programs[].id.`
    );
  }

  if (scope === "all") return null;

  for (const id of scope) {
    const resolved = opts.resolveProduct(id);
    if (!resolved?.active) {
      return (
        `${prefix}data.${bindPath} references unknown or inactive purchasable product "${id}". ` +
        `Add programs/${id}/_ecommerce.yml with purchasable: true, or fix the id.`
      );
    }
  }
  return null;
}
