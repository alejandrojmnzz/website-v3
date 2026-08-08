/**
 * Move an empty live locale file to draft.{locale}.yml and register it in versioning.yml.
 */

import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import { getFolder } from "./content-types";
import { getDefaultContentRoot } from "./site-config";
import { markFileAsModified } from "./sync-state";
import { DEFAULT_DRAFT_VARIANT } from "./draft-entry";
import { isEmptyDetachedLocaleEntry } from "./empty-locale";
import type { ContentIndex } from "./content-index";
import { contentIndex as defaultCi } from "./content-index";
import { child } from "./logger";

const log = child({ module: "convert-empty-locale-to-draft" });

export type ConvertEmptyLocaleResult = {
  converted: boolean;
  draftPath: string;
  previousLivePath: string;
  variantSlug: string;
};

/**
 * If live `{locale}.yml` is an empty detached locale, rename to `draft.{locale}.yml`
 * and ensure versioning.yml lists variant `draft` at 0% for that locale.
 */
export function convertEmptyLiveLocaleToDraft(opts: {
  contentType: string;
  slug: string;
  locale: string;
  contentRoot?: string;
  ci?: ContentIndex;
  author?: string | null;
  variantSlug?: string;
}): ConvertEmptyLocaleResult | null {
  const contentRoot = opts.contentRoot ?? getDefaultContentRoot();
  const ci = opts.ci ?? defaultCi;
  const variantSlug = opts.variantSlug || DEFAULT_DRAFT_VARIANT;
  const folder = getFolder(opts.contentType, contentRoot);
  const entryDir = path.join(contentRoot, folder, opts.slug);
  const livePath = path.join(entryDir, `${opts.locale}.yml`);
  const draftPath = path.join(entryDir, `${variantSlug}.${opts.locale}.yml`);

  if (!fs.existsSync(livePath)) return null;

  if (
    !isEmptyDetachedLocaleEntry({
      contentType: opts.contentType,
      slug: opts.slug,
      locale: opts.locale,
      contentRoot,
      ci,
    })
  ) {
    return null;
  }

  if (fs.existsSync(draftPath)) {
    // Prefer keeping existing draft; drop empty live stub
    fs.unlinkSync(livePath);
    markFileAsModified(livePath, opts.author ?? undefined, undefined, contentRoot);
    ensureDraftVariantInVersioning({
      contentType: opts.contentType,
      slug: opts.slug,
      locale: opts.locale,
      contentRoot,
      author: opts.author,
      variantSlug,
    });
    log.info(
      { contentType: opts.contentType, slug: opts.slug, locale: opts.locale },
      "[EmptyLocale] Removed empty live; draft already existed",
    );
    return {
      converted: true,
      draftPath,
      previousLivePath: livePath,
      variantSlug,
    };
  }

  fs.renameSync(livePath, draftPath);
  markFileAsModified(draftPath, opts.author ?? undefined, undefined, contentRoot);
  markFileAsModified(livePath, opts.author ?? undefined, undefined, contentRoot);
  ensureDraftVariantInVersioning({
    contentType: opts.contentType,
    slug: opts.slug,
    locale: opts.locale,
    contentRoot,
    author: opts.author,
    variantSlug,
  });

  log.info(
    {
      contentType: opts.contentType,
      slug: opts.slug,
      locale: opts.locale,
      draftPath,
    },
    "[EmptyLocale] Converted empty live locale to draft",
  );

  return {
    converted: true,
    draftPath,
    previousLivePath: livePath,
    variantSlug,
  };
}

/** Register `{variantSlug}` at 0% for `locale` in the entry's versioning.yml. */
export function ensureDraftVariantInVersioning(opts: {
  contentType: string;
  slug: string;
  locale: string;
  contentRoot?: string;
  author?: string | null;
  variantSlug?: string;
}): void {
  const contentRoot = opts.contentRoot ?? getDefaultContentRoot();
  const variantSlug = opts.variantSlug || DEFAULT_DRAFT_VARIANT;
  const folder = getFolder(opts.contentType, contentRoot);
  const entryDir = path.join(contentRoot, folder, opts.slug);
  const versioningPath = path.join(entryDir, "versioning.yml");
  let data: Record<string, { variants?: Array<{ slug: string; allocation: number }> }> = {};
  if (fs.existsSync(versioningPath)) {
    try {
      const parsed = yaml.load(fs.readFileSync(versioningPath, "utf-8"));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        data = parsed as typeof data;
      }
    } catch {
      data = {};
    }
  }

  const localeBlock = data[opts.locale] || { variants: [] };
  const variants = Array.isArray(localeBlock.variants) ? [...localeBlock.variants] : [];
  if (!variants.some((v) => v.slug === variantSlug)) {
    variants.push({ slug: variantSlug, allocation: 0 });
  }
  data[opts.locale] = { variants };

  if (!fs.existsSync(entryDir)) {
    fs.mkdirSync(entryDir, { recursive: true });
  }
  fs.writeFileSync(versioningPath, yaml.dump(data, { lineWidth: -1, noRefs: true }), "utf-8");
  markFileAsModified(
    path.join(contentRoot, folder, opts.slug, "versioning.yml"),
    opts.author ?? undefined,
    undefined,
    contentRoot,
  );
}
