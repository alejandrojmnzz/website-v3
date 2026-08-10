/**
 * Ecommerce REST routes.
 *
 * GET  /api/ecommerce/products
 * GET  /api/ecommerce/product-map
 * GET  /api/ecommerce/events
 * GET  /api/ecommerce/funnel/:slug
 * PUT  /api/ecommerce/funnel/:slug
 * GET  /api/ecommerce/products/:productId
 */

import type { Express, Request, Response } from "express";
import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";
import { z } from "zod";
import { ecommerceManager } from "../ecommerce/ecommerce-manager";
import { getDefaultContentRoot } from "../site-config";
import { resolveComponentBehaviors } from "@shared/component-behaviors";
import {
  resolveProductScope,
  scopeIncludesProduct,
} from "@shared/resolveProductScope";
import { contentIndex } from "../content-index";
import { markFileAsModified } from "../sync-state";
import { scanEcommerceContent } from "../ecommerce/ecommerce-index";
import type { FunnelStep, FunnelTrafficSource } from "../ecommerce/types";
import { child } from "../logger";
import { requireCapability } from "./_helpers";

const log = child({ module: "routes/ecommerce" });

const productIdSchema = z.object({
  productId: z.string().min(1).regex(/^[a-z0-9-_]+$/i),
});

const slugSchema = z.object({
  slug: z.string().min(1).regex(/^[a-z0-9-_]+$/i),
});

const funnelStepSchema = z.object({
  content_type: z.string().min(1),
  slug: z.string().min(1),
  role: z.string().optional(),
});

const trafficSourceSchema = z.object({
  content_type: z.string().min(1),
  role: z.string().min(1),
});

const putFunnelSchema = z.object({
  steps: z.array(funnelStepSchema),
  /** When omitted, existing funnel.traffic_sources are preserved. */
  traffic_sources: z.array(trafficSourceSchema).optional(),
});

const ECOMMERCE_EVENT_CATALOG = [
  {
    name: "view_item",
    wired: true,
    description: "Hero course (or product page) when a purchasable product resolves",
    sample: {
      event: "view_item",
      item_id: "program-ai-fluency",
      item_name: "AI Fluency",
      item_category: "program",
      program_id: "ai-fluency",
      component_type: "hero",
      component_variant: "course",
    },
  },
  {
    name: "add_to_cart",
    wired: true,
    description: "CTA with tracking=add_to_cart (e.g. payment-component / enrollment CTA)",
    sample: {
      event: "add_to_cart",
      item_id: "program-ai-flex",
      item_name: "AI Flex",
      item_category: "program",
      program_id: "ai-flex",
      item_list_name: "enrollment_selector",
      selected_plan_option: "basic",
      amount: "129",
      period_label: "/month",
      component_type: "enrollment_selector",
    },
  },
  {
    name: "view_item_list",
    wired: true,
    description: "enrollment_selector / pricing_plans when viewport-visible",
    sample: {
      event: "view_item_list",
      item_list_name: "enrollment_selector",
      program_id: "ai-fluency",
      item_id: "program-ai-fluency",
      item_name: "AI Fluency",
      item_category: "program",
      cohort_date: "2026-09-08",
      amount: "$250",
      component_type: "enrollment_selector",
    },
  },
  {
    name: "select_item",
    wired: true,
    description: "User changes program in enrollment_selector (debounced)",
    sample: {
      event: "select_item",
      program_id: "ai-fluency",
      item_id: "program-ai-fluency",
      item_name: "AI Fluency",
      item_category: "program",
      item_list_name: "enrollment_selector",
      cohort_date: "2026-09-08",
      amount: "$250",
      component_type: "enrollment_selector",
    },
  },
  {
    name: "click_begin_checkout",
    wired: true,
    description: "User clicks checkout CTA on enrollment_selector / hero",
    sample: {
      event: "click_begin_checkout",
      program_id: "ai-engineering",
      item_id: "program-ai-engineering",
      item_name: "AI Engineering",
      item_category: "program",
      item_list_name: "enrollment_selector",
      cohort_date: "2026-09-08",
      amount: "$250",
      addon_id: "job-guarantee",
      component_type: "enrollment_selector",
    },
  },
  {
    name: "begin_checkout",
    wired: false,
    description: "Off-site only (learn.4geeks checkout page). Not fired from this site.",
    sample: { event: "begin_checkout", item_id: "program-ai-fluency", note: "off-site (learn.4geeks)" },
  },
  {
    name: "purchase",
    wired: false,
    description: "Off-site only (checkout POS). Not fired from this site.",
    sample: { event: "purchase", item_id: "program-ai-fluency", note: "off-site" },
  },
] as const;

