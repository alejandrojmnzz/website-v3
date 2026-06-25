/**
 * Ecommerce Index — startup scanner.
 *
 * Reads marketing-content/ecommerce-settings.yml for global config and plan
 * definitions. Discovers co-located _ecommerce.yml files by walking content-type
 * directories under marketing-content/:
 *
 *   marketing-content/<content-type>/_ecommerce.yml          — type-level defaults
 *   marketing-content/<content-type>/<slug>/_ecommerce.yml   — entry-level config
 *
 * Entry-level files are deep-merged with type-level defaults to build an
 * EcommerceProduct. Only entries with purchasable: true become products.
 *
 * A file-watcher keeps the maps fresh when YAML files change without a server
 * restart. Zero filesystem I/O occurs at request time — all data is read from
 * in-memory maps.
 */

import fs from "fs";
import path from "path";
import { contentIndex } from "../content-index";
import type { EcommerceProduct, EcommercePlan, EcommerceSettings } from "./types";
import { child } from "../logger";
const log = child({ module: "ecommerce/ecommerce-index" });



export const MARKETING_CONTENT_DIR = path.join(process.cwd(), process.env.CONTENT_FOLDER || "marketing-content");
export const ECOMMERCE_SETTINGS_PATH = path.join(MARKETING_CONTENT_DIR, "ecommerce-settings.yml");
const CONTENT_TYPES_PATH = path.join(MARKETING_CONTENT_DIR, "content-types.yml");

/**
 * Builds a map from directory name → canonical content-type key by reading
 * content-types.yml. Falls back to an empty map if the file cannot be parsed.
 *
 * Example: "programs" → "program", "locations" → "location"
 */
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
    // non-fatal — scanner falls back to using directory names as-is
  }
  return map;
}

const DEFAULTS_SETTINGS: EcommerceSettings = {
  currency: "USD",
  locale: "en-US",
  tax_inclusive: false,
};

export const productMap = new Map<string, EcommerceProduct>();
export const planMap = new Map<string, EcommercePlan>();
export let ecommerceSettings: EcommerceSettings = { ...DEFAULTS_SETTINGS };

// ------------------------------------------------------------------
// Loaders
// ------------------------------------------------------------------

function loadGlobalSettings(): { settings: EcommerceSettings; plansRaw: Record<string, unknown> } {
  if (!fs.existsSync(ECOMMERCE_SETTINGS_PATH)) {
    return { settings: { ...DEFAULTS_SETTINGS }, plansRaw: {} };
  }
  try {
    const raw = fs.readFileSync(ECOMMERCE_SETTINGS_PATH, "utf-8");
    const parsed = contentIndex.safeYamlLoad(raw) as Record<string, unknown> | null;
    if (!parsed) return { settings: { ...DEFAULTS_SETTINGS }, plansRaw: {} };

    const settings: EcommerceSettings = {
      currency: typeof parsed.currency === "string" ? parsed.currency : DEFAULTS_SETTINGS.currency,
      locale: typeof parsed.locale === "string" ? parsed.locale : DEFAULTS_SETTINGS.locale,
      tax_inclusive:
        typeof parsed.tax_inclusive === "boolean"
          ? parsed.tax_inclusive
          : DEFAULTS_SETTINGS.tax_inclusive,
    };

    const plansRaw =
      parsed.plans && typeof parsed.plans === "object" && !Array.isArray(parsed.plans)
        ? (parsed.plans as Record<string, unknown>)
        : {};

    return { settings, plansRaw };
  } catch (err) {
    log.error({ err: err }, "[EcommerceIndex] Failed to parse ecommerce-settings.yml:");
    return { settings: { ...DEFAULTS_SETTINGS }, plansRaw: {} };
  }
}

function parsePlanFromMap(
  planId: string,
  raw: unknown,
  fallbackCurrency: string,
): EcommercePlan | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const p = raw as Record<string, unknown>;

  const name = typeof p.name === "string" ? p.name : null;
  const price = typeof p.price === "number" ? p.price : null;

  if (!name || price === null) {
    log.warn(`[EcommerceIndex] Skipping plan "${planId}" — missing name or price`);
    return null;
  }

  const features = Array.isArray(p.features)
    ? (p.features as unknown[]).filter((f): f is string => typeof f === "string")
    : [];

  return {
    plan_id: planId,
    name,
    price,
    currency: typeof p.currency === "string" ? p.currency : fallbackCurrency,
    billing_period:
      typeof p.billing_period === "string"
        ? (p.billing_period as EcommercePlan["billing_period"])
        : "monthly",
    highlighted: typeof p.highlighted === "boolean" ? p.highlighted : false,
    badge: typeof p.badge === "string" ? p.badge : undefined,
    trial_days: typeof p.trial_days === "number" ? p.trial_days : undefined,
    features,
  };
}

