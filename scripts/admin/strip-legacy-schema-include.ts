/**
 * strip-legacy-schema-include.ts
 *
 * Removes dead legacy `schema.include` (and empty `schema` / org overrides) from
 * all YAML under a content root, and ensures the configured home page has leading
 * WebSite + Organization `schema_org` sections prefilled from schema-org.yml.
 *
 * Usage:
 *   npx tsx scripts/admin/strip-legacy-schema-include.ts [contentRoot] [--dry-run]
 *
 * Examples:
 *   npx tsx scripts/admin/strip-legacy-schema-include.ts site_4geeks-com --dry-run
 *   npx tsx scripts/admin/strip-legacy-schema-include.ts site_4geeks-com
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import yaml from "js-yaml";
import { glob } from "glob";
import {
  escapeObjectVars,
  escapeTemplateVars,
  unescapeObjectVars,
  unescapeYamlDump,
} from "../../shared/templateVars";
import { markFileAsModified } from "../../server/sync-state";
import {
  getOrganizationTemplateProperties,
  getWebsiteTemplateProperties,
} from "../../server/schema-org";
import { getHomePage, getSupportedLocales } from "../../server/settings";
import {
  clampSchemaOrgSectionsLeading,
  getSchemaOrgType,
  isSchemaOrgSection,
  schemaOrgInsertIndex,
} from "../../shared/schema-org-sections";

const CONTENT_ROOT_DEFAULT = "site_4geeks-com";
const AUTHOR = "strip-legacy-schema-include";

const SECTION_ID_WEBSITE = "schema-org-website";
const SECTION_ID_ORGANIZATION = "schema-org-organization";

export interface StripLegacySchemaIncludeOptions {
  contentRoot?: string;
  dryRun?: boolean;
}

export interface StripLegacySchemaIncludeResultItem {
  id: string;
  src?: string;
  status: string;
  reason?: string;
  kind?: "strip" | "home-ensure";
}

export interface StripLegacySchemaIncludeResult {
  message: string;
  results: StripLegacySchemaIncludeResultItem[];
  strippedCount: number;
  homeEnsuredCount: number;
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

function resolveContentRoot(contentRoot?: string): { abs: string; folder: string } {
  const folder = contentRoot || CONTENT_ROOT_DEFAULT;
  const abs = path.isAbsolute(folder) ? folder : path.join(process.cwd(), folder);
  return { abs, folder: path.relative(process.cwd(), abs) || folder };
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Strip include entirely + organization overrides; remove empty schema. */
function stripLegacySchema(doc: YamlDoc): boolean {
  const schema = doc.schema;
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return false;

  const schemaObj = schema as YamlDoc;
  let changed = false;

  if ("include" in schemaObj) {
    delete schemaObj.include;
    changed = true;
  }

  if (schemaObj.overrides && typeof schemaObj.overrides === "object" && !Array.isArray(schemaObj.overrides)) {
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

function hasSchemaOrgOfTypeOrId(
  sections: unknown[],
  schemaType: string,
  sectionId: string,
): boolean {
  for (const s of sections) {
    if (!isSchemaOrgSection(s)) continue;
    const sec = s as Record<string, unknown>;
    if (sec.section_id === sectionId) return true;
    if (getSchemaOrgType(sec) === schemaType) return true;
  }
  return false;
}

function buildHomeSchemaSection(
  schemaType: "WebSite" | "Organization",
  sectionId: string,
  properties: Record<string, unknown>,
): YamlDoc {
  return {
    type: "schema_org",
    version: "1.0",
    section_id: sectionId,
    schema_type: schemaType,
    properties: deepClone(properties),
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

function localeFromHomeFilename(filename: string, supported: string[]): string | null {
  // Only exact locale files: en.yml / es.yml (not home-new-programs.en.yml)
  const base = filename.replace(/\.(yml|yaml)$/i, "");
  if (supported.includes(base)) return base;
  return null;
}

export async function stripLegacySchemaInclude(
  options: StripLegacySchemaIncludeOptions = {},
): Promise<StripLegacySchemaIncludeResult> {
  const dryRun = options.dryRun ?? false;
  const { abs: contentAbs, folder: contentRootFolder } = resolveContentRoot(options.contentRoot);

  if (!fs.existsSync(contentAbs)) {
    return {
      message: `Content root not found: ${contentRootFolder}`,
      results: [],
      strippedCount: 0,
      homeEnsuredCount: 0,
      skippedCount: 0,
      errorCount: 1,
    };
  }

  const results: StripLegacySchemaIncludeResultItem[] = [];
  let strippedCount = 0;
  let homeEnsuredCount = 0;
  let skippedCount = 0;
  let errorCount = 0;

  const files = await glob("**/*.{yml,yaml}", {
    cwd: contentAbs,
    absolute: true,
    nodir: true,
    ignore: [
      "**/node_modules/**",
      "**/.cache/**",
      "**/component-registry/**",
      "**/.git/**",
    ],
  });

  for (const absPath of files.sort()) {
    const rel = path.relative(process.cwd(), absPath);
    try {
      const doc = loadYamlFile(absPath);
      if (!doc) {
        skippedCount++;
        results.push({
          id: rel,
          src: rel,
          status: "skipped",
          reason: "not a YAML object",
          kind: "strip",
        });
        continue;
      }

      const changed = stripLegacySchema(doc);
      if (!changed) {
        continue;
      }

      writeAndMark(absPath, doc, contentRootFolder, dryRun);
      strippedCount++;
      results.push({
        id: rel,
        src: rel,
        status: dryRun ? "would-strip" : "stripped",
        kind: "strip",
      });
    } catch (err: any) {
      errorCount++;
      results.push({
        id: rel,
        src: rel,
        status: "error",
        reason: err?.message || "unknown",
        kind: "strip",
      });
    }
  }

  // Phase 2: ensure home WebSite + Organization sections
  try {
    const home = getHomePage(contentRootFolder);
    const contentType = home.type || "page";
    const slug = home.slug || "home";
    const supported = getSupportedLocales(contentRootFolder);
    const folderName =
      contentType === "page"
        ? "pages"
        : contentType.endsWith("s")
          ? contentType
          : `${contentType}s`;
    const homeDir = path.join(contentAbs, folderName, slug);

    if (!fs.existsSync(homeDir)) {
      errorCount++;
      results.push({
        id: `${folderName}/${slug}`,
        status: "error",
        reason: `home directory missing: ${path.relative(process.cwd(), homeDir)}`,
        kind: "home-ensure",
      });
    } else {
      const homeFiles = fs
        .readdirSync(homeDir)
        .filter((n) => n.endsWith(".yml") || n.endsWith(".yaml"))
        .filter((n) => !n.startsWith("_"))
        .sort();

      for (const filename of homeFiles) {
        const locale = localeFromHomeFilename(filename, supported);
        if (!locale) {
          // Skip experiment variants like home-new-programs.en.yml under pages/home/
          skippedCount++;
          results.push({
            id: path.join(folderName, slug, filename),
            status: "skipped",
            reason: "not a primary home locale file",
            kind: "home-ensure",
          });
          continue;
        }

        const absPath = path.join(homeDir, filename);
        const rel = path.relative(process.cwd(), absPath);

        try {
          const doc = loadYamlFile(absPath);
          if (!doc) {
            skippedCount++;
            results.push({
              id: rel,
              src: rel,
              status: "skipped",
              reason: "not a YAML object",
              kind: "home-ensure",
            });
            continue;
          }

          let sections = Array.isArray(doc.sections)
            ? ([...doc.sections] as YamlDoc[])
            : [];

          const websiteProps = getWebsiteTemplateProperties(locale, contentRootFolder);
          const orgProps = getOrganizationTemplateProperties(locale, contentRootFolder);

          if (!websiteProps || !orgProps) {
            errorCount++;
            results.push({
              id: rel,
              src: rel,
              status: "error",
              reason: "schema-org.yml missing website or organization template",
              kind: "home-ensure",
            });
            continue;
          }

          const added: string[] = [];
          let changed = false;

          if (!hasSchemaOrgOfTypeOrId(sections, "WebSite", SECTION_ID_WEBSITE)) {
            const idx = schemaOrgInsertIndex(sections);
            sections.splice(
              idx,
              0,
              buildHomeSchemaSection("WebSite", SECTION_ID_WEBSITE, websiteProps),
            );
            added.push("WebSite");
            changed = true;
          }

          if (!hasSchemaOrgOfTypeOrId(sections, "Organization", SECTION_ID_ORGANIZATION)) {
            const idx = schemaOrgInsertIndex(sections);
            sections.splice(
              idx,
              0,
              buildHomeSchemaSection("Organization", SECTION_ID_ORGANIZATION, orgProps),
            );
            added.push("Organization");
            changed = true;
          }

          if (changed) {
            sections = clampSchemaOrgSectionsLeading(sections) as YamlDoc[];
            const websiteSec = sections.find(
              (s) =>
                isSchemaOrgSection(s) &&
                (getSchemaOrgType(s as Record<string, unknown>) === "WebSite" ||
                  (s as YamlDoc).section_id === SECTION_ID_WEBSITE),
            );
            const orgSec = sections.find(
              (s) =>
                isSchemaOrgSection(s) &&
                (getSchemaOrgType(s as Record<string, unknown>) === "Organization" ||
                  (s as YamlDoc).section_id === SECTION_ID_ORGANIZATION),
            );
            const others = sections.filter((s) => s !== websiteSec && s !== orgSec);
            const leading = [websiteSec, orgSec].filter(Boolean) as YamlDoc[];
            doc.sections = [...leading, ...others];
            stripLegacySchema(doc);

            writeAndMark(absPath, doc, contentRootFolder, dryRun);
            homeEnsuredCount++;
            results.push({
              id: rel,
              src: rel,
              status: dryRun ? "would-ensure" : "ensured",
              reason: `added ${added.join(", ")}`,
              kind: "home-ensure",
            });
          } else {
            skippedCount++;
            results.push({
              id: rel,
              src: rel,
              status: "skipped",
              reason: "WebSite and Organization sections already present",
              kind: "home-ensure",
            });
          }
        } catch (err: any) {
          errorCount++;
          results.push({
            id: rel,
            src: rel,
            status: "error",
            reason: err?.message || "unknown",
            kind: "home-ensure",
          });
        }
      }
    }
  } catch (err: any) {
    errorCount++;
    results.push({
      id: "home-ensure",
      status: "error",
      reason: err?.message || "unknown",
      kind: "home-ensure",
    });
  }

  const message = dryRun
    ? `Dry run: would strip ${strippedCount} file(s), ensure home on ${homeEnsuredCount} file(s); ${skippedCount} skipped; ${errorCount} error(s).`
    : `Stripped ${strippedCount} file(s), ensured home on ${homeEnsuredCount} file(s); ${skippedCount} skipped; ${errorCount} error(s).`;

  return {
    message,
    results,
    strippedCount,
    homeEnsuredCount,
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

  stripLegacySchemaInclude({ contentRoot, dryRun })
    .then((result) => {
      for (const r of result.results) {
        const prefix =
          r.status === "error" ? "[ERR]" : r.status === "skipped" ? "[SKIP]" : "[OK]";
        const detail = r.reason ? ` — ${r.reason}` : "";
        console.log(`  ${prefix}  ${r.id}: ${r.status}${detail}`);
      }
      console.log("");
      console.log(
        `Done. stripped=${result.strippedCount}, homeEnsured=${result.homeEnsuredCount}, skipped=${result.skippedCount}, errors=${result.errorCount}`,
      );
      console.log(result.message);
      if (result.errorCount > 0 && result.strippedCount + result.homeEnsuredCount === 0) {
        process.exit(1);
      }
    })
    .catch((err) => {
      console.error("Failed:", err);
      process.exit(1);
    });
}
