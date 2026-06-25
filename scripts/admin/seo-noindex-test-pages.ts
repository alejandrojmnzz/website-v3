#!/usr/bin/env tsx
/**
 * SEO Noindex Script for Test/Demo Pages
 *
 * Scans all YAML files in 4geeks-com/, identifies test/demo pages
 * by slug patterns, and adds robots: noindex, nofollow to their meta blocks.
 *
 * Test patterns: prueba, copia, sample, testing, lumi, anik, lorena, jt
 *
 * Usage:
 *   npx tsx scripts/admin/seo-noindex-test-pages.ts          # dry run
 *   npx tsx scripts/admin/seo-noindex-test-pages.ts --write  # apply changes
 */

import * as fs from "fs";
import * as path from "path";
import * as glob from "glob";

const TEST_PATTERNS = [
  /\bprueba\b/i,
  /\bcopia\b/i,
  /\bsample\b/i,
  /\btesting\b/i,
  /\blumi\b/i,
  /\banik\b/i,
  /\blorena\b/i,
  /\b-jt\b/i,
  /^jt-/i,
  /\bjt$/i,
];

const CONTENT_ROOT = path.join(process.cwd(), "4geeks-com");
const DRY_RUN = !process.argv.includes("--write");

function isTestSlug(slug: string): boolean {
  return TEST_PATTERNS.some((p) => p.test(slug));
}

/**
 * Updates or adds robots: noindex, nofollow in the meta block of a YAML file.
 * Uses string manipulation to avoid reformatting the whole file.
 */
function setNoindex(content: string): { updated: string; changed: boolean } {
  // Check if there's already a robots line in the meta block
  const metaBlockMatch = content.match(/^meta:\s*\n((?:[ \t]+.*\n?)*)/m);
  if (!metaBlockMatch) {
    // No meta block found - skip
    return { updated: content, changed: false };
  }

  const noindexValue = "noindex, nofollow";

  // Check if there's an existing robots line in meta
  const robotsInMetaRegex = /^(meta:\s*\n(?:(?!^[^\s])[\s\S])*?)( {2}robots:[ \t]*.+)/m;
  if (robotsInMetaRegex.test(content)) {
    // Replace existing robots value
    const updated = content.replace(
      /^( {2}robots:[ \t]*)(.+)$/m,
      `$1${noindexValue}`
    );
    const changed = updated !== content;
    return { updated, changed };
  }

  // No existing robots line - insert after `meta:` line
  const updated = content.replace(
    /^(meta:\s*\n)/m,
    `$1  robots: ${noindexValue}\n`
  );
  const changed = updated !== content;
  return { updated, changed };
}

async function main() {
  console.log(`Mode: ${DRY_RUN ? "DRY RUN (use --write to apply)" : "WRITE"}`);
  console.log(`Content root: ${CONTENT_ROOT}\n`);

  const files = glob.sync("**/*.yml", {
    cwd: CONTENT_ROOT,
    absolute: true,
    ignore: ["_common.single.yml", "**/_common.yml", "**/schema-org.yml"],
  });

  let modified = 0;
  let alreadyNoindex = 0;
  let skipped = 0;

  for (const filePath of files) {
    const relativePath = path.relative(CONTENT_ROOT, filePath);
    // Extract slug from directory path (e.g. landings/prueba-lorena/en.yml -> prueba-lorena)
    const parts = relativePath.split(path.sep);
    const slug = parts.length >= 2 ? parts[parts.length - 2] : parts[0];

    if (!isTestSlug(slug)) {
      continue;
    }

    const content = fs.readFileSync(filePath, "utf-8");

    // Check if already noindex
    if (/robots:\s*noindex/i.test(content)) {
      alreadyNoindex++;
      console.log(`  [SKIP - already noindex] ${relativePath}`);
      continue;
    }

    let { updated, changed } = setNoindex(content);

    if (!changed) {
      // No meta block exists - prepend one with noindex
      updated = `meta:\n  robots: noindex, nofollow\n\n${content}`;
      changed = true;
      console.log(`  [NOINDEX - added meta] ${relativePath} (slug: ${slug})`);
      modified++;
      if (!DRY_RUN) {
        fs.writeFileSync(filePath, updated, "utf-8");
      }
      continue;
    }

    console.log(`  [NOINDEX] ${relativePath} (slug: ${slug})`);
    modified++;

    if (!DRY_RUN) {
      fs.writeFileSync(filePath, updated, "utf-8");
    }
  }

  console.log(`\n--- Summary ---`);
  console.log(`Modified: ${modified}`);
  console.log(`Already noindex: ${alreadyNoindex}`);
  console.log(`Skipped (no meta): ${skipped}`);
  if (DRY_RUN) {
    console.log(`\nDry run - no files written. Run with --write to apply.`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
