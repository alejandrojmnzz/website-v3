/**
 * Content-type field_overrides — page-level YAML overlays on live locale files.
 * Precedence at render: field_overrides > DB overrides.json > original DB.
 * Always stored on `{slug}/{locale}.yml` (never _common.yml or variant files).
 */

import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";
import { getFolder, getContentTypeConfig, getFieldMapping, getFullFieldMapping, getLookupKey, RESERVED_IMAGE_FIELD, IMAGE_ALIAS_FIELD, RESERVED_SLUG_FIELD, SLUG_ALIAS_FIELD, KNOWN_SPECIAL_FIELDS, RESERVED_PUBLISHED_AT_FIELD } from "./content-types";
import { getDefaultContentRoot } from "./site-config";
import { contentIndex } from "./content-index";
import { markFileAsModified } from "./sync-state";
import { resolveFieldValue } from "./transform";
import type { DatabaseManager } from "./database";
import { isPublishedAtEmpty, setPublishedAt } from "./published-at";

export const FIELD_OVERRIDES_KEY = "field_overrides";

export type FieldOverrideSource =
  | "original"
  | "db_override"
  | "ct_override"
  | "entry_default";

export type FieldProvenance = {
  field: string;
  effective: unknown;
  source: FieldOverrideSource;
  baseline?: unknown;
  db_value?: unknown;
  ct_value?: unknown;
  calculated?: boolean;
};

function contentRootPath(contentRoot?: string): string {
  const raw = contentRoot ?? getDefaultContentRoot();
  return path.isAbsolute(raw) ? raw : path.join(process.cwd(), raw);
}

export function liveLocaleOverlayPath(
  contentType: string,
  slug: string,
  locale: string,
  contentRoot?: string,
): string {
  const root = contentRootPath(contentRoot);
  const folder = getFolder(contentType, contentRoot);
  return path.join(root, folder, slug, `${locale}.yml`);
}

export function readFieldOverrides(
  contentType: string,
  slug: string,
  locale: string,
  contentRoot?: string,
): Record<string, unknown> {
  const filePath = liveLocaleOverlayPath(contentType, slug, locale, contentRoot);
  if (!fs.existsSync(filePath)) return {};
  try {
    const parsed = contentIndex.safeYamlLoad(fs.readFileSync(filePath, "utf-8"));
    if (!parsed || typeof parsed !== "object") return {};
    const fo = (parsed as Record<string, unknown>)[FIELD_OVERRIDES_KEY];
    if (!fo || typeof fo !== "object" || Array.isArray(fo)) return {};
    return { ...(fo as Record<string, unknown>) };
  } catch {
    return {};
  }
}

export function applyFieldOverridesToItem(
  item: Record<string, unknown>,
  overrides: Record<string, unknown>,
): Record<string, unknown> {
  if (!overrides || Object.keys(overrides).length === 0) return item;
  return { ...item, ...overrides };
}

/**
 * Write or merge field_overrides keys on the live locale file.
 * Pass `null` for a key value to delete that override.
 */