type ScopedEntry = {
  content_type: string;
  slug: string;
  scope: "all" | string[];
  files: string[];
};

function scanEcommerceComponentUsage(): Array<{
  component_type: string;
  role?: string;
  events: string[];
  notes?: string;
}> {
  const usage: Array<{ component_type: string; role?: string; events: string[]; notes?: string }> = [];
  try {
    const root = getDefaultContentRoot();
    const registry = path.join(root, "component-registry");
    if (!fs.existsSync(registry)) return usage;
    for (const typeDir of fs.readdirSync(registry, { withFileTypes: true })) {
      if (!typeDir.isDirectory()) continue;
      const typePath = path.join(registry, typeDir.name);
      const versions = fs
        .readdirSync(typePath, { withFileTypes: true })
        .filter((d) => d.isDirectory() && /^v\d/.test(d.name))
        .sort((a, b) => b.name.localeCompare(a.name));
      if (!versions[0]) continue;
      const schemaPath = path.join(typePath, versions[0].name, "schema.yml");
      if (!fs.existsSync(schemaPath)) continue;
      const parsed = yaml.load(fs.readFileSync(schemaPath, "utf-8"));
      if (!parsed || typeof parsed !== "object") continue;
      const behaviors = resolveComponentBehaviors(parsed as Record<string, unknown>);
      if (!behaviors.ecommerce) continue;
      usage.push({
        component_type: typeDir.name,
        role: behaviors.ecommerce.role,
        events: behaviors.ecommerce.events ?? [],
        notes: behaviors.ecommerce.notes,
      });
    }
  } catch (err) {
    log.warn({ err }, "[EcommerceRoutes] usage scan failed");
  }
  return usage;
}

