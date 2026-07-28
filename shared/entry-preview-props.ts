/** Shared helpers for OG / entry-preview prop mappings (including dotted paths). */

import { formatReadingMinutesLabel, formatReadingTimeLabel } from "./reading-time";

const SKIP_PROP_KEYS = new Set(["variant", "version", "type", "section_id"]);
const SCALAR_TYPES = new Set(["string", "number", "boolean", "text"]);

/** Max path segments (e.g. left.button.text = 3). */
export const PREVIEW_PROP_MAX_DEPTH = 3;

/** Circular / reserved image sources — never map into preview component props. */
export const BLOCKED_PREVIEW_IMAGE_SOURCES = [
  "_image",
  "image",
  "og_image",
  "meta.og_image",
] as const;

export type PreviewPropDef = {
  type?: string;
  required?: boolean;
  description?: string;
  fields?: Record<string, PreviewPropDef>;
  properties?: Record<string, PreviewPropDef>;
  items?: PreviewPropDef | Record<string, PreviewPropDef>;
};

export type MappablePreviewProp = {
  key: string;
  required: boolean;
  description?: string;
};

export type PreviewPropResolveContext = {
  /** Mapped content-type / single bag. */
  entry: Record<string, unknown>;
  /** Resolved SEO meta (templates already expanded). */
  meta?: Record<string, unknown>;
  /** Site brand vars keyed as `brand.title`, `brand.logo`, … */
  brand?: Record<string, unknown>;
};

export function isScalarPreviewProp(def: PreviewPropDef | undefined): boolean {
  if (!def || typeof def !== "object") return false;
  const t = (def.type || "string").toLowerCase();
  return SCALAR_TYPES.has(t);
}

function childProps(def: PreviewPropDef): Record<string, PreviewPropDef> | undefined {
  if (def.fields && typeof def.fields === "object") return def.fields;
  if (def.properties && typeof def.properties === "object") return def.properties;
  return undefined;
}

/**
 * Collect flat + nested object scalar paths (`title`, `left.heading`, `cta_button.text`).
 * Does not expand arrays (no `features.0.title` in the picker) — those stay out of scope.
 * Nested paths are never required; only top-level scalars keep schema `required`.
 */
export function collectMappablePreviewProps(
  props: Record<string, PreviewPropDef> | undefined,
  options?: { maxDepth?: number },
): MappablePreviewProp[] {
  if (!props) return [];
  const maxDepth = options?.maxDepth ?? PREVIEW_PROP_MAX_DEPTH;
  const out: MappablePreviewProp[] = [];
  const seen = new Set<string>();

  const walk = (bag: Record<string, PreviewPropDef>, prefix: string, depth: number) => {
    if (depth > maxDepth) return;
    for (const [key, def] of Object.entries(bag)) {
      if (!key || SKIP_PROP_KEYS.has(key)) continue;
      if (!def || typeof def !== "object") continue;
      const path = prefix ? `${prefix}.${key}` : key;
      if (seen.has(path)) continue;

      if (isScalarPreviewProp(def)) {
        seen.add(path);
        out.push({
          key: path,
          required: !prefix && !!def.required,
          description: typeof def.description === "string" ? def.description : undefined,
        });
        continue;
      }

      const t = (def.type || "").toLowerCase();
      if (t === "array") continue;

      const children = childProps(def);
      if (children && (t === "object" || !t || Object.keys(children).length > 0)) {
        walk(children, path, depth + 1);
      }
    }
  };

  walk(props, "", 1);
  return out;
}

export function collectMappablePropsFromSchema(
  schema:
    | {
        props?: Record<string, PreviewPropDef>;
        base_props?: Record<string, PreviewPropDef>;
        variant_props?: Record<string, Record<string, PreviewPropDef>>;
      }
    | null
    | undefined,
  variant: string,
): MappablePreviewProp[] {
  if (!schema) return [];
  const seen = new Set<string>();
  const out: MappablePreviewProp[] = [];
  const add = (bag: Record<string, PreviewPropDef> | undefined) => {
    for (const prop of collectMappablePreviewProps(bag)) {
      if (seen.has(prop.key)) continue;
      seen.add(prop.key);
      out.push(prop);
    }
  };
  add(schema.props);
  add(schema.base_props);
  add(schema.variant_props?.[variant]);
  return out;
}

