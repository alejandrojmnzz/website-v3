/**
 * FormState — per-site registry of form sections found across content YAMLs.
 *
 * Local file at {site}/.form-state.json, synced to GCS at
 * {site}/sync/form-state.json on every write (production only).
 */

import * as fs from "fs";
import * as path from "path";
import {
  formStateReadKeys,
  siteSyncGcsKey,
  SYNC_FILENAMES,
} from "@shared/gcsKeys";
import { gcs } from "./gcs";
import { safeYamlLoad } from "./routes/_helpers";
import { canonicalSectionId } from "./utils/sectionIdentity";
import { child } from "./logger";
import { getDefaultContentRoot, getSiteConfigs } from "./site-config";
const log = child({ module: "form-state" });

const IS_PRODUCTION = process.env.NODE_ENV === "production";

export interface FormStateEntry {
  file: string;
  content_type: string;
  slug: string;
  locale: string;
  section_id: string;
  section_type: string;
  /** Empty string when the form block has no conversion_name (flagged in the Leads UI). */
  conversion_name: string;
  automations?: string;
  tags?: string[];
  consent?: Record<string, unknown>;
  variant?: string;
}

interface FormState {
  forms: FormStateEntry[];
  conversion_names: Record<string, string[]>;
  known_automations: string[];
  known_tags: string[];
  last_built: string;
}

const stateBySite = new Map<string, FormState>();

function emptyFormState(): FormState {
  return {
    forms: [],
    conversion_names: {},
    known_automations: [],
    known_tags: [],
    last_built: new Date().toISOString(),
  };
}

function getSiteLocalPath(contentFolder: string): string {
  return path.join(process.cwd(), contentFolder, ".form-state.json");
}

function getSiteGcsKey(contentFolder: string): string {
  return siteSyncGcsKey(contentFolder, SYNC_FILENAMES.formState);
}

function getOrCreateSiteState(contentFolder: string): FormState {
  if (!stateBySite.has(contentFolder)) {
    stateBySite.set(contentFolder, emptyFormState());
  }
  return stateBySite.get(contentFolder)!;
}

function getAllForms(): FormStateEntry[] {
  const forms: FormStateEntry[] = [];
  for (const siteState of stateBySite.values()) {
    forms.push(...siteState.forms);
  }
  return forms;
}

function getAggregatedSuggestions(): { automations: string[]; tags: string[] } {
  const automations = new Set<string>();
  const tags = new Set<string>();
  for (const siteState of stateBySite.values()) {
    for (const a of siteState.known_automations) automations.add(a);
    for (const t of siteState.known_tags) tags.add(t);
  }
  return {
    automations: Array.from(automations).sort(),
    tags: Array.from(tags).sort(),
  };
}

function resolveSiteFromRelPath(relPath: string): string | null {
  for (const site of getSiteConfigs()) {
    const prefix = site.contentFolder.replace(/\/$/, "") + "/";
    if (relPath.startsWith(prefix)) return site.contentFolder;
  }
  return null;
}

function saveSiteLocal(contentFolder: string): void {
  const siteState = stateBySite.get(contentFolder);
  if (!siteState) return;
  try {
    const localPath = getSiteLocalPath(contentFolder);
    const dir = path.dirname(localPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(localPath, JSON.stringify(siteState, null, 2), "utf-8");
  } catch (err) {
    log.error({ err }, "[FormState] Error saving local file:");
  }
}

async function saveSiteToBucket(contentFolder: string): Promise<void> {
  if (!IS_PRODUCTION || !gcs.available) return;
  const siteState = stateBySite.get(contentFolder);
  if (!siteState) return;
  try {
    const content = JSON.stringify(siteState, null, 2);
    gcs.debouncedUpload(getSiteGcsKey(contentFolder), Buffer.from(content, "utf-8"), "application/json");
  } catch (err) {
    log.error({ err }, "[FormState] Error saving to GCS:");
  }
}

function saveSite(contentFolder: string): void {
  saveSiteLocal(contentFolder);
  saveSiteToBucket(contentFolder).catch((err) => {
    log.error({ err }, "[FormState] Background GCS save failed:");
  });
}

function rebuildIndexForSite(contentFolder: string): void {
  const siteState = getOrCreateSiteState(contentFolder);
  const index: Record<string, string[]> = {};
  const automationsSet = new Set<string>();
  const tagsSet = new Set<string>();

  for (const entry of siteState.forms) {
    // Entries without a conversion_name are tracked for the Leads inventory
    // but excluded from the conversion-name index used by the Conversions page.
    if (entry.conversion_name) {
      if (!index[entry.conversion_name]) index[entry.conversion_name] = [];
      if (!index[entry.conversion_name].includes(entry.file)) {
        index[entry.conversion_name].push(entry.file);
      }
    }
    if (entry.automations) automationsSet.add(entry.automations);
    if (entry.tags) {
      for (const tag of entry.tags) {
        if (tag) tagsSet.add(tag);
      }
    }
  }

  siteState.conversion_names = index;
  siteState.known_automations = Array.from(automationsSet).sort();
  siteState.known_tags = Array.from(tagsSet).sort();
}

/** Walk every non-hidden .yml file under a directory */
function collectYmlFiles(dir: string, result: string[] = []): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return result;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectYmlFiles(fullPath, result);
    } else if (entry.isFile() && (entry.name.endsWith(".yml") || entry.name.endsWith(".yaml"))) {
      result.push(fullPath);
    }
  }
  return result;
}

