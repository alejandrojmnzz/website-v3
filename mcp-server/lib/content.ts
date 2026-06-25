import fs from "fs";
import path from "path";
import yaml from "js-yaml";

export const MARKETING_CONTENT_PATH = path.join(process.cwd(), "4geeks-com");
export const COMPONENT_REGISTRY_PATH = path.join(MARKETING_CONTENT_PATH, "component-registry");
export const CONTENT_TYPES_PATH = path.join(MARKETING_CONTENT_PATH, "content-types.yml");

// ─── YAML helpers ─────────────────────────────────────────────────────────────

export function safeLoad(raw: string): Record<string, unknown> | null {
  try {
    // Template expressions like {{ ratio | 7:1 }} contain characters (e.g. ":")
    // that break YAML parsing. Swap them out for safe placeholders, parse, then
    // restore so callers receive the original template strings intact.
    const templates: string[] = [];
    const sanitized = raw.replace(/\{\{[^}]*\}\}/g, (match) => {
      templates.push(match);
      return `__TPL_${templates.length - 1}__`;
    });

    const parsed = (yaml.load(sanitized) as Record<string, unknown>) || null;
    if (!parsed || templates.length === 0) return parsed;

    function restore(val: unknown): unknown {
      if (typeof val === "string")
        return val.replace(/__TPL_(\d+)__/g, (_, i) => templates[parseInt(i)]);
      if (Array.isArray(val)) return val.map(restore);
      if (val && typeof val === "object") {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(val as Record<string, unknown>))
          out[k] = restore(v);
        return out;
      }
      return val;
    }

    return restore(parsed) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function safeDump(obj: unknown): string {
  return yaml.dump(obj, { lineWidth: -1, noRefs: true, quotingType: '"', forceQuotes: false });
}

export function deepMerge(
  base: Record<string, unknown>,
  override: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(override)) {
    if (
      v !== null &&
      typeof v === "object" &&
      !Array.isArray(v) &&
      typeof result[k] === "object" &&
      result[k] !== null &&
      !Array.isArray(result[k])
    ) {
      result[k] = deepMerge(result[k] as Record<string, unknown>, v as Record<string, unknown>);
    } else {
      result[k] = v;
    }
  }
  return result;
}

// ─── Content type helpers ─────────────────────────────────────────────────────

export interface ContentTypeConfig {
  directory?: string;
  url_pattern?: Record<string, string>;
  database?: { slug: string };
  field_mapping?: Record<string, unknown>;
  layout?: unknown;
}

export function loadContentTypes(): Record<string, ContentTypeConfig> {
  if (!fs.existsSync(CONTENT_TYPES_PATH)) return {};
  const raw = fs.readFileSync(CONTENT_TYPES_PATH, "utf-8");
  return (safeLoad(raw) as Record<string, ContentTypeConfig>) || {};
}

export function isDbBacked(config: ContentTypeConfig): boolean {
  return !!config?.database?.slug;
}

export function getDirectory(contentType: string, config: ContentTypeConfig): string {
  return config.directory || contentType;
}

export function resolveContentType(
  slug: string,
  hintContentType?: string,
): { contentType: string; config: ContentTypeConfig } | null {
  const configs = loadContentTypes();
  if (hintContentType) {
    const config = configs[hintContentType];
    if (!config || isDbBacked(config)) return null;
    const dir = path.join(MARKETING_CONTENT_PATH, getDirectory(hintContentType, config), slug);
    if (fs.existsSync(dir)) return { contentType: hintContentType, config };
    return null;
  }
  for (const [ct, config] of Object.entries(configs)) {
    if (isDbBacked(config)) continue;
    const dir = path.join(MARKETING_CONTENT_PATH, getDirectory(ct, config), slug);
    if (fs.existsSync(dir)) return { contentType: ct, config };
  }
  return null;
}

// ─── Page helpers ─────────────────────────────────────────────────────────────

export interface VersioningVariant {
  slug: string;
  allocation: number;
}

export interface VersioningLocale {
  variants: VersioningVariant[];
}

