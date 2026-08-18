/**
 * Store conversion journey: pages whose _common.yml funnel.products includes a SKU
 * (or all), grouped by funnel.stage. Read-only query — membership is edited per page.
 */

import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";
import {
  effectiveProducts,
  FUNNEL_STAGES,
  scopeIncludesProduct,
  type FunnelStage,
} from "@shared/funnel";
import { readFunnelBlockFromFile, commonYmlPath } from "../funnel-fields";
import { contentIndex } from "../content-index";
import { getDefaultContentRoot } from "../site-config";
import { ecommerceManager } from "./ecommerce-manager";

export type JourneyPageRow = {
  content_type: string;
  slug: string;
  stage: FunnelStage | string;
  urls: Record<string, string>;
  files: string[];
};

export type ProductFunnelJourney = {
  locked: JourneyPageRow;
  stages: Record<FunnelStage, JourneyPageRow[]>;
};

function resolveStepMeta(
  contentType: string,
  slug: string,
): { urls: Record<string, string>; files: string[] } {
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
    // default dirName
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

function isActivePurchasableSlug(slug: string): boolean {
  const p =
    ecommerceManager.findProductByCmsEntry("program", slug) ||
    ecommerceManager.getAllProducts().find((x) => x.content_slug === slug);
  return !!p && p.actively_selling !== false;
}

/** Pages grouped by funnel.stage for a product SKU (4B: inactive product → empty journey). */
export function buildProductFunnelJourney(
  productSlug: string,
  productContentType: string,
  contentRoot?: string,
): ProductFunnelJourney {
  const stages = Object.fromEntries(
    FUNNEL_STAGES.map((s) => [s, [] as JourneyPageRow[]]),
  ) as Record<FunnelStage, JourneyPageRow[]>;

  const lockedMeta = resolveStepMeta(productContentType, productSlug);
  const locked: JourneyPageRow = {
    content_type: productContentType,
    slug: productSlug,
    stage: "decision",
    ...lockedMeta,
  };

  if (!isActivePurchasableSlug(productSlug)) {
    return { locked, stages };
  }

  const seen = new Set<string>();
  for (const entry of contentIndex.listAll()) {
    const ct = entry.contentType;
    const slug = entry.slug;
    const key = `${ct}/${slug}`;
    if (seen.has(key)) continue;
    seen.add(key);

    if (ct === productContentType && slug === productSlug) continue;

    const funnel = readFunnelBlockFromFile(commonYmlPath(ct, slug, contentRoot));
    const stageRaw = funnel.stage;
    if (typeof stageRaw !== "string" || !stageRaw.trim()) continue;

    const effective = effectiveProducts(funnel, { contentType: ct, contentSlug: slug });
    if (!effective || !scopeIncludesProduct(effective, productSlug)) continue;

    const stage = stageRaw.trim() as FunnelStage;
    const bucket = (FUNNEL_STAGES as readonly string[]).includes(stage)
      ? stages[stage as FunnelStage]
      : null;
    if (!bucket) continue;

    bucket.push({
      content_type: ct,
      slug,
      stage,
      ...resolveStepMeta(ct, slug),
    });
  }

  for (const stage of FUNNEL_STAGES) {
    stages[stage].sort((a, b) => a.slug.localeCompare(b.slug));
  }

  return { locked, stages };
}
