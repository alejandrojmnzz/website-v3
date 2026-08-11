/**
 * migrate-schema-org-to-sections.ts
 *
 * Migrates legacy schema-org.yml catalogs (courses / local_business) into
 * leading `schema_org` sections on program and location YAML, then slims
 * schema-org.yml to organization + website only.
 *
 * Usage:
 *   npx tsx scripts/admin/migrate-schema-org-to-sections.ts [contentRoot] [--dry-run]
 *
 * Examples:
 *   npx tsx scripts/admin/migrate-schema-org-to-sections.ts site_4geeks-com --dry-run
 *   npx tsx scripts/admin/migrate-schema-org-to-sections.ts site_4geeks-com
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import yaml from "js-yaml";
import {
  escapeObjectVars,
  escapeTemplateVars,
  unescapeObjectVars,
  unescapeYamlDump,
} from "../../shared/templateVars";
import { markFileAsModified } from "../../server/sync-state";
import {
  buildLocalBusinessProperties,
} from "../../server/schema-org-seed";

const CONTENT_ROOT_DEFAULT = "site_4geeks-com";
const AUTHOR = "migrate-schema-org-to-sections";

const PROGRAM_STRIP_INCLUDES = new Set(["organization", "website"]);
const LOCATION_STRIP_INCLUDES = new Set(["organization", "website", "local_business"]);

export interface MigrateSchemaOrgOptions {
  contentRoot?: string;
  dryRun?: boolean;
}

export interface MigrateSchemaOrgResultItem {
  id: string;
  src?: string;
  status: string;
  reason?: string;
  kind?: "program" | "location" | "schema-org" | "registry";
}

export interface MigrateSchemaOrgResult {
  message: string;
  results: MigrateSchemaOrgResultItem[];
  programFilesChanged: number;
  locationFilesChanged: number;
  schemaOrgSlimmed: boolean;
  registryMarked: number;
  skippedCount: number;
  errorCount: number;
}

type YamlDoc = Record<string, unknown>;

function dumpYaml(data: unknown): string {
  const { escaped, map } = escapeObjectVars(data);
  const dumped = yaml.dump(escaped, {
    lineWidth: 120,
    noRefs: true,
    sortKeys: false,
    quotingType: '"',
    forceQuotes: false,
  });
  const out = unescapeYamlDump(dumped, map);
  return out.endsWith("\n") ? out : `${out}\n`;
}

function loadYamlFile(filePath: string): YamlDoc | null {
  const raw = fs.readFileSync(filePath, "utf-8");
  const { escaped, map } = escapeTemplateVars(raw);
  const parsed = yaml.load(escaped);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  return unescapeObjectVars(parsed, map) as YamlDoc;
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function withoutType(entry: Record<string, unknown>): Record<string, unknown> {
  const { type: _type, ...rest } = entry;
  return rest;
}

function resolveContentRoot(contentRoot?: string): { abs: string; folder: string } {
  const folder = contentRoot || CONTENT_ROOT_DEFAULT;
  const abs = path.isAbsolute(folder) ? folder : path.join(process.cwd(), folder);
  return { abs, folder: path.relative(process.cwd(), abs) || folder };
}

function listImmediateDirs(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith("."))
    .map((d) => d.name)
    .sort();
}

function listYamlFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"))
    .sort();
}

function isLocaleLikeYaml(filename: string): boolean {
  if (filename.startsWith("_")) return false;
  if (filename === "versioning.yml" || filename === "versioning.yaml") return false;
  if (filename === "ecommerce.yml" || filename === "ecommerce.yaml") return false;
  return filename.endsWith(".yml") || filename.endsWith(".yaml");
}

function getIncludeList(doc: YamlDoc | null | undefined): string[] {
  const schema = doc?.schema;
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return [];
  const include = (schema as YamlDoc).include;
  if (!Array.isArray(include)) return [];
  return include.filter((x): x is string => typeof x === "string");
}

function findCourseSlugFromIncludes(includes: string[]): string | null {
  for (const key of includes) {
    if (key.startsWith("courses:")) return key.slice("courses:".length);
  }
  return null;
}

function shouldStripProgramInclude(key: string): boolean {
  return PROGRAM_STRIP_INCLUDES.has(key) || key.startsWith("courses:");
}

function shouldStripLocationInclude(key: string): boolean {
  return LOCATION_STRIP_INCLUDES.has(key) || key.startsWith("local_business:");
}

/** Strip include keys / overrides; remove empty schema. Returns whether doc changed. */
function stripSchemaBlock(
  doc: YamlDoc,
  shouldStripInclude: (key: string) => boolean,
  stripOrganizationOverrides: boolean,
): boolean {
  const schema = doc.schema;
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return false;

  const schemaObj = schema as YamlDoc;
  let changed = false;

  if (Array.isArray(schemaObj.include)) {
    const before = schemaObj.include as unknown[];
    const after = before.filter((k) => typeof k !== "string" || !shouldStripInclude(k));
    if (after.length !== before.length) {
      changed = true;
      if (after.length === 0) delete schemaObj.include;
      else schemaObj.include = after;
    }
  }

  if (stripOrganizationOverrides && schemaObj.overrides && typeof schemaObj.overrides === "object") {
    const overrides = schemaObj.overrides as YamlDoc;
    if ("organization" in overrides) {
      delete overrides.organization;
      changed = true;
    }
    if (Object.keys(overrides).length === 0) {
      delete schemaObj.overrides;
      changed = true;
    }
  }

  if (Object.keys(schemaObj).length === 0) {
    delete doc.schema;
    changed = true;
  }

  return changed;
}