export type VersioningData = Record<string, VersioningLocale>;

export function loadVersioning(contentType: string, slug: string): VersioningData | null {
  const configs = loadContentTypes();
  const config = configs[contentType];
  if (!config || isDbBacked(config)) return null;
  const dir = path.join(MARKETING_CONTENT_PATH, getDirectory(contentType, config), slug);
  const versioningPath = path.join(dir, "versioning.yml");
  if (!fs.existsSync(versioningPath)) return null;
  const parsed = safeLoad(fs.readFileSync(versioningPath, "utf-8"));
  if (!parsed) return null;
  return parsed as VersioningData;
}

export function loadVariantPage(
  contentType: string,
  slug: string,
  locale: string,
  variantSlug: string,
): { data: Record<string, unknown>; filePath: string } | null {
  const configs = loadContentTypes();
  const config = configs[contentType];
  if (!config || isDbBacked(config)) return null;

  const dir = path.join(MARKETING_CONTENT_PATH, getDirectory(contentType, config), slug);
  if (!fs.existsSync(dir)) return null;

  const commonPath = path.join(dir, "_common.yml");
  const variantPath = path.join(dir, `${variantSlug}.${locale}.yml`);

  let commonData: Record<string, unknown> = {};
  if (fs.existsSync(commonPath)) {
    commonData = safeLoad(fs.readFileSync(commonPath, "utf-8")) || {};
  }

  if (!fs.existsSync(variantPath)) return null;
  const variantData = safeLoad(fs.readFileSync(variantPath, "utf-8")) || {};

  return {
    data: deepMerge(commonData, variantData),
    filePath: variantPath,
  };
}

export interface PageEntry {
  slug: string;
  contentType: string;
  directory: string;
  locales: string[];
  title?: string;
  urls?: Record<string, string>;
  variants?: Array<{ locale: string; slug: string; allocation: number }>;
}

export function scanPages(): PageEntry[] {
  const configs = loadContentTypes();
  const pages: PageEntry[] = [];

  for (const [contentType, config] of Object.entries(configs)) {
    if (isDbBacked(config)) continue;

    const dir = path.join(MARKETING_CONTENT_PATH, getDirectory(contentType, config));
    if (!fs.existsSync(dir)) continue;

    const entries = fs.readdirSync(dir, { withFileTypes: true }).filter(d => d.isDirectory());
    for (const entry of entries) {
      const entryPath = path.join(dir, entry.name);
      const files = fs.readdirSync(entryPath).filter(f => f.endsWith(".yml") || f.endsWith(".yaml"));
      if (files.length === 0) continue;

      const locales = files
        .map(f => f.replace(/\.(yml|yaml)$/, ""))
        .filter(n => /^[a-z]{2}(-[a-z]{2})?$/.test(n));

      let title: string | undefined;
      for (const candidate of ["_common.yml", "_common.yaml", "en.yml", "en.yaml"]) {
        if (files.includes(candidate)) {
          try {
            const parsed = safeLoad(fs.readFileSync(path.join(entryPath, candidate), "utf-8"));
            if (parsed?.title && typeof parsed.title === "string") { title = parsed.title; break; }
            if (parsed?.name && typeof parsed.name === "string") { title = parsed.name; break; }
          } catch {}
        }
      }

      let urls: Record<string, string> | undefined;
      if (config.url_pattern) {
        const pattern = config.url_pattern;
        const resolved: Record<string, string> = {};
        if (pattern["default"]) {
          // Shorthand: same path for all locales
          const path_ = pattern["default"].replace(":slug", entry.name);
          for (const locale of locales) resolved[locale] = path_;
        } else {
          // Per-locale paths — only include locales that have a pattern defined
          for (const locale of locales) {
            if (pattern[locale]) resolved[locale] = pattern[locale].replace(":slug", entry.name);
          }
        }
        if (Object.keys(resolved).length > 0) urls = resolved;
      }

      const versioning = loadVersioning(contentType, entry.name);
      let variants: Array<{ locale: string; slug: string; allocation: number }> | undefined;
      if (versioning) {
        const variantList: Array<{ locale: string; slug: string; allocation: number }> = [];
        for (const [locale, localeData] of Object.entries(versioning)) {
          for (const v of localeData.variants || []) {
            variantList.push({ locale, slug: v.slug, allocation: v.allocation });
          }
        }
        if (variantList.length > 0) variants = variantList;
      }

      pages.push({
        slug: entry.name,
        contentType,
        directory: `4geeks-com/${getDirectory(contentType, config)}/${entry.name}`,
        locales,
        title,
        ...(urls ? { urls } : {}),
        ...(variants ? { variants } : {}),
      });
    }
  }
  return pages;
}

