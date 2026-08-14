/**
 * Gate catalog lead-form writes: ecommerce content types require source.query.
 */

import { parseFormFieldSource } from "../../shared/parseFormFieldSource.js";
import { ecommerceManager } from "../../server/ecommerce/ecommerce-manager.js";
import { actionRequired, type McpTextResult, type NextAction } from "./respond.js";

export type MissingCatalogQueryHit = {
  property_path: string;
  content_type: string;
  purchasable_slugs: string[];
};

function isPlain(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function inspectSource(
  source: unknown,
  propertyPath: string,
  hits: MissingCatalogQueryHit[],
): void {
  if (source == null) return;
  const parsed = parseFormFieldSource(
    source as string | { content_type?: string; database?: string; name?: string; relation?: string; query?: string },
  );
  const ct = parsed.content_type;
  if (!ct || parsed.relation || parsed.database) return;
  if (parsed.query && parsed.query.trim()) return;
  if (!ecommerceManager.contentTypeHasEcommerce(ct)) return;
  hits.push({
    property_path: propertyPath,
    content_type: ct,
    purchasable_slugs: ecommerceManager.listPurchasableSlugs(ct),
  });
}

function walkFields(
  fields: Record<string, unknown>,
  prefix: string,
  hits: MissingCatalogQueryHit[],
): void {
  for (const [name, cfg] of Object.entries(fields)) {
    if (!isPlain(cfg) || cfg.source === undefined) continue;
    inspectSource(cfg.source, `${prefix}.${name}.source`, hits);
  }
}

export function collectMissingCatalogQueries(
  node: unknown,
  pathPrefix = "",
): MissingCatalogQueryHit[] {
  const hits: MissingCatalogQueryHit[] = [];
  const visit = (n: unknown, p: string) => {
    if (Array.isArray(n)) {
      n.forEach((item, i) => visit(item, p ? `${p}[${i}]` : `[${i}]`));
      return;
    }
    if (!isPlain(n)) return;
    if (isPlain(n.fields)) {
      walkFields(n.fields, p ? `${p}.fields` : "fields", hits);
    }
    if (isPlain(n.form)) visit(n.form, p ? `${p}.form` : "form");
    for (const [k, v] of Object.entries(n)) {
      if (k === "fields" || k === "form") continue;
      visit(v, p ? `${p}.${k}` : k);
    }
  };
  visit(node, pathPrefix);
  return hits;
}

export function collectMissingCatalogQueriesFromUpdates(
  updates: Array<{ field_path: string; value: unknown }>,
): MissingCatalogQueryHit[] {
  const hits: MissingCatalogQueryHit[] = [];
  for (const u of updates) {
    if (u.field_path === "source" || u.field_path.endsWith(".source")) {
      inspectSource(u.value, u.field_path, hits);
      continue;
    }
    if (isPlain(u.value) && u.value.source !== undefined) {
      inspectSource(u.value.source, `${u.field_path}.source`, hits);
    }
    hits.push(...collectMissingCatalogQueries(u.value, u.field_path));
  }
  return hits;
}

export function missingCatalogQueryGate(
  hits: MissingCatalogQueryHit[],
  ctx: {
    tool: string;
    retryArgs: Record<string, unknown>;
    site?: string;
  },
): McpTextResult | null {
  if (!hits.length) return null;
  const first = hits[0]!;
  const subset =
    first.purchasable_slugs.length > 0
      ? `slug=${first.purchasable_slugs.join(",")}`
      : "slug=<slug>";
  const next_actions: NextAction[] = [
    {
      tool: "query_options",
      reason:
        "Inspect catalog entries. No implicit purchasable filter — pass query to filter.",
      args_hint: {
        content_type: first.content_type,
        query: "purchasable=true",
        ...(ctx.site ? { site: ctx.site } : {}),
      },
      priority: "recommended",
    },
    {
      tool: "explain_site",
      reason: "Lead-form catalog source contract (content_type vs relation, required query)",
      args_hint: { topic: "lead-forms" },
      priority: "optional",
    },
    {
      tool: ctx.tool,
      reason:
        `Re-submit with source.query. Typical: "purchasable=true". Subset: "${subset}". ` +
        `On a non-purchasable program page use source.relation (or query: "slug=<this>"), not the vendible catalog.`,
      args_hint: ctx.retryArgs,
      priority: "required",
    },
  ];
  return actionRequired(
    {
      success: false,
      action_required: "catalog_source_query_required",
      message:
        `Catalog source.content_type on an ecommerce content type requires an explicit query. ` +
        `Typical: query: "purchasable=true". Subset: query: "${subset}". ` +
        `On a non-purchasable program page, bind that program only (source.relation or slug query), not the full catalog. ` +
        `Do not write single.purchasable. actively_selling on _ecommerce.yml pauses the store — it is not the form filter. ` +
        `EN/ES are separate writes (no locale fan-out).`,
      missing: hits,
      proposed_query: "purchasable=true",
      proposed_subset_query: subset,
    },
    next_actions,
  );
}