function hasMatchingCourseSection(sections: unknown[], courseSlug: string): boolean {
  const wantId = `schema-org-course-${courseSlug}`;
  for (const s of sections) {
    if (!s || typeof s !== "object") continue;
    const sec = s as YamlDoc;
    if (sec.type !== "schema_org") continue;
    if (sec.section_id === wantId) return true;
    if (sec.schema_type === "Course") return true;
  }
  return false;
}

function hasLocalBusinessSection(sections: unknown[]): boolean {
  for (const s of sections) {
    if (!s || typeof s !== "object") continue;
    const sec = s as YamlDoc;
    if (sec.type !== "schema_org") continue;
    if (sec.schema_type === "LocalBusiness") return true;
    if (
      typeof sec.section_id === "string" &&
      sec.section_id.startsWith("schema-org-local-business-")
    ) {
      return true;
    }
  }
  return false;
}

function buildCourseSection(courseSlug: string, catalogEntry: Record<string, unknown>): YamlDoc {
  return {
    type: "schema_org",
    version: "1.0",
    section_id: `schema-org-course-${courseSlug}`,
    schema_type: "Course",
    properties: withoutType(deepClone(catalogEntry)),
  };
}

function writeAndMark(
  absPath: string,
  doc: YamlDoc,
  contentRootFolder: string,
  dryRun: boolean,
): void {
  if (dryRun) return;
  fs.writeFileSync(absPath, dumpYaml(doc), "utf-8");
  markFileAsModified(absPath, AUTHOR, undefined, contentRootFolder);
}

function markDeletedRegistryPaths(
  contentAbs: string,
  contentRootFolder: string,
  dryRun: boolean,
  results: MigrateSchemaOrgResultItem[],
): number {
  const prefixes = ["component-registry/faq", "component-registry/breadcrumb"];
  let marked = 0;

  const syncStatePath = path.join(contentAbs, ".sync-state.json");
  if (!fs.existsSync(syncStatePath)) return 0;

  let state: { files?: Record<string, unknown> };
  try {
    state = JSON.parse(fs.readFileSync(syncStatePath, "utf-8"));
  } catch {
    return 0;
  }

  const files = state.files || {};
  for (const key of Object.keys(files)) {
    const rel = key.startsWith(`${contentRootFolder}/`)
      ? key.slice(contentRootFolder.length + 1)
      : key;
    const matches = prefixes.some((p) => rel === p || rel.startsWith(`${p}/`));
    if (!matches) continue;

    const abs = path.join(contentAbs, rel);
    if (fs.existsSync(abs)) {
      results.push({
        id: key,
        src: key,
        status: "skipped",
        reason: "registry path still exists on disk",
        kind: "registry",
      });
      continue;
    }

    if (!dryRun) {
      markFileAsModified(abs, AUTHOR, undefined, contentRootFolder);
    }
    results.push({
      id: key,
      src: key,
      status: dryRun ? "would-mark-deleted" : "marked-deleted",
      kind: "registry",
    });
    marked++;
  }

  return marked;
}