export function loadPage(
  contentType: string,
  slug: string,
  locale: string,
): { data: Record<string, unknown>; filePath: string } | null {
  const configs = loadContentTypes();
  const config = configs[contentType];
  if (!config || isDbBacked(config)) return null;

  const dir = path.join(MARKETING_CONTENT_PATH, getDirectory(contentType, config), slug);
  if (!fs.existsSync(dir)) return null;

  const commonPath = path.join(dir, "_common.yml");
  const localePath = path.join(dir, `${locale}.yml`);

  let commonData: Record<string, unknown> = {};
  if (fs.existsSync(commonPath)) {
    commonData = safeLoad(fs.readFileSync(commonPath, "utf-8")) || {};
  }

  if (!fs.existsSync(localePath)) return null;
  const localeData = safeLoad(fs.readFileSync(localePath, "utf-8")) || {};

  return {
    data: deepMerge(commonData, localeData),
    filePath: localePath,
  };
}

export function getValueAtPath(obj: Record<string, unknown>, pathStr: string): unknown {
  const parts = pathStr.replace(/\[(\d+)\]/g, ".$1").split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

export function setValueAtPath(obj: Record<string, unknown>, pathStr: string, value: unknown): void {
  const parts = pathStr.replace(/\[(\d+)\]/g, ".$1").split(".");
  let current: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (current[part] === undefined || typeof current[part] !== "object") {
      current[part] = /^\d+$/.test(parts[i + 1]) ? [] : {};
    }
    current = current[part] as Record<string, unknown>;
  }
  current[parts[parts.length - 1]] = value;
}

// ─── Component registry helpers ───────────────────────────────────────────────
// Kept in lib/content.ts alongside page helpers because both operate on the
// same 4geeks-com/ tree and share safeLoad/safeDump. Tools that need
// them import from here rather than from tools/components.ts to avoid cycles.

export interface ComponentVariantInfo {
  name: string;
}

export interface ComponentInfo {
  type: string;
  version: string;
  name?: string;
  description?: string;
  variants?: ComponentVariantInfo[];
}

export function listComponents(): ComponentInfo[] {
  if (!fs.existsSync(COMPONENT_REGISTRY_PATH)) return [];
  const components: ComponentInfo[] = [];

  const entries = fs
    .readdirSync(COMPONENT_REGISTRY_PATH, { withFileTypes: true })
    .filter(d => d.isDirectory() && !d.name.startsWith("_"));

  for (const entry of entries) {
    const componentPath = path.join(COMPONENT_REGISTRY_PATH, entry.name);
    const versionDirs = fs
      .readdirSync(componentPath, { withFileTypes: true })
      .filter(d => d.isDirectory() && /^v\d/.test(d.name));

    for (const vDir of versionDirs) {
      const schemaYml = path.join(componentPath, vDir.name, "schema.yml");
      let name: string | undefined;
      let description: string | undefined;
      let variants: ComponentVariantInfo[] | undefined;

      if (fs.existsSync(schemaYml)) {
        const parsed = safeLoad(fs.readFileSync(schemaYml, "utf-8"));
        if (parsed) {
          name = typeof parsed.name === "string" ? parsed.name : undefined;
          description = typeof parsed.description === "string" ? parsed.description : undefined;
          if (parsed.variants && typeof parsed.variants === "object" && !Array.isArray(parsed.variants)) {
            const variantsMap = parsed.variants as Record<string, unknown>;
            variants = Object.entries(variantsMap).map(([variantName]) => ({ name: variantName }));
          } else if (Array.isArray(parsed.variants)) {
            variants = (parsed.variants as unknown[]).map(v => ({ name: String(v) }));
          }
        }
      }

      components.push({ type: entry.name, version: vDir.name, name, description, variants });
    }
  }

  return components.sort((a, b) => a.type.localeCompare(b.type));
}