export function writeFieldOverrides(
  contentType: string,
  slug: string,
  locale: string,
  updates: Record<string, unknown | null>,
  author?: string,
  contentRoot?: string,
): { success: boolean; error?: string } {
  if (slug.includes("/") || contentType.includes("/") || /[^a-z0-9_-]/i.test(locale)) {
    return { success: false, error: "Invalid path segment" };
  }

  const root = contentRootPath(contentRoot);
  const folder = getFolder(contentType, contentRoot);
  const entryDir = path.join(root, folder, slug);
  const filePath = path.join(entryDir, `${locale}.yml`);
  const config = getContentTypeConfig(contentType, contentRoot);
  const isStatic = !config?.database?.slug;

  // Reserved editorial published_at: static types write _common.yml (listings sort from there).
  const pendingUpdates: Record<string, unknown | null> = { ...updates };
  if (Object.prototype.hasOwnProperty.call(pendingUpdates, RESERVED_PUBLISHED_AT_FIELD)) {
    const pubVal = pendingUpdates[RESERVED_PUBLISHED_AT_FIELD];
    if (pubVal === null || pubVal === undefined || isPublishedAtEmpty(pubVal)) {
      return {
        success: false,
        error: "published_at cannot be cleared; set a non-empty datetime to backdate.",
      };
    }
    if (isStatic) {
      const written = setPublishedAt(
        contentType,
        slug,
        String(pubVal),
        author,
        contentRoot,
      );
      if (!written.success) {
        return { success: false, error: written.error || "Failed to write published_at" };
      }
      // Clear any locale override so provenance matches _common
      pendingUpdates[RESERVED_PUBLISHED_AT_FIELD] = null;
    }
  }

  try {
    if (!fs.existsSync(entryDir)) {
      fs.mkdirSync(entryDir, { recursive: true });
    }

    let entryData: Record<string, unknown> = {};
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, "utf-8");
      entryData = (yaml.load(raw) as Record<string, unknown>) || {};
    }

    const existing =
      entryData[FIELD_OVERRIDES_KEY] &&
      typeof entryData[FIELD_OVERRIDES_KEY] === "object" &&
      !Array.isArray(entryData[FIELD_OVERRIDES_KEY])
        ? { ...(entryData[FIELD_OVERRIDES_KEY] as Record<string, unknown>) }
        : {};

    for (const [key, value] of Object.entries(pendingUpdates)) {
      if (value === null || value === undefined) {
        delete existing[key];
      } else {
        existing[key] = value;
      }
    }

    if (Object.keys(existing).length === 0) {
      delete entryData[FIELD_OVERRIDES_KEY];
    } else {
      entryData[FIELD_OVERRIDES_KEY] = existing;
    }

    fs.writeFileSync(
      filePath,
      yaml.dump(entryData, { lineWidth: -1, noRefs: true }),
      "utf-8",
    );
    markFileAsModified(filePath, author, undefined, contentRoot);
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export function clearFieldOverride(
  contentType: string,
  slug: string,
  locale: string,
  field: string,
  author?: string,
  contentRoot?: string,
): { success: boolean; error?: string } {
  return writeFieldOverrides(contentType, slug, locale, { [field]: null }, author, contentRoot);
}

function isFunctionMapping(source: unknown): boolean {
  return typeof source === "string" && source.startsWith("function:");
}

function mappingSourceString(source: string | { source: string; default: string } | undefined): string | undefined {
  if (!source) return undefined;
  if (typeof source === "string") return source;
  return source.source;
}

/**
 * Build provenance rows for the SEO Fields tab.
 */
