/**
 * One-shot: convert empty live detached locale files to draft.{locale}.yml.
 *
 * Usage:
 *   npx tsx scripts/migrate-empty-detached-locales.ts
 *   npx tsx scripts/migrate-empty-detached-locales.ts --dry-run
 */
import path from "path";
import { contentIndex } from "../server/content-index";
import { getAllConfigs, getDirectory } from "../server/content-types";
import { getDefaultContentRoot } from "../server/site-config";
import { isEntryDetached } from "../server/shared-layout-entry";
import { isEmptyDetachedLocaleEntry } from "../server/empty-locale";
import { convertEmptyLiveLocaleToDraft } from "../server/convert-empty-locale-to-draft";
import { invalidateStaticListingCache } from "../server/static-listing-cache";

const DRY = process.argv.includes("--dry-run");

async function main(): Promise<void> {
  const contentRoot = getDefaultContentRoot();

  const converted: string[] = [];
  const configs = getAllConfigs(contentRoot);

  for (const contentType of Object.keys(configs)) {
    const slugs = contentIndex.listContentSlugs(contentType as any);
    for (const slug of slugs) {
      if (!isEntryDetached(contentType, slug, contentRoot)) continue;
      const locales = contentIndex.getAvailableLocalesOrVariants(contentType as any, slug);
      for (const locale of locales) {
        if (locale.startsWith("_") || locale.includes(".")) continue;
        if (
          !isEmptyDetachedLocaleEntry({
            contentType,
            slug,
            locale,
            contentRoot,
            ci: contentIndex,
          })
        ) {
          continue;
        }
        const key = `${contentType}/${slug}/${locale}.yml`;
        if (DRY) {
          converted.push(`dry-run ${key}`);
          continue;
        }
        const result = convertEmptyLiveLocaleToDraft({
          contentType,
          slug,
          locale,
          contentRoot,
          ci: contentIndex,
          author: "migrate-empty-detached-locales",
        });
        if (result) {
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