export interface ComponentVariantSummary {
  name: string;
  description?: string;
  best_for?: string;
}

export interface ComponentSchemaSlim {
  name: string | null;
  description: string | null;
  when_to_use: string | null;
  variants: ComponentVariantSummary[];
}

export function getComponentSchema(componentType: string): ComponentSchemaSlim | null {
  const componentPath = path.join(COMPONENT_REGISTRY_PATH, componentType);
  if (!fs.existsSync(componentPath)) return null;

  const versionDirs = fs
    .readdirSync(componentPath, { withFileTypes: true })
    .filter(d => d.isDirectory() && /^v\d/.test(d.name))
    .sort((a, b) => b.name.localeCompare(a.name));

  if (versionDirs.length === 0) return null;

  const latestVersion = versionDirs[0].name;
  const versionPath = path.join(componentPath, latestVersion);

  const schemaYml = path.join(versionPath, "schema.yml");
  if (!fs.existsSync(schemaYml)) return null;

  const parsed = safeLoad(fs.readFileSync(schemaYml, "utf-8"));
  if (!parsed) return null;

  const name = typeof parsed.name === "string" ? parsed.name : null;
  const description = typeof parsed.description === "string" ? parsed.description : null;
  const when_to_use = typeof parsed.when_to_use === "string" ? parsed.when_to_use : null;

  const variants: ComponentVariantSummary[] = [];
  if (parsed.variants && typeof parsed.variants === "object" && !Array.isArray(parsed.variants)) {
    for (const [variantName, variantDef] of Object.entries(parsed.variants as Record<string, unknown>)) {
      const def = variantDef as Record<string, unknown> | null;
      const entry: ComponentVariantSummary = { name: variantName };
      if (def && typeof def.description === "string") entry.description = def.description;
      if (def && typeof def.best_for === "string") entry.best_for = def.best_for;
      variants.push(entry);
    }
  } else if (Array.isArray(parsed.variants)) {
    for (const v of parsed.variants) {
      if (typeof v === "string") {
        variants.push({ name: v });
      } else if (v && typeof v === "object") {
        const def = v as Record<string, unknown>;
        if (typeof def.name !== "string") continue;
        const entry: ComponentVariantSummary = { name: def.name };
        if (typeof def.description === "string") entry.description = def.description;
        if (typeof def.best_for === "string") entry.best_for = def.best_for;
        variants.push(entry);
      }
    }
  }

  // If no variants are declared the component is single-variant; expose a synthetic "default"
  // so the two-step workflow (get_component_schema → get_component_variant) always works.
  if (variants.length === 0) {
    variants.push({ name: "default", description: "Default (single-variant) component" });
  }

  return { name, description, when_to_use, variants };
}

export interface ComponentVariantDetail {
  componentType: string;
  variant: string;
  variant_props: Record<string, unknown> | null;
  example: string | null;
}

