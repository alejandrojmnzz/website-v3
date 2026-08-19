import type { SeoMeta } from "@/components/DebugBubble/types";

export const EDITABLE_META_KEYS = [
  "page_title",
  "description",
  "og_image",
  "canonical_url",
  "robots",
  "priority",
  "change_frequency",
] as const;

export type EditableMetaKey = (typeof EDITABLE_META_KEYS)[number];

export type MetaSaveOperation = {
  action: "update_field";
  path: string;
  value: unknown;
};

export type BuildMetaSaveOperationsInput = {
  context: "live" | "variant";
  seoMeta: SeoMeta;
  dirtyKeys: Set<string> | ReadonlySet<string>;
  /** Display/merged meta from seo-preview (variant context). */
  displayMeta?: Record<string, unknown>;
  liveMeta?: Record<string, unknown>;
  metaOverrides?: string[];
};

function redirectsEqual(a: string[], b: unknown): boolean {
  const bArr = Array.isArray(b)
    ? b
        .map((r) => (typeof r === "string" ? r : (r as { path?: string })?.path))
        .filter((r): r is string => Boolean(r))
    : [];
  if (a.length !== bArr.length) return false;
  return a.every((v, i) => v === bArr[i]);
}

export function valuesEqual(
  key: EditableMetaKey | "redirects",
  formVal: string | string[],
  liveVal: unknown,
): boolean {
  if (key === "redirects") {
    return redirectsEqual(formVal as string[], liveVal);
  }
  const liveStr = liveVal == null ? "" : String(liveVal);
  return String(formVal || "") === liveStr;
}

/** Compare landing location slug lists (order-insensitive). */
export function areSlugListsEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((v, i) => v === sortedB[i]);
}

/** Track which meta form fields changed since load. */
export function computeDirtyMetaKeys(seoMeta: SeoMeta, baseline: SeoMeta): Set<string> {
  const dirty = new Set<string>();
  for (const key of EDITABLE_META_KEYS) {
    if (seoMeta[key] !== baseline[key]) dirty.add(key);
  }
  if (
    seoMeta.redirects.length !== baseline.redirects.length ||
    seoMeta.redirects.some((r, i) => r !== baseline.redirects[i])
  ) {
    dirty.add("redirects");
  }
  return dirty;
}

function metaFieldPath(key: string): string {
  return `meta.${key}`;
}

function metaPayloadToOperations(metaPayload: Record<string, unknown>): MetaSaveOperation[] {
  const ops: MetaSaveOperation[] = [];
  for (const [key, value] of Object.entries(metaPayload)) {
    ops.push({ action: "update_field", path: metaFieldPath(key), value });
  }
  return ops;
}

function buildLiveMetaPayload(
  seoMeta: SeoMeta,
  dirtyKeys: ReadonlySet<string>,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const key of EDITABLE_META_KEYS) {
    if (!dirtyKeys.has(key)) continue;
    const formVal = seoMeta[key];
    if (formVal) {
      payload[key] = formVal;
    } else {
      payload[key] = null;
    }
  }
  if (dirtyKeys.has("redirects")) {
    if (seoMeta.redirects.length > 0) {
      payload.redirects = seoMeta.redirects;
    } else {
      payload.redirects = null;
    }
  }
  return payload;
}

function buildVariantMetaPayload(input: BuildMetaSaveOperationsInput): Record<string, unknown> {
  const { seoMeta, dirtyKeys, displayMeta = {}, liveMeta = {}, metaOverrides = [] } = input;
  const payload: Record<string, unknown> = {};

  for (const key of metaOverrides) {
    if ((EDITABLE_META_KEYS as readonly string[]).includes(key) || key === "redirects") {
      continue;
    }
    if (displayMeta[key] !== undefined) {
      payload[key] = displayMeta[key];
    }
  }

  for (const key of EDITABLE_META_KEYS) {
    const isDirty = dirtyKeys.has(key);
    const wasOverride = metaOverrides.includes(key);
    if (!isDirty && !wasOverride) continue;
    const formVal = seoMeta[key];
    if (isDirty) {
      if (!formVal) continue;
      if (valuesEqual(key, formVal, liveMeta[key])) continue;
      payload[key] = formVal;
    } else if (formVal) {
      payload[key] = formVal;
    }
  }

  const isDirtyRedirects = dirtyKeys.has("redirects");
  const wasOverrideRedirects = metaOverrides.includes("redirects");
  if (isDirtyRedirects || wasOverrideRedirects) {
    if (isDirtyRedirects) {
      if (
        seoMeta.redirects.length > 0 &&
        !valuesEqual("redirects", seoMeta.redirects, liveMeta.redirects)
      ) {
        payload.redirects = seoMeta.redirects;
      }
    } else if (seoMeta.redirects.length > 0) {
      payload.redirects = seoMeta.redirects;
    }
  }

  return payload;
}

/**
 * Build patch-style edit-sections ops for SEO meta saves.
 * Only dirty keys are written; unchanged title/description stay on disk.
 */
export function buildMetaSaveOperations(input: BuildMetaSaveOperationsInput): MetaSaveOperation[] {
  const payload =
    input.context === "live"
      ? buildLiveMetaPayload(input.seoMeta, input.dirtyKeys)
      : buildVariantMetaPayload(input);
  return metaPayloadToOperations(payload);
}
