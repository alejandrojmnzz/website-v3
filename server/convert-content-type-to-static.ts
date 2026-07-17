import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import { escapeObjectVars, unescapeYamlDump } from "@shared/templateVars";
import { contentIndex } from "./content-index";
import {
  getContentTypeConfig,
  getDirectory,
  getFieldMapping,
  getLocaleKey,
  updateContentTypeConfig,
  type ContentTypeEntry,
} from "./content-types";
import { databaseManager, type DatabaseManager } from "./database";
import { mergeSingleTemplate } from "./database-single-loader";
import { fetchMarkdownContent } from "./markdown";
import { resolveSingleVars } from "./single-resolver";
import { clearSitemapCache, refreshSitemapEntriesForContentKey } from "./sitemap";
import { markFileAsModified } from "./sync-state";
import { child } from "./logger";

const log = child({ module: "convert-to-static" });

const YAML_DUMP_OPTS: yaml.DumpOptions = { lineWidth: 120, noRefs: true, sortKeys: false };

const STRIP_KEYS = new Set([
  "_variableFields",
  "_variableKeys",
  "_perEntrySource",
  "_insertAfterSectionId",
  "singleEntry",
  "perEntryRemovedSections",
]);

/** Keys that always live on locale files (never only in _common). */
const LOCALE_FILE_KEYS = new Set(["meta", "sections", "settings", "title", "description", "content"]);

function safeYamlDump(obj: unknown): string {
  const { escaped, map } = escapeObjectVars(obj);
  return unescapeYamlDump(yaml.dump(escaped, YAML_DUMP_OPTS), map);
}

function stripRuntimeKeys(obj: unknown): unknown {
  if (Array.isArray(obj)) return obj.map(stripRuntimeKeys);
  if (obj !== null && typeof obj === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      if (STRIP_KEYS.has(key)) continue;
      out[key] = stripRuntimeKeys(value);
    }
    return out;
  }
  return obj;
}

function deepEqual(a: unknown, b: unknown): boolean {
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

function contentRootNameFromPath(contentRoot: string): string {
  return path.basename(contentRoot);
}

async function resolveItemContent(item: Record<string, unknown>): Promise<string> {
  let content = typeof item.content === "string" ? item.content : "";
  if (!content && typeof item.content_url === "string" && item.content_url) {
    content = await fetchMarkdownContent(item.content_url);
  }
  if (!content && typeof item.readme_url === "string" && item.readme_url) {
    content = await fetchMarkdownContent(item.readme_url);
  }
  return content;
}

function normalizeLocale(raw: unknown, fallback = "en"): string {
  const s = String(raw || fallback).trim().toLowerCase();
  if (!s) return fallback;
  // "en-US" → "en"
  const m = s.match(/^([a-z]{2})/);
  return m ? m[1] : fallback;
}

function identityFieldsFromItem(
  item: Record<string, unknown>,
  fieldMapping: Record<string, string> | null,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!fieldMapping) {
    if (item.slug != null) out.slug = item.slug;
    if (item.title != null) out.title = item.title;
    return out;
  }
  for (const key of Object.keys(fieldMapping)) {
    if (key.startsWith("_")) continue;
    if (item[key] !== undefined && item[key] !== null) {
      out[key] = item[key];
    }
  }
  if (item.slug != null && out.slug === undefined) out.slug = item.slug;
  return out;
}

function buildIdentityFieldMapping(
  existing: ContentTypeEntry["field_mapping"],
): Record<string, string> {
  const result: Record<string, string> = {};
  if (!existing) return { slug: "slug", title: "title" };
  for (const key of Object.keys(existing)) {
    if (key.startsWith("_")) continue;
    result[key] = key;
  }
  if (!result.slug) result.slug = "slug";
  return result;
}

function listSharedTemplateFiles(typeDir: string): string[] {
  if (!fs.existsSync(typeDir)) return [];
  return fs
    .readdirSync(typeDir)
    .filter((f) => /^single\.[a-z0-9-]+\.ya?ml$/i.test(f))
    .map((f) => path.join(typeDir, f));
}

