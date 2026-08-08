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
  source: "ecommerce_products" | "programs[].id" | "inherit" | "none";
};

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/**
 * Resolve product scope from section instance data + page context.
 * Precedence: ecommerce_products → programs[].id → inherit (program entry).
 */
export function resolveProductScope(
  section: Record<string, unknown>,
  ctx: ProductScopeContext = {},
): ResolveProductScopeResult {
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

/** True when section type participates in ecommerce funnel/catalog. */
export function sectionNeedsProductScope(
  section: Record<string, unknown>,
  opts: { hasEcommerceBehavior: boolean; ctaPaths: string[]; fieldEditors: Record<string, string> },
): boolean {
  if (!opts.hasEcommerceBehavior) return false;
  const type = String(section.type ?? "");
  if (type === "enrollment_selector" || type === "pricing_plans") return true;
  const hasEcommerceProductsEditor = Object.values(opts.fieldEditors).some(
    (v) => String(v).split(":")[0] === "ecommerce-products",
  );
  if (hasEcommerceProductsEditor) return true;
  // Hero course etc.: require when any bound CTA uses non-none tracking
  for (const path of opts.ctaPaths) {
    const raw = getByPath(section, path);
    if (ctaHasNonNoneTracking(raw)) return true;
  }
  return false;
}

function getByPath(obj: unknown, path: string): unknown {
  if (!obj || typeof obj !== "object") return undefined;
  const parts = path.replace(/\[\]/g, ".$").split(".").filter(Boolean);
  return walk(obj, parts);
}

function walk(current: unknown, parts: string[]): unknown {
  if (parts.length === 0) return current;
  const [head, ...rest] = parts;
  if (head === "$") {
    if (!Array.isArray(current)) return undefined;
    return current.map((item) => walk(item, rest));
  }
  if (!current || typeof current !== "object" || Array.isArray(current)) return undefined;
  return walk((current as Record<string, unknown>)[head!], rest);
}

function ctaHasNonNoneTracking(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(ctaHasNonNoneTracking);
  const o = asRecord(value);
  if (!o) return false;
  if (typeof o.url === "string" && typeof o.text === "string") {
    const t = o.tracking;
    return typeof t === "string" && t !== "" && t !== "none";
  }
  for (const v of Object.values(o)) {
    if (ctaHasNonNoneTracking(v)) return true;
  }
  return false;
}

export type ProductResolveFn = (programId: string) => { product_id: string; active: boolean } | undefined;

/**
 * Validate ecommerce product scope for a section. Returns error message or null.
 * Message always cites bindPath.
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

  const { scope, bindPath } = resolveProductScope(section, {
    contentType: opts.contentType,
    contentSlug: opts.contentSlug,
  });

  const prefix =
    typeof opts.sectionIndex === "number" ? `sections[${opts.sectionIndex}].` : "sections[].";

  if (!scope) {
    return (
      `${prefix}data.${bindPath === "inherit (content entry slug)" ? "ecommerce_products" : bindPath} ` +
      `is required for ecommerce scope on ${String(section.type ?? "section")}. ` +
      `Set ecommerce_products to a product slug list or "all", or provide programs[].id, ` +
      `or place this section on a program entry (inherit).`
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
