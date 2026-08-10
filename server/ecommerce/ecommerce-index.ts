/**
 * Ecommerce Index — startup scanner.
 *
 * Reads ecommerce-settings.yml for global currency/locale/tax.
 * Discovers co-located _ecommerce.yml files by walking content-type
 * directories. Only entries with purchasable: true become products.
 * Optional funnel.steps are authored conversion steps (after the product page).
 * Optional funnel.traffic_sources document inbound content types (top of funnel).
 */

import fs from "fs";
import { getDefaultContentRoot } from "../site-config";
import path from "path";
import { contentIndex } from "../content-index";
import type {
  EcommerceProduct,
  EcommerceSettings,
  FunnelStep,
  FunnelTrafficSource,
} from "./types";
import { child } from "../logger";
const log = child({ module: "ecommerce/ecommerce-index" });

export const MARKETING_CONTENT_DIR = getDefaultContentRoot();
export const ECOMMERCE_SETTINGS_PATH = path.join(MARKETING_CONTENT_DIR, "ecommerce-settings.yml");
const CONTENT_TYPES_PATH = path.join(MARKETING_CONTENT_DIR, "content-types.yml");

function buildDirToContentTypeMap(): Map<string, string> {
  const map = new Map<string, string>();
  if (!fs.existsSync(CONTENT_TYPES_PATH)) return map;
  try {
    const raw = fs.readFileSync(CONTENT_TYPES_PATH, "utf-8");
    const parsed = contentIndex.safeYamlLoad(raw) as Record<string, unknown> | null;
    if (!parsed) return map;
    for (const [canonicalKey, def] of Object.entries(parsed)) {
      if (def && typeof def === "object" && !Array.isArray(def)) {
        const d = def as Record<string, unknown>;
        const dirName = typeof d.directory === "string" ? d.directory : canonicalKey;
        map.set(dirName, canonicalKey);
      }
    }
  } catch {
    // non-fatal
  }
  return map;
}

const DEFAULTS_SETTINGS: EcommerceSettings = {
  currency: "USD",
  locale: "en-US",
  tax_inclusive: false,
};

export const productMap = new Map<string, EcommerceProduct>();
export let ecommerceSettings: EcommerceSettings = { ...DEFAULTS_SETTINGS };

function loadGlobalSettings(): EcommerceSettings {
  if (!fs.existsSync(ECOMMERCE_SETTINGS_PATH)) {
    return { ...DEFAULTS_SETTINGS };
  }
  try {
    const raw = fs.readFileSync(ECOMMERCE_SETTINGS_PATH, "utf-8");
    const parsed = contentIndex.safeYamlLoad(raw) as Record<string, unknown> | null;
    if (!parsed) return { ...DEFAULTS_SETTINGS };

    return {
      currency: typeof parsed.currency === "string" ? parsed.currency : DEFAULTS_SETTINGS.currency,
      locale: typeof parsed.locale === "string" ? parsed.locale : DEFAULTS_SETTINGS.locale,
      tax_inclusive:
        typeof parsed.tax_inclusive === "boolean"
          ? parsed.tax_inclusive
          : DEFAULTS_SETTINGS.tax_inclusive,
    };
  } catch (err) {
    log.error({ err }, "[EcommerceIndex] Failed to parse ecommerce-settings.yml:");
    return { ...DEFAULTS_SETTINGS };
  }
}

function loadYml(filePath: string): Record<string, unknown> | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = contentIndex.safeYamlLoad(raw) as Record<string, unknown> | null;
    return parsed ?? null;
  } catch (err) {
    log.error({ err }, `[EcommerceIndex] Failed to parse ${filePath}:`);
    return null;
  }
}

function parseFunnelSteps(merged: Record<string, unknown>): FunnelStep[] {
  const funnel = merged.funnel;
  if (!funnel || typeof funnel !== "object" || Array.isArray(funnel)) return [];
  const stepsRaw = (funnel as Record<string, unknown>).steps;
  if (!Array.isArray(stepsRaw)) return [];
  const steps: FunnelStep[] = [];
  for (const s of stepsRaw) {
    if (!s || typeof s !== "object" || Array.isArray(s)) continue;
    const o = s as Record<string, unknown>;
    if (typeof o.content_type !== "string" || typeof o.slug !== "string") continue;
    steps.push({
      content_type: o.content_type,
      slug: o.slug,
      role: typeof o.role === "string" ? o.role : undefined,
    });
  }
  return steps;
}