function splitCommonAndLocales(
  localePages: Map<string, Record<string, unknown>>,
): { common: Record<string, unknown>; locales: Map<string, Record<string, unknown>> } {
  const locales = new Map<string, Record<string, unknown>>();
  const pages = Array.from(localePages.entries());
  if (pages.length === 0) {
    return { common: {}, locales };
  }

  const first = pages[0][1];
  const common: Record<string, unknown> = {};
  const candidateKeys = new Set<string>();
  for (const [, page] of pages) {
    for (const key of Object.keys(page)) candidateKeys.add(key);
  }

  for (const key of candidateKeys) {
    if (LOCALE_FILE_KEYS.has(key)) continue;
    const values = pages.map(([, page]) => page[key]);
    if (values.every((v) => v !== undefined && deepEqual(v, values[0]))) {
      common[key] = values[0];
    }
  }

  // Prefer keeping slug in _common even for single-locale entries
  if (first.slug !== undefined && common.slug === undefined) {
    common.slug = first.slug;
  }

  for (const [locale, page] of pages) {
    const localeObj: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(page)) {
      if (key in common && deepEqual(common[key], value) && !LOCALE_FILE_KEYS.has(key)) {
        continue;
      }
      localeObj[key] = value;
    }
    locales.set(locale, localeObj);
  }

  return { common, locales };
}

export interface ConvertToStaticPreview {
  dry_run: true;
  content_type: string;
  directory: string;
  database_slug: string;
  entry_count: number;
  locale_count: number;
  files_to_write: number;
  files_to_overwrite: number;
  existing_slug_folders: string[];
  templates_to_delete: string[];
  skipped: Array<{ reason: string; detail?: string }>;
  message: string;
}

export interface ConvertToStaticResult {
  dry_run: false;
  success: true;
  content_type: string;
  directory: string;
  unlinked_database: string;
  written: string[];
  overwritten: string[];
  deleted_templates: string[];
  skipped: Array<{ reason: string; detail?: string }>;
  entry_count: number;
  locale_count: number;
}

export type ConvertToStaticOutput = ConvertToStaticPreview | ConvertToStaticResult;

export class ConvertToStaticError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = "ConvertToStaticError";
    this.statusCode = statusCode;
  }
}

export interface ConvertToStaticOptions {
  contentType: string;
  contentRoot: string;
  dryRun?: boolean;
  author?: string;
  db?: DatabaseManager;
  /** Site-scoped content index; defaults to the process singleton. */
  refreshIndex?: () => void;
  invalidateCommonFields?: (contentType: string) => void;
}

