/** Shared helpers for OG / entry-preview prop mappings (including dotted paths). */

const SKIP_PROP_KEYS = new Set(["variant", "version", "type", "section_id"]);
const SCALAR_TYPES = new Set(["string", "number", "boolean", "text"]);

/** Max path segments (e.g. left.button.text = 3). */
export const PREVIEW_PROP_MAX_DEPTH = 3;

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

/** Apply `preview.props` mappings onto a section data object (supports dotted component keys). */
export function applyPreviewPropMappings(
  data: Record<string, unknown>,
  props: Record<string, string> | undefined,
  entry: Record<string, unknown>,
  reservedImageField = "image",
): void {
  for (const [compKey, entryField] of Object.entries(props || {})) {
    if (!compKey || !entryField) continue;
    if (compKey === reservedImageField || entryField === reservedImageField) continue;
    const val = entry[entryField];
    if (val === undefined) continue;
    setValueByDotPath(data, compKey, val);
  }
}
