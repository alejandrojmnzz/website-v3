/**
 * One-shot: move untranslated detached locale shells to draft.{locale}.yml.
 *
 * Heuristic (blog): detached entry + live locale file whose article body is only
 * `{{ single.content }}` + empty/whitespace `_common.yml` content.
 *
 * Usage:
 *   npx tsx scripts/migrate-untranslated-shells.ts --dry-run
 *   npx tsx scripts/migrate-untranslated-shells.ts
 */
import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import { contentIndex } from "../server/content-index";
import { getAllConfigs, getDirectory } from "../server/content-types";
import { getDefaultContentRoot } from "../server/site-config";
import { isEntryDetached } from "../server/shared-layout-entry";
import { ensureDraftVariantInVersioning } from "../server/convert-empty-locale-to-draft";
import { markFileAsModified } from "../server/sync-state";
import { invalidateStaticListingCache } from "../server/static-listing-cache";
import { DEFAULT_DRAFT_VARIANT } from "../server/draft-entry";

const DRY = process.argv.includes("--dry-run");

function commonContentEmpty(entryDir: string): boolean {
  const commonPath = path.join(entryDir, "_common.yml");
  if (!fs.existsSync(commonPath)) return true;
  try {
    const parsed = yaml.load(fs.readFileSync(commonPath, "utf-8")) as Record<string, unknown> | null;
    const c = parsed?.content;
    return typeof c !== "string" || c.trim().length === 0;
  } catch {
    return true;
  }
}

function isUntranslatedShellLocaleFile(filePath: string): boolean {
  if (!fs.existsSync(filePath)) return false;
  const raw = fs.readFileSync(filePath, "utf-8");
  // Article body is only the single.content template (optional liquid-style filter)
  return /content:\s*\{\{\s*single\.content(?:\s*\|[^}]*)?\s*\}\}/.test(raw);
}

function convertShellToDraft(opts: {
  contentType: string;
  slug: string;
  locale: string;
  contentRoot: string;
  folder: string;
}): boolean {
  const entryDir = path.join(opts.contentRoot, opts.folder, opts.slug);
  const livePath = path.join(entryDir, `${opts.locale}.yml`);
  const draftPath = path.join(entryDir, `${DEFAULT_DRAFT_VARIANT}.${opts.locale}.yml`);
  if (!fs.existsSync(livePath)) return false;

  if (fs.existsSync(draftPath)) {
    fs.unlinkSync(livePath);
    markFileAsModified(livePath, "migrate-untranslated-shells", undefined, opts.contentRoot);
  } else {
    fs.renameSync(livePath, draftPath);
    markFileAsModified(draftPath, "migrate-untranslated-shells", undefined, opts.contentRoot);
    markFileAsModified(livePath, "migrate-untranslated-shells", undefined, opts.contentRoot);
  }

  ensureDraftVariantInVersioning({
    contentType: opts.contentType,
    slug: opts.slug,
    locale: opts.locale,
    contentRoot: opts.contentRoot,
    author: "migrate-untranslated-shells",
    variantSlug: DEFAULT_DRAFT_VARIANT,
  });
  return true;
}

async function main(): Promise<void> {
  const contentRoot = getDefaultContentRoot();
  const converted: string[] = [];
  const configs = getAllConfigs(contentRoot);

  for (const contentType of Object.keys(configs)) {
    const folder = getDirectory(contentType, contentRoot);
    const typeDir = path.join(contentRoot, folder);
    if (!fs.existsSync(typeDir)) continue;

    for (const slug of contentIndex.listContentSlugs(contentType as any)) {
      if (!isEntryDetached(contentType, slug, contentRoot)) continue;
      const entryDir = path.join(typeDir, slug);
      if (!commonContentEmpty(entryDir)) continue;

      const locales = contentIndex.getAvailableLocalesOrVariants(contentType as any, slug);
      for (const locale of locales) {
        if (locale.startsWith("_") || locale.includes(".")) continue;
        const livePath = path.join(entryDir, `${locale}.yml`);
        if (!isUntranslatedShellLocaleFile(livePath)) continue;

        const key = `${contentType}/${slug}/${locale}.yml`;
        if (DRY) {
          converted.push(`dry-run ${key}`);
          continue;
        }
        if (
          convertShellToDraft({
            contentType,
            slug,
            locale,
            contentRoot,
            folder,
          })
        ) {
          converted.push(key);
          invalidateStaticListingCache(contentType);
        }
      }
    }
  }

  console.log(
    JSON.stringify(
      {
        mode: DRY ? "dry-run" : "migrate",
        contentRoot,
        count: converted.length,
        converted,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