function parseRelativePath(relPath: string): {
  content_type: string;
  slug: string;
  locale: string;
} | null {
  const parts = relPath.split("/");
  if (parts.length < 3) return null;
  const content_type = parts[0];
  const slug = parts[1];
  const filename = parts[parts.length - 1];
  const locale = filename.replace(/\.(yml|yaml)$/, "");
  return { content_type, slug, locale };
}

function blockFromRecord(
  record: Record<string, unknown>,
  variant: string | undefined,
): {
  conversion_name: string;
  automations?: string;
  tags: string[];
  consent?: Record<string, unknown>;
  variant?: string;
} {
  return {
    conversion_name: typeof record.conversion_name === "string" ? record.conversion_name : "",
    ...(typeof record.automations === "string" ? { automations: record.automations } : {}),
    tags: Array.isArray(record.tags)
      ? (record.tags as string[]).filter((t) => typeof t === "string")
      : [],
    ...(record.consent && typeof record.consent === "object" && !Array.isArray(record.consent)
      ? { consent: record.consent as Record<string, unknown> }
      : {}),
    variant,
  };
}

function extractFormBlocks(
  obj: unknown,
  sectionId: string,
  sectionType: string,
  variant: string | undefined,
  results: Array<{
    conversion_name: string;
    automations?: string;
    tags: string[];
    consent?: Record<string, unknown>;
    variant?: string;
  }>,
): void {
  if (!obj || typeof obj !== "object") return;

  if (Array.isArray(obj)) {
    for (const item of obj) extractFormBlocks(item, sectionId, sectionType, variant, results);
    return;
  }

  const record = obj as Record<string, unknown>;

  if (typeof record.conversion_name === "string") {
    results.push(blockFromRecord(record, variant));
    return;
  }

  for (const [key, value] of Object.entries(record)) {
    if (key === "form" && value && typeof value === "object" && !Array.isArray(value)) {
      // A `form:` block is a form even when it lacks conversion_name — record it
      // so the Leads inventory can flag the missing name.
      results.push(blockFromRecord(value as Record<string, unknown>, variant));
    } else {
      extractFormBlocks(value, sectionId, sectionType, variant, results);
    }
  }
}

/** Section types that are forms by nature, even without a nested `form:` block or conversion_name. */
const FORM_SECTION_TYPES = new Set(["lead_form"]);

function scanFile(absPath: string, contentDir: string): FormStateEntry[] {
  const relPath = path.relative(process.cwd(), absPath);
  const relToContent = path.relative(contentDir, absPath);
  const parsed = parseRelativePath(relToContent);
  if (!parsed) return [];

  let doc: unknown;
  try {
    const raw = fs.readFileSync(absPath, "utf-8");
    doc = safeYamlLoad(raw);
  } catch {
    return [];
  }

  if (!doc || typeof doc !== "object") return [];

  const record = doc as Record<string, unknown>;
  const sections = record.sections;
  if (!Array.isArray(sections)) return [];

  const entries: FormStateEntry[] = [];

  for (const section of sections) {
    if (!section || typeof section !== "object" || Array.isArray(section)) continue;
    const sec = section as Record<string, unknown>;
    const section_id = canonicalSectionId(sec) ?? "";
    const section_type = typeof sec.type === "string" ? sec.type : "";
    const variant = typeof sec.variant === "string" ? sec.variant : undefined;

    const formBlocks: Array<{
      conversion_name: string;
      automations?: string;
      tags: string[];
      consent?: Record<string, unknown>;
      variant?: string;
    }> = [];
    extractFormBlocks(sec, section_id, section_type, variant, formBlocks);

    // Form-type sections with no extracted block at all are still forms —
    // record them with an empty conversion_name so they surface in Leads.
    if (formBlocks.length === 0 && FORM_SECTION_TYPES.has(section_type)) {
      formBlocks.push({ conversion_name: "", tags: [], variant });
    }

    for (const block of formBlocks) {
      entries.push({
        file: relPath,
        content_type: parsed.content_type,
        slug: parsed.slug,
        locale: parsed.locale,
        section_id,
        section_type,
        conversion_name: block.conversion_name,
        ...(block.automations ? { automations: block.automations } : {}),
        ...(block.tags.length > 0 ? { tags: block.tags } : {}),
        ...(block.consent ? { consent: block.consent } : {}),
        ...(block.variant !== undefined ? { variant: block.variant } : {}),
      });
    }
  }

  return entries;
}

