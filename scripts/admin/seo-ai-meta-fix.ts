#!/usr/bin/env tsx
/**
 * SEO AI Meta Fix Script
 *
 * Reads all YAML content files, identifies DUPLICATE_TITLE, DUPLICATE_DESCRIPTION,
 * TITLE_TOO_LONG, DESCRIPTION_TOO_LONG, TITLE_TOO_SHORT, DESCRIPTION_TOO_SHORT issues
 * (for non-noindexed pages), and uses OpenRouter (via llm.yml) to generate unique,
 * properly-sized meta content. Writes corrections back to YAML files.
 *
 * Usage:
 *   npx tsx scripts/admin/seo-ai-meta-fix.ts          # dry run (log proposed changes)
 *   npx tsx scripts/admin/seo-ai-meta-fix.ts --write  # apply changes
 */

import * as fs from "fs";
import * as path from "path";
import OpenAI from "openai";
import * as yaml from "js-yaml";
import { globSync } from "glob";

const DRY_RUN = !process.argv.includes("--write");
const CONTENT_ROOT = path.join(process.cwd(), "site_4geeks-com");
const LLM_YML_PATH = path.join(CONTENT_ROOT, "llm.yml");
const DEFAULT_MODEL = "openai/gpt-4o-mini";
const OPENROUTER_DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";

function loadLlmConfig(): {
  apiKey: string;
  baseURL: string;
  model: string;
} {
  let apiKeyEnv = "OPENROUTER_API_KEY";
  let baseUrlEnv = "OPENROUTER_BASE_URL";
  let model = process.env.LLM_MODEL || DEFAULT_MODEL;

  try {
    if (fs.existsSync(LLM_YML_PATH)) {
      const cfg = yaml.load(fs.readFileSync(LLM_YML_PATH, "utf-8")) as {
        provider?: { api_key_env?: string; base_url_env?: string };
        model?: string | { default?: string };
      };
      if (cfg?.provider?.api_key_env) apiKeyEnv = cfg.provider.api_key_env;
      if (cfg?.provider?.base_url_env) baseUrlEnv = cfg.provider.base_url_env;
      if (!process.env.LLM_MODEL) {
        if (typeof cfg?.model === "string") model = cfg.model;
        else if (cfg?.model?.default) model = cfg.model.default;
      }
    }
  } catch {
    /* use defaults */
  }

  const apiKey = process.env[apiKeyEnv];
  if (!apiKey) {
    throw new Error(`LLM not configured. Please set ${apiKeyEnv} in environment.`);
  }

  const baseURL =
    process.env[baseUrlEnv] ||
    (baseUrlEnv === "OPENROUTER_BASE_URL" ? OPENROUTER_DEFAULT_BASE_URL : undefined) ||
    OPENROUTER_DEFAULT_BASE_URL;

  return { apiKey, baseURL, model };
}

const llm = loadLlmConfig();
const openai = new OpenAI({
  apiKey: llm.apiKey,
  baseURL: llm.baseURL,
});
const COMPLETION_MODEL = llm.model;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface PageInfo {
  filePath: string;
  relativePath: string;
  slug: string;
  locale: string;
  contentType: string;
  pageTitle?: string;
  description?: string;
  isNoindex: boolean;
}

interface PageFix {
  filePath: string;
  pageTitle?: string;
  description?: string;
}

/**
 * Extract a single-line meta field value using regex on raw file content.
 * Matches fields like `  field_name: some value here` at exactly 2-space indent.
 */
