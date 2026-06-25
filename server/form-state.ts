/**
 * FormState — registry of form sections found across content YAMLs.
 *
 * Local file at 4geeks-com/.form-state.json, synced to GCS
 * at sync/form-state.json on every write (production only).
 *
 * Follows the same pattern as server/user-store.ts.
 */

import * as fs from "fs";
import * as path from "path";
import { gcs } from "./gcs";
import { safeYamlLoad } from "./routes/_helpers";
import { child } from "./logger";
const log = child({ module: "form-state" });



const LOCAL_PATH = path.join(
  process.cwd(),
  process.env.CONTENT_FOLDER || "content",
  ".form-state.json"
);
const GCS_KEY = "sync/form-state.json";
const CONTENT_DIR = path.join(process.cwd(), process.env.CONTENT_FOLDER || "content");
const IS_PRODUCTION = process.env.NODE_ENV === "production";

export interface FormStateEntry {
  file: string;
  content_type: string;
  slug: string;
  locale: string;
  section_id: string;
  section_type: string;
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

let state: FormState = {
  forms: [],
  conversion_names: {},
  known_automations: [],
  known_tags: [],
  last_built: new Date().toISOString(),
};

// ─── Persistence ────────────────────────────────────────────────────────────

function saveLocal(): void {
  try {
    const dir = path.dirname(LOCAL_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(LOCAL_PATH, JSON.stringify(state, null, 2), "utf-8");
  } catch (err) {
    log.error({ err: err }, "[FormState] Error saving local file:");
  }
}

async function saveToBucket(): Promise<void> {
  if (!IS_PRODUCTION || !gcs.available) return;
  try {
    const content = JSON.stringify(state, null, 2);
    gcs.debouncedUpload(GCS_KEY, Buffer.from(content, "utf-8"), "application/json");
  } catch (err) {
    log.error({ err: err }, "[FormState] Error saving to GCS:");
  }
}

function save(): void {
  saveLocal();
  saveToBucket().catch((err) => {
    log.error({ err: err }, "[FormState] Background GCS save failed:");
  });
}

// ─── YAML scanning ───────────────────────────────────────────────────────────

/** Walk every non-hidden .yml file under 4geeks-com/ */
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

/**
 * Parse a relative file path into content_type / slug / locale components.
 * Relative path format: <content_type>/<slug>/<locale>.yml  (or _common.yml)
 */
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

/** Recursively search an object for `form` blocks containing `conversion_name`. */
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
  }>
): void {
  if (!obj || typeof obj !== "object") return;

  if (Array.isArray(obj)) {
    for (const item of obj) extractFormBlocks(item, sectionId, sectionType, variant, results);
    return;
  }

  const record = obj as Record<string, unknown>;

  // If this object is a form block with conversion_name
  if (typeof record.conversion_name === "string") {
    results.push({
      conversion_name: record.conversion_name,
      ...(typeof record.automations === "string" ? { automations: record.automations } : {}),
      tags: Array.isArray(record.tags)
        ? (record.tags as string[]).filter((t) => typeof t === "string")
        : [],
      ...(record.consent && typeof record.consent === "object" && !Array.isArray(record.consent)
        ? { consent: record.consent as Record<string, unknown> }
        : {}),
      variant,
    });
    return;
  }

  for (const [key, value] of Object.entries(record)) {
    if (key === "form" && value && typeof value === "object" && !Array.isArray(value)) {
      const formObj = value as Record<string, unknown>;
      if (typeof formObj.conversion_name === "string") {
        results.push({
          conversion_name: formObj.conversion_name,
          ...(typeof formObj.automations === "string" ? { automations: formObj.automations } : {}),
          tags: Array.isArray(formObj.tags)
            ? (formObj.tags as string[]).filter((t) => typeof t === "string")
            : [],
          ...(formObj.consent && typeof formObj.consent === "object" && !Array.isArray(formObj.consent)
            ? { consent: formObj.consent as Record<string, unknown> }
            : {}),
          variant,
        });
      }
    } else {
      extractFormBlocks(value, sectionId, sectionType, variant, results);
    }
  }
}