function buildSiteFormState(contentFolder: string): void {
  const siteDir = path.join(process.cwd(), contentFolder);
  const forms: FormStateEntry[] = [];
  for (const absPath of collectYmlFiles(siteDir)) {
    forms.push(...scanFile(absPath, siteDir));
  }
  stateBySite.set(contentFolder, {
    forms,
    conversion_names: {},
    known_automations: [],
    known_tags: [],
    last_built: new Date().toISOString(),
  });
  rebuildIndexForSite(contentFolder);
  saveSite(contentFolder);
}

/** Full rebuild by scanning all .yml files under all site content dirs. */
export function buildFormState(): void {
  const siteConfigs = getSiteConfigs();
  const sites = siteConfigs.length > 0
    ? siteConfigs.map((s) => s.contentFolder)
    : [path.relative(process.cwd(), getDefaultContentRoot())];

  for (const contentFolder of sites) {
    buildSiteFormState(contentFolder);
  }

  const totalForms = getAllForms().length;
  const totalNames = new Set(getAllForms().map((f) => f.conversion_name)).size;
  log.info(`[FormState] Built: ${totalForms} form entry(ies) across ${totalNames} conversion name(s)`);
}

export function updateFormStateForFile(relPath: string): void {
  const contentFolder = resolveSiteFromRelPath(relPath);
  if (!contentFolder) return;

  const prefix = contentFolder.replace(/\/$/, "") + "/";
  const fileRelToContent = relPath.slice(prefix.length);
  const absPath = path.join(process.cwd(), contentFolder, fileRelToContent);

  const siteState = getOrCreateSiteState(contentFolder);
  siteState.forms = siteState.forms.filter((e) => e.file !== relPath);

  if (fs.existsSync(absPath)) {
    const siteDir = path.join(process.cwd(), contentFolder);
    siteState.forms.push(...scanFile(absPath, siteDir));
  }

  rebuildIndexForSite(contentFolder);
  saveSite(contentFolder);
}

export async function loadFormStateFromBucket(): Promise<void> {
  const siteConfigs = getSiteConfigs();
  const defaultSite = siteConfigs[0]?.contentFolder ?? null;

  if (IS_PRODUCTION && gcs.available) {
    for (const site of siteConfigs) {
      const isDefault = site.contentFolder === defaultSite;
      try {
        const result = await gcs.downloadFirstExisting(
          formStateReadKeys(site.contentFolder, isDefault),
        );
        if (result) {
          stateBySite.set(site.contentFolder, JSON.parse(result.data.toString("utf-8")) as FormState);
          saveSiteLocal(site.contentFolder);
          log.info(`[FormState] Loaded cached form state from GCS for ${site.contentFolder}`);
        }
      } catch (err) {
        log.error({ err }, `[FormState] Error loading from GCS for ${site.contentFolder} — will rebuild:`);
      }
    }
  }

  buildFormState();
}

export interface ReuploadFormStateResult {
  success: boolean;
  uploaded: boolean;
  gcsKey: string;
  reason?: string;
}

