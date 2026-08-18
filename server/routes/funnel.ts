/**
 * REST routes for page-level funnel fields on _common.yml.
 */

import type { Express, Request, Response } from "express";
import { z } from "zod";
import { ecommerceManager } from "../ecommerce/ecommerce-manager";
import {
  coerceFunnelInput,
  readFunnelBlockFromFile,
  writeFunnelBlock,
  commonYmlPath,
} from "../funnel-fields";
import {
  effectiveProducts,
  enrollmentIdsOutsideFunnel,
  funnelHasProductsWithoutStage,
  type FunnelBlock,
} from "@shared/funnel";
import { requireCapability } from "./_helpers";
import { getDefaultContentRoot } from "../site-config";
import { contentIndex } from "../content-index";
import { markFileAsModified } from "../sync-state";
import { child } from "../logger";
import { enrollmentCardIds } from "@shared/resolveProductScope";

const log = child({ module: "routes/funnel" });

function getContentRoot(res: Response): string {
  return (res.locals.site as { contentRoot?: string } | undefined)?.contentRoot ?? getDefaultContentRoot();
}

const funnelPutSchema = z.object({
  stage: z.string().optional().nullable(),
  products: z.union([z.literal("all"), z.array(z.string()), z.null()]).optional(),
});

function resolveProductActive(slug: string): { active: boolean } | undefined {
  const p =
    ecommerceManager.findProductByCmsEntry("program", slug) ||
    ecommerceManager.getAllProducts().find((x) => x.content_slug === slug);
  if (!p) return undefined;
  return { active: p.actively_selling !== false };
}

function inactiveProductWarnings(funnel: FunnelBlock): { code: string; message: string }[] {
  const scope = effectiveProducts(funnel, {});
  if (!scope || scope === "all") return [];
  const warnings: { code: string; message: string }[] = [];
  for (const slug of scope) {
    const r = resolveProductActive(slug);
    if (!r?.active) {
      warnings.push({
        code: "inactive_product",
        message: `Product "${slug}" is unknown or not actively selling — skipped in Store and tracking.`,
      });
    }
  }
  return warnings;
}

function storeJourneyMembership(
  contentType: string,
  slug: string,
  funnel: FunnelBlock,
): { productSlug: string; stage: string }[] {
  const stage = typeof funnel.stage === "string" ? funnel.stage : "";
  if (!stage) return [];
  const scope = effectiveProducts(funnel, { contentType, contentSlug: slug });
  if (!scope) return [];

  const products = ecommerceManager.getAllProducts().filter((p) => p.actively_selling !== false);
  const out: { productSlug: string; stage: string }[] = [];
  for (const product of products) {
    const ps = product.content_slug;
    if (scope === "all" || scope.includes(ps)) {
      out.push({ productSlug: ps, stage });
    }
  }
  return out;
}

export function registerFunnelRoutes(app: Express): void {
  app.get("/api/content-types/:type/funnel/:slug", async (req: Request, res: Response) => {
    try {
      const contentType = req.params.type;
      const slug = req.params.slug;
      const contentRoot = getContentRoot(res);
      const filePath = commonYmlPath(contentType, slug, contentRoot);
      const funnel = readFunnelBlockFromFile(filePath);
      const effective = effectiveProducts(funnel, { contentType, contentSlug: slug });

      const enrollmentWarnings: { code: string; message: string; ids: string[] }[] = [];
      const merged = contentIndex.loadMergedContent(contentType, slug, "en");
      const sections = (merged.data as { sections?: unknown[] } | null)?.sections;
      if (Array.isArray(sections)) {
        const allCardIds: string[] = [];
        for (const sec of sections) {
          if (!sec || typeof sec !== "object") continue;
          allCardIds.push(...enrollmentCardIds(sec as Record<string, unknown>));
        }
        const outside = enrollmentIdsOutsideFunnel(allCardIds, funnel, {
          contentType,
          contentSlug: slug,
        });
        if (outside.length > 0) {
          enrollmentWarnings.push({
            code: "enrollment_outside_funnel",
            message:
              "Enrollment card program ids not in page funnel.products — allowed, but journey membership differs.",
            ids: outside,
          });
        }
      }

      const relPath = filePath.includes(contentRoot)
        ? filePath.slice(filePath.indexOf(contentRoot)).replace(/^\//, "")
        : filePath;

      res.json({
        funnel,
        effectiveProducts: effective ?? null,
        storeMembership: storeJourneyMembership(contentType, slug, funnel),
        warnings: [
          ...(funnelHasProductsWithoutStage(funnel)
            ? [
                {
                  code: "products_without_stage",
                  message:
                    "Products are set but stage is missing. Diagnostics counts Unknown; Store hides this page.",
                },
              ]
            : []),
          ...inactiveProductWarnings(funnel),
          ...enrollmentWarnings,
        ],
        relativePath: relPath,
      });
    } catch (err) {
      log.error({ err }, "GET funnel");
      res.status(500).json({ error: String(err) });
    }
  });

  app.put("/api/content-types/:type/funnel/:slug", async (req: Request, res: Response) => {
    const auth = await requireCapability(req, res, "content_edit_structure", req.params.type);
    if (!auth.authorized) return;

    const parsed = funnelPutSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    }

    try {
      const contentType = req.params.type;
      const slug = req.params.slug;
      const contentRoot = getContentRoot(res);
      const coerced = coerceFunnelInput(parsed.data);
      if (!coerced.ok) {
        return res.status(400).json({ error: coerced.error, code: coerced.code });
      }

      const { relativePath } = writeFunnelBlock(contentType, slug, coerced.coerced, contentRoot);
      markFileAsModified(relativePath, auth.author ?? "staff", undefined, contentRoot);

      res.json({
        success: true,
        funnel: coerced.coerced,
        warnings: [...coerced.warnings, ...inactiveProductWarnings(coerced.coerced)],
        relativePath,
      });
    } catch (err) {
      log.error({ err }, "PUT funnel");
      res.status(500).json({ error: String(err) });
    }
  });
}
