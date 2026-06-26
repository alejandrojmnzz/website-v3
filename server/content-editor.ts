import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import { escapeObjectVars, unescapeYamlDump } from "@shared/templateVars";
import { validateFormSection } from "@shared/validateFormSection";
import { getConsentKeyError } from "@shared/consentLegacyKeys";
import { getTrackingSettings } from "./settings";
import { generateSectionId } from "./utils/generateSectionId";

function getDefaultContentRootName(): string {
  try {
    const { getDefaultSite } = require("./site-manager") as typeof import("./site-manager");
    return getDefaultSite().contentRootName;
  } catch {
    return process.env.CONTENT_FOLDER || "default-site-content";
  }
}

function safeYamlDump(obj: unknown, opts?: yaml.DumpOptions): string {
  const { escaped, map } = escapeObjectVars(obj);
  const dumped = yaml.dump(escaped, opts);
  return unescapeYamlDump(dumped, map);
}
import type { EditOperation } from "@shared/schema";
import { normalizeLocale, getSupportedLocales, getDefaultLocale } from "./settings";
import { markFileAsModified } from "./sync-state";
import { contentIndex, ContentIndex } from "./content-index";
import { deepMerge } from "./utils/deepMerge";
import { mergeSingleTemplate, extractVariableFields, TEMPLATE_EXPR_RE } from "./database-single-loader";
import { getDatabaseName, getLookupKey, getFieldMapping, isValidType, getAllTypes, getFolder, getContentTypeConfig } from "./content-types";
import { databaseManager, DatabaseManager } from "./database";
import { regenerateSectionIds } from "./utils/regenerateSectionIds";
import {
  refreshSitemapEntry,
  refreshSitemapEntriesForContentKey,
  invalidateSitemapEntry,
  invalidateSitemapEntriesByContentKey,
} from "./sitemap";
import { clearRedirectCache } from "./redirects";
import { clearSsrSchemaCache } from "./ssr-schema";
import { child } from "./logger";
const log = child({ module: "content-editor" });



interface ContentEditRequest {
  contentType: string;
  slug: string;
  locale: string;
  operations: EditOperation[];
  variant?: string;
  version?: number;
  author?: string;
  contentRoot?: string;
  database?: DatabaseManager;
  ci?: ContentIndex;
}

function getValueAtPath(obj: Record<string, unknown>, pathStr: string): unknown {
  const parts = pathStr.replace(/\[(\d+)\]/g, ".$1").split(".");
  let current: unknown = obj;
  
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  
  return current;
}

function setValueAtPath(obj: Record<string, unknown>, pathStr: string, value: unknown): void {
  const parts = pathStr.replace(/\[(\d+)\]/g, ".$1").split(".");
  let current: Record<string, unknown> = obj;
  
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (current[part] === undefined) {
      // Create intermediate object or array
      const nextPart = parts[i + 1];
      current[part] = /^\d+$/.test(nextPart) ? [] : {};
    }
    current = current[part] as Record<string, unknown>;
  }
  
  const lastPart = parts[parts.length - 1];
  current[lastPart] = value;
}

function applyOperation(content: Record<string, unknown>, operation: EditOperation): void {
  switch (operation.action) {
    case "update_field": {
      setValueAtPath(content, operation.path, operation.value);
      break;
    }
    
    case "reorder_sections": {
      const sections = content.sections as unknown[];
      if (!Array.isArray(sections)) throw new Error("sections is not an array");
      if (operation.from < 0 || operation.from >= sections.length) throw new Error("Invalid from index");
      if (operation.to < 0 || operation.to >= sections.length) throw new Error("Invalid to index");
      
      const [moved] = sections.splice(operation.from, 1);
      sections.splice(operation.to, 0, moved);
      break;
    }
    
    case "add_item": {
      let arr = getValueAtPath(content, operation.path) as unknown[];
      if (!Array.isArray(arr)) {
        if (operation.path === "sections") {
          (content as Record<string, unknown>).sections = [];
          arr = (content as Record<string, unknown>).sections as unknown[];
        } else {
          throw new Error(`Path ${operation.path} is not an array`);
        }
      }
      
      let insertedIndex: number;
      if (operation.index !== undefined && operation.index >= 0 && operation.index <= arr.length) {
        arr.splice(operation.index, 0, operation.item);
        insertedIndex = operation.index;
      } else {
        arr.push(operation.item);
        insertedIndex = arr.length - 1;
      }
      if (operation.path === "sections") {
        const inserted = arr[insertedIndex] as Record<string, unknown>;
        if (inserted && typeof inserted === "object") {
          if (!inserted.section_id) {
            inserted.section_id = generateSectionId((inserted.type as string) || "section");
          }
          if (!inserted.paddingY) {
            inserted.paddingY = { desktop: "sm" };
          }
        }
      }
      break;
    }
    
    case "remove_item": {
      const arr = getValueAtPath(content, operation.path) as unknown[];
      if (!Array.isArray(arr)) throw new Error(`Path ${operation.path} is not an array`);
      if (operation.index < 0 || operation.index >= arr.length) throw new Error("Invalid index");
      
      arr.splice(operation.index, 1);
      break;
    }
    
    case "update_section": {
      const sections = content.sections as unknown[];
      if (!Array.isArray(sections)) throw new Error("sections is not an array");
      if (operation.index < 0 || operation.index >= sections.length) throw new Error("Invalid section index");
      
      const sectionToSave = operation.section as Record<string, unknown>;
      if (sectionToSave && typeof sectionToSave === "object" && sectionToSave.dynamic_entries) {
        delete sectionToSave.items;
        delete sectionToSave._dynamic_meta;
      }
      if (sectionToSave && typeof sectionToSave === "object") {
        delete sectionToSave._imageSizes;
      }
      const existingSection = sections[operation.index] as Record<string, unknown>;
      const existingId = existingSection?.section_id;
      // Preserve _insertAfterSectionId: this controls where per-entry sections appear
      // in the merged view. If the client doesn't echo it back, losing it causes the
      // section to fall to the end of the page on the next load.
      const existingInsertAfter = existingSection?._insertAfterSectionId;
      sections[operation.index] = sectionToSave;
      if (existingId && !sectionToSave.section_id) {
        (sections[operation.index] as Record<string, unknown>).section_id = existingId;
      }
      if (existingInsertAfter !== undefined && sectionToSave._insertAfterSectionId === undefined) {
        (sections[operation.index] as Record<string, unknown>)._insertAfterSectionId = existingInsertAfter;
      }
      break;
    }
    
    case "replace_all_sections": {
      if (!Array.isArray(operation.sections)) throw new Error("sections must be an array");
      content.sections = (operation.sections as Record<string, unknown>[]).map((sec) => {
        if (sec && typeof sec === "object" && sec.dynamic_entries) {
          const { items: _items, _dynamic_meta: _meta, ...authored } = sec;
          delete (authored as Record<string, unknown>)._imageSizes;
          if (!authored.section_id) authored.section_id = generateSectionId((authored.type as string) || "section");
          return authored;
        }
        if (sec && typeof sec === "object") delete sec._imageSizes;
        if (!sec.section_id) sec.section_id = generateSectionId((sec.type as string) || "section");
        return sec;
      });
      break;
    }
  }
}

