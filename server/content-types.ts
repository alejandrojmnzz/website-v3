import fs from "fs";
import { getDefaultContentRoot } from "./site-config";
import path from "path";
import yaml from "js-yaml";
import { getSupportedLocales, getDefaultLocale } from "./settings";
import { markFileAsModified } from "./sync-state";
import { child } from "./logger";
const log = child({ module: "content-types" });



export interface DatabaseConfig {
  slug: string;
}

export interface LayoutMenuConfig {
  top: string | null;
  bottom: string | null;
}

export interface LayoutConfig {
  menu: LayoutMenuConfig;
}

export interface ContentTypeEntry {
  directory: string;
  url_pattern: Record<string, string>;
  unique_fields?: string[];
  field_mapping?: Record<string, string | { source: string; default: string }>;
  indexes?: string[];
  database?: DatabaseConfig;
  layout?: { menu?: { top?: string | null; bottom?: string | null } };
  /**
   * When true (static types), `_common.single.yml` (+ optional `single.{locale}.yml`)
   * is the shared section template; entry YAML id-patches sections instead of replacing them.
   * DB-backed types already use this merge model via mergeSingleTemplate.
   */
  single_template?: boolean;
}

interface ContentTypesRegistry {
  types: Record<string, ContentTypeEntry>;
  directoryToType: Map<string, string>;
  allDirectories: string[];
  allTypes: string[];
}

const registryCache = new Map<string, ContentTypesRegistry>();

function resolveContentTypeRoot(contentRoot?: string): string {
  return contentRoot ?? getDefaultContentRoot();
}
function getConfigPath(contentRoot?: string): string {
  return path.join(resolveContentTypeRoot(contentRoot), "content-types.yml");
}

const CONFIG_HEADER = `# Content Types Configuration
# ===========================
# Each entry defines a content type with its URL routing, field mapping, and optional database connection.
#
# Required fields:
#   directory: folder inside 4geeks-com/ where YAML entries live
#   url_pattern: URL routing pattern (must include :slug for unique entry URLs)
#     - Per-locale object: { en: /en/path/:slug, es: /es/ruta/:slug }
#     - Shorthand: { default: /landing/:slug } (same path for all locales)
#
# field_mapping (recommended):
#   Declares which fields are available as {{ single.* }} template variables.
#   For database-backed types: maps content concepts to database column names.
#     Underscore-prefixed fields are mandatory special fields:
#       _slug: DB field containing the entry's unique identifier
#       _locale: DB field containing the entry's language
#   For non-database types: exposes YAML keys from merged content as {{ single.* }} variables.
#     Dot-notation supported for nested keys (e.g., page_title: meta.page_title).
#
# indexes (optional):
#   Fields for filtering when listing entries. Works for DB and non-DB types.
#
# database (optional):
#   slug: database name (matches a db config in 4geeks-com/db/)
#
# layout (optional):
#   menu:
#     top: menu ID for navbar (e.g., "main-navbar") or null for no navbar
#     bottom: menu ID for footer (e.g., "main-footer") or null for no footer
#   System default (when absent): { menu: { top: null, bottom: null } }
#   Per-entry override: set layout.menu.top / layout.menu.bottom in _common.yml or locale files
#
# single_template (optional, default false):
#   When true, static entries inherit sections from _common.single.yml (and single.{locale}.yml
#   if present) and apply per-entry section patches by id — same model as DB-backed singles.
#   Set automatically when converting a DB-backed type to static.
`;

function writeConfigWithHeader(allTypes: Record<string, ContentTypeEntry>, contentRoot?: string): void {
  const configPath = getConfigPath(contentRoot);
  const yamlBody = yaml.dump(allTypes, { lineWidth: 120, noRefs: true, sortKeys: false });
  fs.writeFileSync(configPath, CONFIG_HEADER + "\n" + yamlBody, "utf-8");
}

function validateUrlPatterns(urlPattern: Record<string, string>): void {
  for (const [locale, pattern] of Object.entries(urlPattern)) {
    if (!pattern.startsWith("/")) {
      throw new Error(`URL pattern for "${locale}" must start with /`);
    }
    if (!pattern.includes(":slug")) {
      throw new Error(`URL pattern for "${locale}" must include :slug`);
    }
  }
}