/** Set `a.b.c` on an object, creating intermediate plain objects (or arrays for numeric segments). */
export function setValueByDotPath(
  obj: Record<string, unknown>,
  dotPath: string,
  value: unknown,
): void {
  const parts = dotPath.split(".").filter(Boolean);
  if (parts.length === 0) return;
  if (parts.length === 1) {
    obj[parts[0]] = value;
    return;
  }

  let current: Record<string, unknown> | unknown[] = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    const nextPart = parts[i + 1];
    const nextIsIndex = /^\d+$/.test(nextPart);

    if (Array.isArray(current)) {
      const idx = Number(part);
      if (!Number.isFinite(idx) || idx < 0) return;
      if (current[idx] === null || current[idx] === undefined || typeof current[idx] !== "object") {
        current[idx] = nextIsIndex ? [] : {};
      }
      current = current[idx] as Record<string, unknown> | unknown[];
      continue;
    }

    const record = current as Record<string, unknown>;
    if (record[part] === null || record[part] === undefined || typeof record[part] !== "object") {
      record[part] = nextIsIndex ? [] : {};
    }
    current = record[part] as Record<string, unknown> | unknown[];
  }

  const last = parts[parts.length - 1];
  if (Array.isArray(current)) {
    const idx = Number(last);
    if (Number.isFinite(idx) && idx >= 0) current[idx] = value;
  } else {
    current[last] = value;
  }
}

export function isBlockedPreviewSource(
  source: string,
  reservedImageField = "_image",
): boolean {
  const s = source.trim();
  if (!s) return true;
  if (s === reservedImageField) return true;
  for (const b of BLOCKED_PREVIEW_IMAGE_SOURCES) {
    if (s === b) return true;
  }
  return false;
}

/** Brand sources are live at capture; excluded from dirty `propsHash`. */
export function isBrandPreviewSource(source: string): boolean {
  return source.trim().startsWith("brand.");
}

export function isMetaPreviewSource(source: string): boolean {
  return source.trim().startsWith("meta.");
}

/**
 * Resolve a preview.props source key.
 * `brand.*` / `meta.*` are reserved namespaces (never dotted paths into entry).
 */
export function resolvePreviewSourceValue(
  source: string,
  ctx: PreviewPropResolveContext,
  reservedImageField = "_image",
): unknown {
  const key = source.trim();
  if (!key || isBlockedPreviewSource(key, reservedImageField)) return undefined;

  if (isBrandPreviewSource(key)) {
    return ctx.brand?.[key];
  }
  if (isMetaPreviewSource(key)) {
    const metaKey = key.slice("meta.".length);
    if (!metaKey || metaKey === "og_image") return undefined;
    return ctx.meta?.[metaKey];
  }

  return ctx.entry[key];
}