export async function editContent(request: ContentEditRequest): Promise<{ success: boolean; error?: string; warning?: string; updatedSections?: unknown[] }> {
  const { contentType, slug, locale: rawLocale, operations, variant, version, contentRoot } = request;
  // Use per-site ContentIndex when provided (avoids resolving files against default site)
  const ci = request.ci ?? contentIndex;
  
  // Normalize locale to prevent es-ES, en-US etc from causing file lookup failures
  const locale = normalizeLocale(rawLocale);
  
  // Validate that version is not provided without a variant
  const hasVariant = variant !== undefined && variant !== null && variant !== "";
  const hasValidVersion = version !== undefined && version !== null && Number.isFinite(version);
  if (hasValidVersion && !hasVariant) {
    return { success: false, error: "version cannot be provided without variant" };
  }
  
  try {
    const { data: localeData, filePath, error: loadError, isSharedTemplate } = ci.loadLocaleData(contentType, slug, locale, variant, version);
    if (!localeData || loadError) {
      return { success: false, error: loadError || `Content file not found` };
    }

    // For DB-backed single pages the localeData points at the shared template.
    // We must NOT write variable-field changes back to that shared file — instead
    // we patch only the specific entry in the database file cache.
    if (isSharedTemplate) {
      // Top-level field ops (e.g. "meta", "schema") must NEVER touch the shared
      // template — they belong in the per-entry locale file for this slug.
      // Create it if it doesn't exist yet.
      const allTopLevelFields = operations.length > 0 && operations.every(
        op => op.action === "update_field" && !op.path.startsWith("sections.")
      );
      if (allTopLevelFields) {
        return writeTopLevelFieldsToPerEntryFile({ contentType, slug, locale, operations, author: request.author });
      }
      return handleSharedTemplateEdit({ contentType, slug, locale, operations, localeData, filePath, author: request.author, contentRoot, database: request.database, ci });
    }

    // For DB-backed entries that have their own per-entry file (isSharedTemplate=false),
    // the client sends indices relative to the fully merged view (template + per-entry).
    // Translate update_section indices from the merged view to the per-entry local indices
    // before applying, so we write to the correct section in the per-entry file.
    let resolvedOperations = operations;
    if (ci.isDatabaseBacked(contentType) && operations.some(op => op.action === "update_section")) {
      const mergedTemplate = mergeSingleTemplate(contentType, locale, slug, undefined, contentRoot);
      const mergedSections = Array.isArray(mergedTemplate?.sections)
        ? (mergedTemplate!.sections as Record<string, unknown>[])
        : [];

      if (mergedSections.length > 0) {
        const localSections = Array.isArray(localeData.sections)
          ? (localeData.sections as Record<string, unknown>[])
          : [];

        const translated: EditOperation[] = [];
        const templateOps: EditOperation[] = [];
        for (const op of operations) {
          if (op.action !== "update_section") {
            translated.push(op);
            continue;
          }

          // Resolve the section identity from the merged view.
          const mergedSection = mergedSections[op.index] as Record<string, unknown> | undefined;
          const sectionId = mergedSection
            ? ((mergedSection.id as string | undefined) || (mergedSection.section_id as string | undefined))
            : undefined;

          // Try to find it by ID in the per-entry local file.
          const localIdx = sectionId !== undefined
            ? localSections.findIndex(
                s => (s as Record<string, unknown>).id === sectionId ||
                     (s as Record<string, unknown>).section_id === sectionId
              )
            : -1;

          if (localIdx === -1) {
            // Section lives in the shared template — collect it for a separate
            // write to single.{locale}.yml via handleSharedTemplateEdit.
            templateOps.push(op);
            continue;
          }

          translated.push({ ...op, index: localIdx });
        }
        resolvedOperations = translated;

        // Forward any template-owned ops to the shared template file.
        if (templateOps.length > 0) {
          // The per-entry file is at 4geeks-com/{type}/{slug}/{locale}.yml
          // Two levels up is 4geeks-com/{type}/ where single.{locale}.yml lives.
          const templateFilePath = path.join(
            path.dirname(path.dirname(filePath)),
            `single.${locale}.yml`,
          );
          if (fs.existsSync(templateFilePath)) {
            const rawTemplate = fs.readFileSync(templateFilePath, "utf-8");
            const templateLocaleData = ci.safeYamlLoad(rawTemplate) as Record<string, unknown>;
            const templateResult = handleSharedTemplateEdit({
              contentType,
              slug,
              locale,
              operations: templateOps,
              localeData: templateLocaleData,
              filePath: templateFilePath,
              author: request.author,
              contentRoot,
              database: request.database,
              ci,
            });
            if (!templateResult.success) {
              return { success: false, error: templateResult.error };
            }
          }
        }
      }
    }

    // Handle reorder_sections for DB-backed per-entry pages.
    // The client sends merged-view indices. We must translate them appropriately:
    //   • Both template sections   → forward reorder to the shared template file; swap
    //                                _insertAfterSectionId anchors in the per-entry data.
    //   • Both per-entry sections  → translate merged indices to local per-entry indices
    //                                and apply the reorder directly to localeData.
    //   • Boundary (mixed)         → explicit error; moving across template/per-entry
    //                                boundary is not supported.
    if (ci.isDatabaseBacked(contentType) && resolvedOperations.some(op => op.action === "reorder_sections")) {
      const mergedView = mergeSingleTemplate(contentType, locale, slug, undefined, contentRoot);
      const mergedSections = Array.isArray(mergedView?.sections)
        ? (mergedView!.sections as Record<string, unknown>[])
        : [];

      // Helper: return the first non-empty string ID from a section object
      const getSectionId = (s: Record<string, unknown>): string | null =>
        typeof s.id === "string" && s.id ? s.id
          : typeof s.section_id === "string" && s.section_id ? s.section_id
          : null;

      const opsToRemove = new Set<number>();

      for (let opIdx = 0; opIdx < resolvedOperations.length; opIdx++) {
        const op = resolvedOperations[opIdx];
        if (op.action !== "reorder_sections") continue;

        const fromIdx = (op as { from: number }).from;
        const toIdx = (op as { to: number }).to;
        const fromSection = mergedSections[fromIdx] as Record<string, unknown> | undefined;
        const toSection = mergedSections[toIdx] as Record<string, unknown> | undefined;

        if (!fromSection || !toSection) {
          throw new Error(`Invalid section indices for reorder: from=${fromIdx} to=${toIdx} (merged view has ${mergedSections.length} sections)`);
        }

        const fromIsPerEntry = !!fromSection._perEntrySource;
        const toIsPerEntry = !!toSection._perEntrySource;

        if (!fromIsPerEntry && !toIsPerEntry) {
          // Both are template sections: forward reorder to shared template file
          const templateFilePath = path.join(
            path.dirname(path.dirname(filePath)),
            `single.${locale}.yml`,
          );

          if (!fs.existsSync(templateFilePath)) {
            throw new Error(`Shared template file not found: ${templateFilePath}`);
          }

          const rawTemplate = fs.readFileSync(templateFilePath, "utf-8");
          const templateData = (contentIndex.safeYamlLoad(rawTemplate) as Record<string, unknown>) || {};
          const templateSections = Array.isArray(templateData.sections)
            ? (templateData.sections as Record<string, unknown>[])
            : [];

          const fromId = typeof fromSection.id === "string" ? fromSection.id : null;
          const toId = typeof toSection.id === "string" ? toSection.id : null;

          // Resolve template-file indices by section ID (avoids merged-vs-template index divergence)
          const tplFrom = fromId ? templateSections.findIndex(s => s.id === fromId) : -1;
          const tplTo = toId ? templateSections.findIndex(s => s.id === toId) : -1;

          if (tplFrom === -1 || tplTo === -1) {
            throw new Error(`Could not find template sections by ID (from="${fromId}", to="${toId}") — sections may lack id fields`);
          }

          const [moved] = templateSections.splice(tplFrom, 1);
          templateSections.splice(tplTo, 0, moved);
          templateData.sections = templateSections;

          const updatedYaml = safeYamlDump(templateData, {
            lineWidth: -1,
            noRefs: true,
            quotingType: '"',
            forceQuotes: false,
          });
          fs.writeFileSync(templateFilePath, updatedYaml, "utf-8");
          markFileAsModified(templateFilePath, request.author, undefined, contentRoot);

          // Swap _insertAfterSectionId anchors that pointed to either moved section,
          // so per-entry sections keep their intended visual position relative to neighbours.
          if (fromId && toId) {
            const localSections = Array.isArray(localeData.sections)
              ? (localeData.sections as Record<string, unknown>[])
              : [];
            for (const s of localSections) {
              const anchor = s._insertAfterSectionId;
              if (anchor === fromId) s._insertAfterSectionId = toId;
              else if (anchor === toId) s._insertAfterSectionId = fromId;
            }
          }

          // Remove the reorder op so it is NOT applied to the per-entry file array
          opsToRemove.add(opIdx);

        } else if (fromIsPerEntry && toIsPerEntry) {
          // Both are per-entry sections: find their local indices in the per-entry file
          const localSections = Array.isArray(localeData.sections)
            ? (localeData.sections as Record<string, unknown>[])
            : [];
          const fromId = typeof fromSection.id === "string" ? fromSection.id : null;
          const toId = typeof toSection.id === "string" ? toSection.id : null;
          const localFrom = fromId ? localSections.findIndex(s => s.id === fromId) : -1;
          const localTo = toId ? localSections.findIndex(s => s.id === toId) : -1;

          if (localFrom === -1 || localTo === -1) {
            throw new Error(`Per-entry sections not found in local file (from="${fromId}", to="${toId}")`);
          }

          // Apply the reorder directly to localeData (written to per-entry file at end of editContent)
          const [moved] = localSections.splice(localFrom, 1);
          localSections.splice(localTo, 0, moved);

          // Remove from resolvedOperations to prevent double-apply via applyOperation
          opsToRemove.add(opIdx);

        } else {
          // Boundary move: one template section + one per-entry section.
          // We handle this by updating _insertAfterSectionId on the per-entry section
          // so it appears in the new visual position within this entry's merged view.
          // The shared template file is NOT modified — this only affects this entry.
          const localSections = Array.isArray(localeData.sections)
            ? (localeData.sections as Record<string, unknown>[])
            : [];

          let perEntrySectionId: string | null;
          let newAnchorId: string | null;

          if (fromIsPerEntry) {
            // Per-entry section moving past a template section
            perEntrySectionId = getSectionId(fromSection);
            if (fromIdx < toIdx) {
              // Moving DOWN: anchor becomes the template section it moved past
              newAnchorId = getSectionId(toSection);
            } else {
              // Moving UP: anchor becomes the section that will be just before the new slot
              newAnchorId = toIdx > 0 ? getSectionId(mergedSections[toIdx - 1]) : null;
            }
          } else {
            // Template section moving past a per-entry section.
            // Only the per-entry section's anchor changes (template file unchanged).
            perEntrySectionId = getSectionId(toSection);
            if (fromIdx < toIdx) {
              // Template moving DOWN past per-entry: per-entry shifts up to fromIdx
              newAnchorId = fromIdx > 0 ? getSectionId(mergedSections[fromIdx - 1]) : null;
            } else {
              // Template moving UP past per-entry: per-entry shifts down to fromIdx
              newAnchorId = getSectionId(fromSection);
            }
          }

          if (!perEntrySectionId) {
            throw new Error("Cannot resolve per-entry section ID for boundary reorder");
          }

          const localSection = localSections.find(s => getSectionId(s) === perEntrySectionId);
          if (!localSection) {
            throw new Error(`Per-entry section "${perEntrySectionId}" not found in local per-entry file`);
          }

          localSection._insertAfterSectionId = newAnchorId;
          opsToRemove.add(opIdx);
        }
      }

      if (opsToRemove.size > 0) {
        resolvedOperations = resolvedOperations.filter((_, i) => !opsToRemove.has(i));
      }
    }

    // Apply all operations to the locale data (this is what gets saved)
    for (const operation of resolvedOperations) {
      applyOperation(localeData, operation);
    }

    // Strip null/non-object entries from sections before writing — a null section
    // entry (produced by a blank YAML list item) causes a server crash at load time.
    if (Array.isArray(localeData.sections)) {
      localeData.sections = (localeData.sections as unknown[]).filter(
        (s): s is Record<string, unknown> => s != null && typeof s === "object",
      );
    }

    // Validate form sections after all operations are applied, before writing to disk.
    // This covers every edit path (update_section, update_field, add_item, replace_all_sections)
    // because we inspect the fully-mutated in-memory state.
    if (Array.isArray(localeData.sections)) {
      const conversionNames = getTrackingSettings().conversion_events.map((e) => e.name);
      for (let i = 0; i < (localeData.sections as Record<string, unknown>[]).length; i++) {
        const section = (localeData.sections as Record<string, unknown>[])[i];
        const formErr = validateFormSection(section, conversionNames);
        if (formErr) {
          return { success: false, error: `sections[${i}]: ${formErr}` };
        }
      }
    }

    // Reject obsolete consent keys before writing to disk.
    const consentErr = getConsentKeyError(localeData);
    if (consentErr) {
      return { success: false, error: consentErr };
    }

    // Write locale data back to file (without _common.yml content)
    const updatedYaml = safeYamlDump(localeData, {
      lineWidth: -1, // Don't wrap lines
      noRefs: true,
      quotingType: '"',
      forceQuotes: false,
    });
    
    fs.writeFileSync(filePath, updatedYaml, "utf-8");

    // Track who modified this file for sync purposes.
    // markFileAsModified fires fileModifiedListeners, which includes the
    // VersioningManager listener that invalidates the variant content cache.
    markFileAsModified(filePath, request.author, undefined, contentRoot);
    
    // Note: GitHub commits are now handled manually via /api/github/commit endpoint
    // Changes are saved locally and users commit when ready
    
    const commonData = ci.loadCommonData(contentType, slug);
    const mergedContent = commonData
      ? deepMerge(commonData, localeData)
      : localeData;
    const updatedSections = (mergedContent.sections as unknown[]) || [];
    return { success: true, updatedSections };
  } catch (error) {
    log.error({ err: error }, "Content edit error:");
    return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
  }
}