export function normalizeUrlPattern(raw: string | Record<string, string>): Record<string, string> {
  if (typeof raw === "object" && raw !== null) return raw;
  if (typeof raw !== "string") return {};
  if (raw.includes(":locale")) {
    const result: Record<string, string> = {};
    for (const locale of getSupportedLocales()) {
      result[locale] = raw.replaceAll(":locale", locale);
    }
    return result;
  }
  return { default: raw };
}

function loadRegistry(contentRoot?: string): ContentTypesRegistry {
  const key = resolveContentTypeRoot(contentRoot);
  if (registryCache.has(key)) return registryCache.get(key)!;

  const configPath = getConfigPath(key);
  let parsed: Record<string, any> = {};

  if (fs.existsSync(configPath)) {
    try {
      const raw = fs.readFileSync(configPath, "utf-8");
      parsed = (yaml.load(raw) as Record<string, any>) || {};
    } catch (err) {
      log.error({ err: err }, "[ContentTypes] Failed to read content-types.yml:");
    }
  }

  for (const config of Object.values(parsed)) {
    if (config?.url_pattern) {
      config.url_pattern = normalizeUrlPattern(config.url_pattern);
    }
    if (config?.folder && !config.directory) {
      config.directory = config.folder;
      delete config.folder;
    }
  }

  const directoryToType = new Map<string, string>();
  for (const [type, config] of Object.entries(parsed)) {
    if ((config as ContentTypeEntry).directory) {
      directoryToType.set((config as ContentTypeEntry).directory, type);
    }
  }

  const reg: ContentTypesRegistry = {
    types: parsed,
    directoryToType,
    allDirectories: Object.values(parsed).map(c => c.directory),
    allTypes: Object.keys(parsed),
  };

  registryCache.set(key, reg);
  return reg;
}

export function getDirectory(type: string, contentRoot?: string): string {
  const reg = loadRegistry(contentRoot);
  const entry = reg.types[type];
  if (entry?.directory) return entry.directory;
  if (reg.directoryToType.has(type)) return type;
  return type;
}

export const getFolder = getDirectory;

export function getType(directoryOrType: string, contentRoot?: string): string {
  const reg = loadRegistry(contentRoot);
  if (reg.types[directoryOrType]) return directoryOrType;
  const mapped = reg.directoryToType.get(directoryOrType);
  return mapped || directoryOrType;
}

export function isValidType(type: string, contentRoot?: string): boolean {
  const reg = loadRegistry(contentRoot);
  return type in reg.types || reg.directoryToType.has(type);
}

export function getAllTypes(contentRoot?: string): string[] {
  return loadRegistry(contentRoot).allTypes;
}

export function getAllDirectories(contentRoot?: string): string[] {
  return loadRegistry(contentRoot).allDirectories;
}

export const getAllFolders = getAllDirectories;

export function getUrlPattern(type: string, locale: string, contentRoot?: string): string | null {
  const reg = loadRegistry(contentRoot);
  const singular = getType(type, contentRoot);
  const entry = reg.types[singular];
  if (!entry?.url_pattern) return null;
  return entry.url_pattern[locale] || entry.url_pattern["default"] || null;
}

export function getContentTypeConfig(type: string, contentRoot?: string): ContentTypeEntry | undefined {
  const reg = loadRegistry(contentRoot);
  const singular = getType(type, contentRoot);
  return reg.types[singular];
}

export function getAllConfigs(contentRoot?: string): Record<string, ContentTypeEntry> {
  return loadRegistry(contentRoot).types;
}

export function getLabel(type: string, contentRoot?: string): string {
  const singular = getType(type, contentRoot);
  return singular.charAt(0).toUpperCase() + singular.slice(1);
}

export function getDirectoryMap(contentRoot?: string): Record<string, string> {
  const reg = loadRegistry(contentRoot);
  const map: Record<string, string> = {};
  for (const [type, config] of Object.entries(reg.types)) {
    map[type] = config.directory;
  }
  return map;
}

export const getFolderMap = getDirectoryMap;

