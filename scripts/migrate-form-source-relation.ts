/**
 * Migrate lead-form program fields to source.relation (landings) or source.name (pages).
 *
 * Landings (CT has editor.programs relation):
 *   - Collect defaults/slugs from forms → write programs: [...] on _common.yml
 *   - Set fields.program.source.relation: programs; drop visible/default/slugs when replaced
 *
 * Pages (no programs relation):
 *   - If hardcoded default (not auto) or visible catalog → source.name: program
 *   - Leave default: auto alone
 *
 * Run: npx tsx scripts/migrate-form-source-relation.ts
 */
import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import {
  escapeTemplateVars,
  unescapeObjectVars,
  escapeObjectVars,
  unescapeYamlDump,
} from "../shared/templateVars";

const CONTENT_ROOT = "site_4geeks-com";
const ROOT = path.join(process.cwd(), CONTENT_ROOT);

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function loadYaml(filePath: string): Record<string, unknown> | null {
  if (!fs.existsSync(filePath)) return null;
  const raw = fs.readFileSync(filePath, "utf-8");
  try {
    const { escaped, map } = escapeTemplateVars(raw);
    const data = yaml.load(escaped);
    if (!isPlainObject(data)) return null;
    return unescapeObjectVars(data, map) as Record<string, unknown>;
  } catch (e) {
    console.warn("skip unreadable", filePath, (e as Error).message);
    return null;
  }
}

function dumpYaml(data: Record<string, unknown>): string {
  const { escaped, map } = escapeObjectVars(data);
  const dumped = yaml.dump(escaped, {
    lineWidth: -1,
    noRefs: true,
    quotingType: '"',
    forceQuotes: false,
    sortKeys: false,
  });
  return unescapeYamlDump(dumped, map);
}

type ProgramHit = {
  defaults: string[];
  slugs: string[];
  hadVisibleTrue: boolean;
  hadSource: boolean;
};

function walkForms(
  node: unknown,
  onForm: (form: Record<string, unknown>) => void,
): void {
  if (!isPlainObject(node)) return;
  if (isPlainObject(node.fields) && (node.fields as Record<string, unknown>).program != null) {
    onForm(node);
  }
  for (const v of Object.values(node)) {
    if (Array.isArray(v)) {
      for (const item of v) walkForms(item, onForm);
    } else if (isPlainObject(v)) {
      walkForms(v, onForm);
    }
  }
}

function collectProgramHits(doc: Record<string, unknown>): ProgramHit {
  const hit: ProgramHit = {
    defaults: [],
    slugs: [],
    hadVisibleTrue: false,
    hadSource: false,
  };
  walkForms(doc, (form) => {
    const fields = form.fields as Record<string, unknown>;
    const program = fields.program;
    if (!isPlainObject(program)) return;
    if (program.source != null) {
      hit.hadSource = true;
      return;
    }
    if (program.visible === true) hit.hadVisibleTrue = true;
    if (typeof program.default === "string" && program.default.trim() && program.default !== "auto") {
      hit.defaults.push(program.default.trim());
    }
    if (Array.isArray(program.slugs)) {
      for (const s of program.slugs) {
        if (typeof s === "string" && s.trim()) hit.slugs.push(s.trim());
      }
    }
  });
  return hit;
}

function migrateFormProgram(
  form: Record<string, unknown>,
  mode: "relation" | "catalog",
  opts?: { forceRelation?: boolean },
): boolean {
  const fields = form.fields as Record<string, unknown>;
  const program = fields.program;
  if (!isPlainObject(program)) return false;
  if (program.source != null) return false;

  const hasDefault =
    typeof program.default === "string" &&
    program.default.trim() &&
    program.default !== "auto";
  const hasSlugs =
    Array.isArray(program.slugs) &&
    program.slugs.some((s) => typeof s === "string" && s.trim());
  const visibleTrue = program.visible === true;

  if (mode === "relation") {
    if (!opts?.forceRelation && !hasDefault && !hasSlugs) {
      return false;
    }
    const next: Record<string, unknown> = { ...program };
    delete next.slugs;
    delete next.default;
    delete next.visible;
    delete next.required;
    next.source = { relation: "programs" };
    fields.program = next;
    return true;
  }

  // catalog (pages): only when hardcoded default or explicitly visible list
  if (hasDefault || visibleTrue || hasSlugs) {
    const next: Record<string, unknown> = { ...program };
    delete next.slugs;
    if (hasDefault) delete next.default;
    next.source = { name: "program" };
    fields.program = next;
    return true;
  }
  return false;
}