function extractMetaField(content: string, field: string): string | undefined {
  // Match the field at 2-space indent, capturing the rest of the line
  const re = new RegExp(`^  ${field}:[ \\t]*(.+)$`, "m");
  const match = content.match(re);
  return match ? match[1].trim().replace(/^["']|["']$/g, "") : undefined;
}

function readPageMeta(filePath: string): PageInfo {
  const content = fs.readFileSync(filePath, "utf-8");
  const relativePath = path.relative(CONTENT_ROOT, filePath);
  const parts = relativePath.split(path.sep);
  const contentType = parts[0];
  const slug = parts.length >= 2 ? parts[parts.length - 2] : parts[0];
  const locale = path.basename(filePath, ".yml");

  // Use regex to safely extract meta fields without full YAML parsing
  // This handles files with Jinja/template syntax that would break yaml.parse()
  const pageTitle = extractMetaField(content, "page_title");
  const description = extractMetaField(content, "description");
  const robots = extractMetaField(content, "robots") || "";
  const isNoindex = robots.includes("noindex");

  return {
    filePath,
    relativePath,
    slug,
    locale,
    contentType,
    pageTitle,
    description,
    isNoindex,
  };
}

function scanPages(): PageInfo[] {
  const files = globSync("**/*.yml", {
    cwd: CONTENT_ROOT,
    absolute: true,
    ignore: ["_common.single.yml", "**/_common.yml", "**/schema-org.yml"],
  });
  return files.map(readPageMeta);
}

interface Issues {
  needsNewTitle: boolean;
  needsNewDescription: boolean;
}

/**
 * Analyze all pages and return per-file issue flags.
 * For duplicate groups, all files in the group are flagged.
 */
function analyzeIssues(pages: PageInfo[]): Map<string, Issues> {
  const result = new Map<string, Issues>();
  const get = (fp: string): Issues => {
    if (!result.has(fp)) result.set(fp, { needsNewTitle: false, needsNewDescription: false });
    return result.get(fp)!;
  };

  const titleMap = new Map<string, string[]>();
  const descMap = new Map<string, string[]>();

  for (const p of pages) {
    if (p.isNoindex) continue;
    if (p.pageTitle) {
      const arr = titleMap.get(p.pageTitle) || [];
      arr.push(p.filePath);
      titleMap.set(p.pageTitle, arr);
      if (p.pageTitle.length > 60 || p.pageTitle.length < 30) get(p.filePath).needsNewTitle = true;
    }
    if (p.description) {
      const arr = descMap.get(p.description) || [];
      arr.push(p.filePath);
      descMap.set(p.description, arr);
      if (p.description.length > 160 || p.description.length < 70) get(p.filePath).needsNewDescription = true;
    }
  }

  titleMap.forEach((files) => {
    if (files.length > 1) files.forEach((f) => (get(f).needsNewTitle = true));
  });
  descMap.forEach((files) => {
    if (files.length > 1) files.forEach((f) => (get(f).needsNewDescription = true));
  });

  return result;
}

/**
 * Call AI to generate unique meta for a GROUP of related pages in one shot.
 * Returns a map from filePath -> {pageTitle, description}.
 */
async function generateMetaForGroup(
  pages: PageInfo[],
  issues: Map<string, Issues>,
  attempt = 0
): Promise<Map<string, PageFix>> {
  const items = pages.map((p, i) => {
    const iss = issues.get(p.filePath)!;
    return {
      index: i + 1,
      slug: p.slug,
      contentType: p.contentType,
      locale: p.locale,
      currentTitle: p.pageTitle || "(none)",
      currentDescription: p.description || "(none)",
      needsNewTitle: iss.needsNewTitle,
      needsNewDescription: iss.needsNewDescription,
    };
  });

  const lang = pages[0]?.locale === "es" ? "Spanish" : "English";
  const prompt = `You are an SEO specialist for 4Geeks Academy, a coding bootcamp offering AI Engineering, Full Stack Development, Data Science, and Cybersecurity programs.

Generate unique SEO meta content for the following ${pages.length} pages. Each page MUST have a completely different page_title and description from all the others in this group.

Pages:
${items.map((it) => `
Page ${it.index}:
  slug: ${it.slug}
  type: ${it.contentType}
  locale: ${it.locale}
  current_title: "${it.currentTitle}"
  current_description: "${it.currentDescription}"
  needs_new_title: ${it.needsNewTitle}
  needs_new_description: ${it.needsNewDescription}`).join("\n")}

Requirements for each page:
- page_title: 35-60 characters, must include "4Geeks" or "4Geeks Academy", unique across ALL pages in this group
- description: 80-155 characters, unique across ALL pages in this group
- Both must clearly reflect the page's specific topic (from its slug)
- Language: ${lang}
- For location pages: include the city/country name
- For program pages: include the specific program name
- CRITICAL: Every single page must have a DIFFERENT title and a DIFFERENT description from every other page

Respond with a JSON object with keys "1", "2", etc (matching page indices):
{"1": {"page_title": "...", "description": "..."}, "2": {"page_title": "...", "description": "..."}, ...}`;

  try {
    const response = await openai.chat.completions.create({
      model: COMPLETION_MODEL,
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      max_tokens: Math.max(600, pages.length * 200),
      temperature: 0.8,
    });

    const content = response.choices[0]?.message?.content || "{}";
    const parsed = JSON.parse(content) as Record<string, { page_title?: string; description?: string }>;

    const result = new Map<string, PageFix>();
    for (const p of pages) {
      const idx = String(items.find((i) => i.slug === p.slug)?.index || "");
      const fix = parsed[idx];
      if (fix?.page_title && fix?.description) {
        result.set(p.filePath, {
          filePath: p.filePath,
          pageTitle: fix.page_title.slice(0, 60).trim(),
          description: fix.description.slice(0, 160).trim(),
        });
      }
    }
    return result;
  } catch (err: unknown) {
    const error = err as { status?: number; message?: string };
    if (error?.status === 429 && attempt < 3) {
      console.log(`  [RATE LIMIT] Waiting 10s before retry...`);
      await sleep(10000);
      return generateMetaForGroup(pages, issues, attempt + 1);
    }
    console.error(`  [AI ERROR] Group generation failed: ${error?.message}`);
    return new Map();
  }
}

/**
 * For individual pages (no group, just length issues), generate meta solo.
 */
async function generateMetaSolo(page: PageInfo, issues: Issues, attempt = 0): Promise<PageFix | null> {
  const lang = page.locale === "es" ? "Spanish" : "English";
  const prompt = `You are an SEO specialist for 4Geeks Academy.

Fix the SEO meta for this page:
  slug: ${page.slug}
  type: ${page.contentType}
  locale: ${page.locale}
  current_title: "${page.pageTitle}"
  current_description: "${page.description}"
  needs_new_title: ${issues.needsNewTitle} (${issues.needsNewTitle ? "too long or short" : "no change"})
  needs_new_description: ${issues.needsNewDescription} (${issues.needsNewDescription ? "too long or short" : "no change"})

Requirements:
- page_title: 35-60 characters, include "4Geeks" or "4Geeks Academy"
- description: 80-155 characters, persuasive, specific to the topic
- Language: ${lang}
- If not flagged for change, keep the original value

Respond with: {"page_title": "...", "description": "..."}`;

  try {
    const response = await openai.chat.completions.create({
      model: COMPLETION_MODEL,
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      max_tokens: 300,
      temperature: 0.7,
    });

    const content = response.choices[0]?.message?.content || "{}";
    const fix = JSON.parse(content) as { page_title?: string; description?: string };

    if (!fix.page_title || !fix.description) return null;

    return {
      filePath: page.filePath,
      pageTitle: fix.page_title.slice(0, 60).trim(),
      description: fix.description.slice(0, 160).trim(),
    };
  } catch (err: unknown) {
    const error = err as { status?: number; message?: string };
    if (error?.status === 429 && attempt < 3) {
      await sleep(10000);
      return generateMetaSolo(page, issues, attempt + 1);
    }
    console.error(`  [AI ERROR] ${page.relativePath}: ${error?.message}`);
    return null;
  }
}

function updatePageTitle(content: string, newTitle: string): string {
  const singleLine = /^( {2}page_title:[ \t]*)(.+)$/m;
  return singleLine.test(content) ? content.replace(singleLine, `$1${newTitle}`) : content;
}

function updateDescription(content: string, newDesc: string): string {
  // Block scalar (>-, |-, etc.)
  const blockPattern = /^( {2}description:[ \t]*)([>|][+-]?)\n((?:[ \t]+.*\n?)*)/m;
  if (blockPattern.test(content)) {
    return content.replace(blockPattern, `$1${newDesc}\n`);
  }
  // Single-line
  const singleLine = /^( {2}description:[ \t]*)(.+)$/m;
  return singleLine.test(content) ? content.replace(singleLine, `$1${newDesc}`) : content;
}

function applyFix(page: PageInfo, fix: PageFix, issues: Issues): boolean {
  let content = fs.readFileSync(page.filePath, "utf-8");
  let changed = false;

  if (issues.needsNewTitle && fix.pageTitle) {
    const updated = updatePageTitle(content, fix.pageTitle);
    if (updated !== content) { content = updated; changed = true; }
  }
  if (issues.needsNewDescription && fix.description) {
    const updated = updateDescription(content, fix.description);
    if (updated !== content) { content = updated; changed = true; }
  }

  if (changed && !DRY_RUN) {
    fs.writeFileSync(page.filePath, content, "utf-8");
  }
  return changed;
}

async function main() {
  console.log(`Mode: ${DRY_RUN ? "DRY RUN (use --write to apply)" : "WRITE"}`);
  console.log("Scanning pages...\n");

  const pages = scanPages();
  const issueMap = analyzeIssues(pages);

  // Build groups: files that share the same duplicate title or description
  const titleGroupMap = new Map<string, Set<string>>(); // title -> set of filePaths
  const descGroupMap = new Map<string, Set<string>>();  // desc -> set of filePaths

  for (const p of pages) {
    if (p.isNoindex) continue;
    if (p.pageTitle) {
      if (!titleGroupMap.has(p.pageTitle)) titleGroupMap.set(p.pageTitle, new Set());
      titleGroupMap.get(p.pageTitle)!.add(p.filePath);
    }
    if (p.description) {
      if (!descGroupMap.has(p.description)) descGroupMap.set(p.description, new Set());
      descGroupMap.get(p.description)!.add(p.filePath);
    }
  }

  // Collect files that need fixing
  const toFix = new Set<string>();
  issueMap.forEach((issues, fp) => {
    if (issues.needsNewTitle || issues.needsNewDescription) toFix.add(fp);
  });

  if (toFix.size === 0) {
    console.log("No issues to fix!");
    return;
  }

  console.log(`Files to fix: ${toFix.size}\n`);

  // Build clusters: files that share title or description duplicates
  // Files in the same cluster should be processed together
  const fileToClusters = new Map<string, Set<string>>(); // filePath -> set of clustermates
  const getCluster = (fp: string) => {
    if (!fileToClusters.has(fp)) fileToClusters.set(fp, new Set([fp]));
    return fileToClusters.get(fp)!;
  };

  const mergeIntoCluster = (files: string[]) => {
    if (files.length <= 1) return;
    const primaryCluster = getCluster(files[0]);
    for (const fp of files.slice(1)) {
      const otherCluster = getCluster(fp);
      // Merge into primary
      otherCluster.forEach((f) => { primaryCluster.add(f); fileToClusters.set(f, primaryCluster); });
    }
  };

  titleGroupMap.forEach((fileSet) => {
    if (fileSet.size > 1) mergeIntoCluster([...fileSet].filter((f) => toFix.has(f)));
  });
  descGroupMap.forEach((fileSet) => {
    if (fileSet.size > 1) mergeIntoCluster([...fileSet].filter((f) => toFix.has(f)));
  });

  // Get unique clusters that have files to fix
  const processedClusters = new Set<Set<string>>();
  const clusters: PageInfo[][] = [];
  const soloPages: PageInfo[] = [];

  const pageByPath = new Map(pages.map((p) => [p.filePath, p]));

  toFix.forEach((fp) => {
    const cluster = fileToClusters.get(fp);
    if (!cluster) { soloPages.push(pageByPath.get(fp)!); return; }
    if (!processedClusters.has(cluster)) {
      processedClusters.add(cluster);
      const clusterPages = [...cluster]
        .filter((f) => toFix.has(f))
        .map((f) => pageByPath.get(f)!)
        .filter(Boolean);
      if (clusterPages.length > 1) clusters.push(clusterPages);
      else if (clusterPages.length === 1) soloPages.push(clusterPages[0]);
    }
  });

  console.log(`Groups to process: ${clusters.length} clusters + ${soloPages.length} solo pages\n`);

  let fixed = 0; let failed = 0;

  // Process clusters
  for (let i = 0; i < clusters.length; i++) {
    const group = clusters[i];
    console.log(`[Cluster ${i + 1}/${clusters.length}] ${group.length} pages with shared meta:`);
    group.forEach((p) => {
      const iss = issueMap.get(p.filePath)!;
      console.log(`  - ${p.relativePath} [title=${iss.needsNewTitle}, desc=${iss.needsNewDescription}]`);
    });

    const fixes = await generateMetaForGroup(group, issueMap);

    if (fixes.size === 0) {
      console.log(`  [FAILED] Could not generate meta for this cluster\n`);
      failed += group.length;
      continue;
    }

    for (const p of group) {
      const fix = fixes.get(p.filePath);
      if (!fix) { console.log(`  [SKIP] No fix generated for ${p.relativePath}`); failed++; continue; }
      const issues = issueMap.get(p.filePath)!;
      console.log(`  -> ${p.relativePath}`);
      if (issues.needsNewTitle) console.log(`     title: "${fix.pageTitle}" (${fix.pageTitle?.length} chars)`);
      if (issues.needsNewDescription) console.log(`     desc: "${fix.description}" (${fix.description?.length} chars)`);

      const changed = applyFix(p, fix, issues);
      if (!DRY_RUN && changed) console.log(`     [WRITTEN]`);
      else if (DRY_RUN) console.log(`     [DRY RUN]`);
      else console.log(`     [NO CHANGE - regex didn't match]`);
      fixed++;
    }
    console.log();
    await sleep(500);
  }

  // Process solo pages
  for (let i = 0; i < soloPages.length; i++) {
    const p = soloPages[i];
    const issues = issueMap.get(p.filePath)!;
    console.log(`[Solo ${i + 1}/${soloPages.length}] ${p.relativePath}`);

    const fix = await generateMetaSolo(p, issues);
    if (!fix) { console.log(`  [SKIP] Failed to generate\n`); failed++; continue; }

    if (issues.needsNewTitle) console.log(`  title: "${fix.pageTitle}" (${fix.pageTitle?.length} chars)`);
    if (issues.needsNewDescription) console.log(`  desc: "${fix.description}" (${fix.description?.length} chars)`);

    const changed = applyFix(p, fix, issues);
    if (!DRY_RUN && changed) console.log(`  [WRITTEN]`);
    else if (DRY_RUN) console.log(`  [DRY RUN]`);
    else console.log(`  [NO CHANGE - regex didn't match]`);
    fixed++;
    await sleep(200);
  }

  console.log(`\n--- Summary ---`);
  console.log(`Processed: ${fixed}`);
  console.log(`Failed: ${failed}`);
  if (DRY_RUN) console.log(`\nDry run — no files written. Run with --write to apply.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