export function getComponentVariant(
  componentType: string,
  variant: string,
): ComponentVariantDetail | null {
  const componentPath = path.join(COMPONENT_REGISTRY_PATH, componentType);
  if (!fs.existsSync(componentPath)) return null;

  const versionDirs = fs
    .readdirSync(componentPath, { withFileTypes: true })
    .filter(d => d.isDirectory() && /^v\d/.test(d.name))
    .sort((a, b) => b.name.localeCompare(a.name));

  if (versionDirs.length === 0) return null;

  const latestVersion = versionDirs[0].name;
  const versionPath = path.join(componentPath, latestVersion);

  const schemaYml = path.join(versionPath, "schema.yml");
  if (!fs.existsSync(schemaYml)) return null;

  const parsed = safeLoad(fs.readFileSync(schemaYml, "utf-8"));
  if (!parsed) return null;

  // Check the variant actually exists — handle three schema shapes:
  // (a) object-map variants: { variantName: { description, best_for } }
  // (b) array variants: [{ name, description, best_for }] or ["name", ...]
  // (c) no variants key: single-variant component — accept any requested name
  //     (get_component_schema emits a synthetic "default" for these; honour it and
  //     any other name so callers are never stuck).
  const variantsDef = parsed.variants;
  let variantExists = false;
  if (!variantsDef) {
    // No variants declared → single-variant component; always accept
    variantExists = true;
  } else if (typeof variantsDef === "object" && !Array.isArray(variantsDef)) {
    variantExists = variant in (variantsDef as Record<string, unknown>);
  } else if (Array.isArray(variantsDef)) {
    variantExists = variantsDef.some((v: unknown) => {
      if (typeof v === "string") return v === variant;
      if (v && typeof v === "object") return (v as Record<string, unknown>).name === variant;
      return false;
    });
  }
  if (!variantExists) return null;

  // Extract variant_props for this specific variant.
  // Object-map schemas define a `variant_props` block keyed by variant name.
  // Array-style schemas use a flat `props` or `properties` block shared across variants.
  let variant_props: Record<string, unknown> | null = null;
  if (
    parsed.variant_props &&
    typeof parsed.variant_props === "object" &&
    !Array.isArray(parsed.variant_props)
  ) {
    const propsMap = parsed.variant_props as Record<string, unknown>;
    if (variant in propsMap && propsMap[variant] && typeof propsMap[variant] === "object") {
      variant_props = propsMap[variant] as Record<string, unknown>;
    }
  }
  // Fallback: use top-level `props` or `properties` (common in array-style schemas)
  if (
    variant_props === null &&
    parsed.props &&
    typeof parsed.props === "object" &&
    !Array.isArray(parsed.props)
  ) {
    variant_props = parsed.props as Record<string, unknown>;
  }
  if (
    variant_props === null &&
    parsed.properties &&
    typeof parsed.properties === "object" &&
    !Array.isArray(parsed.properties)
  ) {
    variant_props = parsed.properties as Record<string, unknown>;
  }

  // Find an example that uses this variant.
  // Strategy:
  // 1. Regex-match `variant: <name>` (unquoted or quoted) across example files.
  // 2. If no match found, fall back to the first available example file.
  //    This ensures single-variant components (no `variants` key in schema, synthetic
  //    "default" variant) always return an example even though their example files
  //    do not contain a `variant:` field at all.
  const variantPattern = new RegExp(`variant:\\s*["']?${variant}["']?(?:\\s|$)`);
  let example: string | null = null;
  const examplesPath = path.join(versionPath, "examples");
  if (fs.existsSync(examplesPath)) {
    const exampleFiles = fs
      .readdirSync(examplesPath)
      .filter(f => f.endsWith(".yml") || f.endsWith(".yaml"));

    const extractYaml = (exFile: string): string | null => {
      try {
        const raw = fs.readFileSync(path.join(examplesPath, exFile), "utf-8");
        const exParsed = safeLoad(raw);
        return exParsed?.yaml && typeof exParsed.yaml === "string" ? exParsed.yaml : raw;
      } catch { return null; }
    };

    // Pass 1: prefer an example that explicitly references this variant
    for (const exFile of exampleFiles) {
      const yamlContent = extractYaml(exFile);
      if (yamlContent && variantPattern.test(yamlContent)) {
        example = yamlContent;
        break;
      }
    }

    // Pass 2: fallback — return the first readable example when no tagged match found
    if (example === null && exampleFiles.length > 0) {
      example = extractYaml(exampleFiles[0]);
    }
  }

  return { componentType, variant, variant_props, example };
}
