/**
 * Lazy-load registry for section components.
 *
 * Resolution priority (highest wins):
 *   1. site_4geeks-com/component-registry/{type}/variants/*.tsx  (site-specific)
 *   2. client/src/components/{type}/variants/*.tsx                 (shared platform)
 *   3. null → SectionRenderer renders UnknownSection fallback
 *
 * Used before hydration/SSR render so Suspense fallbacks do not blank the page:
 * - main.tsx and entry-server.tsx call preloadSectionsFromInitialData()
 * - SectionRenderer uses getCachedSectionComponent() / loadSectionComponent() at runtime
 *
 * Variant resolution: YAML type + variant map to files like HeroCourse.tsx → hero/course.
 * The glob also picks up lead_form/variants/LeadFormDefault.tsx (type lead_form, variant default).
 * That chunk is preloaded separately when priority sections contain a form config (see below),
 * because nested React.lazy() inside heroes does not load with section preload alone.
 */
import type { ComponentType } from "react";

type SectionLoader = () => Promise<{ default: ComponentType<unknown> }>;

/** Shared platform components under client/src/components/{type}/variants/ (code-split). */
const clientLoaders = import.meta.glob("./*/variants/*.tsx") as Record<string, SectionLoader>;

/**
 * Site-specific components co-located with their schema inside component-registry.
 * Path pattern (relative to this file): ../../../site_4geeks-com/component-registry/{type}/variants/*.tsx
 * These win over clientLoaders when both define the same type+variant key.
 * The folder may be absent in some environments — the glob simply returns {} in that case.
 */
const registryLoaders = import.meta.glob(
  "../../../site_4geeks-com/component-registry/*/variants/*.tsx",
) as Record<string, SectionLoader>;

/** Combined map used by loadSectionComponent — registry paths and client paths share the same namespace. */
const allLoaders: Record<string, SectionLoader> = { ...clientLoaders, ...registryLoaders };

function snakeToPascal(str: string): string {
  return str.split("_").map((s) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()).join("");
}

function deriveVariant(type: string, filenameBase: string): string {
  const prefix = snakeToPascal(type);
  const remainder = filenameBase.slice(prefix.length);
  if (!remainder) return "default";
  return remainder.charAt(0).toLowerCase() + remainder.slice(1);
}

/** Normalizes YAML variant strings for lookup (e.g. product-showcase → productshowcase). */
export function normalizeSectionVariant(v: string): string {
  return v.replace(/[-_]/g, "").replace(/[A-Z]/g, (c) => c.toLowerCase());
}

/** type -> normalizedVariant -> module path */
const pathIndex: Record<string, Record<string, string>> = {};

// First pass: shared client components (lower priority).
for (const filePath of Object.keys(clientLoaders)) {
  const match = filePath.match(/^\.\/([^/]+)\/variants\/([^/]+)\.tsx$/);
  if (!match) continue;
  const type = match[1];
  const filenameBase = match[2];
  const variantName = normalizeSectionVariant(deriveVariant(type, filenameBase));
  if (!pathIndex[type]) pathIndex[type] = {};
  pathIndex[type][variantName] = filePath;
}

// Second pass: registry components (higher priority — overlay on collision).
for (const filePath of Object.keys(registryLoaders)) {
  // Matches paths like: .../component-registry/{type}/variants/{Component}.tsx
  const match = filePath.match(/\/component-registry\/([^/]+)\/variants\/([^/]+)\.tsx$/);
  if (!match) continue;
  const type = match[1];
  const filenameBase = match[2];
  const variantName = normalizeSectionVariant(deriveVariant(type, filenameBase));
  if (!pathIndex[type]) pathIndex[type] = {};
  pathIndex[type][variantName] = filePath;
}

const componentCache = new Map<string, ComponentType<unknown>>();

function cacheKey(type: string, variant: string): string {
  return `${type}::${normalizeSectionVariant(variant)}`;
}

function resolveModulePath(type: string, variant: string): string | undefined {
  const registry = pathIndex[type];
  if (!registry) return undefined;
  const normalized = normalizeSectionVariant(variant);
  return registry[normalized] ?? registry.default;
}

/** Returns a component already loaded via loadSectionComponent, or null. */
export function getCachedSectionComponent(
  type: string,
  variant: string,
): ComponentType<{ data: unknown }> | null {
  const cached = componentCache.get(cacheKey(type, variant));
  return (cached as ComponentType<{ data: unknown }> | undefined) ?? null;
}

/**
 * Dynamically imports a section variant and caches the default export.
 * Falls back to the default variant when the requested variant is missing.
 * Resolves from registry (site-specific) first, then shared client components.
 */
export async function loadSectionComponent(
  type: string,
  variant: string,
): Promise<ComponentType<{ data: unknown }> | null> {
  const key = cacheKey(type, variant ?? "default");
  const existing = componentCache.get(key);
  if (existing) return existing as ComponentType<{ data: unknown }>;

  const modulePath = resolveModulePath(type, variant ?? "default");
  if (!modulePath) return null;

  const loader = allLoaders[modulePath];
  if (!loader) return null;

  // Retry once on transient fetch failures (interrupted connection, HMR invalidation).
  const mod = await loader().catch(async () => {
    await new Promise((resolve) => setTimeout(resolve, 300));
    return loader();
  });
  if (!mod.default) return null;

  componentCache.set(key, mod.default);
  return mod.default as ComponentType<{ data: unknown }>;
}

