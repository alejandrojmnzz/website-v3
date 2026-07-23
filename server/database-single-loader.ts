import * as fs from "fs";
import { getDefaultContentRoot } from "./site-config";
import * as path from "path";
import { contentIndex } from "./content-index";
import { deepMerge } from "./utils/deepMerge";
import { databaseManager, type DatabaseManager } from "./database";
import {
  getDatabaseName,
  getFolder,
  getLookupKey,
  getFieldMapping,
  getLocaleKey,
  getLocaleSource,
  hasDatabaseSingle,
  getContentTypeConfig,
} from "./content-types";
import { resolveFieldValue, applyTransformIfNeeded } from "./transform";
import { fetchMarkdownContent } from "./markdown";
import { applyComponentSectionDefaults, applyComponentImageSizes } from "./component-registry";
import { readSectionAnchors, writeSectionAnchors } from "./utils/sectionAnchors";
import { canonicalSectionId, sectionIdCandidates } from "./utils/sectionIdentity";
import { applyPerEntryLayer, type PerEntryAccum } from "./section-merge";
import { applySectionLayoutDefaults } from "./section-layout-defaults";
import type { TemplatePage } from "@shared/schema";
import { child } from "./logger";
const log = child({ module: "database-single-loader" });

export type { PerEntryAccum } from "./section-merge";

export const TEMPLATE_EXPR_RE = /\{\{[\s\S]*?\}\}/;

export function extractVariableFields(
  obj: unknown,
  prefix = "",
): Record<string, string> {
  const result: Record<string, string> = {};
  if (typeof obj !== "object" || obj === null) return result;
  const entries: Array<[string, unknown]> = Array.isArray(obj)
    ? obj.map((v, i) => [String(i), v] as [string, unknown])
    : Object.entries(obj as Record<string, unknown>).filter(([k]) => !k.startsWith("_"));
  for (const [key, value] of entries) {
    const dotPath = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string" && TEMPLATE_EXPR_RE.test(value)) {
      result[dotPath] = value.trim();
    } else if (typeof value === "object" && value !== null) {
      Object.assign(result, extractVariableFields(value, dotPath));
    }
  }
  return result;
}

export function mergeSingleTemplate(
  contentType: string,
  locale: string,
  slug?: string,
  accum?: PerEntryAccum,
  contentRoot?: string,
  variantSlug?: string,
): Record<string, unknown> | null {
  const resolvedRoot = contentRoot ?? getDefaultContentRoot();
  const folder = getFolder(contentType, resolvedRoot);
  const templateDir = path.join(resolvedRoot, folder);
  const singleCommonPath = path.join(templateDir, "_common.single.yml");
  const commonPath = path.join(templateDir, "_common.yml");

  let localePath: string;
  if (variantSlug) {
    // Use the variant template (single-{variantSlug}.{locale}.yml)
    const variantPath = path.join(templateDir, `single-${variantSlug}.${locale}.yml`);
    if (fs.existsSync(variantPath)) {
      localePath = variantPath;
    } else {
      // Fallback: try base locale then en
      localePath = path.join(templateDir, `single.${locale}.yml`);
      if (!fs.existsSync(localePath)) {
        localePath = path.join(templateDir, "single.en.yml");
      }
    }
  } else {
    localePath = path.join(templateDir, `single.${locale}.yml`);
    if (!fs.existsSync(localePath)) {
      localePath = path.join(templateDir, "single.en.yml");
    }
  }
  if (!fs.existsSync(localePath)) return null;

  let baseData: Record<string, unknown> = {};
  if (fs.existsSync(singleCommonPath)) {
    const parsed = contentIndex.safeYamlLoad(fs.readFileSync(singleCommonPath, "utf-8"));
    if (parsed) {
      // Shared-layout: _common.single.yml is layout defaults only — never carry sections
      const { sections: _ignoredSections, ...rest } = parsed;
      if (_ignoredSections !== undefined) {
        log.warn(
          `[mergeSingleTemplate] Ignoring sections in _common.single.yml for ${contentType} (structure lives in single.{locale}.yml)`,
        );
      }
      baseData = rest;
    }
  }
  if (fs.existsSync(commonPath)) {
    const parsed = contentIndex.safeYamlLoad(fs.readFileSync(commonPath, "utf-8"));
    if (parsed) {
      const { sections: _ignoredSections, ...rest } = parsed;
      if (_ignoredSections !== undefined) {
        log.warn(
          `[mergeSingleTemplate] Ignoring sections in type _common.yml for ${contentType}`,
        );
      }
      baseData = Object.keys(baseData).length > 0 ? deepMerge(baseData, rest) : rest;
    }
  }
  const localeData = contentIndex.safeYamlLoad(fs.readFileSync(localePath, "utf-8"));
  if (!localeData) return null;
  let merged: Record<string, unknown> = Object.keys(baseData).length > 0
    ? deepMerge(baseData, localeData)
    : { ...localeData };

  // Capture stable base-template section-id → index map BEFORE any per-entry layers
  // so that originalIndex values in accum.removedSections are always relative to the
  // immutable shared template, regardless of how many per-entry layers fire.
  if (slug && accum) {
    const baseSectionsSnapshot = Array.isArray(merged.sections)
      ? (merged.sections as Record<string, unknown>[])
      : [];
    const baseIndexById = new Map<string, number>();
    baseSectionsSnapshot.forEach((s, idx) => {
      const id = canonicalSectionId(s);
      if (id) baseIndexById.set(id, idx);
    });
    accum.baseIndexById = baseIndexById;
  }

  // Layer 4 & 5: per-entry YML overrides (only when slug is provided).
  // Each layer is applied sequentially so section directives from layer 4
  // (_common.yml) are not lost when layer 5 ({locale}.yml) also has sections.
  if (slug) {
    // Load alias map once (silently skipped if file doesn't exist)
    let aliases: Record<string, string | null> | undefined;
    try {
      const anchors = readSectionAnchors(contentType);
      if (Object.keys(anchors.aliases).length > 0) {
        // Step 5: clear stale aliases whose original section ID is now back in the template.
        // This handles the case where a section was deleted and then re-created with the same ID.
        const baseSectionIds = new Set<string>(
          Array.isArray(merged.sections)
            ? (merged.sections as Record<string, unknown>[]).flatMap((s) =>
                sectionIdCandidates(s),
              )
            : [],
        );
        const staleKeys = Object.keys(anchors.aliases).filter((k) => baseSectionIds.has(k));
        if (staleKeys.length > 0) {
          for (const k of staleKeys) delete anchors.aliases[k];
          try {
            writeSectionAnchors(contentType, anchors);
          } catch { /* non-fatal */ }
        }
        if (Object.keys(anchors.aliases).length > 0) {
          aliases = anchors.aliases;
        }
      }
    } catch { /* non-fatal — alias resolution is best-effort */ }

    const entryDir = path.join(templateDir, slug);
    if (fs.existsSync(entryDir) && fs.statSync(entryDir).isDirectory()) {
      const entryCommonPath = path.join(entryDir, "_common.yml");
      if (fs.existsSync(entryCommonPath)) {
        const parsed = contentIndex.safeYamlLoad(fs.readFileSync(entryCommonPath, "utf-8"));
        if (parsed) merged = applyPerEntryLayer(merged, parsed, accum, aliases);
      }
      const entryLocalePath = path.join(entryDir, `${locale}.yml`);
      if (fs.existsSync(entryLocalePath)) {
        const parsed = contentIndex.safeYamlLoad(fs.readFileSync(entryLocalePath, "utf-8"));
        if (parsed) merged = applyPerEntryLayer(merged, parsed, accum, aliases);
      }
    }
  }

  return applySectionLayoutDefaults(merged);
}