export async function migrateSchemaOrgToSections(
  options: MigrateSchemaOrgOptions = {},
): Promise<MigrateSchemaOrgResult> {
  const dryRun = options.dryRun ?? false;
  const { abs: contentAbs, folder: contentRootFolder } = resolveContentRoot(options.contentRoot);

  if (!fs.existsSync(contentAbs)) {
    return {
      message: `Content root not found: ${contentAbs}`,
      results: [],
      programFilesChanged: 0,
      locationFilesChanged: 0,
      schemaOrgSlimmed: false,
      registryMarked: 0,
      skippedCount: 0,
      errorCount: 1,
    };
  }

  const schemaOrgPath = path.join(contentAbs, "schema-org.yml");
  if (!fs.existsSync(schemaOrgPath)) {
    return {
      message: `schema-org.yml not found under ${contentRootFolder}`,
      results: [],
      programFilesChanged: 0,
      locationFilesChanged: 0,
      schemaOrgSlimmed: false,
      registryMarked: 0,
      skippedCount: 0,
      errorCount: 1,
    };
  }

  const results: MigrateSchemaOrgResultItem[] = [];
  let programFilesChanged = 0;
  let locationFilesChanged = 0;
  let skippedCount = 0;
  let errorCount = 0;
  let schemaOrgSlimmed = false;

  let schemaConfig: YamlDoc;
  try {
    schemaConfig = loadYamlFile(schemaOrgPath) || {};
  } catch (err: any) {
    return {
      message: `Failed to parse schema-org.yml: ${err?.message || err}`,
      results: [],
      programFilesChanged: 0,
      locationFilesChanged: 0,
      schemaOrgSlimmed: false,
      registryMarked: 0,
      skippedCount: 0,
      errorCount: 1,
    };
  }

  const coursesCatalog = (
    schemaConfig.courses && typeof schemaConfig.courses === "object"
      ? (schemaConfig.courses as Record<string, Record<string, unknown>>)
      : {}
  ) as Record<string, Record<string, unknown>>;

  const localBusinessCatalog = (
    schemaConfig.local_business && typeof schemaConfig.local_business === "object"
      ? (schemaConfig.local_business as Record<string, Record<string, unknown>>)
      : {}
  ) as Record<string, Record<string, unknown>>;

  const siteUrl =
    typeof (schemaConfig.organization as YamlDoc | undefined)?.url === "string"
      ? ((schemaConfig.organization as YamlDoc).url as string)
      : typeof (schemaConfig.website as YamlDoc | undefined)?.url === "string"
        ? ((schemaConfig.website as YamlDoc).url as string)
        : "https://4geeksacademy.com";

  // ── Programs ──────────────────────────────────────────────────────────────
  const programsDir = path.join(contentAbs, "programs");
  for (const programSlug of listImmediateDirs(programsDir)) {
    const programDir = path.join(programsDir, programSlug);
    const yamlFiles = listYamlFiles(programDir);
    const commonPath = path.join(programDir, "_common.yml");

    let commonDoc: YamlDoc | null = null;
    if (fs.existsSync(commonPath)) {
      try {
        commonDoc = loadYamlFile(commonPath);
      } catch (err: any) {
        results.push({
          id: `programs/${programSlug}/_common.yml`,
          status: "error",
          reason: err?.message || "parse failed",
          kind: "program",
        });
        errorCount++;
        continue;
      }
    }

    const commonCourse = findCourseSlugFromIncludes(getIncludeList(commonDoc));
    const courseByFile = new Map<string, string | null>();
    let programHasCourse = !!commonCourse;

    for (const filename of yamlFiles) {
      try {
        const d = loadYamlFile(path.join(programDir, filename));
        const c = findCourseSlugFromIncludes(getIncludeList(d));
        courseByFile.set(filename, c);
        if (c) programHasCourse = true;
      } catch {
        courseByFile.set(filename, null);
      }
    }

    if (!programHasCourse) continue;

    for (const filename of yamlFiles) {
      const absPath = path.join(programDir, filename);
      const relId = `programs/${programSlug}/${filename}`;
      try {
        const doc = loadYamlFile(absPath);
        if (!doc) {
          results.push({
            id: relId,
            status: "skipped",
            reason: "empty or invalid yaml",
            kind: "program",
          });
          skippedCount++;
          continue;
        }

        const preCourse = courseByFile.get(filename) || commonCourse;
        let changed = stripSchemaBlock(doc, shouldStripProgramInclude, false);

        let sectionError: string | undefined;
        if (isLocaleLikeYaml(filename) && Array.isArray(doc.sections) && preCourse) {
          const catalogEntry = coursesCatalog[preCourse];
          if (!catalogEntry) {
            sectionError = `course catalog missing for courses:${preCourse}`;
          } else if (!hasMatchingCourseSection(doc.sections as unknown[], preCourse)) {
            doc.sections = [buildCourseSection(preCourse, catalogEntry), ...(doc.sections as unknown[])];
            changed = true;
          }
        }

        if (sectionError) {
          results.push({
            id: relId,
            status: "error",
            reason: sectionError,
            kind: "program",
          });
          errorCount++;
          // Still persist include stripping if that part succeeded.
          if (changed) {
            writeAndMark(absPath, doc, contentRootFolder, dryRun);
            programFilesChanged++;
          }
          continue;
        }

        if (!changed) {
          results.push({
            id: relId,
            status: "skipped",
            reason: "no changes",
            kind: "program",
          });
          skippedCount++;
          continue;
        }

        writeAndMark(absPath, doc, contentRootFolder, dryRun);
        results.push({
          id: relId,
          src: relId,
          status: dryRun ? "would-migrate" : "migrated",
          kind: "program",
          reason: preCourse ? `course:${preCourse}` : undefined,
        });
        programFilesChanged++;
      } catch (err: any) {
        results.push({
          id: relId,
          status: "error",
          reason: err?.message || "unknown",
          kind: "program",
        });
        errorCount++;
      }
    }
  }

  // Strip shared programs/_common.single.yml organization/website includes.
  const programsCommonSingle = path.join(programsDir, "_common.single.yml");
  if (fs.existsSync(programsCommonSingle)) {
    try {
      const doc = loadYamlFile(programsCommonSingle);
      if (doc && stripSchemaBlock(doc, shouldStripProgramInclude, false)) {
        writeAndMark(programsCommonSingle, doc, contentRootFolder, dryRun);
        results.push({
          id: "programs/_common.single.yml",
          src: "programs/_common.single.yml",
          status: dryRun ? "would-migrate" : "migrated",
          kind: "program",
          reason: "stripped shared includes",
        });
        programFilesChanged++;
      }
    } catch (err: any) {
      results.push({
        id: "programs/_common.single.yml",
        status: "error",
        reason: err?.message || "unknown",
        kind: "program",
      });
      errorCount++;
    }
  }

  // ── Locations ─────────────────────────────────────────────────────────────
  const locationsDir = path.join(contentAbs, "locations");
  for (const locationSlug of listImmediateDirs(locationsDir)) {
    const locationDir = path.join(locationsDir, locationSlug);
    const commonPath = path.join(locationDir, "_common.yml");

    let region: string | undefined;
    let locationName = locationSlug;
    if (fs.existsSync(commonPath)) {
      try {
        const commonDoc = loadYamlFile(commonPath);
        if (commonDoc) {
          if (typeof commonDoc.region === "string") region = commonDoc.region;
          if (typeof commonDoc.name === "string") locationName = commonDoc.name;
          else if (typeof commonDoc.city === "string") locationName = commonDoc.city;
        }
      } catch (err: any) {
        results.push({
          id: `locations/${locationSlug}/_common.yml`,
          status: "error",
          reason: err?.message || "parse failed",
          kind: "location",
        });
        errorCount++;
      }
    }

    for (const filename of listYamlFiles(locationDir)) {
      const absPath = path.join(locationDir, filename);
      const relId = `locations/${locationSlug}/${filename}`;
      try {
        const doc = loadYamlFile(absPath);
        if (!doc) {
          results.push({
            id: relId,
            status: "skipped",
            reason: "empty or invalid yaml",
            kind: "location",
          });
          skippedCount++;
          continue;
        }

        const fileRegion = typeof doc.region === "string" ? doc.region : region;
        const fileName =
          typeof doc.name === "string"
            ? doc.name
            : typeof doc.city === "string"
              ? doc.city
              : locationName;

        let changed = stripSchemaBlock(doc, shouldStripLocationInclude, true);

        if (isLocaleLikeYaml(filename) && Array.isArray(doc.sections)) {
          if (!hasLocalBusinessSection(doc.sections as unknown[])) {
            const properties = buildLocalBusinessProperties({
              locationSlug,
              locationName: fileName,
              region: fileRegion,
              catalog: localBusinessCatalog,
              siteUrl,
            });
            doc.sections = [
              {
                type: "schema_org",
                version: "1.0",
                section_id: `schema-org-local-business-${locationSlug}`,
                schema_type: "LocalBusiness",
                properties,
              },
              ...(doc.sections as unknown[]),
            ];
            changed = true;
          }
        }

        if (!changed) {
          results.push({
            id: relId,
            status: "skipped",
            reason: "no changes",
            kind: "location",
          });
          skippedCount++;
          continue;
        }

        writeAndMark(absPath, doc, contentRootFolder, dryRun);
        results.push({
          id: relId,
          src: relId,
          status: dryRun ? "would-migrate" : "migrated",
          kind: "location",
        });
        locationFilesChanged++;
      } catch (err: any) {
        results.push({
          id: relId,
          status: "error",
          reason: err?.message || "unknown",
          kind: "location",
        });
        errorCount++;
      }
    }
  }

  // ── Slim schema-org.yml ───────────────────────────────────────────────────
  try {
    const slim: YamlDoc = {};
    if (schemaConfig.organization) slim.organization = schemaConfig.organization;
    if (schemaConfig.website) slim.website = schemaConfig.website;

    const hadExtra =
      "courses" in schemaConfig ||
      "item_lists" in schemaConfig ||
      "local_business" in schemaConfig;

    if (hadExtra || Object.keys(schemaConfig).some((k) => k !== "organization" && k !== "website")) {
      writeAndMark(schemaOrgPath, slim, contentRootFolder, dryRun);
      schemaOrgSlimmed = true;
      results.push({
        id: "schema-org.yml",
        src: "schema-org.yml",
        status: dryRun ? "would-slim" : "slimmed",
        kind: "schema-org",
        reason: "kept organization + website only",
      });
    } else {
      results.push({
        id: "schema-org.yml",
        status: "skipped",
        reason: "already slim",
        kind: "schema-org",
      });
      skippedCount++;
    }
  } catch (err: any) {
    results.push({
      id: "schema-org.yml",
      status: "error",
      reason: err?.message || "unknown",
      kind: "schema-org",
    });
    errorCount++;
  }

  const registryMarked = markDeletedRegistryPaths(
    contentAbs,
    contentRootFolder,
    dryRun,
    results,
  );

  const message = dryRun
    ? `Dry run: would change ${programFilesChanged} program file(s), ${locationFilesChanged} location file(s); schema-org ${schemaOrgSlimmed ? "would slim" : "unchanged"}; ${registryMarked} registry path(s); ${errorCount} error(s).`
    : `Migrated ${programFilesChanged} program file(s), ${locationFilesChanged} location file(s); schema-org ${schemaOrgSlimmed ? "slimmed" : "unchanged"}; marked ${registryMarked} deleted registry path(s); ${errorCount} error(s).`;

  return {
    message,
    results,
    programFilesChanged,
    locationFilesChanged,
    schemaOrgSlimmed,
    registryMarked,
    skippedCount,
    errorCount,
  };
}