/** Reload one site's form state from GCS (or local) into memory. */
export async function loadFormStateForSiteFromBucket(
  contentFolder: string,
): Promise<"gcs" | "local"> {
  const siteConfigs = getSiteConfigs();
  const defaultSite = siteConfigs[0]?.contentFolder ?? null;
  const isDefault = contentFolder === defaultSite;

  if (IS_PRODUCTION) {
    if (!gcs.available) gcs.initBootstrapFromEnv();
    if (gcs.available) {
      try {
        const result = await gcs.downloadFirstExisting(
          formStateReadKeys(contentFolder, isDefault),
        );
        if (result) {
          stateBySite.set(contentFolder, JSON.parse(result.data.toString("utf-8")) as FormState);
          saveSiteLocal(contentFolder);
          log.info(`[FormState] Reloaded form state from GCS for ${contentFolder}`);
          return "gcs";
        }
      } catch (err) {
        log.error({ err }, `[FormState] Error reloading from GCS for ${contentFolder}:`);
      }
    }
  }

  const localPath = getSiteLocalPath(contentFolder);
  if (fs.existsSync(localPath)) {
    try {
      stateBySite.set(contentFolder, JSON.parse(fs.readFileSync(localPath, "utf-8")) as FormState);
    } catch {
      getOrCreateSiteState(contentFolder);
    }
  } else {
    getOrCreateSiteState(contentFolder);
  }
  return "local";
}

/** Force-upload one site's form-state JSON to GCS immediately. */
export async function reuploadFormStateToBucket(
  contentFolder: string,
): Promise<ReuploadFormStateResult> {
  const gcsKey = getSiteGcsKey(contentFolder);

  if (!IS_PRODUCTION) {
    return {
      success: false,
      uploaded: false,
      gcsKey,
      reason: "GCS sync only runs in production (NODE_ENV=production).",
    };
  }

  if (!gcs.available) {
    gcs.initBootstrapFromEnv();
  }
  if (!gcs.available) {
    return {
      success: false,
      uploaded: false,
      gcsKey,
      reason: "GCS is unavailable — missing GCS_BUCKET_NAME or credentials.",
    };
  }

  const localPath = getSiteLocalPath(contentFolder);
  let content: string;
  if (stateBySite.has(contentFolder)) {
    saveSiteLocal(contentFolder);
    content = JSON.stringify(stateBySite.get(contentFolder), null, 2);
  } else if (fs.existsSync(localPath)) {
    content = fs.readFileSync(localPath, "utf-8");
  } else {
    return {
      success: false,
      uploaded: false,
      gcsKey,
      reason: "No local form-state file found to upload.",
    };
  }

  await gcs.upload(gcsKey, Buffer.from(content, "utf-8"), "application/json");
  log.info(`[FormState] Re-uploaded form state to GCS for ${contentFolder}`);
  return { success: true, uploaded: true, gcsKey };
}

export function getFormStateLocalPath(contentFolder: string): string {
  return getSiteLocalPath(contentFolder);
}

export function getConversionNameUsages(name: string): FormStateEntry[] {
  return getAllForms().filter((e) => e.conversion_name === name);
}

export function getConversionNameCounts(): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const entry of getAllForms()) {
    if (!entry.conversion_name) continue;
    counts[entry.conversion_name] = (counts[entry.conversion_name] ?? 0) + 1;
  }
  return counts;
}

/** All form entries across every site, including those missing a conversion_name. */
export function getAllFormEntries(): FormStateEntry[] {
  return getAllForms();
}