/** Minimal section identity from page YAML (type + optional variant). */
export interface SectionRef {
  type: string;
  variant?: string;
}

export function collectSectionsFromData(data: unknown, out: SectionRef[]): void {
  if (!data || typeof data !== "object") return;

  const record = data as Record<string, unknown>;
  if (!Array.isArray(record.sections)) return;

  for (const section of record.sections) {
    if (section && typeof section === "object" && "type" in section) {
      const s = section as { type: string; variant?: string };
      out.push({ type: s.type, variant: s.variant });
    }
  }
}

/** Shape of window.__INITIAL_DATA__ / SSR dehydrated React Query state. */
export type InitialDataPayload =
  | { queries: Array<{ queryKey: unknown[]; data: unknown }>; queryKey?: never; data?: never }
  | { queryKey: unknown[]; data: unknown; queries?: never };

/** Collects all section refs from every page object embedded in the initial payload. */
export function extractSectionsFromInitialData(
  payload: InitialDataPayload | null,
): SectionRef[] {
  const sections: SectionRef[] = [];
  if (!payload) return sections;

  if (payload.queries && Array.isArray(payload.queries)) {
    for (const { data } of payload.queries) {
      collectSectionsFromData(data, sections);
    }
  } else if (payload.data !== undefined) {
    collectSectionsFromData(payload.data, sections);
  }

  return sections;
}

/** Preloads unique section chunks for the given refs (deduped by type + variant). */
export async function preloadSections(sections: SectionRef[]): Promise<void> {
  const seen = new Set<string>();
  const loads: Promise<ComponentType<{ data: unknown }> | null>[] = [];

  for (const { type, variant } of sections) {
    const key = cacheKey(type, variant ?? "default");
    if (seen.has(key)) continue;
    seen.add(key);
    loads.push(loadSectionComponent(type, variant ?? "default"));
  }

  await Promise.all(loads);
}

/** Matches SectionRenderer default when settings.loading.eager_count is unset. */
const DEFAULT_EAGER_COUNT = 3;

function isLeadFormConfig(value: unknown): boolean {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** True if the object tree contains a `form` key with lead-form config (e.g. signup_card.form). */
function objectHasFormKey(obj: unknown, maxDepth = 4, depth = 0): boolean {
  if (!obj || typeof obj !== "object" || depth > maxDepth) return false;
  if (Array.isArray(obj)) {
    return obj.some((item) => objectHasFormKey(item, maxDepth, depth + 1));
  }
  const record = obj as Record<string, unknown>;
  for (const [key, value] of Object.entries(record)) {
    if (key === "form" && isLeadFormConfig(value)) return true;
    if (typeof value === "object" && value !== null && objectHasFormKey(value, maxDepth, depth + 1)) {
      return true;
    }
  }
  return false;
}

function getEagerCountFromPageData(data: unknown): number {
  if (!data || typeof data !== "object") return DEFAULT_EAGER_COUNT;
  const settings = (data as Record<string, unknown>).settings as
    | Record<string, unknown>
    | undefined;
  const loading = settings?.loading as Record<string, unknown> | undefined;
  const count = loading?.eager_count;
  return typeof count === "number" && count >= 0 ? count : DEFAULT_EAGER_COUNT;
}

function pageDataListFromPayload(payload: InitialDataPayload | null): unknown[] {
  const pages: unknown[] = [];
  if (!payload) return pages;
  if (payload.queries?.length) {
    for (const { data } of payload.queries) {
      if (data !== undefined) pages.push(data);
    }
  } else if (payload.data !== undefined) {
    pages.push(payload.data);
  }
  return pages;
}

/**
 * Whether to preload lead_form/default before first paint.
 * Scans only the first settings.loading.eager_count sections (default 3) and looks for
 * any form key in the section object tree (e.g. hero signup_card.form, cta_banner.form).
 * YAML form.variant (stacked/inline) is layout config, not a separate React variant.
 */
export function shouldPreloadLeadFormFromInitialData(
  payload: InitialDataPayload | null,
): boolean {
  for (const pageData of pageDataListFromPayload(payload)) {
    if (!pageData || typeof pageData !== "object") continue;
    const sections = (pageData as Record<string, unknown>).sections;
    if (!Array.isArray(sections)) continue;
    const eagerCount = getEagerCountFromPageData(pageData);
    if (sections.slice(0, eagerCount).some((s) => objectHasFormKey(s))) {
      return true;
    }
  }
  return false;
}

/**
 * Entry point for bootstrap: preloads all page sections from SSR initial data, plus
 * LeadFormDefault when shouldPreloadLeadFormFromInitialData is true.
 */
export async function preloadSectionsFromInitialData(
  payload: InitialDataPayload | null,
): Promise<void> {
  const loads: Promise<unknown>[] = [
    preloadSections(extractSectionsFromInitialData(payload)),
  ];

  if (shouldPreloadLeadFormFromInitialData(payload) && hasSectionType("lead_form")) {
    loads.push(loadSectionComponent("lead_form", "default"));
  }

  await Promise.all(loads);
}

/** True if the glob indexed at least one variant for this component type folder. */
export function hasSectionType(type: string): boolean {
  return !!pathIndex[type];
}