const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] === __filename) {
  const args = process.argv.slice(2);
  const positional = args.filter((a) => !a.startsWith("--"));
  const flags = new Set(args.filter((a) => a.startsWith("--")));
  const dryRun = flags.has("--dry-run");
  const contentRoot = positional[0] || CONTENT_ROOT_DEFAULT;

  migrateSchemaOrgToSections({ contentRoot, dryRun })
    .then((result) => {
      for (const r of result.results) {
        const prefix =
          r.status === "error" ? "[ERR]" : r.status === "skipped" ? "[SKIP]" : "[OK]";
        const detail = r.reason ? ` — ${r.reason}` : "";
        console.log(`  ${prefix}  ${r.id}: ${r.status}${detail}`);
      }
      console.log("");
      console.log(
        `Done. programs=${result.programFilesChanged}, locations=${result.locationFilesChanged}, schemaOrgSlimmed=${result.schemaOrgSlimmed}, registryMarked=${result.registryMarked}, skipped=${result.skippedCount}, errors=${result.errorCount}`,
      );
      console.log(result.message);
      if (
        result.errorCount > 0 &&
        result.programFilesChanged + result.locationFilesChanged === 0 &&
        !result.schemaOrgSlimmed
      ) {
        process.exit(1);
      }
    })
    .catch((err) => {
      console.error("Failed:", err);
      process.exit(1);
    });
}
