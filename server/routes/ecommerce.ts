/**
 * Ecommerce REST routes.
 *
 * GET /api/ecommerce/products
 * GET /api/ecommerce/product-map
 * GET /api/ecommerce/events
 * GET /api/ecommerce/funnel/:slug
 * GET /api/ecommerce/products/:productId
 * GET /api/ecommerce/plans/:planId
 */

import type { Express } from "express";
import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";
import { z } from "zod";
import { ecommerceManager } from "../ecommerce/ecommerce-manager";
import { getDefaultContentRoot } from "../site-config";
import { resolveComponentBehaviors } from "@shared/component-behaviors";
import { child } from "../logger";

const log = child({ module: "routes/ecommerce" });

const productIdSchema = z.object({
  productId: z.string().min(1).regex(/^[a-z0-9-_]+$/i),
});

const planIdSchema = z.object({
  planId: z.string().min(1).regex(/^[a-z0-9-_]+$/i),
});

const slugSchema = z.object({
  slug: z.string().min(1).regex(/^[a-z0-9-_]+$/i),
});

const ECOMMERCE_EVENT_CATALOG = [
  {
    name: "view_item",
    wired: true,
    description: "Hero course (or product page) when a purchasable product resolves",
    sample: { event: "view_item", item_id: "program-ai-fluency", program_id: "ai-fluency", item_category: "program" },
  },
  {
    name: "add_to_cart",
    wired: true,
    description: "CTA with tracking=add_to_cart (e.: payment-component configurator)",
    sample: { event: "add_to_cart", item_id: "program-ai-fluency", program_id: "ai-fluency" },
  },
  {
    name: "view_item_list",
    wired: true,
    description: "enrollment_selector / pricing_plans when viewport-visible",
    sample: { event: "view_item_list", item_list_name: "enrollment_selector", program_id: "ai-fluency" },
  },
  {
    name: "select_item",
    wired: true,
    description: "User changes program in enrollment_selector (debounced)",
    sample: { event: "select_item", program_id: "ai-fluency", item_id: "program-ai-fluency" },
  },
  {
    name: "begin_checkout",
    wired: true,
    description: "CTA with tracking=begin_checkout (external POS)",
    sample: { event: "begin_checkout", program_id: "ai-fluency", item_id: "program-ai-fluency" },
  },
  {
    name: "purchase",
    wired: false,
    description: "Off-site only (4geeks.com checkout POS). Not fired from this site.",
    sample: { event: "purchase", item_id: "program-ai-fluency", note: "off-site" },
  },
] as const;

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

function collectFunnelPages(slug: string): Array<{ path: string; locale?: string; file: string }> {
  const pages: Array<{ path: string; locale?: string; file: string }> = [];
  try {
    const root = getDefaultContentRoot();
    const programDir = path.join(root, "programs", slug);
    if (fs.existsSync(programDir)) {
      for (const f of fs.readdirSync(programDir)) {
        if (!/\.ya?ml$/.test(f) || f.startsWith("_")) continue;
        const locale = f.replace(/\.(yml|yaml)$/, "").split(".").pop();
        pages.push({
          path: `/us/${slug}`,
          locale: locale === "en" || locale === "es" ? locale : undefined,
          file: path.relative(process.cwd(), path.join(programDir, f)),
        });
      }
    }
    const paymentEn = path.join(root, "pages/payment-component/en.yml");
    if (fs.existsSync(paymentEn)) {
      const raw = fs.readFileSync(paymentEn, "utf-8");
      if (raw.includes(`id: ${slug}`) || raw.includes(`program=${slug}`) || raw.includes(`"${slug}"`)) {
        pages.push({
          path: "/payment-component",
          locale: "en",
          file: path.relative(process.cwd(), paymentEn),
        });
      }
    }
  } catch {
    // non-fatal
  }
  return pages;
}

export function registerEcommerceRoutes(app: Express): void {
  app.get("/api/ecommerce/products", (_req, res) => {
    try {
      const products = ecommerceManager.getAllProducts().map((p) => ({
        ...p,
        plans: ecommerceManager.resolvePlans(p.plans),
      }));
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
            "Ecommerce funnel events are purchasable-gated. Forms/conversions are separate. Purchase completes off-site.",
          advanced_paths: [
            "docs/component-behaviors.md",
            "client/src/lib/tracking.ts",
            "shared/component-behaviors.ts",
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
      res.json({
        product: resolved,
        funnel: {
          pages: collectFunnelPages(slug),
          components: usage.map((u) => ({
            type: u.component_type,
            events: u.events,
            role: u.role,
          })),
        },
        education: {
          summary:
            "Product identity comes from programs/{slug}/_ecommerce.yml with purchasable: true. Never use the payment-component page slug as the product id.",
          advanced_paths: [
            "site_4geeks-com/programs/_ecommerce.yml",
            `site_4geeks-com/programs/${slug}/_ecommerce.yml`,
            "server/ecommerce/ecommerce-index.ts",
          ],
        },
      });
    } catch (err) {
      log.error({ err }, "[EcommerceRoutes] GET /api/ecommerce/funnel/:slug:");
      res.status(500).json({ error: "Internal server error" });
    }
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

  app.get("/api/ecommerce/plans/:planId", (req, res) => {
    const parsed = planIdSchema.safeParse(req.params);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid plan ID" });
    }

    try {
      const plan = ecommerceManager.getPlan(parsed.data.planId);
      if (!plan) {
        return res.status(404).json({ error: `Plan "${parsed.data.planId}" not found` });
      }
      res.json({ plan, settings: ecommerceManager.getSettings() });
    } catch (err) {
      log.error({ err }, `[EcommerceRoutes] GET /api/ecommerce/plans/${parsed.data.planId}:`);
      res.status(500).json({ error: "Internal server error" });
    }
  });
}