export function getDatabaseName(type: string, contentRoot?: string): string | null {
  const reg = loadRegistry(contentRoot);
  const singular = getType(type, contentRoot);
  const entry = reg.types[singular];
  return entry?.database?.slug || null;
}

export function getFullFieldMapping(type: string, contentRoot?: string): Record<string, string> | null {
  const reg = loadRegistry(contentRoot);
  const singular = getType(type, contentRoot);
  const entry = reg.types[singular];
  const mapping = entry?.field_mapping;
  if (!mapping) return null;
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(mapping)) {
    result[key] = typeof value === "object" ? value.source : value;
  }
  return Object.keys(result).length > 0 ? result : null;
}

export function getFieldMapping(type: string, contentRoot?: string): Record<string, string> | null {
  const full = getFullFieldMapping(type, contentRoot);
  if (!full) return null;
  const filtered: Record<string, string> = {};
  for (const [key, value] of Object.entries(full)) {
    if (!key.startsWith("_")) {
      filtered[key] = value;
    }
  }
  return Object.keys(filtered).length > 0 ? filtered : null;
}

export function getSlugField(type: string, contentRoot?: string): string | null {
  const reg = loadRegistry(contentRoot);
  const singular = getType(type, contentRoot);
  const entry = reg.types[singular];
  const slugConfig = entry?.field_mapping?._slug;
  if (!slugConfig) return null;
  if (typeof slugConfig === "object") return slugConfig.source;
  return slugConfig;
}

export function getLocaleKey(type: string, contentRoot?: string): string | null {
  const reg = loadRegistry(contentRoot);
  const singular = getType(type, contentRoot);
  const entry = reg.types[singular];
  const localeConfig = entry?.field_mapping?._locale;
  if (!localeConfig) return null;
  const raw = typeof localeConfig === "object" ? localeConfig.source : localeConfig;
  if (raw.startsWith("function:")) {
    const mapping = entry?.field_mapping;
    if (mapping) {
      const localeLikeFields = ["lang", "locale", "language"];
      for (const f of localeLikeFields) {
        if (f in mapping && !f.startsWith("_")) return f;
      }
    }
    return null;
  }
  return raw;
}

export function getLocaleSource(type: string, contentRoot?: string): string | null {
  const reg = loadRegistry(contentRoot);
  const singular = getType(type, contentRoot);
  const entry = reg.types[singular];
  const localeConfig = entry?.field_mapping?._locale;
  if (!localeConfig) return null;
  if (typeof localeConfig === "object") return localeConfig.source;
  return localeConfig;
}

export function getLocaleDefault(type: string, contentRoot?: string): string {
  const reg = loadRegistry(contentRoot);
  const singular = getType(type, contentRoot);
  const entry = reg.types[singular];
  const localeConfig = entry?.field_mapping?._locale;
  if (localeConfig && typeof localeConfig === "object" && localeConfig.default) {
    return localeConfig.default;
  }
  return getDefaultLocale(contentRoot);
}

export function getIndexes(type: string, contentRoot?: string): string[] {
  const reg = loadRegistry(contentRoot);
  const singular = getType(type, contentRoot);
  const entry = reg.types[singular];
  return entry?.indexes || [];
}

export function getDatabaseConfig(type: string, contentRoot?: string): DatabaseConfig | null {
  const reg = loadRegistry(contentRoot);
  const singular = getType(type, contentRoot);
  const entry = reg.types[singular];
  return entry?.database || null;
}

export function getLookupKey(type: string, contentRoot?: string): string | null {
  const reg = loadRegistry(contentRoot);
  const singular = getType(type, contentRoot);
  const entry = reg.types[singular];
  if (!entry?.url_pattern) return null;
  const patterns = Object.values(entry.url_pattern);
  if (patterns.length === 0) return null;
  const pattern = patterns[0];
  const params = pattern.match(/:([a-zA-Z_]+)/g);
  if (!params || params.length === 0) return null;
  return params[params.length - 1].slice(1);
}

export function hasDatabaseSingle(type: string, contentRoot?: string): boolean {
  return !!getDatabaseName(type, contentRoot);
}

export function hasFieldMapping(type: string, contentRoot?: string): boolean {
  return !!getFieldMapping(type, contentRoot);
}

