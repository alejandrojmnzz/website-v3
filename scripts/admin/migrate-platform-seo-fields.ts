#!/usr/bin/env tsx
/**
 * Surgical migrate of platform SEO fields:
 * - top-level main_seo_keyword → seo.main_keyword (if empty)
 * - nested seo.pillar → seo.pillar_path
 * - fail/log seo: / main_seo_keyword on _common.yml (do not move)
 * - cluster_keyword / cluster_url are removed by migrate-blog-cluster-to-seo.ts
 * - build seo-index.json from live locale files
 *
 * Usage:
 *   npx tsx scripts/admin/migrate-platform-seo-fields.ts
 *   npx tsx scripts/admin/migrate-platform-seo-fields.ts --write
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { getAllConfigs, getFolder, LEGACY_MAIN_SEO_KEYWORD_KEY } from "../../server/content-types";
import { getDefaultContentRoot } from "../../server/site-config";
import {
  migrateMainKeywordInYamlText,
  readTopLevelScalar,
  yamlHasSeoKey,
} from "../../server/seo-fields";
import { rebuildSeoIndex, SEO_INDEX_FILENAME } from "../../server/seo-index";

export interface MigratePlatformSeoOptions {
  contentRoot?: string;
  dryRun?: boolean;
}

export interface MigrateResultItem {
  id: string;
  src?: string;
  status: string;
  reason?: string;
}

export interface MigratePlatformSeoResult {
  message: string;
  remappedCount: number;
  skippedCount: number;
  errorCount: number;
  commonBlocked: number;
  indexBuilt: boolean;
  results: MigrateResultItem[];
}

const LIVE_LOCALE_FILE = /^[a-z]{2}\.ya?ml$/i;

function contentRootAbs(contentRoot?: string): string {
  const raw = contentRoot ?? getDefaultContentRoot();
  return path.isAbsolute(raw) ? raw : path.join(process.cwd(), raw);
}

export async function migratePlatformSeoFields(
  options: MigratePlatformSeoOptions = {},
): Promise<MigratePlatformSeoResult> {
  const dryRun = options.dryRun !== false;
  const root = contentRootAbs(options.contentRoot);
  const results: MigrateResultItem[] = [];
  let remappedCount = 0;
  let skippedCount = 0;
  let errorCount = 0;
  let commonBlocked = 0;

  const configs = getAllConfigs(options.contentRoot ?? root);
  for (const [contentType, cfg] of Object.entries(configs)) {
    const dirName = cfg.directory || getFolder(contentType, options.contentRoot ?? root);
    const typeDir = path.join(root, dirName);
    if (!fs.existsSync(typeDir)) continue;
    for (const slugEnt of fs.readdirSync(typeDir, { withFileTypes: true })) {
      if (!slugEnt.isDirectory() || slugEnt.name.startsWith("_")) continue;
      const slugDir = path.join(typeDir, slugEnt.name);
      const commonPath = path.join(slugDir, "_common.yml");
      if (fs.existsSync(commonPath)) {
        const commonText = fs.readFileSync(commonPath, "utf-8");
        const hasSeo = yamlHasSeoKey(commonText);
        const hasLegacy = readTopLevelScalar(commonText, LEGACY_MAIN_SEO_KEYWORD_KEY) != null;
        if (hasSeo || hasLegacy) {
          commonBlocked++;
          errorCount++;
          results.push({
            id: `${contentType}/${slugEnt.name}/_common.yml`,
            src: commonPath,
            status: "error",
            reason: "seo.* / main_seo_keyword on _common.yml — locale-only is required; not moved.",
          });
        }
      }
      for (const file of fs.readdirSync(slugDir)) {
        if (!LIVE_LOCALE_FILE.test(file)) continue;
        const abs = path.join(slugDir, file);
        const id = `${contentType}/${slugEnt.name}/${file}`;
        try {
          const original = fs.readFileSync(abs, "utf-8");
          const { text, moved } = migrateMainKeywordInYamlText(original);
          if (!moved) {
            skippedCount++;
            results.push({ id, src: abs, status: dryRun ? "would-skip" : "skipped", reason: "no legacy keys" });
            continue;
          }
          if (!dryRun) fs.writeFileSync(abs, text, "utf-8");
          remappedCount++;
          results.push({
            id,
            src: abs,
            status: dryRun ? "would-migrate" : "migrated",
            reason: "main_seo_keyword → seo.main_keyword and/or seo.pillar → seo.pillar_path",
          });
        } catch (err) {
          errorCount++;
          results.push({
            id,
            src: abs,
            status: "error",
            reason: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }
  }

  let indexBuilt = false;
  if (!dryRun) {
    rebuildSeoIndex({
      contentRoot: options.contentRoot ?? root,
      author: "agent",
      reason: "migrate-platform-seo-fields",
      mark: true,
    });
    indexBuilt = fs.existsSync(path.join(root, SEO_INDEX_FILENAME));
  }

  return {
    message: dryRun
      ? `Dry run: ${remappedCount} would migrate, ${skippedCount} skipped, ${errorCount} failed (${commonBlocked} _common.yml blocked)`
      : `Wrote ${remappedCount} locale files, ${skippedCount} skipped, ${errorCount} failed (${commonBlocked} _common.yml blocked); seo-index.json ${indexBuilt ? "built" : "missing"}`,
    remappedCount,
    skippedCount,
    errorCount,
    commonBlocked,
    indexBuilt,
    results,
  };
}

const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] === __filename) {
  const args = process.argv.slice(2);
  const dryRun = !args.includes("--write");
  migratePlatformSeoFields({ dryRun })
    .then((result) => {
      for (const item of result.results) {
        if (item.status === "error") {
          console.log("error", `  [ERR]  ${item.id} — ${item.reason}`);
        } else if (item.status === "skipped" || item.status === "would-skip") {
          continue;
        } else {
          console.log("migrated", `  [OK]   ${item.id} — ${item.reason}`);
        }
      }
      console.log("message", result.message);
      if (result.errorCount > 0) process.exitCode = 1;
    })
    .catch((err) => {
      console.error("Failed:", err);
      process.exit(1);
    });
}