export function isUnusablePreviewValue(val: unknown): boolean {
  if (val === undefined || val === null) return true;
  if (typeof val === "string") {
    const t = val.trim();
    if (!t) return true;
    // Reject unresolved template placeholders, not article bodies that happen to
    // contain "{{" in code samples. Short strings that are only a template, or
    // that reference reserved namespaces, are unusable for preview props.
    if (/^\{\{[^}]+\}\}$/.test(t)) return true;
    if (t.length < 500 && /\{\{\s*(?:single|meta|brand|param|global)\./.test(t)) return true;
  }
  if (Array.isArray(val) && val.length === 0) return true;
  return false;
}

/** Short reason why a resolved preview source can't be used on the OG card. */
export function describeUnusablePreviewSource(val: unknown): string {
  if (val === undefined || val === null) return "is missing";
  if (typeof val === "string") {
    const t = val.trim();
    if (!t) return "is empty";
    if (/^\{\{[^}]+\}\}$/.test(t) || /\{\{\s*(?:single|meta|brand|param|global)\./.test(t)) {
      return "still looks like an unresolved template";
    }
  }
  if (Array.isArray(val) && val.length === 0) return "is an empty list";
  if (typeof val === "string" && !val.trim()) return "is empty";
  return "can't be used as preview text";
}

/**
 * Staff-facing explanation when mapped preview props fail at capture time.
 * Example: category ← tags but tags is [].
 */
export function formatMissingPreviewPropsMessage(
  missing: string[],
  props?: Record<string, string>,
  ctx?: PreviewPropResolveContext,
): string {
  if (missing.length === 0) {
    return "Can't generate the OG preview — required data is missing.";
  }

  const lines = missing.map((compKey) => {
    const source = props?.[compKey]?.trim();
    if (!source) {
      return `“${compKey}” has no field mapped in Entry preview.`;
    }
    if (isBlockedPreviewSource(source)) {
      return `“${compKey}” is mapped to “${source}”, which isn't allowed (circular image source).`;
    }
    if (isBrandPreviewSource(source)) {
      const val = ctx?.brand?.[source];
      return `“${compKey}” uses brand setting “${source}”, but that value ${describeUnusablePreviewSource(val)}. Check Brand in variables.`;
    }
    if (isMetaPreviewSource(source)) {
      const metaKey = source.slice("meta.".length);
      const val = ctx?.meta?.[metaKey];
      return `“${compKey}” uses SEO field “${source}”, but that value ${describeUnusablePreviewSource(val)} on this entry.`;
    }
    const val = ctx ? resolvePreviewSourceValue(source, ctx) : undefined;
    return `“${compKey}” is mapped from “${source}”, but that field ${describeUnusablePreviewSource(val)} on this entry.`;
  });

  const hint =
    missing.length === 1
      ? "Add the missing data on the entry, or change that mapping under Entry preview."
      : "Add the missing data on the entry, or change those mappings under Entry preview.";

  if (lines.length === 1) {
    return `Can't generate the OG preview: ${lines[0]} ${hint}`;
  }
  return `Can't generate the OG preview:\n• ${lines.join("\n• ")}\n${hint}`;
}

/**
 * Turn mapped article `content` into a short `reading_time` label and drop the body
 * from the section (list APIs strip bodies; huge markdown must not ride on the canvas).
 *
 * Falls back to entry `reading_minutes` when the body was stripped but minutes were
 * precomputed (see content-type items API).
 */
export function materializeOgPreviewReadingTime(
  data: Record<string, unknown>,
  props: Record<string, string> | undefined,
  entry?: Record<string, unknown>,
): void {
  const source = props?.content?.trim();
  const fromBody = formatReadingTimeLabel(data.content);
  if (fromBody) {
    data.reading_time = fromBody;
    delete data.content;
    return;
  }
  delete data.content;
  if (source === "content") {
    const fromMinutes = formatReadingMinutesLabel(entry?.reading_minutes);
    if (fromMinutes) data.reading_time = fromMinutes;
  }
}

/**
 * Apply `preview.props` mappings onto a section data object (supports dotted component keys).
 * Returns component keys whose sources were blocked or resolved to an unusable value.
 */
export function applyPreviewPropMappings(
  data: Record<string, unknown>,
  props: Record<string, string> | undefined,
  ctxOrEntry: PreviewPropResolveContext | Record<string, unknown>,
  reservedImageField = "_image",
): { missing: string[] } {
  const ctx: PreviewPropResolveContext =
    ctxOrEntry && typeof ctxOrEntry === "object" && "entry" in ctxOrEntry
      ? (ctxOrEntry as PreviewPropResolveContext)
      : { entry: ctxOrEntry as Record<string, unknown> };

  const missing: string[] = [];
  for (const [compKey, entryField] of Object.entries(props || {})) {
    if (!compKey || !entryField?.trim()) continue;
    if (isBlockedPreviewSource(compKey, reservedImageField) || isBlockedPreviewSource(entryField, reservedImageField)) {
      missing.push(compKey);
      continue;
    }
    const val = resolvePreviewSourceValue(entryField, ctx, reservedImageField);
    if (isUnusablePreviewValue(val)) {
      missing.push(compKey);
      continue;
    }
    setValueByDotPath(data, compKey, val);
  }
  return { missing };
}

/**
 * Build the payload used for dirty hashing.
 * Brand sources are omitted so brand edits do not auto-recapture.
 */
export function buildPreviewPropsHashPayload(
  props: Record<string, string> | undefined,
  ctx: PreviewPropResolveContext,
  reservedImageField = "_image",
): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const [compKey, entryField] of Object.entries(props || {})) {
    if (!compKey || !entryField?.trim()) continue;
    if (isBlockedPreviewSource(compKey, reservedImageField) || isBlockedPreviewSource(entryField, reservedImageField)) {
      continue;
    }
    if (isBrandPreviewSource(entryField)) continue;
    payload[compKey] = resolvePreviewSourceValue(entryField, ctx, reservedImageField);
  }
  return payload;
}

/** Standard SEO meta keys offered in the preview prop picker (not og_image). */
export const PREVIEW_META_SOURCE_OPTIONS = [
  "meta.page_title",
  "meta.description",
  "meta.og_type",
  "meta.robots",
  "meta.canonical_url",
  "meta.twitter_card",
] as const;

/** Brand keys offered in the preview prop picker. */
export const PREVIEW_BRAND_SOURCE_OPTIONS = [
  "brand.title",
  "brand.logo",
  "brand.logo_dark",
] as const;
