#!/usr/bin/env tsx
/**
 * Backfill blog main_seo_keyword (if empty), cluster_keyword, and cluster_url
 * from keyword-cluster-priorities.csv. Slug match is case-insensitive.
 *
 * Usage:
 *   npx tsx scripts/admin/backfill-blog-cluster-keywords.ts          # dry run
 *   npx tsx scripts/admin/backfill-blog-cluster-keywords.ts --write  # apply
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const DEFAULT_CSV = path.join(process.cwd(), "keyword-cluster-priorities.csv");
const BLOG_ROOT = path.join(process.cwd(), "site_4geeks-com", "blog");

export interface BackfillBlogClusterOptions {
  csvPath?: string;
  blogRoot?: string;
  dryRun?: boolean;
}

export interface BackfillResultItem {
  id: string;
  src?: string;
  status: string;
  reason?: string;
  oldSrc?: string;
  newSrc?: string;
}

export interface BackfillBlogClusterResult {
  message: string;
  remappedCount: number;
  skippedCount: number;
  errorCount: number;
  results: BackfillResultItem[];
}

interface CsvRow {
  clusterKeyword: string;
  clusterSlug: string;
  locale: string;
  clusterUrl: string;
  secondaryKeyword: string;
}

interface Assignment {
  folder: string;
  locale: string;
  filePath: string;
  clusterKeyword: string;
  clusterUrl: string;
  seoFromSlug: string;
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ",") {
      row.push(field);
      field = "";
      continue;
    }
    if (ch === "\n") {
      if (field.endsWith("\r")) field = field.slice(0, -1);
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      continue;
    }
    field += ch;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.length > 1 || (r[0] ?? "").trim() !== "");
}

function csvLocaleToFileLocale(csvLocale: string): string {
  return csvLocale.trim().toLowerCase() === "us" ? "en" : csvLocale.trim().toLowerCase();
}

function slugToKeyword(slug: string): string {
  return slug.replace(/-/g, " ").trim();
}

function yamlScalar(value: string): string {
  if (value === "") return '""';
  if (
    /[:#{}[\],&*!|>'"%@`]/.test(value) ||
    value !== value.trim() ||
    /[\n\r]/.test(value) ||
    /^(true|false|null|~|\d+)$/i.test(value)
  ) {
    return JSON.stringify(value);
  }
  return value;
}

function readTopLevelScalar(content: string, key: string): string | null {
  const re = new RegExp(`^${key}:\\s*(.*)$`, "m");
  const m = content.match(re);
  if (!m) return null;
  let raw = m[1].trim();
  if (raw === "" || raw === "|" || raw === ">" || raw === "|-" || raw === ">-") return "";
  if (
    (raw.startsWith('"') && raw.endsWith('"')) ||
    (raw.startsWith("'") && raw.endsWith("'"))
  ) {
    raw = raw.slice(1, -1);
  }
  if (raw === "null" || raw === "~") return "";
  return raw;
}

function setTopLevelKey(content: string, key: string, value: string): string {
  const line = `${key}: ${yamlScalar(value)}`;
  const re = new RegExp(`^${key}:\\s*.*$`, "m");
  if (re.test(content)) return content.replace(re, line);
  const trimmed = content.endsWith("\n") ? content : `${content}\n`;
  return `${trimmed}${line}\n`;
}

function isEmptyKeyword(value: string | null): boolean {
  return value == null || value.trim() === "";
}

interface BlogIndex {
  byFolder: Map<string, string>;
  byLocaleSlug: Map<string, { folder: string; locale: string; filePath: string }>;
}

function buildBlogIndex(blogRoot: string): BlogIndex {
  const byFolder = new Map<string, string>();
  const byLocaleSlug = new Map<string, { folder: string; locale: string; filePath: string }>();
  if (!fs.existsSync(blogRoot)) return { byFolder, byLocaleSlug };

  const dirs = fs.readdirSync(blogRoot, { withFileTypes: true }).filter((d) => d.isDirectory());
  for (const dir of dirs) {
    byFolder.set(dir.name.toLowerCase(), dir.name);
    const folderPath = path.join(blogRoot, dir.name);
    const files = fs.readdirSync(folderPath).filter((f) => /^(en|es)\.ya?ml$/.test(f));
    for (const file of files) {
      const locale = file.replace(/\.ya?ml$/, "");
      const filePath = path.join(folderPath, file);
      const content = fs.readFileSync(filePath, "utf-8");
      const fileSlug = readTopLevelScalar(content, "slug") || dir.name;
      byLocaleSlug.set(`${locale}:${fileSlug.toLowerCase()}`, {
        folder: dir.name,
        locale,
        filePath,
      });
      byLocaleSlug.set(`${locale}:${dir.name.toLowerCase()}`, {
        folder: dir.name,
        locale,
        filePath,
      });
    }
  }
  return { byFolder, byLocaleSlug };
}

function resolveEntry(
  index: BlogIndex,
  blogRoot: string,
  locale: string,
  slug: string,
): { folder: string; locale: string; filePath: string } | null {
  const key = `${locale}:${slug.toLowerCase()}`;
  const hit = index.byLocaleSlug.get(key);
  if (hit) return hit;

  const folder = index.byFolder.get(slug.toLowerCase());
  if (!folder) return null;
  const filePath = path.join(blogRoot, folder, `${locale}.yml`);
  const alt = path.join(blogRoot, folder, `${locale}.yaml`);
  if (fs.existsSync(filePath)) return { folder, locale, filePath };
  if (fs.existsSync(alt)) return { folder, locale, filePath: alt };
  return null;
}

function loadCsvRows(csvPath: string): CsvRow[] {
  const rows = parseCsv(fs.readFileSync(csvPath, "utf-8"));
  const header = rows[0] ?? [];
  const idx = {
    clusterKeyword: header.indexOf("cluster_keyword"),
    clusterSlug: header.indexOf("cluster_slug"),
    locale: header.indexOf("locale"),
    clusterUrl: header.indexOf("cluster_url"),
    secondaryKeyword: header.indexOf("secondary_keyword"),
  };
  if (Object.values(idx).some((i) => i < 0)) {
    throw new Error("CSV missing required columns");
  }
  return rows.slice(1).map((row) => ({
    clusterKeyword: (row[idx.clusterKeyword] ?? "").trim(),
    clusterSlug: (row[idx.clusterSlug] ?? "").trim(),
    locale: (row[idx.locale] ?? "").trim(),
    clusterUrl: (row[idx.clusterUrl] ?? "").trim(),
    secondaryKeyword: (row[idx.secondaryKeyword] ?? "").trim(),
  }));
}

function collectAssignments(
  rows: CsvRow[],
  index: BlogIndex,
  blogRoot: string,
): { assignments: Assignment[]; warnings: string[]; unmatched: string[] } {
  const assignments = new Map<string, Assignment>();
  const warnings: string[] = [];
  const unmatched: string[] = [];

  const consider = (slug: string, row: CsvRow) => {
    if (!slug) return;
    const locale = csvLocaleToFileLocale(row.locale);
    const id = `${locale}:${slug.toLowerCase()}`;
    const entry = resolveEntry(index, blogRoot, locale, slug);
    if (!entry) {
      unmatched.push(id);
      return;
    }
    const existing = assignments.get(`${entry.locale}:${entry.folder.toLowerCase()}`);
    if (existing) {
      if (
        existing.clusterKeyword !== row.clusterKeyword ||
        existing.clusterUrl !== row.clusterUrl
      ) {
        warnings.push(
          `${entry.folder}/${entry.locale}: already assigned to "${existing.clusterKeyword}"; ignoring "${row.clusterKeyword}"`,
        );
      }
      return;
    }
    assignments.set(`${entry.locale}:${entry.folder.toLowerCase()}`, {
      folder: entry.folder,
      locale: entry.locale,
      filePath: entry.filePath,
      clusterKeyword: row.clusterKeyword,
      clusterUrl: row.clusterUrl,
      seoFromSlug: slugToKeyword(slug),
    });
  };

  for (const row of rows) {
    if (row.secondaryKeyword) consider(row.secondaryKeyword, row);
    if (row.clusterSlug) consider(row.clusterSlug, row);
  }

  return { assignments: [...assignments.values()], warnings, unmatched };
}

export async function backfillBlogClusterKeywords(
  options: BackfillBlogClusterOptions = {},
): Promise<BackfillBlogClusterResult> {
  const dryRun = options.dryRun ?? true;
  const csvPath = options.csvPath ?? DEFAULT_CSV;
  const blogRoot = options.blogRoot ?? BLOG_ROOT;
  const results: BackfillResultItem[] = [];
  let remappedCount = 0;
  let skippedCount = 0;
  let errorCount = 0;

  if (!fs.existsSync(csvPath)) {
    return {
      message: `CSV not found: ${csvPath}`,
      remappedCount: 0,
      skippedCount: 0,
      errorCount: 0,
      results: [],
    };
  }
  if (!fs.existsSync(blogRoot)) {
    return {
      message: `Blog root not found: ${blogRoot}`,
      remappedCount: 0,
      skippedCount: 0,
      errorCount: 0,
      results: [],
    };
  }

  const rows = loadCsvRows(csvPath);
  const index = buildBlogIndex(blogRoot);
  const { assignments, warnings } = collectAssignments(rows, index, blogRoot);

  for (const note of warnings) {
    results.push({
      id: note.split(":")[0] ?? note,
      status: "skipped",
      reason: note,
    });
  }

  for (const asg of assignments) {
    const id = `${asg.folder}/${asg.locale}.yml`;
    try {
      const original = fs.readFileSync(asg.filePath, "utf-8");
      let next = original;
      const existingSeo = readTopLevelScalar(original, "main_seo_keyword");
      const wroteSeo = isEmptyKeyword(existingSeo);
      if (wroteSeo) next = setTopLevelKey(next, "main_seo_keyword", asg.seoFromSlug);
      next = setTopLevelKey(next, "cluster_keyword", asg.clusterKeyword);
      next = setTopLevelKey(next, "cluster_url", asg.clusterUrl);

      const changed = next !== original;
      if (!changed) {
        skippedCount++;
        results.push({
          id,
          src: asg.filePath,
          status: dryRun ? "would-skip" : "skipped",
          reason: "already up to date",
        });
        continue;
      }

      if (!dryRun) fs.writeFileSync(asg.filePath, next, "utf-8");
      remappedCount++;
      results.push({
        id,
        src: asg.filePath,
        status: dryRun ? "would-remap" : "remapped",
        reason: wroteSeo
          ? `keyword + cluster (${asg.clusterKeyword})`
          : `cluster only; kept main_seo_keyword (${existingSeo})`,
        oldSrc: existingSeo ?? "",
        newSrc: asg.clusterUrl,
      });
    } catch (err) {
      errorCount++;
      results.push({
        id,
        src: asg.filePath,
        status: "error",
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    message: dryRun
      ? `Dry run: ${remappedCount} would update, ${skippedCount} skipped, ${errorCount} failed (${assignments.length} matched posts)`
      : `Wrote ${remappedCount} locale files, ${skippedCount} skipped, ${errorCount} failed (${assignments.length} matched posts)`,
    remappedCount,
    skippedCount,
    errorCount,
    results,
  };
}

const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] === __filename) {
  const args = process.argv.slice(2);
  const dryRun = !args.includes("--write");
  const csvPath = args.find((a) => a.startsWith("--csv="))?.slice("--csv=".length);

  backfillBlogClusterKeywords({ dryRun, csvPath })
    .then((result) => {
      for (const item of result.results) {
        if (item.status === "error") {
          console.log(`  [ERR]  ${item.id} — ${item.reason}`);
        } else if (item.status === "skipped" || item.status === "would-skip") {
          console.log(`  [SKIP] ${item.id} — ${item.reason ?? item.status}`);
        } else {
          console.log(`  [OK]   ${item.id} — ${item.reason}`);
        }
      }
      console.log(`\n${result.message}`);
      if (result.errorCount > 0) process.exitCode = 1;
    })
    .catch((err) => {
      console.error("Failed:", err);
      process.exit(1);
    });
}