/**
 * Returns true for operations that structurally change the sections array
 * on the shared template file (add, remove, reorder, or full section swap).
 */
function isStructuralOp(op: EditOperation): boolean {
  if (op.action === "add_item" && op.path === "sections") return true;
  if (op.action === "remove_item" && op.path === "sections") return true;
  if (op.action === "update_section" && (op as { structural?: boolean }).structural === true) return true;
  if (op.action === "reorder_sections") return true;
  return false;
}

/**
 * Restores `{{ single.* }}` and `{{ global.* }}` placeholder expressions from
 * the original template section back into the new section data, preventing any
 * resolved values (e.g. from the AI adapt flow) from leaking into the template.
 */
function restoreTemplatePlaceholders(
  newSection: Record<string, unknown>,
  originalTemplateSection: Record<string, unknown>
): Record<string, unknown> {
  const varFields = extractVariableFields(originalTemplateSection);
  if (Object.keys(varFields).length === 0) return newSection;

  const result = JSON.parse(JSON.stringify(newSection)) as Record<string, unknown>;
  for (const [dotPath, templateExpr] of Object.entries(varFields)) {
    setValueAtPath(result, dotPath, templateExpr);
  }
  return result;
}

/**
 * Writes structural section changes (add/remove/swap) directly to the shared
 * `single.{locale}.yml` template file, preserving all `{{ }}` placeholder
 * expressions. Uses safe YAML load/dump to avoid template variable corruption.
 */