/**
 * Load a merged single-entry page for per-entry section ops.
 * Works for both DB-backed types and static types with `single_template: true`
 * (e.g. blog after convert-to-static). Prefer this over `loadDatabaseSinglePage`
 * in edit/delete routes that must support both.
 */
export async function loadMergedSinglePage(
  contentType: string,
  slug: string,
  locale: string,
  contentRoot?: string,
  db: DatabaseManager = databaseManager,
): Promise<TemplatePage | null> {
  const resolvedRoot = contentRoot ?? getDefaultContentRoot();

  if (hasDatabaseSingle(contentType, resolvedRoot)) {
    return loadDatabaseSinglePage(contentType, slug, locale, resolvedRoot, db);
  }

  const config = getContentTypeConfig(contentType, resolvedRoot);
  if (!config?.single_template) return null;

  const folder = getFolder(contentType, resolvedRoot);
  const entryLocalePath = path.join(resolvedRoot, folder, slug, `${locale}.yml`);
  if (!fs.existsSync(entryLocalePath)) {
    log.info(
      `[MergedSingle] Static entry not found: ${contentType}/${slug}/${locale}.yml`,
    );
    return null;
  }

  const accum: PerEntryAccum = { removedSections: [] };
  const merged = mergeSingleTemplate(contentType, locale, slug, accum, resolvedRoot);
  if (!merged) {
    log.error(
      `[MergedSingle] Template not found for static single_template type: ${contentType}`,
    );
    return null;
  }

  const sections = (merged.sections as TemplatePage["sections"]) || [];
  applyComponentSectionDefaults(sections as unknown[]);
  applyComponentImageSizes(sections as unknown[]);

  return {
    slug: (merged.slug as string) || slug,
    title: (merged.title as string) || slug,
    meta: (merged.meta as TemplatePage["meta"]) || {},
    sections,
    settings: (merged.settings as TemplatePage["settings"]) || undefined,
    schema: (merged.schema as TemplatePage["schema"]) || undefined,
    perEntryRemovedSections:
      accum.removedSections.length > 0 ? accum.removedSections : undefined,
  };
}