export function bulkReplaceConversionName(oldName: string, newName: string): number {
  let siteDirs: string[] = [];
  try {
    siteDirs = getSiteConfigs().map((s) => path.join(process.cwd(), s.contentFolder));
  } catch {
    siteDirs = [getDefaultContentRoot()];
  }
  if (siteDirs.length === 0) siteDirs = [getDefaultContentRoot()];

  let count = 0;
  for (const siteDir of siteDirs) {
    for (const absPath of collectYmlFiles(siteDir)) {
      let raw: string;
      try {
        raw = fs.readFileSync(absPath, "utf-8");
      } catch {
        continue;
      }

      const lines = raw.split("\n");
      let changed = false;
      const updatedLines = lines.map((line) => {
        const trimmed = line.trimStart();
        if (!trimmed.startsWith("conversion_name:")) return line;
        const rest = trimmed.slice("conversion_name:".length).trim();
        const unquoted = rest.replace(/^['"]|['"]$/g, "");
        if (unquoted !== oldName) return line;
        const indent = line.slice(0, line.length - trimmed.length);
        changed = true;
        return `${indent}conversion_name: ${newName}`;
      });

      if (changed) {
        fs.writeFileSync(absPath, updatedLines.join("\n"), "utf-8");
        count++;
      }
    }
  }

  for (const [contentFolder, siteState] of stateBySite.entries()) {
    for (const entry of siteState.forms) {
      if (entry.conversion_name === oldName) {
        entry.conversion_name = newName;
      }
    }
    rebuildIndexForSite(contentFolder);
    saveSite(contentFolder);
  }

  return count;
}

export function partialReplaceConversionNameBySection(
  targets: Array<{ file: string; section_id: string }>,
  oldName: string,
  newName: string,
): number {
  let siteDirs: string[] = [getDefaultContentRoot()];
  try {
    const cfgs = getSiteConfigs();
    if (cfgs.length > 0) siteDirs = cfgs.map((s) => path.join(process.cwd(), s.contentFolder));
  } catch { /* fallback */ }

  function resolveFilePath(file: string): { abs: string; contentDir: string } | null {
    const abs = path.resolve(process.cwd(), file);
    for (const dir of siteDirs) {
      if (abs.startsWith(dir + path.sep)) return { abs, contentDir: dir };
    }
    return null;
  }

  const byFile = new Map<string, Set<string>>();
  for (const { file, section_id } of targets) {
    if (path.isAbsolute(file) || file.includes("..")) continue;
    if (!file.endsWith(".yml") && !file.endsWith(".yaml")) continue;
    if (!resolveFilePath(file)) continue;
    if (!byFile.has(file)) byFile.set(file, new Set());
    byFile.get(file)!.add(section_id);
  }

  let filesChanged = 0;

  for (const [relPath, sectionIds] of byFile.entries()) {
    const resolved = resolveFilePath(relPath);
    if (!resolved) continue;
    const absPath = resolved.abs;
    let raw: string;
    try {
      raw = fs.readFileSync(absPath, "utf-8");
    } catch {
      continue;
    }

    const lines = raw.split("\n");
    let changed = false;
    let sectionsIndent = -1;
    let listItemIndent = -1;
    let currentSectionId: string | null = null;
    let inTargetSection = false;
    let idSeen = false;

    const updatedLines = lines.map((line) => {
      const rawTrimmed = line.trimStart();
      const currentIndent = line.length - rawTrimmed.length;
      const trimmed = rawTrimmed.trimEnd();

      if (trimmed === "" || trimmed.startsWith("#")) return line;

      if (currentIndent === 0 && (trimmed === "sections:" || trimmed.startsWith("sections: "))) {
        sectionsIndent = currentIndent;
        listItemIndent = -1;
        currentSectionId = null;
        inTargetSection = false;
        idSeen = false;
        return line;
      }

      if (sectionsIndent >= 0) {
        if (currentIndent <= sectionsIndent && trimmed !== "" && !trimmed.startsWith("#")) {
          sectionsIndent = -1;
          listItemIndent = -1;
          currentSectionId = null;
          inTargetSection = false;
          idSeen = false;
        } else if (trimmed.startsWith("- ")) {
          if (listItemIndent === -1 || currentIndent === listItemIndent) {
            listItemIndent = currentIndent;
            currentSectionId = null;
            inTargetSection = false;
            idSeen = false;
            const afterDash = trimmed.startsWith("- ") ? trimmed.slice(2).trimStart() : "";
            if (afterDash.startsWith("id:")) {
              const val = afterDash.slice(3).trim().replace(/^['"]|['"]$/g, "");
              currentSectionId = val;
              inTargetSection = sectionIds.has(val);
              idSeen = true;
            }
            return line;
          }
        }

        if (!idSeen && trimmed.startsWith("id:")) {
          const val = trimmed.slice(3).trim().replace(/^['"]|['"]$/g, "");
          currentSectionId = val;
          inTargetSection = sectionIds.has(val);
          idSeen = true;
          return line;
        }

        if (inTargetSection && trimmed.startsWith("conversion_name:")) {
          const rest = trimmed.slice("conversion_name:".length).trim();
          const unquoted = rest.replace(/^['"]|['"]$/g, "");
          if (unquoted === oldName) {
            changed = true;
            return `${" ".repeat(currentIndent)}conversion_name: ${newName}`;
          }
        }
      }

      return line;
    });

    if (changed) {
      fs.writeFileSync(absPath, updatedLines.join("\n"), "utf-8");
      filesChanged++;
    }
  }

  const targetKey = new Set(targets.map(({ file, section_id }) => `${file}::${section_id}`));
  for (const [contentFolder, siteState] of stateBySite.entries()) {
    let siteChanged = false;
    for (const entry of siteState.forms) {
      if (
        targetKey.has(`${entry.file}::${entry.section_id}`) &&
        entry.conversion_name === oldName
      ) {
        entry.conversion_name = newName;
        siteChanged = true;
      }
    }
    if (siteChanged) {
      rebuildIndexForSite(contentFolder);
      saveSite(contentFolder);
    }
  }

  return filesChanged;
}

export function getFormStateSuggestions(): { automations: string[]; tags: string[] } {
  return getAggregatedSuggestions();
}
