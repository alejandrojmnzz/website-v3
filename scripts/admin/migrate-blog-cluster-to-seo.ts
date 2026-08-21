#!/usr/bin/env tsx
/**
 * Migrate blog holding columns cluster_keyword / cluster_url into locale seo.*
 * (seo.pillar_path, seo.is_pillar, hub seo.main_keyword if empty), then strip
 * the holding keys. Cross-type hub URLs mark the owning entry as pillar.
 *
 * Usage:
 *   npx tsx scripts/admin/migrate-blog-cluster-to-seo.ts          # dry run
 *   npx tsx scripts/admin/migrate-blog-cluster-to-seo.ts --write  # apply
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { getFolder } from "../../server/content-types";
import { ContentIndex } from "../../server/content-index";
import { getDefaultContentRoot } from "../../server/site-config";
import { toPublicUrlPath } from "../../server/redirects";
import {
  canonicalizePillarPath,
  entryCanonicalPath,
  mergeSeoUpdates,
  readSeoBlockFromYamlText,
  readTopLevelScalar,
  surgicalRemoveTopLevelKey,
  surgicalReplaceSeoBlock,
  validateSeoSave,
  type SeoBlock,
} from "../../server/seo-fields";
import { markFileAsModified } from "../../server/sync-state";
import { invalidateSeoIndexCache, rebuildSeoIndex } from "../../server/seo-index";

const LIVE_LOCALE_FILE = /^[a-z]{2}\.ya?ml$/i;
const CLUSTER_KEYWORD_KEY = "cluster_keyword";
const CLUSTER_URL_KEY = "cluster_url";

export const DEFAULT_LEFTOVER_PATH = path.join(
  process.cwd(),
  "scripts/admin/reports/blog-clusters-missing-hub.txt",
);

export interface MigrateBlogClusterOptions {
  contentRoot?: string;
  dryRun?: boolean;
  leftoverPath?: string;
  mark?: boolean;
  ci?: ContentIndex;
}

export interface LeftoverRow {
  id: string;
  locale: string;
  clusterKeyword: string;
  clusterUrl: string;
  reason: string;
  detail?: string;
}

export interface MigrateResultItem {
  id: string;
  src?: string;
  status: string;
  reason?: string;
}

export interface MigrateBlogClusterResult {
  message: string;
  migratedCount: number;
  hubMarkedCount: number;
  strippedOnlyCount: number;
  skippedCount: number;
  errorCount: number;
  leftoverCount: number;
  leftoverPath?: string;
  leftovers: LeftoverRow[];
  results: MigrateResultItem[];
}

function contentRootAbs(contentRoot?: string): string {
  const raw = contentRoot ?? getDefaultContentRoot();
  return path.isAbsolute(raw) ? raw : path.join(process.cwd(), raw);
}

export function stripClusterHoldingKeys(content: string): string {
  let next = surgicalRemoveTopLevelKey(content, CLUSTER_KEYWORD_KEY);
  next = surgicalRemoveTopLevelKey(next, CLUSTER_URL_KEY);
  return next;
}

export function existingSeoDisagrees(
  existing: SeoBlock,
  desired: { pillar_path: string; is_pillar: boolean },
): boolean {
  const existingPath =
    typeof existing.pillar_path === "string" && existing.pillar_path.trim()
      ? toPublicUrlPath(existing.pillar_path)
      : "";
  const existingIsPillar = existing.is_pillar === true;
  if (!existingIsPillar && !existingPath) return false;
  if (existingIsPillar !== desired.is_pillar) return true;
  if (existingPath && existingPath !== desired.pillar_path) return true;
  return false;
}

export function formatLeftoverReport(rows: LeftoverRow[]): string {
  const header = "# Blog clusters missing a live hub (or skipped because seo.* already disagreed)\n# id\tlocale\tcluster_keyword\tcluster_url\treason\tdetail\n";
  const lines = rows.map((r) =>
    [r.id, r.locale, r.clusterKeyword, r.clusterUrl, r.reason, r.detail ?? ""].join("\t"),
  );
  return `${header}${lines.join("\n")}${lines.length ? "\n" : ""}`;
}

function hasHoldingKeys(text: string): boolean {
  return readTopLevelScalar(text, CLUSTER_KEYWORD_KEY) != null || readTopLevelScalar(text, CLUSTER_URL_KEY) != null;
}

function localeFilePath(root: string, contentType: string, slug: string, locale: string): string {
  return path.join(root, getFolder(contentType, root), slug, `${locale}.yml`);
}

type HubJob = {
  path: string;
  locale: string;
  keywords: Array<{ value: string; sourceId: string }>;
};

function applySeoAndStrip(opts: {
  text: string;
  updates?: Record<string, unknown>;
  locale: string;
  contentType: string;
  slug: string;
  ci: ContentIndex;
}): { text: string; error?: string } {
  let next = opts.text;
  if (opts.updates && Object.keys(opts.updates).length > 0) {
    const current = readSeoBlockFromYamlText(next);
    const merged = mergeSeoUpdates(current, opts.updates);
    const validated = validateSeoSave({
      next: merged,
      locale: opts.locale,
      contentType: opts.contentType,
      slug: opts.slug,
      ci: opts.ci,
    });
    if (!validated.ok) return { text: next, error: validated.error };
    next = surgicalReplaceSeoBlock(next, validated.coerced);
  }
  next = stripClusterHoldingKeys(next);
  return { text: next };
}

export async function migrateBlogClusterToSeo(
  options: MigrateBlogClusterOptions = {},
): Promise<MigrateBlogClusterResult> {
  const dryRun = options.dryRun !== false;
  const mark = options.mark !== false;
  const root = contentRootAbs(options.contentRoot);
  const leftoverPath = options.leftoverPath ?? DEFAULT_LEFTOVER_PATH;
  const ci = options.ci ?? new ContentIndex(root);
  const results: MigrateResultItem[] = [];
  const leftovers: LeftoverRow[] = [];
  const filesToMark = new Set<string>();
  const markedHubPaths = new Set<string>();
  const hubJobs = new Map<string, HubJob>();

  let migratedCount = 0;
  let hubMarkedCount = 0;
  let strippedOnlyCount = 0;
  let skippedCount = 0;
  let errorCount = 0;

  const blogDir = path.join(root, getFolder("blog", root));
  if (!fs.existsSync(blogDir)) {
    return {
      message: `Blog directory not found: ${blogDir}`,
      migratedCount: 0,
      hubMarkedCount: 0,
      strippedOnlyCount: 0,
      skippedCount: 0,
      errorCount: 0,
      leftoverCount: 0,
      leftovers: [],
      results: [],
    };
  }

  const pushLeftover = (row: LeftoverRow) => leftovers.push(row);

  const slugDirs = fs.readdirSync(blogDir, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith("_"));

  for (const slugEnt of slugDirs) {
    const slugDir = path.join(blogDir, slugEnt.name);
    for (const file of fs.readdirSync(slugDir)) {
      if (!LIVE_LOCALE_FILE.test(file)) continue;
      const abs = path.join(slugDir, file);
      const locale = file.replace(/\.ya?ml$/i, "").toLowerCase();
      const id = `blog/${slugEnt.name}/${file}`;
      try {
        const original = fs.readFileSync(abs, "utf-8");
        if (!hasHoldingKeys(original)) {
          skippedCount++;
          continue;
        }

        const clusterKeyword = (readTopLevelScalar(original, CLUSTER_KEYWORD_KEY) ?? "").trim();
        const clusterUrlRaw = (readTopLevelScalar(original, CLUSTER_URL_KEY) ?? "").trim();
        const existing = readSeoBlockFromYamlText(original);

        const finishStripOnly = (status: string, reason: string, leftover?: LeftoverRow) => {
          if (leftover) pushLeftover(leftover);
          const next = stripClusterHoldingKeys(original);
          if (!dryRun && next !== original) {
            fs.writeFileSync(abs, next, "utf-8");
            filesToMark.add(abs);
          }
          strippedOnlyCount++;
          results.push({ id, src: abs, status: dryRun ? `would-${status}` : status, reason });
        };

        if (!clusterUrlRaw) {
          finishStripOnly("stripped", "empty cluster_url", {
            id,
            locale,
            clusterKeyword,
            clusterUrl: "",
            reason: "empty_url",
          });
          continue;
        }

        const canon = canonicalizePillarPath(clusterUrlRaw, locale, ci);
        if (!canon.live) {
          finishStripOnly("stripped", "hub URL is not live", {
            id,
            locale,
            clusterKeyword,
            clusterUrl: clusterUrlRaw,
            reason: "not_live",
            detail: canon.path,
          });
          continue;
        }

        const resolved = ci.resolveUrl(canon.path);
        if (!resolved) {
          finishStripOnly("stripped", "hub URL did not resolve", {
            id,
            locale,
            clusterKeyword,
            clusterUrl: clusterUrlRaw,
            reason: "unresolved",
            detail: canon.path,
          });
          continue;
        }

        const selfPath = entryCanonicalPath("blog", slugEnt.name, locale, ci);
        const isSelf = Boolean(selfPath && canon.path === selfPath);
        const desiredPath = isSelf && selfPath ? selfPath : canon.path;
        const desired = { pillar_path: desiredPath, is_pillar: isSelf };

        if (existingSeoDisagrees(existing, desired)) {
          finishStripOnly("stripped", "seo.* wins over cluster_url", {
            id,
            locale,
            clusterKeyword,
            clusterUrl: clusterUrlRaw,
            reason: "seo_conflict",
            detail: `existing pillar_path=${existing.pillar_path ?? ""} is_pillar=${existing.is_pillar === true}`,
          });
          continue;
        }

        const updates: Record<string, unknown> = {
          "seo.pillar_path": desiredPath,
          "seo.is_pillar": isSelf,
        };
        if (isSelf && clusterKeyword) {
          const existingKw = typeof existing.main_keyword === "string" ? existing.main_keyword.trim() : "";
          if (!existingKw) updates["seo.main_keyword"] = clusterKeyword;
        }

        const applied = applySeoAndStrip({
          text: original,
          updates,
          locale,
          contentType: "blog",
          slug: slugEnt.name,
          ci,
        });
        if (applied.error) {
          finishStripOnly("stripped", applied.error, {
            id,
            locale,
            clusterKeyword,
            clusterUrl: clusterUrlRaw,
            reason: "seo_invalid",
            detail: applied.error,
          });
          continue;
        }

        if (!dryRun && applied.text !== original) {
          fs.writeFileSync(abs, applied.text, "utf-8");
          filesToMark.add(abs);
        }
        migratedCount++;
        results.push({
          id,
          src: abs,
          status: dryRun ? "would-migrate" : "migrated",
          reason: isSelf ? `hub self (${desiredPath})` : `spoke → ${desiredPath}`,
        });

        if (isSelf && desiredPath) markedHubPaths.add(desiredPath);

        if (!isSelf) {
          const jobKey = `${locale}:${canon.path}`;
          const job = hubJobs.get(jobKey) ?? { path: canon.path, locale, keywords: [] };
          if (clusterKeyword) job.keywords.push({ value: clusterKeyword, sourceId: id });
          hubJobs.set(jobKey, job);
        }
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

  for (const job of hubJobs.values()) {
    const hubId = `hub:${job.locale}:${job.path}`;
    try {
      if (markedHubPaths.has(job.path)) continue;
      const resolved = ci.resolveUrl(job.path);
      if (!resolved) {
        pushLeftover({
          id: hubId,
          locale: job.locale,
          clusterKeyword: job.keywords[0]?.value ?? "",
          clusterUrl: job.path,
          reason: "hub_unresolved",
        });
        continue;
      }

      const hubFile = localeFilePath(root, resolved.contentType, resolved.slug, job.locale);
      if (!fs.existsSync(hubFile)) {
        pushLeftover({
          id: hubId,
          locale: job.locale,
          clusterKeyword: job.keywords[0]?.value ?? "",
          clusterUrl: job.path,
          reason: "hub_file_missing",
          detail: path.relative(root, hubFile).split(path.sep).join("/"),
        });
        continue;
      }

      const uniqueKeywords: string[] = [];
      for (const k of job.keywords) {
        if (!uniqueKeywords.includes(k.value)) uniqueKeywords.push(k.value);
      }
      const chosen = uniqueKeywords[0] ?? "";
      for (const extra of uniqueKeywords.slice(1)) {
        const sources = job.keywords.filter((k) => k.value === extra).map((k) => k.sourceId);
        pushLeftover({
          id: hubId,
          locale: job.locale,
          clusterKeyword: extra,
          clusterUrl: job.path,
          reason: "keyword_conflict",
          detail: `kept "${chosen}"; also seen from ${sources.join(", ")}`,
        });
      }

      const original = fs.readFileSync(hubFile, "utf-8");
      const existing = readSeoBlockFromYamlText(original);
      const selfPath = entryCanonicalPath(resolved.contentType, resolved.slug, job.locale, ci) || job.path;
      if (existingSeoDisagrees(existing, { pillar_path: selfPath, is_pillar: true })) {
        pushLeftover({
          id: hubId,
          locale: job.locale,
          clusterKeyword: chosen,
          clusterUrl: job.path,
          reason: "seo_conflict",
          detail: `hub ${resolved.contentType}/${resolved.slug} already has seo.*`,
        });
        continue;
      }

      const updates: Record<string, unknown> = { "seo.is_pillar": true };
      const existingKw = typeof existing.main_keyword === "string" ? existing.main_keyword.trim() : "";
      if (chosen && !existingKw) updates["seo.main_keyword"] = chosen;

      const applied = applySeoAndStrip({
        text: original,
        updates,
        locale: job.locale,
        contentType: resolved.contentType,
        slug: resolved.slug,
        ci,
      });
      if (applied.error) {
        pushLeftover({
          id: hubId,
          locale: job.locale,
          clusterKeyword: chosen,
          clusterUrl: job.path,
          reason: "seo_invalid",
          detail: applied.error,
        });
        continue;
      }

      if (!dryRun && applied.text !== original) {
        fs.writeFileSync(hubFile, applied.text, "utf-8");
        filesToMark.add(hubFile);
      }
      markedHubPaths.add(job.path);
      hubMarkedCount++;
      results.push({
        id: `${resolved.contentType}/${resolved.slug}/${job.locale}.yml`,
        src: hubFile,
        status: dryRun ? "would-mark-hub" : "hub-marked",
        reason: job.path,
      });
    } catch (err) {
      errorCount++;
      results.push({
        id: hubId,
        status: "error",
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (!dryRun) {
    invalidateSeoIndexCache();
    rebuildSeoIndex({
      contentRoot: root,
      author: "agent",
      reason: "migrate-blog-cluster-to-seo",
      ci,
      mark,
    });
    if (mark) {
      for (const f of filesToMark) markFileAsModified(f, "agent", undefined, root);
    }
    fs.mkdirSync(path.dirname(leftoverPath), { recursive: true });
    fs.writeFileSync(leftoverPath, formatLeftoverReport(leftovers), "utf-8");
  }

  return {
    message: dryRun
      ? `Dry run: ${migratedCount} would migrate, ${hubMarkedCount} hubs would be marked, ${strippedOnlyCount} strip-only, ${skippedCount} skipped, ${errorCount} failed, ${leftovers.length} leftover`
      : `Wrote ${migratedCount} blog locale files, marked ${hubMarkedCount} hubs, stripped ${strippedOnlyCount} without seo write, ${skippedCount} skipped, ${errorCount} failed, ${leftovers.length} leftover → ${leftoverPath}`,
    migratedCount,
    hubMarkedCount,
    strippedOnlyCount,
    skippedCount,
    errorCount,
    leftoverCount: leftovers.length,
    leftoverPath: dryRun ? undefined : leftoverPath,
    leftovers,
    results,
  };
}

const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] === __filename) {
  const args = process.argv.slice(2);
  const dryRun = !args.includes("--write");
  migrateBlogClusterToSeo({ dryRun })
    .then((result) => {
      for (const item of result.results) {
        if (item.status === "error") {
          console.log(`  [ERR]  ${item.id} — ${item.reason}`);
        } else if (item.status.startsWith("would-") || item.status === "migrated" || item.status === "hub-marked" || item.status === "stripped") {
          console.log(`  [OK]   ${item.id} — ${item.reason ?? item.status}`);
        }
      }
      if (result.leftovers.length) {
        console.log(`\nLeftovers (${result.leftovers.length}):`);
        for (const row of result.leftovers) {
          console.log(`  [${row.reason}] ${row.id} ${row.clusterUrl || "(no url)"} ${row.detail ?? ""}`.trimEnd());
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