function writeStructuralChangesToTemplate(opts: {
  operations: EditOperation[];
  filePath: string;
  localeData: Record<string, unknown>;
  author?: string;
}): { success: boolean; error?: string; updatedSections?: unknown[] } {
  const { operations, filePath, localeData, author } = opts;

  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const templateData = (contentIndex.safeYamlLoad(raw) as Record<string, unknown>) || {};

    for (const op of operations) {
      if (op.action === "update_section" && (op as { structural?: boolean }).structural) {
        const templateSections = Array.isArray(templateData.sections)
          ? (templateData.sections as Record<string, unknown>[])
          : [];
        const originalTemplateSection = templateSections[op.index] as Record<string, unknown> | undefined;
        let newSectionData = op.section as Record<string, unknown>;
        if (originalTemplateSection) {
          newSectionData = restoreTemplatePlaceholders(newSectionData, originalTemplateSection);
        }
        applyOperation(templateData, { ...op, section: newSectionData } as EditOperation);
      } else {
        applyOperation(templateData, op);
      }
    }

    // Strip null/non-object entries from sections before writing
    if (Array.isArray(templateData.sections)) {
      templateData.sections = (templateData.sections as unknown[]).filter(
        (s): s is Record<string, unknown> => s != null && typeof s === "object",
      );
    }

    // Reject obsolete consent keys before writing to disk.
    const consentErrStructural = getConsentKeyError(templateData);
    if (consentErrStructural) {
      return { success: false, error: consentErrStructural };
    }

    const updatedYaml = safeYamlDump(templateData, {
      lineWidth: -1,
      noRefs: true,
      quotingType: '"',
      forceQuotes: false,
    });
    fs.writeFileSync(filePath, updatedYaml, "utf-8");
    markFileAsModified(filePath, author);

    // Apply to localeData in-memory for immediate client-side update
    for (const op of operations) {
      try { applyOperation(localeData, op); } catch {}
    }

    const updatedSections = (localeData.sections as unknown[]) || [];
    return { success: true, updatedSections };
  } catch (err) {
    log.error({ err: err }, "[editContent] Structural template write error:");
    return { success: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}

/**
 * Writes top-level field ops (e.g. `meta`) to a DB-backed entry's per-entry locale
 * file (`{slug}/en.yml`), creating it and its parent directory if absent.
 * Called when `editContent` detects all ops are top-level update_field while the
 * loaded file is the shared template — those fields must never touch the template.
 */
function writeTopLevelFieldsToPerEntryFile(opts: {
  contentType: string;
  slug: string;
  locale: string;
  operations: EditOperation[];
  author?: string;
}): { success: boolean; error?: string } {
  const { contentType, slug, locale, operations, author } = opts;
  try {
    const perEntryDir = path.join(process.cwd(), process.env.CONTENT_FOLDER || "default-site-content", getFolder(contentType), slug);
    const perEntryPath = path.join(perEntryDir, `${locale}.yml`);

    if (!fs.existsSync(perEntryDir)) {
      fs.mkdirSync(perEntryDir, { recursive: true });
    }

    let entryData: Record<string, unknown> = {};
    if (fs.existsSync(perEntryPath)) {
      const raw = fs.readFileSync(perEntryPath, "utf-8");
      entryData = (yaml.load(raw) as Record<string, unknown>) || {};
    }

    for (const op of operations) {
      if (op.value === null || op.value === undefined) {
        delete entryData[op.path as string];
      } else {
        setValueAtPath(entryData, op.path as string, op.value);
      }
    }

    // Reject obsolete consent keys before writing to disk.
    const consentErrEntry = getConsentKeyError(entryData);
    if (consentErrEntry) {
      return { success: false, error: consentErrEntry };
    }

    const dumped = safeYamlDump(entryData, { lineWidth: -1, noRefs: true });
    fs.writeFileSync(perEntryPath, dumped, "utf-8");
    markFileAsModified(perEntryPath, author);
    return { success: true };
  } catch (err) {
    log.error({ err: err }, "[writeTopLevelFieldsToPerEntryFile] Error:");
    return { success: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}

/**
 * Handles section/field saves for DB-backed single-page templates (e.g. blog posts,
 * programs). Instead of writing to the shared `single.en.yml` template, we identify
 * which changed fields are template variable expressions (`{{ single.X | ... }}`),
 * extract the target DB field name `X`, and patch only that entry's row in the
 * database file cache. The shared template YAML is never touched unless a structural
 * operation (add/remove section, swap variant) is explicitly requested.
 */
function handleSharedTemplateEdit(opts: {
  contentType: string;
  slug: string;
  locale: string;
  operations: EditOperation[];
  localeData: Record<string, unknown>;
  filePath: string;
  author?: string;
  contentRoot?: string;
  database?: DatabaseManager;
  ci?: ContentIndex;
}): { success: boolean; error?: string; warning?: string; updatedSections?: unknown[] } {
  const { contentType, slug, locale, operations, localeData, filePath, author, contentRoot } = opts;
  const ci = opts.ci ?? contentIndex;
  const db = opts.database ?? databaseManager;

  // update_section ops always write directly to the shared template YAML.
  // This function is only reached when the user explicitly chose "Update shared
  // template" (or when the per-entry translation layer routed a template-owned
  // section here). DB field patching applies only to update_field ops.
  const structuralOps = operations.filter(
    op => isStructuralOp(op) || op.action === "update_section",
  );
  if (structuralOps.length > 0) {
    return writeStructuralChangesToTemplate({ operations: structuralOps, filePath, localeData, author });
  }

  const dbName = getDatabaseName(contentType);
  const lookupKey = getLookupKey(contentType) || "slug";
  const fieldMapping = getFieldMapping(contentType);

  // Load the raw template to read the original `{{ }}` expressions
  const template = mergeSingleTemplate(contentType, locale, undefined, undefined, contentRoot);
  const templateSections = Array.isArray(template?.sections)
    ? (template!.sections as Record<string, unknown>[])
    : [];

  // Pre-compute variable fields for each template section (index → fieldPath → expr)
  const sectionVarFields: Record<number, Record<string, string>> = {};
  for (let i = 0; i < templateSections.length; i++) {
    const vf = extractVariableFields(templateSections[i]);
    if (Object.keys(vf).length > 0) sectionVarFields[i] = vf;
  }

  // Collect DB field updates from all operations
  const dbUpdates: Record<string, unknown> = {};

  for (const operation of operations) {
    if (operation.action === "update_section") {
      const varFields = sectionVarFields[operation.index] ?? {};
      const newSection = (operation.section ?? {}) as Record<string, unknown>;
      for (const [fieldPath, templateExpr] of Object.entries(varFields)) {
        const newValue = getValueAtPath(newSection, fieldPath);
        if (
          newValue !== undefined &&
          newValue !== templateExpr &&
          typeof newValue === "string" &&
          !TEMPLATE_EXPR_RE.test(newValue)
        ) {
          const templateKey = parseTemplateKey(templateExpr);
          if (templateKey) dbUpdates[templateKey] = newValue;
        }
      }
    } else if (operation.action === "update_field") {
      // Handle paths like "sections.2.image" or "sections.2.background.src"
      const m = operation.path.match(/^sections\.(\d+)\.(.+)$/);
      if (m) {
        const sectionIdx = parseInt(m[1], 10);
        const fieldPath = m[2];
        const varFields = sectionVarFields[sectionIdx] ?? {};
        const templateExpr = varFields[fieldPath];
        if (
          templateExpr !== undefined &&
          operation.value !== undefined &&
          operation.value !== templateExpr &&
          typeof operation.value === "string" &&
          !TEMPLATE_EXPR_RE.test(operation.value)
        ) {
          const templateKey = parseTemplateKey(templateExpr);
          if (templateKey) dbUpdates[templateKey] = operation.value;
        }
      }
    }
  }

  if (Object.keys(dbUpdates).length > 0 && dbName) {
    const patched = db.patchDbEntry(dbName, lookupKey, slug, dbUpdates, fieldMapping, author, contentRoot);
    if (!patched) {
      log.warn(`[editContent] patchDbEntry found no matching entry for ${dbName}/${slug}`);
    }
  }

  // Also write non-DB-variable field changes (e.g. paddingY, showOn, background) and
  // section-level saves (update_section) to the shared template YAML file, while
  // restoring any {{ single.* }} placeholder expressions that the client may have
  // stripped or replaced with resolved values.
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const templateData = (ci.safeYamlLoad(raw) as Record<string, unknown>) || {};

    let templateDirty = false;

    for (const operation of operations) {
      if (operation.action === "update_section") {
        // Write the whole section to the template, but restore placeholder expressions first.
        const templateSections2 = Array.isArray(templateData.sections)
          ? (templateData.sections as Record<string, unknown>[])
          : [];
        const originalTemplateSection = templateSections2[operation.index] as Record<string, unknown> | undefined;
        let newSectionData = (operation.section ?? {}) as Record<string, unknown>;
        if (originalTemplateSection) {
          newSectionData = restoreTemplatePlaceholders(newSectionData, originalTemplateSection);
        }
        applyOperation(templateData, { ...operation, section: newSectionData } as EditOperation);
        templateDirty = true;
      } else if (operation.action === "update_field") {
        // Only write to the template if this path is NOT a template-variable field
        // (template-variable fields are persisted to the DB instead).
        const m = operation.path.match(/^sections\.(\d+)\.(.+)$/);
        if (m) {
          const sectionIdx = parseInt(m[1], 10);
          const fieldPath = m[2];
          const varFields = sectionVarFields[sectionIdx] ?? {};
          if (!varFields[fieldPath]) {
            // Not a DB-mapped variable field → write directly to the template file.
            applyOperation(templateData, operation);
            templateDirty = true;
          }
        } else {
          // Top-level (non-section-field) path → write to template.
          applyOperation(templateData, operation);
          templateDirty = true;
        }
      }
    }

    if (templateDirty) {
      // Reject obsolete consent keys before writing to disk.
      const consentErrTemplate = getConsentKeyError(templateData);
      if (consentErrTemplate) {
        return { success: false, error: consentErrTemplate };
      }

      const updatedYaml = safeYamlDump(templateData, {
        lineWidth: -1,
        noRefs: true,
        quotingType: '"',
        forceQuotes: false,
      });
      fs.writeFileSync(filePath, updatedYaml, "utf-8");
      markFileAsModified(filePath, author, undefined, contentRoot);
    }
  } catch (err) {
    log.error("[editContent] Failed to write non-DB field changes to shared template:", err instanceof Error ? err.message : err);
  }

  // Apply operations to localeData in-memory so the returned sections reflect
  // what the client expects to see immediately (the resolved new values).
  for (const operation of operations) {
    try {
      applyOperation(localeData, operation);
    } catch (err) {
      log.warn("[editContent] Skipping invalid operation on shared template:", operation.action, err instanceof Error ? err.message : err);
    }
  }

  const updatedSections = (localeData.sections as unknown[]) || [];
  return { success: true, updatedSections };
}

/**
 * Parses the template variable name from an expression like `{{ single.thumbnail | default.jpg }}`.
 * Returns the field key after "single." (e.g. "thumbnail"), or null if not a `single.*` variable.
 */
function parseTemplateKey(expr: string): string | null {
  const inner = expr.replace(/^\{\{/, "").replace(/\}\}$/, "").trim();
  const varName = inner.split("|")[0].trim(); // "single.thumbnail"
  if (varName.startsWith("single.")) {
    return varName.slice("single.".length);
  }
  return null;
}

interface CommonEditRequest {
  contentType: string;
  slug: string;
  operations: Array<{ action: "update_field"; path: string; value: unknown }>;
  author?: string;
}

export function editCommonContent(request: CommonEditRequest): { success: boolean; error?: string } {
  const { contentType, slug, operations, author } = request;

  try {
    const commonPath = contentIndex.getCommonFilePath(contentType, slug);
    if (!fs.existsSync(commonPath)) {
      fs.mkdirSync(path.dirname(commonPath), { recursive: true });
      fs.writeFileSync(commonPath, "{}\n", "utf-8");
    }

    const raw = fs.readFileSync(commonPath, "utf-8");
    const commonData = (yaml.load(raw) as Record<string, unknown>) || {};

    for (const op of operations) {
      if (op.action !== "update_field") {
        return { success: false, error: `Unsupported operation: ${op.action}` };
      }
      if (op.value === undefined) {
        delete commonData[op.path];
      } else {
        setValueAtPath(commonData, op.path, op.value);
      }
    }

    const updatedYaml = safeYamlDump(commonData, {
      lineWidth: -1,
      noRefs: true,
      quotingType: '"',
      forceQuotes: false,
    });

    fs.writeFileSync(commonPath, updatedYaml, "utf-8");
    markFileAsModified(commonPath, author);

    return { success: true };
  } catch (error) {
    log.error({ err: error }, "Common content edit error:");
    return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
  }
}

export function getContentForEdit(
  contentType: string,
  slug: string,
  rawLocale: string,
  variant?: string,
  version?: number
): { content: Record<string, unknown> | null; error?: string } {
  const locale = normalizeLocale(rawLocale);
  
  const hasVariant = variant !== undefined && variant !== null && variant !== "";
  const hasValidVersion = version !== undefined && version !== null && Number.isFinite(version);
  if (hasValidVersion && !hasVariant) {
    return { content: null, error: "version cannot be provided without variant" };
  }
  
  try {
    const { data: localeData, error: loadError } = contentIndex.loadLocaleData(contentType, slug, locale, variant, version);
    if (!localeData || loadError) {
      return { content: null, error: loadError || `Content file not found` };
    }

    const commonData = contentIndex.loadCommonData(contentType, slug);
    const content = commonData
      ? deepMerge(commonData, localeData)
      : localeData;

    return { content };
  } catch (error) {
    log.error({ err: error }, "Error reading content:");
    return { content: null, error: error instanceof Error ? error.message : "Unknown error" };
  }
}

// ─── Content lifecycle helpers ────────────────────────────────────────────────

function coerceToOriginalType(newValue: string, originalValue: unknown): unknown {
  if (typeof originalValue === "number") {
    const n = Number(newValue);
    return Number.isNaN(n) ? newValue : n;
  }
  if (typeof originalValue === "boolean") return newValue === "true";
  return newValue;
}

function coerceStringValue(value: string): unknown {
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  if (value === "true") return true;
  if (value === "false") return false;
  return value;
}

function formatValidationError(type: string, raw: string): string {
  try {
    const match = raw.match(/(\[[\s\S]*\])/);
    if (match) {
      const issues = JSON.parse(match[1]) as Array<{ path: string[]; message: string }>;
      return `Cannot save ${type}: ${issues.map(i => `"${i.path.join(".")}" ${i.message}`).join("; ")}`;
    }
  } catch {}
  return `Cannot save ${type}: ${raw}`;
}

function invalidateContentCaches(contentType?: string): void {
  if (contentType) contentIndex.invalidateCommonFields(contentType);
  clearSsrSchemaCache();
}

type ContentLifecycleResult<T extends Record<string, unknown>> =
  | { success: true; data: T }
  | { success: false; statusCode: number; error: string };

// ─── renameContentSlug ────────────────────────────────────────────────────────

export interface RenameContentSlugInput {
  contentType: string;
  folderSlug: string;
  locale: string;
  newSlug: string;
  createRedirect?: boolean;
  author?: string;
  contentRootName?: string;
}

export async function renameContentSlug(
  input: RenameContentSlugInput,
): Promise<ContentLifecycleResult<{
  success: boolean; folderSlug: string; oldSlug: string; newSlug: string;
  oldUrl: string; newUrl: string; locale: string; redirectCreated: boolean;
}>> {
  const { contentType, folderSlug, locale, newSlug, createRedirect = false, author } = input;
  const rootName = input.contentRootName ?? getDefaultContentRootName();

  if (!contentType || !folderSlug || !locale || !newSlug) {
    return { success: false, statusCode: 400, error: "Missing required fields: contentType, folderSlug, locale, newSlug" };
  }
  if (!isValidType(contentType)) {
    return { success: false, statusCode: 400, error: `Invalid type. Must be one of: ${getAllTypes().join(", ")}` };
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(newSlug)) {
    return { success: false, statusCode: 400, error: "Invalid slug format. Use lowercase letters, numbers, and hyphens only." };
  }

  const contentFolder = getFolder(contentType);
  const resolvedFolderSlug = contentIndex.resolveBaseSlug(folderSlug, contentFolder);
  const folderPath = path.join(process.cwd(), rootName, contentFolder, resolvedFolderSlug);

  if (!fs.existsSync(folderPath)) {
    return { success: false, statusCode: 404, error: `Content folder not found: ${folderSlug} (resolved: ${resolvedFolderSlug})` };
  }

  const effectiveLocale =
    contentType === "landing"
      ? ((contentIndex.loadCommonData("landing", resolvedFolderSlug)?.locale as string) || locale)
      : locale;

  const localeFile = [`${effectiveLocale}.yml`, `${effectiveLocale}.yaml`].find(
    (f) => fs.existsSync(path.join(folderPath, f)),
  );
  if (!localeFile) {
    return { success: false, statusCode: 404, error: `Locale file not found: ${effectiveLocale}` };
  }

  const localeFilePath = path.join(folderPath, localeFile);
  const raw = fs.readFileSync(localeFilePath, "utf-8");
  const parsed = contentIndex.safeYamlLoad(raw) as Record<string, unknown> | null;
  if (!parsed) return { success: false, statusCode: 500, error: "Failed to parse locale file" };

  const currentSlug = (parsed.slug as string) || folderSlug;
  if (currentSlug === newSlug) {
    return { success: false, statusCode: 400, error: "New slug is the same as current slug" };
  }

  const oldUrl = contentIndex.buildUrl(contentFolder, effectiveLocale, currentSlug);
  const newUrl = contentIndex.buildUrl(contentFolder, effectiveLocale, newSlug);
  parsed.slug = newSlug;

  if (createRedirect) {
    const meta = (parsed.meta || {}) as Record<string, unknown>;
    const redirects = Array.isArray(meta.redirects) ? [...meta.redirects] : [];
    if (!redirects.includes(oldUrl)) redirects.push(oldUrl);
    meta.redirects = redirects;
    parsed.meta = meta;
  }

  const updated = safeYamlDump(parsed, { lineWidth: -1, noRefs: true });
  fs.writeFileSync(localeFilePath, updated, "utf-8");
  markFileAsModified(`${rootName}/${contentFolder}/${resolvedFolderSlug}/${localeFile}`, author);
  contentIndex.refresh();
  refreshSitemapEntry(contentType, resolvedFolderSlug, effectiveLocale);
  clearRedirectCache();
  invalidateContentCaches(contentType);

  return {
    success: true,
    data: {
      success: true, folderSlug: resolvedFolderSlug, oldSlug: currentSlug,
      newSlug, oldUrl, newUrl, locale: effectiveLocale, redirectCreated: !!createRedirect,
    },
  };
}

// ─── deleteContentEntry ───────────────────────────────────────────────────────

export interface DeleteContentEntryInput {
  type: string;
  slug: string;
  author?: string;
  localesToDelete?: string[];
  contentRootName?: string;
}

export async function deleteContentEntry(
  input: DeleteContentEntryInput,
): Promise<ContentLifecycleResult<{ success: boolean; message: string; deletedFiles?: string[]; folderRemoved?: boolean }>> {
  const { type, slug, author, localesToDelete = [] } = input;
  const rootName = input.contentRootName ?? getDefaultContentRootName();

  if (!type || !slug) {
    return { success: false, statusCode: 400, error: "Missing required fields: type, slug" };
  }
  if (!isValidType(type)) {
    return { success: false, statusCode: 400, error: `Invalid type. Must be one of: ${getAllTypes().join(", ")}` };
  }
  if (/[/\\]|\.\./.test(slug) || slug.startsWith(".")) {
    return { success: false, statusCode: 400, error: "Invalid slug format" };
  }

  const typeFolder = getFolder(type);
  const resolvedSlug = contentIndex.resolveBaseSlug(slug, typeFolder);
  const folderPath = path.join(process.cwd(), rootName, typeFolder, resolvedSlug);

  if (!fs.existsSync(folderPath)) {
    return { success: false, statusCode: 404, error: `Content "${slug}" of type "${type}" not found` };
  }

  const realPath = fs.realpathSync(path.resolve(folderPath));
  const allowedBase = fs.realpathSync(path.join(process.cwd(), rootName, typeFolder));
  if (!realPath.startsWith(allowedBase + path.sep)) {
    return { success: false, statusCode: 400, error: "Invalid path" };
  }

  if (localesToDelete.length > 0) {
    const deletedFiles: string[] = [];
    for (const locale of localesToDelete) {
      const localeFile = path.join(folderPath, `${locale}.yml`);
      if (fs.existsSync(localeFile)) {
        fs.unlinkSync(localeFile);
        deletedFiles.push(`${locale}.yml`);
        markFileAsModified(`${rootName}/${typeFolder}/${resolvedSlug}/${locale}.yml`, author);
      }
    }

    const remainingFiles = fs.readdirSync(folderPath).filter((f) => f.endsWith(".yml") && !f.startsWith("_"));

    if (remainingFiles.length === 0) {
      const allFiles = fs.existsSync(folderPath) ? fs.readdirSync(folderPath) : [];
      for (const file of allFiles) {
        markFileAsModified(`${rootName}/${typeFolder}/${resolvedSlug}/${file}`, author);
      }
      fs.rmSync(folderPath, { recursive: true, force: true });
      log.info(`[Content] Deleted ${type}/${slug} (all locales removed, folder cleaned up)`);
      try {
        const { removeSlugFromAllDependants } = await import("./utils/sectionAnchors");
        removeSlugFromAllDependants(type, resolvedSlug);
      } catch { /* non-fatal */ }
    } else {
      log.info(`[Content] Deleted ${deletedFiles.join(", ")} from ${type}/${slug} (${remainingFiles.length} locale(s) remaining)`);
    }

    if (remainingFiles.length === 0) {
      invalidateSitemapEntriesByContentKey(`${type}:${resolvedSlug}`);
    } else {
      for (const deletedFile of deletedFiles) {
        invalidateSitemapEntry(`${type}:${resolvedSlug}:${deletedFile.replace(/\.ya?ml$/, "")}`);
      }
    }
    contentIndex.refresh();
    invalidateContentCaches(type);

    return {
      success: true,
      data: {
        success: true,
        message: remainingFiles.length === 0
          ? `Successfully deleted ${type}/${slug}`
          : `Deleted ${deletedFiles.join(", ")} from ${type}/${slug}`,
        deletedFiles,
        folderRemoved: remainingFiles.length === 0,
      },
    };
  }

  // Full folder delete
  const allFiles = fs.readdirSync(folderPath);
  for (const file of allFiles) {
    markFileAsModified(`${rootName}/${typeFolder}/${resolvedSlug}/${file}`, author);
  }
  fs.rmSync(folderPath, { recursive: true, force: true });
  log.info(`[Content] Deleted ${type}/${slug}`);
  invalidateSitemapEntriesByContentKey(`${type}:${resolvedSlug}`);
  contentIndex.refresh();
  invalidateContentCaches(type);

  try {
    const { removeSlugFromAllDependants } = await import("./utils/sectionAnchors");
    removeSlugFromAllDependants(type, resolvedSlug);
  } catch { /* non-fatal */ }

  return { success: true, data: { success: true, message: `Successfully deleted ${type}/${slug}` } };
}

// ─── createContentEntry ───────────────────────────────────────────────────────

export interface CreateContentEntryInput {
  type: string;
  slugEn?: string | null;
  slugEs?: string | null;
  title: string;
  sourceUrl?: string;
  changeContentType?: boolean;
  skipLocales?: string[];
  uniqueFieldValues?: Record<string, string | boolean>;
  localeTitles?: Record<string, string>;
  author?: string;
  contentRootName?: string;
}

export async function createContentEntry(
  input: CreateContentEntryInput,
): Promise<ContentLifecycleResult<Record<string, unknown>>> {
  const {
    type, title, sourceUrl, changeContentType = false,
    skipLocales = [], uniqueFieldValues = {}, localeTitles = {}, author,
  } = input;
  const rootName = input.contentRootName ?? getDefaultContentRootName();

  if (!type || !title) {
    return { success: false, statusCode: 400, error: "Missing required fields: type, title" };
  }
  if (!isValidType(type)) {
    return { success: false, statusCode: 400, error: `Invalid type. Must be one of: ${getAllTypes().join(", ")}` };
  }

  const slugRegex = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
  const skipEn = skipLocales.includes("en");
  const skipEs = skipLocales.includes("es");
  const enSlug = skipEn ? null : (input.slugEn || null);
  const esSlug = skipEs ? null : (input.slugEs || null);

  if (!enSlug && !esSlug) {
    return { success: false, statusCode: 400, error: "At least one locale slug must be provided" };
  }
  if (enSlug && !slugRegex.test(enSlug)) {
    return { success: false, statusCode: 400, error: "Invalid English slug format. Use lowercase letters, numbers, and hyphens only." };
  }
  if (esSlug && !slugRegex.test(esSlug)) {
    return { success: false, statusCode: 400, error: "Invalid Spanish slug format. Use lowercase letters, numbers, and hyphens only." };
  }

  const folderSlug = (enSlug || esSlug)!;
  const existingTypeSlugs = contentIndex.listContentSlugs(type);
  if (existingTypeSlugs.includes(folderSlug)) {
    return { success: false, statusCode: 409, error: `A ${type} with slug "${folderSlug}" already exists` };
  }

  const folderPath = path.join(process.cwd(), rootName, getFolder(type), folderSlug);
  if (fs.existsSync(folderPath)) {
    return { success: false, statusCode: 409, error: `A ${type} with slug "${folderSlug}" already exists` };
  }

  fs.mkdirSync(folderPath, { recursive: true });

  if (sourceUrl) {
    try {
      const sourceUrlObj = new URL(sourceUrl);
      const sourcePath = sourceUrlObj.pathname;
      const resolved = contentIndex.resolveUrl(sourcePath);
      const foundSourceFolder = resolved ? path.join(process.cwd(), resolved.entry.directory) : "";

      if (foundSourceFolder) {
        // Cross-type duplication
        if (changeContentType && resolved && resolved.contentType !== type) {
          const result = contentIndex.duplicateWithTypeChange({
            sourceDir: foundSourceFolder,
            sourceType: resolved.contentType,
            targetType: type,
            targetDir: folderPath,
            newSlugs: { en: enSlug || undefined, es: esSlug || undefined },
            title: title || folderSlug,
            skipLocales,
            localeTitles,
          });
          for (const file of result.copiedFiles) {
            markFileAsModified(`${rootName}/${getFolder(type)}/${folderSlug}/${file}`, author);
          }
          refreshSitemapEntriesForContentKey(type, folderSlug, getSupportedLocales().filter(l => !skipLocales.includes(l)));
          contentIndex.refresh();
          invalidateContentCaches(type);

          const localesToValidate1 = getSupportedLocales().filter(
            l => !skipLocales.includes(l) && fs.existsSync(path.join(folderPath, `${l}.yml`))
          );
          for (const locale of localesToValidate1) {
            const { error: validationError } = contentIndex.loadMergedContent(type, folderSlug, locale);
            if (validationError) {
              fs.rmSync(folderPath, { recursive: true, force: true });
              contentIndex.refresh();
              return { success: false, statusCode: 400, error: formatValidationError(type, validationError) };
            }
          }
          return {
            success: true,
            data: {
              success: true, slugEn: enSlug, slugEs: esSlug, type,
              directory: `${rootName}/${getFolder(type)}/${folderSlug}`,
              duplicatedFrom: sourceUrl, typeChanged: true,
              conversion: { from: resolved.contentType, to: type, copiedFiles: result.copiedFiles, strippedFields: result.strippedFields, replacedVars: result.replacedVars },
            },
          };
        }

        // Same-type duplication
        const sourceFiles = fs.readdirSync(foundSourceFolder);
        const parsedDupFiles: Array<{ file: string; parsed: Record<string, unknown> }> = [];
        const sourceLocaleFiles = new Set(
          sourceFiles.filter(f => f.endsWith(".yml") || f.endsWith(".yaml")).map(f => f.replace(/\.ya?ml$/, ""))
        );

        for (const file of sourceFiles) {
          const fileLocale = file.replace(/\.yml$/, "");
          if (fileLocale !== "_common" && skipLocales.includes(fileLocale)) continue;
          if (!file.endsWith(".yml") && !file.endsWith(".yaml")) continue;

          const rawContent = fs.readFileSync(path.join(foundSourceFolder, file), "utf8");

          const isContentFile =
            file === "_common.yml" || file === "_common.yaml" ||
            /^[a-z]{2,5}\.ya?ml$/.test(file) ||
            /^.+\.[a-z]{2,5}\.ya?ml$/.test(file);

          if (!isContentFile) {
            fs.writeFileSync(path.join(folderPath, file), rawContent);
            markFileAsModified(`${rootName}/${getFolder(type)}/${folderSlug}/${file}`, author);
            continue;
          }

          const parsed = contentIndex.safeYamlLoad(rawContent) as Record<string, unknown> | null;
          if (!parsed) {
            fs.writeFileSync(path.join(folderPath, file), rawContent);
            markFileAsModified(`${rootName}/${getFolder(type)}/${folderSlug}/${file}`, author);
            continue;
          }

          delete parsed.redirects;
          if (parsed.meta && typeof parsed.meta === "object") {
            delete (parsed.meta as Record<string, unknown>).redirects;
          }

          parsed.slug = file === "es.yml" ? (esSlug || folderSlug) : (enSlug || folderSlug);

          if (file === "_common.yml") {
            parsed.title = title;
            for (const [fieldName, newValue] of Object.entries(uniqueFieldValues)) {
              if (fieldName === "slug" || fieldName === "title") continue;
              parsed[fieldName] = coerceToOriginalType(newValue as string, parsed[fieldName]);
            }
          } else if (file === "en.yml" || file === "es.yml") {
            const locTitle = localeTitles[fileLocale] || title;
            parsed.title = locTitle;
            if (locTitle) {
              if (!parsed.meta || typeof parsed.meta !== "object") parsed.meta = {};
              (parsed.meta as Record<string, unknown>).page_title = locTitle;
            }
          }
          parsedDupFiles.push({ file, parsed });
        }

        // Synthesize missing locale files from the source
        const supportedLocs = getSupportedLocales();
        const existingSourceLocale = supportedLocs.find(l => sourceLocaleFiles.has(l));
        if (existingSourceLocale) {
          for (const loc of supportedLocs) {
            if (skipLocales.includes(loc) || sourceLocaleFiles.has(loc)) continue;
            const srcRaw = fs.readFileSync(path.join(foundSourceFolder, `${existingSourceLocale}.yml`), "utf8");
            const cloned = contentIndex.safeYamlLoad(srcRaw) as Record<string, unknown> | null;
            if (!cloned) continue;
            delete cloned.redirects;
            if (cloned.meta && typeof cloned.meta === "object") {
              delete (cloned.meta as Record<string, unknown>).redirects;
            }
            cloned.slug = loc === "es" ? (esSlug || folderSlug) : (enSlug || folderSlug);
            cloned.locale = loc;
            const clonedTitle = localeTitles[loc] || title;
            cloned.title = clonedTitle;
            if (clonedTitle) {
              if (!cloned.meta || typeof cloned.meta !== "object") cloned.meta = {};
              (cloned.meta as Record<string, unknown>).page_title = clonedTitle;
            }
            parsedDupFiles.push({ file: `${loc}.yml`, parsed: cloned });
          }
        }

        const { objs: regeneratedDup } = regenerateSectionIds(parsedDupFiles.map(f => f.parsed));
        for (let i = 0; i < parsedDupFiles.length; i++) {
          const { file } = parsedDupFiles[i];
          const content = safeYamlDump(regeneratedDup[i], { lineWidth: 120, noRefs: true, sortKeys: false });
          fs.writeFileSync(path.join(folderPath, file), content);
          markFileAsModified(`${rootName}/${getFolder(type)}/${folderSlug}/${file}`, author);
        }

        refreshSitemapEntriesForContentKey(type, folderSlug, getSupportedLocales().filter(l => !skipLocales.includes(l)));
        contentIndex.refresh();
        invalidateContentCaches(type);

        const localesToValidate2 = getSupportedLocales().filter(
          l => !skipLocales.includes(l) && fs.existsSync(path.join(folderPath, `${l}.yml`))
        );
        for (const locale of localesToValidate2) {
          const { error: validationError } = contentIndex.loadMergedContent(type, folderSlug, locale);
          if (validationError) {
            fs.rmSync(folderPath, { recursive: true, force: true });
            contentIndex.refresh();
            return { success: false, statusCode: 400, error: formatValidationError(type, validationError) };
          }
        }

        return {
          success: true,
          data: {
            success: true, slugEn: enSlug, slugEs: esSlug, type,
            directory: `${rootName}/${getFolder(type)}/${folderSlug}`,
            duplicatedFrom: sourceUrl,
          },
        };
      }
    } catch (dupError) {
      log.error({ err: dupError }, "Error duplicating content:");
      // Fall through to fresh create
    }
  }

  // Fresh create from field_mapping
  const typeConfig = getContentTypeConfig(type);
  const fieldMappingRaw = typeConfig?.field_mapping ?? {};
  const fieldKeys = Object.keys(fieldMappingRaw).filter(k => !k.startsWith("_"));
  const activeLocale = getSupportedLocales().find(l => !skipLocales.includes(l)) ?? getDefaultLocale();

  const commonObj: Record<string, unknown> = {};
  for (const key of fieldKeys) {
    if (key === "slug") commonObj.slug = folderSlug;
    else if (key === "title") commonObj.title = title;
    else if (key === "locale") commonObj.locale = activeLocale;
    else if (uniqueFieldValues[key] !== undefined) {
      const ufv = uniqueFieldValues[key];
      commonObj[key] = typeof ufv === "boolean" ? ufv : coerceStringValue(ufv as string);
    } else {
      commonObj[key] = "";
    }
  }
  const commonYml = yaml.dump(commonObj, { lineWidth: 120, noRefs: true, sortKeys: false });

  const makeLocaleObj = (slug: string, loc: string) => {
    const obj: Record<string, unknown> = { slug, sections: [] };
    const localeTitle = localeTitles[loc];
    const effectiveTitle = localeTitle || title;
    if (localeTitle) obj.title = localeTitle;
    if (effectiveTitle) obj.meta = { page_title: effectiveTitle };
    return obj;
  };
  const enYml = yaml.dump(makeLocaleObj(enSlug || folderSlug, "en"), { lineWidth: 120, noRefs: true, sortKeys: false });
  const esYml = yaml.dump(makeLocaleObj(esSlug || folderSlug, "es"), { lineWidth: 120, noRefs: true, sortKeys: false });

  const createdFiles: string[] = [];
  const relFolder = `${rootName}/${getFolder(type)}/${folderSlug}`;
  if (!fs.existsSync(path.join(folderPath, "_common.yml"))) {
    fs.writeFileSync(path.join(folderPath, "_common.yml"), commonYml);
    createdFiles.push("_common.yml");
    markFileAsModified(`${relFolder}/_common.yml`, author);
  }
  if (!skipEn && !fs.existsSync(path.join(folderPath, "en.yml"))) {
    fs.writeFileSync(path.join(folderPath, "en.yml"), enYml);
    createdFiles.push("en.yml");
    markFileAsModified(`${relFolder}/en.yml`, author);
  }
  if (!skipEs && !fs.existsSync(path.join(folderPath, "es.yml"))) {
    fs.writeFileSync(path.join(folderPath, "es.yml"), esYml);
    createdFiles.push("es.yml");
    markFileAsModified(`${relFolder}/es.yml`, author);
  }

  refreshSitemapEntriesForContentKey(type, folderSlug, getSupportedLocales().filter(l => !skipLocales.includes(l)));
  contentIndex.refresh();
  invalidateContentCaches(type);

  const localesToValidate3 = getSupportedLocales().filter(l => !skipLocales.includes(l));
  for (const locale of localesToValidate3) {
    const { error: validationError } = contentIndex.loadMergedContent(type, folderSlug, locale);
    if (validationError) {
      fs.rmSync(folderPath, { recursive: true, force: true });
      contentIndex.refresh();
      return { success: false, statusCode: 400, error: formatValidationError(type, validationError) };
    }
  }

  return {
    success: true,
    data: {
      success: true, slugEn: enSlug, slugEs: esSlug, type,
      directory: `${rootName}/${getFolder(type)}/${folderSlug}`,
      files: createdFiles,
      skippedLocales: skipLocales.length > 0 ? skipLocales : undefined,
    },
  };
}