/** Scan a single YAML file and return all FormStateEntries found in it. */
function scanFile(absPath: string): FormStateEntry[] {
  const relPath = path.relative(CONTENT_DIR, absPath);
  const parsed = parseRelativePath(relPath);
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
    const section_id = typeof sec.id === "string" ? sec.id : "";
    const section_type = typeof sec.type === "string" ? sec.type : "";
    const variant = typeof sec.variant === "string" ? sec.variant : undefined;

    const formBlocks: Array<{ conversion_name: string; automations?: string; tags: string[]; consent?: Record<string, unknown>; variant?: string }> = [];
    extractFormBlocks(sec, section_id, section_type, variant, formBlocks);

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

/** Rebuild conversion_names index and known_automations/known_tags from the forms array. */
function rebuildIndex(): void {
  const index: Record<string, string[]> = {};
  const automationsSet = new Set<string>();
  const tagsSet = new Set<string>();

  for (const entry of state.forms) {
    if (!index[entry.conversion_name]) index[entry.conversion_name] = [];
    if (!index[entry.conversion_name].includes(entry.file)) {
      index[entry.conversion_name].push(entry.file);
    }
    if (entry.automations) automationsSet.add(entry.automations);
    if (entry.tags) {
      for (const tag of entry.tags) {
        if (tag) tagsSet.add(tag);
      }
    }
  }

  state.conversion_names = index;
  state.known_automations = Array.from(automationsSet).sort();
  state.known_tags = Array.from(tagsSet).sort();
}

// ─── Public API ──────────────────────────────────────────────────────────────

/** Full rebuild by scanning all .yml files under 4geeks-com/. */
export function buildFormState(): void {
  const allFiles = collectYmlFiles(CONTENT_DIR);
  const forms: FormStateEntry[] = [];

  for (const absPath of allFiles) {
    const entries = scanFile(absPath);
    forms.push(...entries);
  }

  state = {
    forms,
    conversion_names: {},
    known_automations: [],
    known_tags: [],
    last_built: new Date().toISOString(),
  };
  rebuildIndex();
  save();

  log.info(`[FormState] Built: ${forms.length} form entry(ies) across ${Object.keys(state.conversion_names).length} conversion name(s)`);
}

/**
 * Incremental update: removes all existing entries for the given file,
 * re-scans just that file, and saves.
 */
export function updateFormStateForFile(relPath: string): void {
  if (!relPath.startsWith("4geeks-com/")) return;

  const fileRelToContent = relPath.slice("4geeks-com/".length);
  const absPath = path.join(CONTENT_DIR, fileRelToContent);

  // Remove existing entries for this file
  state.forms = state.forms.filter((e) => e.file !== fileRelToContent);

  // Re-scan if file still exists
  if (fs.existsSync(absPath)) {
    const newEntries = scanFile(absPath);
    state.forms.push(...newEntries);
  }

  rebuildIndex();
  save();
}

/**
 * Startup: in production + GCS, download the cached copy first, then rebuild
 * from YAMLs. In dev or without GCS, just rebuild.
 */
export async function loadFormStateFromBucket(): Promise<void> {
  if (IS_PRODUCTION && gcs.available) {
    try {
      const exists = await gcs.exists(GCS_KEY);
      if (exists) {
        const data = await gcs.download(GCS_KEY);
        if (data) {
          state = JSON.parse(data.toString("utf-8")) as FormState;
          saveLocal();
          log.info("[FormState] Loaded cached form state from GCS");
        }
      }
    } catch (err) {
      log.error({ err: err }, "[FormState] Error loading from GCS — will rebuild:");
    }
  }

  // Always rebuild from YAMLs to ensure accuracy
  buildFormState();
}

/** Returns all form entries matching a conversion name. */
export function getConversionNameUsages(name: string): FormStateEntry[] {
  return state.forms.filter((e) => e.conversion_name === name);
}

/** Returns a count of form section entries per conversion name. */
export function getConversionNameCounts(): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const entry of state.forms) {
    counts[entry.conversion_name] = (counts[entry.conversion_name] ?? 0) + 1;
  }
  return counts;
}

/**
 * Bulk-replace every occurrence of `oldName` with `newName` in all scanned
 * YAML files, then refresh the in-memory form-state cache.
 * Returns the number of files that were modified.
 */