function parseFunnelTrafficSources(merged: Record<string, unknown>): FunnelTrafficSource[] {
  const funnel = merged.funnel;
  if (!funnel || typeof funnel !== "object" || Array.isArray(funnel)) return [];
  const raw = (funnel as Record<string, unknown>).traffic_sources;
  if (!Array.isArray(raw)) return [];
  const byType = new Map<string, FunnelTrafficSource>();
  for (const s of raw) {
    if (!s || typeof s !== "object" || Array.isArray(s)) continue;
    const o = s as Record<string, unknown>;
    if (typeof o.content_type !== "string" || !o.content_type.trim()) continue;
    if (typeof o.role !== "string" || !o.role.trim()) continue;
    const content_type = o.content_type.trim();
    byType.set(content_type, { content_type, role: o.role.trim() });
  }
  return Array.from(byType.values());
}

export function scanEcommerceContent(): void {
  productMap.clear();
  ecommerceSettings = loadGlobalSettings();
  log.info("[EcommerceIndex] Loaded ecommerce settings (no CMS plan catalog)");

  let productCount = 0;
  if (!fs.existsSync(MARKETING_CONTENT_DIR)) return;

  const dirToCanonicalKey = buildDirToContentTypeMap();

  for (const [dirName, canonicalKey] of dirToCanonicalKey.entries()) {
    const typeDirPath = path.join(MARKETING_CONTENT_DIR, dirName);
    if (!fs.existsSync(typeDirPath)) continue;

    const typeConfig = loadYml(path.join(typeDirPath, "_ecommerce.yml")) ?? {};

    const entries = fs
      .readdirSync(typeDirPath, { withFileTypes: true })
      .filter((d) => d.isDirectory());

    for (const entryDir of entries) {
      const slug = entryDir.name;
      const entryConfigPath = path.join(typeDirPath, slug, "_ecommerce.yml");
      const entryConfig = loadYml(entryConfigPath);
      if (!entryConfig) continue;

      const merged = { ...typeConfig, ...entryConfig };
      // Deep-merge funnel from entry over type
      const typeFunnel = typeConfig.funnel;
      const entryFunnel = entryConfig.funnel;
      if (entryFunnel && typeof entryFunnel === "object") {
        merged.funnel = entryFunnel;
      } else if (typeFunnel && typeof typeFunnel === "object") {
        merged.funnel = typeFunnel;
      }

      const purchasable = typeof merged.purchasable === "boolean" ? merged.purchasable : false;
      if (!purchasable) continue;

      const productId =
        typeof merged.product_id === "string"
          ? merged.product_id
          : `${canonicalKey}-${slug}`;

      const product: EcommerceProduct = {
        product_id: productId,
        name: typeof merged.name === "string" ? merged.name : slug,
        content_type: canonicalKey,
        content_slug: slug,
        active: typeof merged.active === "boolean" ? merged.active : true,
        description: typeof merged.description === "string" ? merged.description : undefined,
        funnel: {
          steps: parseFunnelSteps(merged),
          traffic_sources: parseFunnelTrafficSources(merged),
        },
      };

      productMap.set(productId, product);
      productCount++;
    }
  }

  log.info(`[EcommerceIndex] Scanned ${productCount} products from co-located _ecommerce.yml files`);
}

let watcherStarted = false;

export function startEcommerceWatcher(): void {
  if (watcherStarted || !fs.existsSync(MARKETING_CONTENT_DIR)) return;
  watcherStarted = true;

  fs.watch(MARKETING_CONTENT_DIR, { recursive: true }, (_event, filename) => {
    if (!filename) return;
    const isSettingsFile = filename === "ecommerce-settings.yml";
    const isEcommerceFile =
      filename.endsWith("_ecommerce.yml") || filename.endsWith("_ecommerce.yaml");
    if (!isSettingsFile && !isEcommerceFile) return;
    log.info(`[EcommerceIndex] File changed: ${filename} — rescanning`);
    try {
      scanEcommerceContent();
    } catch (err) {
      log.error({ err }, "[EcommerceIndex] Error during rescan:");
    }
  });
}