export type ContentTypeConfigUpdate = Partial<Omit<ContentTypeEntry, "database">> & {
  /** Pass `null` to unlink a database-backed type (removes the `database` key). */
  database?: DatabaseConfig | null;
};

export function updateContentTypeConfig(type: string, update: ContentTypeConfigUpdate, contentRoot?: string): void {
  const reg = loadRegistry(contentRoot);
  const singular = getType(type, contentRoot);
  const existing = reg.types[singular];
  if (!existing) {
    throw new Error(`Content type "${type}" not found`);
  }

  const { database: databaseUpdate, ...rest } = update;
  const merged: ContentTypeEntry = { ...existing, ...rest };
  if (databaseUpdate === null) {
    delete merged.database;
  } else if (databaseUpdate && existing.database) {
    merged.database = { ...existing.database, ...databaseUpdate };
  } else if (databaseUpdate) {
    merged.database = databaseUpdate;
  }

  if (merged.url_pattern) {
    validateUrlPatterns(merged.url_pattern);
  }

  if (merged.database && !merged.field_mapping?._slug) {
    throw new Error(`Database-backed content type "${singular}" requires _slug in field_mapping`);
  }

  const resolvedRoot = resolveContentTypeRoot(contentRoot);
  const configPath = getConfigPath(contentRoot);
  const allTypes = { ...reg.types, [singular]: merged };
  writeConfigWithHeader(allTypes, contentRoot);
  markFileAsModified(configPath, undefined, undefined, resolvedRoot);
  resetRegistry(resolvedRoot);
  log.info(`[ContentTypes] Updated config for "${singular}"`);
}

export function addContentType(name: string, config: ContentTypeEntry, contentRoot?: string): void {
  const reg = loadRegistry(contentRoot);
  if (reg.types[name]) {
    throw new Error(`Content type "${name}" already exists`);
  }

  validateUrlPatterns(config.url_pattern);

  if (config.database && !config.field_mapping?._slug) {
    throw new Error(`Database-backed content type "${name}" requires _slug in field_mapping`);
  }

  const configPath = getConfigPath(contentRoot);
  const resolvedRoot = resolveContentTypeRoot(contentRoot);
  const allTypes = { ...reg.types, [name]: config };
  writeConfigWithHeader(allTypes, contentRoot);
  markFileAsModified(configPath, undefined, undefined, resolvedRoot);
  registryCache.delete(resolvedRoot);

  const dirPath = path.join(resolvedRoot, config.directory);
  const isNewDir = !fs.existsSync(dirPath);
  if (isNewDir) {
    fs.mkdirSync(dirPath, { recursive: true });
    const folderName = path.relative(process.cwd(), resolvedRoot);
    log.info(`[ContentTypes] Created directory: ${folderName}/${config.directory}/`);
  }

  if (isNewDir) {
    const locales = getSupportedLocales(contentRoot);
    const sampleSlug = `sample-${name}`;
    const sampleDir = path.join(dirPath, sampleSlug);
    fs.mkdirSync(sampleDir, { recursive: true });

    const titleCase = name.replace(/[-_]/g, " ").replace(/\b\w/g, c => c.toUpperCase());

    const commonYml = [
      `slug: ${sampleSlug}`,
      `title: ${titleCase}`,
      "",
      "meta:",
      "  robots: index, follow",
      "  priority: 0.9",
      "  change_frequency: weekly",
      "",
      "schema:",
      "  include:",
      "    - organization",
      "    - website",
      "",
    ].join("\n");
    const commonYmlPath = path.join(sampleDir, "_common.yml");
    fs.writeFileSync(commonYmlPath, commonYml);
    markFileAsModified(commonYmlPath, undefined, undefined, resolvedRoot);

    for (const locale of locales) {
      const localeYml = [
        `slug: ${sampleSlug}`,
        `title: ${titleCase}`,
        "",
        "meta:",
        `  page_title: "${titleCase} | 4Geeks"`,
        `  description: "Sample ${name} entry for ${locale} locale."`,
        "",
        "sections: []",
        "",
      ].join("\n");
      const localeYmlPath = path.join(sampleDir, `${locale}.yml`);
      fs.writeFileSync(localeYmlPath, localeYml);
      markFileAsModified(localeYmlPath, undefined, undefined, resolvedRoot);
    }

    const folderName2 = path.relative(process.cwd(), resolvedRoot);
    log.info(`[ContentTypes] Created sample entry: ${folderName2}/${config.directory}/${sampleSlug}/ (${locales.length} locale(s))`);
  }

  resetRegistry(resolvedRoot);
  log.info(`[ContentTypes] Added content type "${name}"`);
}