export function bulkReplaceConversionName(oldName: string, newName: string): number {
  const allFiles = collectYmlFiles(CONTENT_DIR);
  let count = 0;

  for (const absPath of allFiles) {
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

  for (const entry of state.forms) {
    if (entry.conversion_name === oldName) {
      entry.conversion_name = newName;
    }
  }
  rebuildIndex();
  save();

  return count;
}

/**
 * Section-aware partial replace: replaces `conversion_name` only within the
 * specific YAML sections identified by (file, section_id) pairs.
 *
 * Uses a line-by-line state machine to track which section each
 * `conversion_name:` line belongs to, so a file with multiple sections sharing
 * the same conversion name is updated only for the targeted sections.
 *
 * Two layers of path security:
 *   1. Caller (route) validates entries against the server's own usage index.
 *   2. This function also rejects absolute paths, ".." traversal, non-YAML
 *      extensions, and paths that resolve outside CONTENT_DIR.
 *
 * Returns the number of files that were actually modified.
 */
export function partialReplaceConversionNameBySection(
  targets: Array<{ file: string; section_id: string }>,
  oldName: string,
  newName: string
): number {
  // Group target section_ids by file, with path validation
  const byFile = new Map<string, Set<string>>();
  for (const { file, section_id } of targets) {
    if (path.isAbsolute(file) || file.includes("..")) continue;
    if (!file.endsWith(".yml") && !file.endsWith(".yaml")) continue;
    const abs = path.resolve(path.join(CONTENT_DIR, file));
    if (!abs.startsWith(CONTENT_DIR + path.sep)) continue;
    if (!byFile.has(file)) byFile.set(file, new Set());
    byFile.get(file)!.add(section_id);
  }

  let filesChanged = 0;

  for (const [relPath, sectionIds] of byFile.entries()) {
    const absPath = path.join(CONTENT_DIR, relPath);
    let raw: string;
    try {
      raw = fs.readFileSync(absPath, "utf-8");
    } catch {
      continue;
    }

    const lines = raw.split("\n");
    let changed = false;

    // State machine
    // sectionsIndent: indent level of the root `sections:` key (-1 = not found yet)
    // listItemIndent: indent level of section list items (-1 = not set yet)
    // currentSectionId: id of the section we are currently traversing
    // inTargetSection: whether currentSectionId is in our target set
    // idSeen: have we seen the `id:` field for the current section item yet
    let sectionsIndent = -1;
    let listItemIndent = -1;
    let currentSectionId: string | null = null;
    let inTargetSection = false;
    let idSeen = false;

    const updatedLines = lines.map((line) => {
      const rawTrimmed = line.trimStart();
      const currentIndent = line.length - rawTrimmed.length;
      const trimmed = rawTrimmed.trimEnd();

      // Skip blank lines and YAML comments — preserve state
      if (trimmed === "" || trimmed.startsWith("#")) return line;

      // Detect the root-level `sections:` key
      if (
        currentIndent === 0 &&
        (trimmed === "sections:" || trimmed.startsWith("sections: "))
      ) {
        sectionsIndent = currentIndent;
        listItemIndent = -1;
        currentSectionId = null;
        inTargetSection = false;
        idSeen = false;
        return line;
      }

      if (sectionsIndent >= 0) {
        // Exiting the sections block: root-level non-list key
        if (currentIndent <= sectionsIndent && !trimmed.startsWith("- ") && trimmed !== "-") {
          sectionsIndent = -1;
          currentSectionId = null;
          inTargetSection = false;
          return line;
        }

        // New section list item — only at the established list-item indent
        const isListItem = trimmed.startsWith("- ") || trimmed === "-";
        if (isListItem) {
          if (listItemIndent === -1) listItemIndent = currentIndent;

          if (currentIndent === listItemIndent) {
            // Start of a new section
            currentSectionId = null;
            inTargetSection = false;
            idSeen = false;

            // id might be on the same line: `- id: foo`
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

        // Inside a section: capture the `id:` field if we haven't seen it yet
        if (!idSeen && trimmed.startsWith("id:")) {
          const val = trimmed.slice(3).trim().replace(/^['"]|['"]$/g, "");
          currentSectionId = val;
          inTargetSection = sectionIds.has(val);
          idSeen = true;
          return line;
        }

        // Replace `conversion_name` only within targeted sections
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

  // Update in-memory form state for targeted (file, section_id) pairs only
  const targetKey = new Set(targets.map(({ file, section_id }) => `${file}::${section_id}`));
  for (const entry of state.forms) {
    if (
      targetKey.has(`${entry.file}::${entry.section_id}`) &&
      entry.conversion_name === oldName
    ) {
      entry.conversion_name = newName;
    }
  }
  rebuildIndex();
  save();

  return filesChanged;
}

/** Returns known automations and tags across all form entries (for autocomplete). */
export function getFormStateSuggestions(): { automations: string[]; tags: string[] } {
  return {
    automations: state.known_automations,
    tags: state.known_tags,
  };
}
