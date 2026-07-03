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
} from "./content-types";
import { resolveFieldValue, applyTransformIfNeeded } from "./transform";
import { fetchMarkdownContent } from "./markdown";
import { applyComponentSectionDefaults, applyComponentImageSizes } from "./component-registry";
import { readSectionAnchors, resolveAnchorAlias, writeSectionAnchors } from "./utils/sectionAnchors";
import type { TemplatePage } from "@shared/schema";
import { child } from "./logger";
const log = child({ module: "database-single-loader" });



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

/**
 * Accumulator for per-entry layer metadata collected during merge.
 */
export interface PerEntryAccum {
  /** Sections removed via `_remove: true` with their original index in the base. */
  removedSections: Array<{ section: Record<string, unknown>; originalIndex: number }>;
  /**
   * Stable reference map from section id → base template index, built ONCE before
   * any per-entry layers are applied. Ensures `originalIndex` is always relative to
   * the immutable shared template even when both _common.yml and {locale}.yml remove
   * sections (which would otherwise shift the idx counter in subsequent calls).
   */
  baseIndexById?: Map<string, number>;
}

/**
 * Applies a single per-entry layer (either _common.yml or {locale}.yml) on top
 * of the accumulated merged template. Non-sections fields are deep-merged normally.
 * If the layer declares a `sections` array, it is applied as an id-based patch:
 *   - Entries with `_remove: true` remove the matching base section by id.
 *   - Other entries deep-merge their properties into the matching base section by id.
 *   - Entries whose id does not match any base section are treated as new per-entry
 *     sections and appended to the result with `_perEntrySource: true`.
 * Sections without an id in either layer or base are left unchanged.
 */
function applyPerEntryLayer(
  base: Record<string, unknown>,
  layer: Record<string, unknown>,
  accum?: PerEntryAccum,
  aliases?: Record<string, string | null>,
): Record<string, unknown> {
  const layerSections = Array.isArray(layer.sections)
    ? (layer.sections as Record<string, unknown>[])
    : null;

  if (layerSections === null) {
    // No sections in this layer — plain deep merge
    return deepMerge(base, layer);
  }

  // Merge all non-sections fields normally
  const { sections: _ignored, ...layerRest } = layer;
  let result = Object.keys(layerRest).length > 0 ? deepMerge(base, layerRest) : { ...base };

  // Apply id-based section patches
  const baseSections = Array.isArray(result.sections)
    ? (result.sections as unknown[]).filter((s): s is Record<string, unknown> => s != null && typeof s === "object")
    : [];

  // Build set of base section IDs for fast lookup
  const baseSectionIds = new Set<string>(
    baseSections
      .map((s) => (typeof s.id === "string" ? s.id : null))
      .filter(Boolean) as string[],
  );

  const removeIds = new Set<string>();
  const patchById = new Map<string, Record<string, unknown>>();
  const perEntryNewSections: Record<string, unknown>[] = [];

  for (const s of layerSections) {
    if (!s || typeof s !== "object") continue;
    const id = typeof s.id === "string" ? s.id : undefined;
    if (!id) continue;
    if (s._remove) {
      removeIds.add(id);
    } else if (baseSectionIds.has(id)) {
      patchById.set(id, s);
    } else {
      // Section exists in per-entry layer only — it's a new per-entry addition
      perEntryNewSections.push(s);
    }
  }

  // Collect removed sections with stable original indices.
  // Use baseIndexById (computed before any per-entry layers) when available so that
  // `originalIndex` is always relative to the immutable shared template, not the
  // partially-filtered base of a subsequent layer call.
  if (accum) {
    baseSections.forEach((s, idx) => {
      const id = typeof s.id === "string" ? s.id : undefined;
      if (id && removeIds.has(id)) {
        // Avoid duplicates when both _common.yml and {locale}.yml mark the same section removed
        const alreadyRecorded = accum.removedSections.some(
          (r) => typeof r.section.id === "string" && r.section.id === id,
        );
        if (!alreadyRecorded) {
          const originalIndex = accum.baseIndexById?.get(id) ?? idx;
          accum.removedSections.push({ section: s, originalIndex });
        }
      }
    });
  }

  const filteredAndPatched = baseSections
    .filter((s) => {
      const id = typeof s.id === "string" ? s.id : undefined;
      return !id || !removeIds.has(id);
    })
    .map((s) => {
      const id = typeof s.id === "string" ? s.id : undefined;
      if (!id) return s;
      const patch = patchById.get(id);
      if (!patch) return s;
      return { ...deepMerge(s, patch), _perEntryPatched: true };
    });

  // Tag per-entry-only sections; strip _insertAfterSectionId from final output (positioning hint only)
  const taggedNew = perEntryNewSections.map((s) => {
    const { _insertAfterSectionId: _pos, ...rest } = s as Record<string, unknown>;
    return { ...rest, _perEntrySource: true, _insertAfterSectionId: _pos };
  });

  // Resolve dangling _insertAfterSectionId values via the alias map.
  // Build a set of current base section IDs for fast lookup.
  if (aliases && Object.keys(aliases).length > 0) {
    const baseSectionIds = new Set<string>(
      filteredAndPatched
        .map((s) => (typeof s.id === "string" ? s.id : null))
        .filter(Boolean) as string[],
    );
    for (const s of taggedNew) {
      const anchorId = s._insertAfterSectionId;
      if (typeof anchorId === "string") {
        const resolved = resolveAnchorAlias(anchorId, baseSectionIds, aliases);
        if (resolved !== undefined) {
          // resolved is string | null — update the positioning hint
          s._insertAfterSectionId = resolved;
        }
      }
    }
  }

  // Place per-entry sections at their intended position using _insertAfterSectionId.
  // - _insertAfterSectionId === undefined  → no metadata (legacy/compat): append at end
  // - _insertAfterSectionId === null       → insert before all base sections
  // - _insertAfterSectionId === <id>       → insert immediately after the base section with that id
  const appendNew: typeof taggedNew = [];
  const insertBeforeAll: typeof taggedNew = [];
  const insertAfterMap = new Map<string, typeof taggedNew>();

  for (const s of taggedNew) {
    const anchorKey = s._insertAfterSectionId;
    if (anchorKey === undefined) {
      appendNew.push(s);
    } else if (anchorKey === null) {
      insertBeforeAll.push(s);
    } else {
      const key = anchorKey as string;
      if (!insertAfterMap.has(key)) insertAfterMap.set(key, []);
      insertAfterMap.get(key)!.push(s);
    }
  }

  // Strip the positioning hint from the final output — it's only needed at load time
  const stripHint = (s: Record<string, unknown>) => {
    const { _insertAfterSectionId: _discarded, ...rest } = s;
    return rest;
  };

  // Helper: resolve a section's lookup key — prefer `id`, fall back to `section_id`.
  // Template sections created before the `id` field was introduced only have `section_id`.
  const sectionKey = (s: Record<string, unknown>): string | undefined => {
    if (typeof s.id === "string" && s.id) return s.id;
    if (typeof s.section_id === "string" && s.section_id) return s.section_id;
    return undefined;
  };

  // Phase 1: Build finalSections using base section anchors
  const finalSections: Record<string, unknown>[] = [
    ...insertBeforeAll.map(stripHint),
  ];
  for (const s of filteredAndPatched) {
    finalSections.push(s);
    const id = sectionKey(s);
    if (id && insertAfterMap.has(id)) {
      for (const newS of insertAfterMap.get(id)!) {
        finalSections.push(stripHint(newS));
      }
      insertAfterMap.delete(id);
    }
  }

  // Phase 2: Handle anchors pointing to per-entry sections (those inserted in phase 1).
  // Iterate until stable — handles chained per-entry-after-per-entry insertions.
  let madeProgress = true;
  while (madeProgress && insertAfterMap.size > 0) {
    madeProgress = false;
    for (const [anchorId, sections] of [...insertAfterMap.entries()]) {
      const anchorIdx = finalSections.findIndex(
        (s) => sectionKey(s) === anchorId,
      );
      if (anchorIdx !== -1) {
        // Insert immediately after the anchor (in reverse to preserve order when splicing)
        for (let i = sections.length - 1; i >= 0; i--) {
          finalSections.splice(anchorIdx + 1, 0, stripHint(sections[i]));
        }
        insertAfterMap.delete(anchorId);
        madeProgress = true;
      }
    }
  }

  // Remaining unresolved anchors (anchor id never found) fall back to append-at-end
  for (const [, sections] of insertAfterMap) {
    for (const s of sections) appendNew.push(s);
  }
  for (const s of appendNew) {
    finalSections.push(stripHint(s));
  }

  result.sections = finalSections;

  return result;
}

