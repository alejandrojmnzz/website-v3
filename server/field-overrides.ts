/**
 * Content-type field_overrides — page-level YAML overlays on live locale files.
 * Precedence at render: field_overrides > DB overrides.json > original DB.
 * Always stored on `{slug}/{locale}.yml` (never _common.yml or variant files).
 */

import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";
import { getFolder, getContentTypeConfig, getFieldMapping, getLookupKey } from "./content-types";
import { getDefaultContentRoot } from "./site-config";
import { contentIndex } from "./content-index";
import { markFileAsModified } from "./sync-state";
import type { DatabaseManager } from "./database";

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

    for (const [key, value] of Object.entries(updates)) {
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

  const fm = getFieldMapping(contentType, contentRoot) || {};
  const editorKeys = Object.keys(config.editor || {});
  const mappingKeys = Object.keys(fm).filter((k) => !k.startsWith("_"));
  const fieldKeys = Array.from(new Set([...mappingKeys, ...editorKeys])).sort();

  const ctOverrides = readFieldOverrides(contentType, slug, locale, contentRoot);
  const hasDatabase = !!config.database?.slug;
  const dbName = config.database?.slug;

  let dbOverrides: Record<string, unknown> = {};
  let originalItem: Record<string, unknown> | null = null;
  let mappedItem: Record<string, unknown> | null = null;

  if (hasDatabase && dbName && db.exists(dbName)) {
    const lookupKey = getLookupKey(contentType, contentRoot) || "slug";
    const rawDbOvr = db.getDbOverridesForEntry(dbName, slug) || {};
    // Reverse-map db keys → template keys when needed
    const reverseMap: Record<string, string> = {};
    for (const [templateKey, dbPath] of Object.entries(fm)) {
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
  }

  const fields: FieldProvenance[] = [];

  for (const field of fieldKeys) {
    const sourceRaw = mappingSourceString(fm[field]);
    const calculated = isFunctionMapping(sourceRaw);

    const ctValue = Object.prototype.hasOwnProperty.call(ctOverrides, field)
      ? ctOverrides[field]
      : undefined;
    const hasCt = ctValue !== undefined;

    const dbValue = Object.prototype.hasOwnProperty.call(dbOverrides, field)
      ? dbOverrides[field]
      : undefined;
    const hasDb = dbValue !== undefined;

    let baseline: unknown;
    if (hasDatabase && originalItem) {
      const dbPath = sourceRaw?.startsWith("?") ? sourceRaw.slice(1) : sourceRaw;
      baseline =
        (dbPath && !isFunctionMapping(dbPath) ? originalItem[dbPath] : undefined) ??
        originalItem[field];
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
      effective = mappedItem?.[field] ?? baseline;
      source = "original";
    } else {
      effective = undefined;
      source = "entry_default";
    }

    const row: FieldProvenance = {
      field,
      effective,
      source,
      calculated: calculated || undefined,
    };
    if (hasDatabase) row.baseline = baseline;
    if (hasDb) row.db_value = dbValue;
    if (hasCt) row.ct_value = ctValue;
    fields.push(row);
  }

  return { hasDatabase, fields };
}
