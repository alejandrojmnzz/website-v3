/**
 * Convert a published live locale to an unpublished draft (inverse of per-locale promote).
 * Does not convert shared templates — detach the entry first.
 */

import fs from "fs";
import path from "path";
import { getFolder } from "./content-types";
import { getDefaultContentRoot } from "./site-config";
import { markFileAsModified } from "./sync-state";
import { DEFAULT_DRAFT_VARIANT } from "./draft-entry";
import { isEntryDetached, isSharedLayoutType, isTemplateVersioningSlug } from "./shared-layout-entry";
import { ensureDraftVariantInVersioning } from "./convert-empty-locale-to-draft";
import { child } from "./logger";

const log = child({ module: "convert-live-locale-to-draft" });

export const TEMPLATE_CONVERT_BLOCKED =
  "Convert to draft is blocked on the shared template. Detach this entry first, then convert this entry only.";

export type ConvertLiveLocaleOk = {
  ok: true;
  variantSlug: string;
  liveRelPath: string;
  draftRelPath: string;
  versioningRelPath: string;
  lastLiveLocale: boolean;
};

export type ConvertLiveLocaleErr = {
  ok: false;
  status: 400 | 404 | 409;
  error: string;
};

export type ConvertLiveLocaleResult = ConvertLiveLocaleOk | ConvertLiveLocaleErr;

/**
 * Rename `{locale}.yml` → `draft.{locale}.yml` and register it in versioning.yml at 0%.
 * Extra variants are left unchanged. Does not clear published_at.
 */
export function convertLiveLocaleToDraft(opts: {
  contentType: string;
  slug: string;
  locale: string;
  contentRoot?: string;
  author?: string | null;
  variantSlug?: string;
}): ConvertLiveLocaleResult {
  const contentRoot = opts.contentRoot ?? getDefaultContentRoot();
  const variantSlug = opts.variantSlug || DEFAULT_DRAFT_VARIANT;
  const { contentType, slug, locale } = opts;

  if (isTemplateVersioningSlug(slug)) {
    return { ok: false, status: 400, error: TEMPLATE_CONVERT_BLOCKED };
  }

  if (isSharedLayoutType(contentType, contentRoot) && !isEntryDetached(contentType, slug, contentRoot)) {
    return { ok: false, status: 400, error: TEMPLATE_CONVERT_BLOCKED };
  }

  const folder = getFolder(contentType, contentRoot);
  const entryDir = path.join(contentRoot, folder, slug);
  const livePath = path.join(entryDir, `${locale}.yml`);
  const draftPath = path.join(entryDir, `${variantSlug}.${locale}.yml`);
  const liveRelPath = `${folder}/${slug}/${locale}.yml`;
  const draftRelPath = `${folder}/${slug}/${variantSlug}.${locale}.yml`;
  const versioningRelPath = `${folder}/${slug}/versioning.yml`;

  if (!fs.existsSync(livePath)) {
    return {
      ok: false,
      status: 404,
      error: `Live file ${locale}.yml not found`,
    };
  }

  if (fs.existsSync(draftPath)) {
    return {
      ok: false,
      status: 409,
      error: `Draft file ${variantSlug}.${locale}.yml already exists. Rename or delete it before converting live to draft.`,
    };
  }

  const siblingLive = fs
    .readdirSync(entryDir)
    .filter((f) => /^[a-z]{2}(-[a-z]{2})?\.ya?ml$/i.test(f))
    .map((f) => f.replace(/\.ya?ml$/i, ""))
    .filter((stem) => stem !== locale);
  const lastLiveLocale = siblingLive.length === 0;

  fs.renameSync(livePath, draftPath);
  markFileAsModified(liveRelPath, opts.author ?? undefined, undefined, contentRoot);
  markFileAsModified(draftRelPath, opts.author ?? undefined, undefined, contentRoot);

  ensureDraftVariantInVersioning({
    contentType,
    slug,
    locale,
    contentRoot,
    author: opts.author,
    variantSlug,
  });

  log.info(
    { contentType, slug, locale, draftRelPath, lastLiveLocale },
    "[Versioning] Converted live locale to draft",
  );

  return {
    ok: true,
    variantSlug,
    liveRelPath,
    draftRelPath,
    versioningRelPath,
    lastLiveLocale,
  };
}