export async function buildFieldProvenance(opts: {
  contentType: string;
  slug: string;
  locale: string;
  contentRoot?: string;
  db: DatabaseManager;
}): Promise<{
  hasDatabase: boolean;
  fields: FieldProvenance[];
}> {
  const { contentType, slug, locale, contentRoot, db } = opts;
  const config = getContentTypeConfig(contentType, contentRoot);
  if (!config) {
    throw new Error(`Content type "${contentType}" not found`);
  }

  const fmRegular = getFieldMapping(contentType, contentRoot) || {};
  const fmFull = getFullFieldMapping(contentType, contentRoot) || {};
  const editorKeys = Object.keys(config.editor || {}).filter(
    (k) => k !== IMAGE_ALIAS_FIELD && k !== SLUG_ALIAS_FIELD && !k.startsWith("_"),
  );
  const mappingKeys = Object.keys(fmRegular).filter(
    (k) => !k.startsWith("_") && k !== IMAGE_ALIAS_FIELD && k !== SLUG_ALIAS_FIELD,
  );
  const specialKeys = KNOWN_SPECIAL_FIELDS.filter((k) => k in fmFull || true);
  const fieldKeys = Array.from(new Set([...specialKeys, ...mappingKeys, ...editorKeys]));

  const ctOverrides = readFieldOverrides(contentType, slug, locale, contentRoot);
  const hasDatabase = !!config.database?.slug;
  const dbName = config.database?.slug;

  let dbOverrides: Record<string, unknown> = {};
  let originalItem: Record<string, unknown> | null = null;
  let mappedItem: Record<string, unknown> | null = null;
  /** Merged entry YAML for static types — used as entry_default baseline. */
  let staticPageData: Record<string, unknown> | null = null;

  if (hasDatabase && dbName && db.exists(dbName)) {
    const lookupKey = getLookupKey(contentType, contentRoot) || "slug";
    const rawDbOvr = db.getDbOverridesForEntry(dbName, slug) || {};
    const reverseMap: Record<string, string> = {};
    for (const [templateKey, dbPath] of Object.entries(fmRegular)) {
      if (typeof dbPath === "string" && !dbPath.startsWith("function:") && !templateKey.startsWith("_")) {
        const clean = dbPath.startsWith("?") ? dbPath.slice(1) : dbPath;
        reverseMap[clean] = templateKey;
      }
    }
    for (const [dbKey, value] of Object.entries(rawDbOvr)) {
      const templateKey = reverseMap[dbKey] || dbKey;
      dbOverrides[templateKey] = value;
    }

    originalItem = db.getOriginalMappedItem(dbName, slug, lookupKey);

    const cached = await db.fetchItems(dbName);
    const items = cached.items as Record<string, unknown>[];
    mappedItem = items.find((i) => String(i[lookupKey] ?? "") === slug) ?? null;
  } else if (!hasDatabase) {
    const { data } = contentIndex.loadMergedContent(contentType, slug, locale);
    if (data && typeof data === "object" && !Array.isArray(data)) {
      staticPageData = data as Record<string, unknown>;
    }
  }

  const fields: FieldProvenance[] = [];

  for (const field of fieldKeys) {
    const sourceRaw = mappingSourceString(fmFull[field] ?? fmRegular[field]);
    const calculated = isFunctionMapping(sourceRaw);
    const isSpecial = field.startsWith("_");

    const ctValue = Object.prototype.hasOwnProperty.call(ctOverrides, field)
      ? ctOverrides[field]
      : undefined;
    const hasCt = ctValue !== undefined && !isSpecial;

    const dbValue = Object.prototype.hasOwnProperty.call(dbOverrides, field)
      ? dbOverrides[field]
      : undefined;
    const hasDb = dbValue !== undefined && !isSpecial;

    let baseline: unknown;
    if (hasDatabase && originalItem) {
      const dbPath = sourceRaw?.startsWith("?") ? sourceRaw.slice(1) : sourceRaw;
      baseline =
        (dbPath && !isFunctionMapping(dbPath) ? originalItem[dbPath] : undefined) ??
        originalItem[field];
      if (field === RESERVED_IMAGE_FIELD && baseline === undefined) {
        baseline = originalItem[IMAGE_ALIAS_FIELD];
      }
      if (field === RESERVED_SLUG_FIELD && baseline === undefined) {
        baseline = originalItem[SLUG_ALIAS_FIELD];
      }
    } else if (!hasDatabase && staticPageData && sourceRaw && !calculated) {
      baseline = resolveFieldValue(sourceRaw, staticPageData, field);
    } else if (!hasDatabase && staticPageData && field === RESERVED_IMAGE_FIELD && !sourceRaw) {
      baseline = staticPageData[IMAGE_ALIAS_FIELD];
    } else if (!hasDatabase && staticPageData && field === RESERVED_SLUG_FIELD && !sourceRaw) {
      baseline = staticPageData[SLUG_ALIAS_FIELD];
    }

    let effective: unknown;
    let source: FieldOverrideSource;

    if (hasCt) {
      effective = ctValue;
      source = "ct_override";
    } else if (hasDb) {
      effective = dbValue;
      source = "db_override";
    } else if (hasDatabase) {
      effective =
        (field === RESERVED_IMAGE_FIELD
          ? mappedItem?.[IMAGE_ALIAS_FIELD] ?? mappedItem?.[field]
          : field === RESERVED_SLUG_FIELD
            ? mappedItem?.[SLUG_ALIAS_FIELD] ?? mappedItem?.[field]
            : mappedItem?.[field]) ?? baseline;
      source = "original";
    } else {
      effective = baseline;
      source = "entry_default";
    }

    const row: FieldProvenance = {
      field,
      effective,
      source,
      calculated: calculated || undefined,
    };
    if (hasDatabase || baseline !== undefined) row.baseline = baseline;
    if (hasDb) row.db_value = dbValue;
    if (hasCt) row.ct_value = ctValue;
    fields.push(row);
  }

  return { hasDatabase, fields };
}