/** Loads the optional YAML file at filePath and returns parsed object or null. */
function loadYml(filePath: string): Record<string, unknown> | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = contentIndex.safeYamlLoad(raw) as Record<string, unknown> | null;
    return parsed ?? null;
  } catch (err) {
    log.error({ err: err }, `[EcommerceIndex] Failed to parse ${filePath}:`);
    return null;
  }
}

// ------------------------------------------------------------------
// Scanner
// ------------------------------------------------------------------

export function scanEcommerceContent(): void {
  productMap.clear();
  planMap.clear();

  // 1. Load global settings and plans
  const { settings, plansRaw } = loadGlobalSettings();
  ecommerceSettings = settings;

  for (const [planId, planData] of Object.entries(plansRaw)) {
    const plan = parsePlanFromMap(planId, planData, settings.currency);
    if (plan) planMap.set(planId, plan);
  }
  log.info(`[EcommerceIndex] Loaded ${planMap.size} plans from ecommerce-settings.yml`);

  // 2. Walk content-type directories.
  //    Use content-types.yml to resolve canonical keys (e.g. "programs" → "program")
  //    so that product.content_type matches what callers pass to findProductByCmsEntry().
  let productCount = 0;
  if (!fs.existsSync(MARKETING_CONTENT_DIR)) return;

  const dirToCanonicalKey = buildDirToContentTypeMap();

  // Only iterate directories that appear in content-types.yml; this naturally
  // excludes non-content-type dirs like component-registry, db, images, menus, etc.
  for (const [dirName, canonicalKey] of dirToCanonicalKey.entries()) {
    const typeDirPath = path.join(MARKETING_CONTENT_DIR, dirName);
    if (!fs.existsSync(typeDirPath)) continue;

    // Load type-level defaults
    const typeConfig = loadYml(path.join(typeDirPath, "_ecommerce.yml")) ?? {};

    // Walk entry subdirectories
    const entries = fs
      .readdirSync(typeDirPath, { withFileTypes: true })
      .filter((d) => d.isDirectory());

    for (const entryDir of entries) {
      const slug = entryDir.name;
      const entryConfigPath = path.join(typeDirPath, slug, "_ecommerce.yml");
      const entryConfig = loadYml(entryConfigPath);
      if (!entryConfig) continue;

      // Deep-merge: type-level defaults ← entry-level overrides
      const merged = { ...typeConfig, ...entryConfig };

      // Only purchasable entries become products
      const purchasable = typeof merged.purchasable === "boolean" ? merged.purchasable : false;
      if (!purchasable) continue;

      // Derived ID uses a hyphen separator so it is safe for API route params
      const productId =
        typeof merged.product_id === "string"
          ? merged.product_id
          : `${canonicalKey}-${slug}`;

      const plans = Array.isArray(merged.plans)
        ? (merged.plans as unknown[]).filter((p): p is string => typeof p === "string")
        : [];

      const product: EcommerceProduct = {
        product_id: productId,
        name: typeof merged.name === "string" ? merged.name : slug,
        content_type: canonicalKey,   // canonical key, not directory name
        content_slug: slug,
        plans,
        active: typeof merged.active === "boolean" ? merged.active : true,
        description: typeof merged.description === "string" ? merged.description : undefined,
      };

      productMap.set(productId, product);
      productCount++;
    }
  }

  log.info(`[EcommerceIndex] Scanned ${productCount} products from co-located _ecommerce.yml files`);
}

// ------------------------------------------------------------------
// File watcher
// ------------------------------------------------------------------

let watcherStarted = false;

export function startEcommerceWatcher(): void {
  if (watcherStarted || !fs.existsSync(MARKETING_CONTENT_DIR)) return;
  watcherStarted = true;

  // Watch the full marketing-content/ tree; filter on _ecommerce.yml / ecommerce-settings.yml
  fs.watch(MARKETING_CONTENT_DIR, { recursive: true }, (event, filename) => {
    if (!filename) return;
    const isSettingsFile = filename === "ecommerce-settings.yml";
    const isEcommerceFile = filename.endsWith("_ecommerce.yml") || filename.endsWith("_ecommerce.yaml");
    if (!isSettingsFile && !isEcommerceFile) return;
    log.info(`[EcommerceIndex] File changed: ${filename} — rescanning`);
    try {
      scanEcommerceContent();
    } catch (err) {
      log.error({ err: err }, "[EcommerceIndex] Error during rescan:");
    }
  });
}