/** Walk content YAML for ecommerce sections and collect product scope. */
function scanScopedContentEntries(): ScopedEntry[] {
  const byKey = new Map<string, ScopedEntry>();
  const root = getDefaultContentRoot();
  if (!fs.existsSync(root)) return [];

  const contentTypesPath = path.join(root, "content-types.yml");
  if (!fs.existsSync(contentTypesPath)) return [];

  let dirToCanonical = new Map<string, string>();
  try {
    const parsed = yaml.load(fs.readFileSync(contentTypesPath, "utf-8")) as Record<
      string,
      { directory?: string }
    > | null;
    if (parsed) {
      for (const [key, def] of Object.entries(parsed)) {
        const dir = def?.directory || key;
        dirToCanonical.set(dir, key);
      }
    }
  } catch {
    return [];
  }

  for (const [dirName, contentType] of dirToCanonical.entries()) {
    const typeDir = path.join(root, dirName);
    if (!fs.existsSync(typeDir)) continue;
    for (const entry of fs.readdirSync(typeDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const slug = entry.name;
      const entryDir = path.join(typeDir, slug);
      for (const f of fs.readdirSync(entryDir)) {
        if (!/\.ya?ml$/.test(f) || f.startsWith("_")) continue;
        const filePath = path.join(entryDir, f);
        let doc: unknown;
        try {
          doc = yaml.load(fs.readFileSync(filePath, "utf-8"));
        } catch {
          continue;
        }
        if (!doc || typeof doc !== "object") continue;
        const sections = (doc as { sections?: unknown }).sections;
        if (!Array.isArray(sections)) continue;

        let matchedScope: "all" | string[] | null = null;
        for (const section of sections) {
          if (!section || typeof section !== "object") continue;
          const s = section as Record<string, unknown>;
          const { scope } = resolveProductScope(s, { contentType, contentSlug: slug });
          if (!scope) continue;
          if (scope === "all") {
            matchedScope = "all";
            break;
          }
          if (!matchedScope || matchedScope === "all") {
            matchedScope = [...scope];
          } else {
            matchedScope = [...new Set([...matchedScope, ...scope])];
          }
        }
        if (!matchedScope) continue;

        const key = `${contentType}/${slug}`;
        const rel = path.relative(process.cwd(), filePath);
        const existing = byKey.get(key);
        if (existing) {
          if (!existing.files.includes(rel)) existing.files.push(rel);
          if (matchedScope === "all") existing.scope = "all";
          else if (existing.scope !== "all") {
            existing.scope = [...new Set([...existing.scope, ...matchedScope])];
          }
        } else {
          byKey.set(key, {
            content_type: contentType,
            slug,
            scope: matchedScope === "all" ? "all" : matchedScope,
            files: [rel],
          });
        }
      }
    }
  }
  return Array.from(byKey.values());
}

function resolveStepMeta(
  contentType: string,
  slug: string,
): { urls: Record<string, string>; files: string[]; title?: string } {
  let urls: Record<string, string> = {};
  try {
    urls = contentIndex.getAlternateUrls(slug, contentType) ?? {};
  } catch {
    urls = {};
  }
  const files: string[] = [];
  const root = getDefaultContentRoot();
  const typesPath = path.join(root, "content-types.yml");
  let dirName = contentType;
  try {
    const parsed = yaml.load(fs.readFileSync(typesPath, "utf-8")) as Record<
      string,
      { directory?: string }
    > | null;
    if (parsed?.[contentType]?.directory) dirName = parsed[contentType].directory!;
  } catch {
    // ignore
  }
  const entryDir = path.join(root, dirName, slug);
  if (fs.existsSync(entryDir)) {
    for (const f of fs.readdirSync(entryDir)) {
      if (/\.ya?ml$/.test(f) && !f.startsWith("_")) {
        files.push(path.relative(process.cwd(), path.join(entryDir, f)));
      }
    }
  }
  return { urls, files };
}

function entryExists(contentType: string, slug: string): boolean {
  try {
    const urls = contentIndex.getAlternateUrls(slug, contentType);
    return urls && Object.keys(urls).length > 0;
  } catch {
    return false;
  }
}

function buildEffectiveFunnel(productSlug: string, contentType: string, authored: FunnelStep[]) {
  const lockedMeta = resolveStepMeta(contentType, productSlug);
  const steps: Array<{
    source: "locked" | "authored" | "auto";
    locked?: boolean;
    content_type: string;
    slug: string;
    role?: string;
    urls: Record<string, string>;
    files: string[];
  }> = [
    {
      source: "locked",
      locked: true,
      content_type: contentType,
      slug: productSlug,
      role: "product",
      ...lockedMeta,
    },
  ];

  const seen = new Set<string>([`${contentType}/${productSlug}`]);

  for (const s of authored) {
    const key = `${s.content_type}/${s.slug}`;
    if (seen.has(key)) continue;
    if (s.content_type === contentType && s.slug === productSlug) continue;
    seen.add(key);
    steps.push({
      source: "authored",
      content_type: s.content_type,
      slug: s.slug,
      role: s.role,
      ...resolveStepMeta(s.content_type, s.slug),
    });
  }

  const scoped = scanScopedContentEntries();
  for (const entry of scoped) {
    if (entry.scope !== "all") continue;
    const key = `${entry.content_type}/${entry.slug}`;
    if (seen.has(key)) continue;
    seen.add(key);
    steps.push({
      source: "auto",
      content_type: entry.content_type,
      slug: entry.slug,
      role: "configure",
      urls: resolveStepMeta(entry.content_type, entry.slug).urls,
      files: entry.files,
    });
  }

  const suggestions: Array<{
    content_type: string;
    slug: string;
    reason: string;
    urls: Record<string, string>;
  }> = [];

  for (const entry of scoped) {
    if (entry.scope === "all") continue;
    if (!scopeIncludesProduct(entry.scope, productSlug)) continue;
    const key = `${entry.content_type}/${entry.slug}`;
    if (seen.has(key)) continue;
    suggestions.push({
      content_type: entry.content_type,
      slug: entry.slug,
      reason: `ecommerce section scope includes product (bind: programs[].id or ecommerce_products)`,
      urls: resolveStepMeta(entry.content_type, entry.slug).urls,
    });
  }

  return { steps, suggestions };
}

function dedupeTrafficSources(sources: FunnelTrafficSource[]): FunnelTrafficSource[] {
  const byType = new Map<string, FunnelTrafficSource>();
  for (const s of sources) {
    const content_type = s.content_type.trim();
    const role = s.role.trim();
    if (!content_type || !role) continue;
    byType.set(content_type, { content_type, role });
  }
  return Array.from(byType.values());
}

function writeFunnel(
  contentType: string,
  slug: string,
  steps: FunnelStep[],
  trafficSources: FunnelTrafficSource[],
): { ok: true; file: string } | { ok: false; error: string } {
  const root = getDefaultContentRoot();
  const typesPath = path.join(root, "content-types.yml");
  let dirName = contentType === "program" ? "programs" : contentType;
  try {
    const parsed = yaml.load(fs.readFileSync(typesPath, "utf-8")) as Record<
      string,
      { directory?: string }
    > | null;
    if (parsed?.[contentType]?.directory) dirName = parsed[contentType].directory!;
  } catch {
    // default
  }
  const filePath = path.join(root, dirName, slug, "_ecommerce.yml");
  if (!fs.existsSync(filePath)) {
    return { ok: false, error: `_ecommerce.yml not found for ${contentType}/${slug}` };
  }
  let doc: Record<string, unknown>;
  try {
    doc = (yaml.load(fs.readFileSync(filePath, "utf-8")) as Record<string, unknown>) ?? {};
  } catch (err) {
    return { ok: false, error: `Failed to parse ${filePath}: ${String(err)}` };
  }
  const traffic_sources = dedupeTrafficSources(trafficSources);
  doc.funnel = { steps, traffic_sources };
  // Drop legacy plans if present
  delete doc.plans;
  const dumped = yaml.dump(doc, { lineWidth: -1, noRefs: true, quotingType: '"', forceQuotes: false });
  fs.writeFileSync(filePath, dumped, "utf-8");
  markFileAsModified(filePath);
  try {
    scanEcommerceContent();
  } catch (err) {
    log.warn({ err }, "[EcommerceRoutes] rescan after funnel write failed");
  }
  return { ok: true, file: path.relative(process.cwd(), filePath) };
}

export function registerEcommerceRoutes(app: Express): void {
  app.get("/api/ecommerce/products", (_req, res) => {
    try {
      const products = ecommerceManager.getAllProducts();
      res.json({ products, settings: ecommerceManager.getSettings() });
    } catch (err) {
      log.error({ err }, "[EcommerceRoutes] GET /api/ecommerce/products:");
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get("/api/ecommerce/product-map", (_req, res) => {
    try {
      const products = ecommerceManager.getAllProducts().map((p) => ({
        product_id: p.product_id,
        name: p.name,
        content_type: p.content_type,
        content_slug: p.content_slug,
        active: p.active,
      }));
      res.json({ products });
    } catch (err) {
      log.error({ err }, "[EcommerceRoutes] GET /api/ecommerce/product-map:");
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get("/api/ecommerce/events", (_req, res) => {
    try {
      res.json({
        events: ECOMMERCE_EVENT_CATALOG,
        usage: scanEcommerceComponentUsage(),
        product_count: ecommerceManager.getAllProducts().length,
        education: {
          summary:
            "Ecommerce funnel events are purchasable-gated. Call sites send selection fields; trackEcommerce resolves product identity from _ecommerce.yml. Visitor session (user_id, geo, language, UTMs) is pushed once via setVisitorContext — not re-attached on every ecommerce event. Forms/conversions are separate. CMS does not manage billing plans. This site fires click_begin_checkout; begin_checkout and purchase are off-site (learn POS).",
          advanced_paths: [
            "docs/component-behaviors.md",
            "docs/gtm-analytics-setup.md",
            "mcp-server/explain/ecommerce.md",
            "client/src/lib/tracking.ts",
            "client/src/lib/ecommerceProgramId.ts",
            "client/src/lib/ecommerceProductMap.ts",
            "shared/component-behaviors.ts",
            "shared/resolveProductScope.ts",
          ],
        },
      });
    } catch (err) {
      log.error({ err }, "[EcommerceRoutes] GET /api/ecommerce/events:");
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get("/api/ecommerce/funnel/:slug", (req, res) => {
    const parsed = slugSchema.safeParse(req.params);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid slug" });
    }
    try {
      const slug = parsed.data.slug;
      const product =
        ecommerceManager.findProductByCmsEntry("program", slug) ||
        ecommerceManager.getAllProducts().find((p) => p.content_slug === slug);
      if (!product) {
        return res.status(404).json({ error: `No purchasable product for slug "${slug}"` });
      }
      const resolved = ecommerceManager.resolveProduct(product.product_id);
      const usage = scanEcommerceComponentUsage();
      const { steps, suggestions } = buildEffectiveFunnel(
        product.content_slug,
        product.content_type,
        product.funnel.steps,
      );
      res.json({
        product: resolved,
        funnel: {
          traffic_sources: product.funnel.traffic_sources ?? [],
          steps,
          suggestions,
          components: usage.map((u) => ({
            type: u.component_type,
            events: u.events,
            role: u.role,
          })),
        },
        education: {
          summary:
            "Conversion journey = top-of-funnel traffic_sources (by content type) + locked product page + authored funnel.steps + auto pages with ecommerce_products: all. Traffic sources are documentation only — not URL steps. CMS does not manage billing plans. Purchase is off-site.",
          advanced_paths: [
            `site_4geeks-com/programs/${slug}/_ecommerce.yml`,
            "funnel.traffic_sources",
            "funnel.steps",
            "server/routes/ecommerce.ts",
            "shared/resolveProductScope.ts",
            "mcp-server/explain/ecommerce.md",
          ],
        },
      });
    } catch (err) {
      log.error({ err }, "[EcommerceRoutes] GET /api/ecommerce/funnel/:slug:");
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.put("/api/ecommerce/funnel/:slug", async (req: Request, res: Response) => {
    const auth = await requireCapability(req, res, "content_edit_structure", "program");
    if (!auth.authorized) return;

    const parsedParams = slugSchema.safeParse(req.params);
    if (!parsedParams.success) {
      return res.status(400).json({ error: "Invalid slug" });
    }
    const body = putFunnelSchema.safeParse(req.body);
    if (!body.success) {
      return res.status(400).json({ error: "Invalid body", details: body.error.flatten() });
    }

    const slug = parsedParams.data.slug;
    const product =
      ecommerceManager.findProductByCmsEntry("program", slug) ||
      ecommerceManager.getAllProducts().find((p) => p.content_slug === slug);
    if (!product) {
      return res.status(404).json({ error: `No purchasable product for slug "${slug}"` });
    }

    for (const step of body.data.steps) {
      if (step.content_type === product.content_type && step.slug === product.content_slug) {
        return res.status(400).json({
          error:
            "Do not include the product entry in funnel.steps — it is always locked step 0. Path: _ecommerce.yml funnel.steps",
        });
      }
      if (!entryExists(step.content_type, step.slug)) {
        return res.status(400).json({
          error: `Funnel step ${step.content_type}/${step.slug} does not resolve to any locale URL`,
        });
      }
    }

    const traffic_sources = dedupeTrafficSources(
      body.data.traffic_sources ?? product.funnel.traffic_sources ?? [],
    );
    const written = writeFunnel(
      product.content_type,
      product.content_slug,
      body.data.steps,
      traffic_sources,
    );
    if (!written.ok) {
      return res.status(500).json({ error: written.error });
    }
    res.json({
      success: true,
      file: written.file,
      steps: body.data.steps,
      traffic_sources,
    });
  });

  app.get("/api/ecommerce/products/:productId", (req, res) => {
    const parsed = productIdSchema.safeParse(req.params);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid product ID" });
    }

    try {
      const resolved = ecommerceManager.resolveProduct(parsed.data.productId);
      if (!resolved) {
        return res.status(404).json({ error: `Product "${parsed.data.productId}" not found` });
      }
      res.json({ product: resolved, settings: ecommerceManager.getSettings() });
    } catch (err) {
      log.error({ err }, `[EcommerceRoutes] GET /api/ecommerce/products/${parsed.data.productId}:`);
      res.status(500).json({ error: "Internal server error" });
    }
  });
}