export async function loadDatabaseSinglePage(
  contentType: string,
  slug: string,
  locale: string,
  contentRoot?: string,
  db: DatabaseManager = databaseManager,
  variantSlug?: string,
): Promise<TemplatePage | null> {
  const resolvedRoot = contentRoot ?? getDefaultContentRoot();
  const dbName = getDatabaseName(contentType, resolvedRoot);
  if (!dbName) return null;

  // Collect per-entry metadata (removed sections, per-entry additions)
  const accum: PerEntryAccum = { removedSections: [] };
  const merged = mergeSingleTemplate(contentType, locale, slug, accum, resolvedRoot, variantSlug);

  if (!merged) {
    log.error(
      `[DatabaseSingle] Template not found: single.${locale}.yml for ${contentType}`,
    );
    return null;
  }

  // Compute per-entry removed sections.
  // Compare base template (no slug) with merged (with slug) to find removed sections.
  let perEntryRemovedSections: Array<{ section: Record<string, unknown>; originalIndex: number }> = [];

  // Only compute if we have per-entry overrides (accum tracks what was removed)
  if (accum.removedSections.length > 0) {
    perEntryRemovedSections = accum.removedSections;
  }

  if (!db.exists(dbName)) {
    log.error(`[DatabaseSingle] Database "${dbName}" not found`);
    return null;
  }

  try {
    const result = await db.fetchItems(dbName);
    const lookupKey = getLookupKey(contentType, resolvedRoot) || "slug";
    const fieldMapping = getFieldMapping(contentType, resolvedRoot);

    let items = result.items as Record<string, unknown>[];

    if (fieldMapping) {
      items = items.map((item) => {
        const mapped: Record<string, unknown> = { ...item };
        const itemSlug = String(item[lookupKey] ?? item.slug ?? "unknown");
        for (const [targetField, sourcePath] of Object.entries(fieldMapping)) {
          const value = resolveFieldValue(sourcePath, item, targetField, {
            contentType,
            slug: itemSlug,
            fieldPath: targetField,
          });
          if (value !== undefined) mapped[targetField] = value;
        }
        return mapped;
      });
    }

    const localeKey = getLocaleKey(contentType, resolvedRoot);
    const localeSource = getLocaleSource(contentType, resolvedRoot);
    let matchItem: Record<string, unknown> | undefined;

    if (localeKey) {
      const normalizedLocale = localeSource
        ? applyTransformIfNeeded(localeSource, locale)
        : locale;
      matchItem = items.find((item) => {
        const itemLocale = String(item[localeKey] || "");
        const normalizedItemLocale = localeSource
          ? applyTransformIfNeeded(localeSource, itemLocale)
          : itemLocale;
        return (
          item[lookupKey] === slug && normalizedItemLocale === normalizedLocale
        );
      });
      if (!matchItem) {
        matchItem = items.find((item) => item[lookupKey] === slug);
      }
    } else {
      matchItem = items.find((item) => item[lookupKey] === slug);
    }

    if (!matchItem) {
      log.info(
        `[DatabaseSingle] Item not found: ${lookupKey}=${slug} in ${dbName}`,
      );
      return null;
    }

    let content = (matchItem as any).content || "";
    if (!content && (matchItem as any).content_url) {
      content = await fetchMarkdownContent(
        (matchItem as any).content_url as string,
      );
    }
    if (!content && (matchItem as any).readme_url) {
      content = await fetchMarkdownContent(
        (matchItem as any).readme_url as string,
      );
    }
    const singleItem = { ...matchItem, content };

    const sections = (merged.sections as TemplatePage["sections"]) || [];

    for (const section of sections as unknown[]) {
      const variableFields = extractVariableFields(section);
      if (Object.keys(variableFields).length > 0) {
        (section as Record<string, unknown>)._variableFields = variableFields;
        // Build a dotPath→templateKey map (e.g. "image.src" → "image") for client badge logic.
        // Values are plain strings so resolveSingleVars won't alter them.
        const variableKeys: Record<string, string> = {};
        const keyRe = /\{\{\s*single\.([^|}\s]+)/;
        for (const [dotPath, expr] of Object.entries(variableFields)) {
          const m = keyRe.exec(expr);
          if (m) variableKeys[dotPath] = m[1].trim();
        }
        if (Object.keys(variableKeys).length > 0) {
          (section as Record<string, unknown>)._variableKeys = variableKeys;
        }
      }
    }

    applyComponentSectionDefaults(sections as unknown[]);
    applyComponentImageSizes(sections as unknown[]);

    const page: TemplatePage = {
      slug: (merged.slug as string) || slug,
      title: (merged.title as string) || (singleItem.title as string) || slug,
      meta: (merged.meta as TemplatePage["meta"]) || {},
      sections,
      settings: (merged.settings as TemplatePage["settings"]) || undefined,
      schema: (merged.schema as TemplatePage["schema"]) || undefined,
      singleEntry: singleItem as Record<string, unknown>,
      perEntryRemovedSections: perEntryRemovedSections.length > 0 ? perEntryRemovedSections : undefined,
    };

    return page;
  } catch (err) {
    log.error(
      `[DatabaseSingle] Error loading ${contentType}/${slug}:`,
      err,
    );
    return null;
  }
}