export async function convertContentTypeToStatic(
  opts: ConvertToStaticOptions,
): Promise<ConvertToStaticOutput> {
  const { contentType, contentRoot, dryRun = false, author } = opts;
  const db = opts.db ?? databaseManager;
  const rootName = contentRootNameFromPath(contentRoot);

  const config = getContentTypeConfig(contentType, contentRoot);
  if (!config) {
    throw new ConvertToStaticError(`Content type "${contentType}" not found`, 404);
  }
  if (!config.database?.slug) {
    throw new ConvertToStaticError(
      `Content type "${contentType}" has no database configured — nothing to convert`,
      400,
    );
  }

  const dbName = config.database.slug;
  if (!db.exists(dbName)) {
    throw new ConvertToStaticError(`Database "${dbName}" not found`, 404);
  }

  const cacheInfo = db.getCacheInfo(dbName);
  if (!cacheInfo) {
    throw new ConvertToStaticError(
      `No cache for database "${dbName}". Refresh the database cache before converting.`,
      400,
    );
  }

  const items = await db.fetchMappedItems(contentType);
  if (items.length === 0) {
    throw new ConvertToStaticError(
      `Database "${dbName}" cache has no mapped items for "${contentType}"`,
      400,
    );
  }

  const directory = getDirectory(contentType, contentRoot) || config.directory;
  const typeDir = path.join(contentRoot, directory);
  const localeKey = getLocaleKey(contentType, contentRoot) || "lang";
  const fieldMapping = getFieldMapping(contentType, contentRoot);
  const templateFiles = listSharedTemplateFiles(typeDir);

  // Group by slug → locale → item
  const bySlug = new Map<string, Map<string, Record<string, unknown>>>();
  const skipped: Array<{ reason: string; detail?: string }> = [];

  for (const item of items) {
    const slug = String(item.slug ?? "").trim();
    if (!slug) {
      skipped.push({ reason: "missing_slug", detail: JSON.stringify(item).slice(0, 120) });
      continue;
    }
    const locale = normalizeLocale(item[localeKey] ?? item.lang ?? item.language ?? item.locale);
    if (!bySlug.has(slug)) bySlug.set(slug, new Map());
    const localeMap = bySlug.get(slug)!;
    if (localeMap.has(locale)) {
      skipped.push({ reason: "duplicate_locale", detail: `${slug}/${locale}` });
      continue;
    }
    localeMap.set(locale, item);
  }

  if (bySlug.size === 0) {
    throw new ConvertToStaticError(`No valid entries with slugs found for "${contentType}"`, 400);
  }

  let filesToWrite = 0;
  let filesToOverwrite = 0;
  const existingSlugFolders: string[] = [];
  let localeCount = 0;

  for (const [slug, localeMap] of bySlug) {
    localeCount += localeMap.size;
    const entryDir = path.join(typeDir, slug);
    const folderExists = fs.existsSync(entryDir) && fs.statSync(entryDir).isDirectory();
    if (folderExists) existingSlugFolders.push(slug);

    // _common.yml + one file per locale
    const plannedFiles = ["_common.yml", ...Array.from(localeMap.keys()).map((l) => `${l}.yml`)];
    for (const file of plannedFiles) {
      const full = path.join(entryDir, file);
      if (fs.existsSync(full)) filesToOverwrite += 1;
      else filesToWrite += 1;
    }
  }

  if (dryRun) {
    return {
      dry_run: true,
      content_type: contentType,
      directory,
      database_slug: dbName,
      entry_count: bySlug.size,
      locale_count: localeCount,
      files_to_write: filesToWrite,
      files_to_overwrite: filesToOverwrite,
      existing_slug_folders: existingSlugFolders,
      templates_to_delete: templateFiles.map((f) => path.relative(contentRoot, f)),
      skipped,
      message:
        `Will convert ${bySlug.size} slug(s) / ${localeCount} locale file(s) from database "${dbName}" ` +
        `into ${directory}/, unlink the database, set single_template: true, preserve _common.single.yml, ` +
        `and delete ${templateFiles.length} single.*.yml template file(s). ` +
        `Existing per-entry overlay patches will be merged into full static YAML and overwritten.`,
    };
  }

  const written: string[] = [];
  const overwritten: string[] = [];
  const createdDirs: string[] = [];

  try {
    for (const [slug, localeMap] of bySlug) {
      const localePages = new Map<string, Record<string, unknown>>();

      for (const [locale, item] of localeMap) {
        const content = await resolveItemContent(item);
        const singleItem = { ...item, content };
        const identity = identityFieldsFromItem(singleItem, fieldMapping);

        const merged = mergeSingleTemplate(contentType, locale, slug, undefined, contentRoot);
        if (!merged) {
          skipped.push({
            reason: "missing_template",
            detail: `single.${locale}.yml for ${contentType}`,
          });
          continue;
        }

        const baked = stripRuntimeKeys(resolveSingleVars(merged, singleItem)) as Record<string, unknown>;
        // Attach identity / index fields used by url_pattern and listings
        const page: Record<string, unknown> = {
          ...identity,
          ...baked,
          slug: typeof baked.slug === "string" && baked.slug ? baked.slug : slug,
        };
        if (typeof page.title !== "string" || !page.title) {
          page.title = typeof singleItem.title === "string" ? singleItem.title : slug;
        }
        localePages.set(locale, page);
      }

      if (localePages.size === 0) continue;

      const { common, locales } = splitCommonAndLocales(localePages);
      const entryDir = path.join(typeDir, slug);
      const existedBefore = fs.existsSync(entryDir) && fs.statSync(entryDir).isDirectory();
      if (!existedBefore) {
        fs.mkdirSync(entryDir, { recursive: true });
        createdDirs.push(entryDir);
      }

      // Remove leftover patch / locale files that are not part of this conversion
      // (e.g. old overlay-only files) — only after we have baked content for all locales.
      const keepFiles = new Set([
        "_common.yml",
        ...Array.from(locales.keys()).map((l) => `${l}.yml`),
      ]);
      if (existedBefore) {
        for (const file of fs.readdirSync(entryDir)) {
          if (!file.endsWith(".yml") && !file.endsWith(".yaml")) continue;
          if (keepFiles.has(file)) continue;
          // Keep versioning.yml and other non-locale control files
          if (file === "versioning.yml" || file.startsWith("_") && file !== "_common.yml") continue;
          // Old locale-only patch files for locales not in DB: leave them (safer). Only overwrite what we bake.
        }
      }

      const commonPath = path.join(entryDir, "_common.yml");
      const commonRel = `${rootName}/${directory}/${slug}/_common.yml`;
      const commonExisted = fs.existsSync(commonPath);
      fs.writeFileSync(commonPath, safeYamlDump(common), "utf-8");
      markFileAsModified(commonRel, author, undefined, contentRoot);
      (commonExisted ? overwritten : written).push(commonRel);

      for (const [locale, localeObj] of locales) {
        const localePath = path.join(entryDir, `${locale}.yml`);
        const localeRel = `${rootName}/${directory}/${slug}/${locale}.yml`;
        const localeExisted = fs.existsSync(localePath);
        fs.writeFileSync(localePath, safeYamlDump(localeObj), "utf-8");
        markFileAsModified(localeRel, author, undefined, contentRoot);
        (localeExisted ? overwritten : written).push(localeRel);
      }

      refreshSitemapEntriesForContentKey(contentType, slug, Array.from(locales.keys()));
    }

    // Unlink database, enable single-template inheritance, rewrite field_mapping to identity keys
    const newMapping = buildIdentityFieldMapping(config.field_mapping);
    updateContentTypeConfig(
      contentType,
      {
        database: null,
        field_mapping: newMapping,
        single_template: true,
      },
      contentRoot,
    );

    const deletedTemplates: string[] = [];
    for (const full of templateFiles) {
      if (!fs.existsSync(full)) continue;
      const rel = `${rootName}/${path.relative(contentRoot, full)}`;
      fs.unlinkSync(full);
      markFileAsModified(rel, author, undefined, contentRoot);
      deletedTemplates.push(rel);
    }

    if (opts.refreshIndex) {
      opts.refreshIndex();
    } else {
      contentIndex.refresh();
    }
    clearSitemapCache();
    if (opts.invalidateCommonFields) {
      opts.invalidateCommonFields(contentType);
    } else {
      contentIndex.invalidateCommonFields(contentType);
    }

    log.info(
      `[ConvertToStatic] Converted "${contentType}" from db "${dbName}": ` +
        `${written.length} new, ${overwritten.length} overwritten, ${deletedTemplates.length} templates deleted`,
    );

    return {
      dry_run: false,
      success: true,
      content_type: contentType,
      directory,
      unlinked_database: dbName,
      written,
      overwritten,
      deleted_templates: deletedTemplates,
      skipped,
      entry_count: bySlug.size,
      locale_count: localeCount,
    };
  } catch (err) {
    // Roll back newly created slug directories only (do not unlink database if we failed before that)
    for (const dir of createdDirs) {
      try {
        if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
    throw err;
  }
}