export function deleteContentType(name: string, contentRoot?: string): void {
  const reg = loadRegistry(contentRoot);
  const singular = getType(name, contentRoot);
  if (!reg.types[singular]) {
    throw new Error(`Content type "${name}" not found`);
  }

  const configPath = getConfigPath(contentRoot);
  const resolvedRoot = resolveContentTypeRoot(contentRoot);
  const allTypes = { ...reg.types };
  delete allTypes[singular];
  writeConfigWithHeader(allTypes, contentRoot);
  markFileAsModified(configPath, undefined, undefined, resolvedRoot);
  resetRegistry(resolvedRoot);
  log.info(`[ContentTypes] Deleted content type "${singular}"`);
}

export function resetRegistry(contentRoot?: string): void {
  if (contentRoot) {
    registryCache.delete(contentRoot);
  } else {
    registryCache.clear();
  }
}

export function readRawContentTypesYml(contentRoot?: string): { content: string; absolutePath: string } | null {
  const configPath = getConfigPath(contentRoot);
  if (!fs.existsSync(configPath)) return null;
  return {
    content: fs.readFileSync(configPath, "utf-8"),
    absolutePath: configPath,
  };
}

export function writeRawContentTypesYml(content: string, contentRoot?: string, author?: string): void {
  let parsed: unknown;
  try {
    parsed = yaml.load(content);
  } catch (err) {
    throw new Error(`Invalid YAML: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("content-types.yml must be a YAML object mapping type names to configs");
  }

  for (const [name, entry] of Object.entries(parsed as Record<string, unknown>)) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`Entry "${name}" must be an object`);
    }
    const config = entry as Partial<ContentTypeEntry>;
    if (!config.directory || typeof config.directory !== "string") {
      throw new Error(`Entry "${name}" requires a string "directory"`);
    }
    if (!config.url_pattern) {
      throw new Error(`Entry "${name}" requires "url_pattern"`);
    }
    const normalized = normalizeUrlPattern(config.url_pattern as string | Record<string, string>);
    validateUrlPatterns(normalized);
    if (config.database && !(config.field_mapping as Record<string, unknown> | undefined)?._slug) {
      throw new Error(`Database-backed content type "${name}" requires _slug in field_mapping`);
    }
  }

  const resolvedRoot = resolveContentTypeRoot(contentRoot);
  const configPath = getConfigPath(resolvedRoot);
  fs.writeFileSync(configPath, content, "utf-8");
  markFileAsModified(configPath, author, undefined, resolvedRoot);
  resetRegistry(resolvedRoot);
  log.info("[ContentTypes] Wrote raw content-types.yml");
}

function extractDotPath(record: Record<string, unknown>, dotPath: string): unknown {
  const parts = dotPath.split(".");
  let current: unknown = record;
  for (const part of parts) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function resolveFieldValue(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.join(",");
  if (typeof value === "object" && "slug" in (value as object)) {
    return String((value as Record<string, unknown>).slug || "");
  }
  return String(value);
}

/**
 * Extract all `:variable` params (besides `slug` and `locale`) from a URL pattern
 * and resolve each from the entry's merged data. Supports nested values like a
 * `category` object whose `slug` should be used, as well as plain string fields
 * and dot-notation lookups via an optional field mapping.
 *
 * Returns the resolved params plus a list of variables that could not be
 * resolved (missing or empty), so callers can skip entries instead of emitting
 * malformed URLs.
 */
export function extractUrlPatternParams(
  pattern: string,
  record: Record<string, unknown>,
  fieldMapping?: Record<string, string | null> | null,
): { params: Record<string, string>; missing: string[] } {
  const params: Record<string, string> = {};
  const missing: string[] = [];

  const paramMatches = pattern.match(/:([a-zA-Z_]+)/g) || [];
  for (const param of paramMatches) {
    const key = param.slice(1);
    if (key === "slug" || key === "locale") continue;

    let rawValue: unknown;
    const mappingKey = fieldMapping && `_${key}` in fieldMapping ? `_${key}` : key;
    if (fieldMapping && mappingKey in fieldMapping) {
      const sourceField = fieldMapping[mappingKey];
      if (sourceField) {
        rawValue = extractDotPath(record, sourceField);
      }
    }
    if (rawValue === undefined) {
      rawValue = extractDotPath(record, key);
    }

    const resolved = resolveFieldValue(rawValue);
    if (!resolved) {
      if (!missing.includes(key)) missing.push(key);
      continue;
    }
    params[key] = resolved;
  }

  return { params, missing };
}

export function resolveUrlPatternWithMapping(
  pattern: string,
  record: Record<string, unknown>,
  locale: string,
  fieldMapping?: Record<string, string | null> | null,
): string {
  let result = pattern.replaceAll(":locale", locale);

  const paramMatches = result.match(/:([a-zA-Z_]+)/g) || [];
  for (const param of paramMatches) {
    const key = param.slice(1);

    let rawValue: unknown;

    const mappingKey = fieldMapping && `_${key}` in fieldMapping ? `_${key}` : key;
    if (fieldMapping && mappingKey in fieldMapping) {
      const sourceField = fieldMapping[mappingKey];
      if (sourceField) {
        rawValue = extractDotPath(record, sourceField);
      }
    }

    if (rawValue === undefined) {
      rawValue = extractDotPath(record, key);
    }

    result = result.replaceAll(param, resolveFieldValue(rawValue));
  }

  result = result.replace(/\/\/+/g, "/");

  return result;
}

export function resolveContentTypeUrl(
  type: string,
  record: Record<string, unknown>,
  locale: string,
  contentRoot?: string,
): string | null {
  const config = getContentTypeConfig(type, contentRoot);
  if (!config?.url_pattern) return null;
  const pattern = config.url_pattern[locale] || config.url_pattern["default"] || config.url_pattern["en"];
  if (!pattern) return null;
  const mapping = getFullFieldMapping(type, contentRoot);
  return resolveUrlPatternWithMapping(pattern, record, locale, mapping);
}

const SYSTEM_DEFAULT_LAYOUT: LayoutConfig = {
  menu: { top: null, bottom: null },
};

export function getLayout(type: string, contentRoot?: string): LayoutConfig {
  const reg = loadRegistry(contentRoot);
  const singular = getType(type, contentRoot);
  const entry = reg.types[singular];
  if (!entry?.layout?.menu) {
    return { ...SYSTEM_DEFAULT_LAYOUT };
  }
  return {
    menu: {
      top: entry.layout.menu.top ?? null,
      bottom: entry.layout.menu.bottom ?? null,
    },
  };
}

export function resolveLayout(
  contentType: string,
  mergedData: Record<string, unknown>,
  contentRoot?: string,
): LayoutConfig {
  const typeLayout = getLayout(contentType, contentRoot);
  const entryLayout = mergedData.layout as
    | { menu?: { top?: string | null; bottom?: string | null } }
    | undefined;

  if (!entryLayout?.menu) return typeLayout;

  return {
    menu: {
      top: "top" in (entryLayout.menu || {}) ? (entryLayout.menu!.top ?? null) : typeLayout.menu.top,
      bottom: "bottom" in (entryLayout.menu || {}) ? (entryLayout.menu!.bottom ?? null) : typeLayout.menu.bottom,
    },
  };
}

export function listAvailableMenus(contentRoot?: string): string[] {
  const menusDir = path.join(resolveContentTypeRoot(contentRoot), "menus");
  if (!fs.existsSync(menusDir)) return [];

  const files = fs.readdirSync(menusDir);
  const ids = new Set<string>();
  for (const file of files) {
    if (!file.endsWith(".yml") && !file.endsWith(".yaml")) continue;
    const base = file.replace(/\.(yml|yaml)$/, "").replace(/\.[a-z]{2}$/, "");
    ids.add(base);
  }
  return Array.from(ids).sort();
}