function migrateDocForms(
  doc: Record<string, unknown>,
  mode: "relation" | "catalog",
  opts?: { forceRelation?: boolean },
): number {
  let n = 0;
  walkForms(doc, (form) => {
    if (migrateFormProgram(form, mode, opts)) n += 1;
  });
  return n;
}

function listEntryDirs(typeDir: string): string[] {
  const abs = path.join(ROOT, typeDir);
  if (!fs.existsSync(abs)) return [];
  return fs
    .readdirSync(abs, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith("_"))
    .map((d) => d.name);
}

function localeFiles(entryDir: string): string[] {
  return fs
    .readdirSync(entryDir)
    .filter(
      (f) =>
        (f.endsWith(".yml") || f.endsWith(".yaml")) &&
        f !== "_common.yml" &&
        !f.startsWith("_"),
    )
    .map((f) => path.join(entryDir, f));
}

const changedFiles: string[] = [];

function writeIfChanged(filePath: string, data: Record<string, unknown>, before: string) {
  const next = dumpYaml(data);
  if (next === before) return;
  fs.writeFileSync(filePath, next, "utf-8");
  const rel = path.relative(process.cwd(), filePath).split(path.sep).join("/");
  changedFiles.push(rel);
}

// --- Landings ---
for (const slug of listEntryDirs("landings")) {
  const entryDir = path.join(ROOT, "landings", slug);
  const commonPath = path.join(entryDir, "_common.yml");
  const common = loadYaml(commonPath) || { slug };
  const beforeCommon = fs.existsSync(commonPath)
    ? fs.readFileSync(commonPath, "utf-8")
    : "";

  const pointers = new Set<string>();
  if (Array.isArray(common.programs)) {
    for (const p of common.programs) {
      if (typeof p === "string" && p.trim()) pointers.add(p.trim());
      else if (isPlainObject(p) && typeof p.slug === "string") pointers.add(p.slug.trim());
    }
  }

  const localeDocs: Array<{ file: string; before: string; doc: Record<string, unknown> }> = [];
  for (const file of localeFiles(entryDir)) {
    const before = fs.readFileSync(file, "utf-8");
    const doc = loadYaml(file);
    if (!doc) continue;
    const hits = collectProgramHits(doc);
    for (const d of hits.defaults) pointers.add(d);
    for (const s of hits.slugs) pointers.add(s);
    localeDocs.push({ file, before, doc });
  }

  if (pointers.size === 0) continue;

  common.programs = Array.from(pointers);
  writeIfChanged(commonPath, common, beforeCommon);

  for (const { file, before, doc } of localeDocs) {
    const n = migrateDocForms(doc, "relation", { forceRelation: true });
    if (n > 0) writeIfChanged(file, doc, before);
  }
}

// --- Pages ---
for (const slug of listEntryDirs("pages")) {
  const entryDir = path.join(ROOT, "pages", slug);
  for (const file of localeFiles(entryDir)) {
    const before = fs.readFileSync(file, "utf-8");
    const doc = loadYaml(file);
    if (!doc) continue;
    const n = migrateDocForms(doc, "catalog");
    if (n > 0) writeIfChanged(file, doc, before);
  }
}

console.log(`Migrated ${changedFiles.length} files`);
for (const f of changedFiles.slice(0, 30)) console.log(" ", f);
if (changedFiles.length > 30) console.log(`  ... and ${changedFiles.length - 30} more`);