export function mergeSingleTemplate(
  contentType: string,
  locale: string,
  slug?: string,
  accum?: PerEntryAccum,
  contentRoot?: string,
): Record<string, unknown> | null {
  const resolvedRoot = contentRoot ?? getDefaultContentRoot();
  const folder = getFolder(contentType, resolvedRoot);
  const templateDir = path.join(resolvedRoot, folder);
  const singleCommonPath = path.join(templateDir, "_common.single.yml");
  const commonPath = path.join(templateDir, "_common.yml");
  let localePath = path.join(templateDir, `single.${locale}.yml`);
  if (!fs.existsSync(localePath)) {
    localePath = path.join(templateDir, "single.en.yml");
  }
  if (!fs.existsSync(localePath)) return null;

  let baseData: Record<string, unknown> = {};
  if (fs.existsSync(singleCommonPath)) {
    const parsed = contentIndex.safeYamlLoad(fs.readFileSync(singleCommonPath, "utf-8"));
    if (parsed) baseData = parsed;
  }
  if (fs.existsSync(commonPath)) {
    const parsed = contentIndex.safeYamlLoad(fs.readFileSync(commonPath, "utf-8"));
    if (parsed) baseData = Object.keys(baseData).length > 0 ? deepMerge(baseData, parsed) : parsed;
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
      const id = typeof s.id === "string" ? s.id : undefined;
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
            ? (merged.sections as Record<string, unknown>[])
                .map((s) => (typeof s.id === "string" ? s.id : null))
                .filter(Boolean) as string[]
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

  return merged;
}

export async function loadDatabaseSinglePage(
  contentType: string,
  slug: string,
  locale: string,
  contentRoot?: string,
  db: DatabaseManager = databaseManager,
): Promise<TemplatePage | null> {
  const resolvedRoot = contentRoot ?? getDefaultContentRoot();
  const dbName = getDatabaseName(contentType, resolvedRoot);
  if (!dbName) return null;

  // Collect per-entry metadata (removed sections, per-entry additions)
  const accum: PerEntryAccum = { removedSections: [] };
  const merged = mergeSingleTemplate(contentType, locale, slug, accum, resolvedRoot);

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
