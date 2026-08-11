/**
 * Gate live entry writes: required SEO meta + editor.required fields.
 */

import { resolveSingleVars } from "./single-resolver";
import { buildSingleEntryFromContent } from "./build-single-entry";
import {
  finalizeSingleEntryForTemplates,
  getContentTypeConfig,
} from "./content-types";
import {
  validateRequiredMeta,
  formatMetaValidationErrors,
} from "@shared/validateRequiredMeta";
import {
  validateRequiredFields,
  formatRequiredFieldErrors,
  type ValidateRequiredFieldsMode,
} from "@shared/validateRequiredFields";
import { isDraftEntry } from "./draft-entry";
import { isEntryDetached, isSharedLayoutType } from "./shared-layout-entry";
import { mergeSingleTemplate } from "./database-single-loader";
import { deepMerge } from "./utils/deepMerge";
import { isEmptyDetachedLocale } from "@shared/isEmptyLocaleContent";
import { getFolder } from "./content-types";
import { getDefaultContentRoot } from "./site-config";
import path from "path";
import fs from "fs";
import { contentIndex } from "./content-index";
import { formatSchemaOrgCompanionGateError } from "./schema-org-requirements";

export type LiveSeoGateOptions = {
  contentType: string;
  slug: string;
  locale: string;
  /** Merged or locale+common data about to be persisted / published. */
  pageData: Record<string, unknown>;
  contentRoot?: string;
  mode?: ValidateRequiredFieldsMode;
  /**
   * When true, skip the gate (draft-only writes).
   * If omitted, uses isDraftEntry() when no live locales exist.
   */
  isDraftWrite?: boolean;
};

/**
 * Validate live SEO meta + required editor fields on merged page data.
 * Returns an error string suitable for API 400, or null if OK / skipped.
 */
export function assertLiveEntrySeoAndRequiredFields(
  opts: LiveSeoGateOptions,
): string | null {
  const {
    contentType,
    slug,
    locale,
    pageData,
    contentRoot,
    mode = "live_update",
  } = opts;

  if (opts.isDraftWrite === true) return null;
  if (
    opts.isDraftWrite !== false &&
    isDraftEntry(contentType, slug, contentRoot)
  ) {
    return null;
  }

  const config = getContentTypeConfig(contentType, contentRoot);

  // Attached shared-layout: meta often lives only on single.{locale}.yml as {{ single.* }}.
  let pageForResolve = pageData;
  if (
    isSharedLayoutType(contentType, contentRoot) &&
    !isEntryDetached(contentType, slug, contentRoot)
  ) {
    const template = mergeSingleTemplate(
      contentType,
      locale,
      slug,
      undefined,
      contentRoot,
    );
    if (template) {
      pageForResolve = deepMerge(template, pageData) as Record<string, unknown>;
    }
  }

  const singleEntry =
    finalizeSingleEntryForTemplates(
      buildSingleEntryFromContent(contentType, pageForResolve, {
        slug,
        locale,
        contentRoot,
      }) || {},
      { slug, locale },
    ) || {};

  const resolvedPage = resolveSingleVars(pageForResolve, singleEntry) as Record<
    string,
    unknown
  >;
  const meta = resolvedPage.meta;

  const metaResult = validateRequiredMeta(meta);
  const metaErr = formatMetaValidationErrors(metaResult);
  if (metaErr) return metaErr;

  const editor = config?.editor as
    | Record<string, { required?: boolean }>
    | undefined;
  const fieldResult = validateRequiredFields(
    editor,
    { ...singleEntry, ...resolvedPage },
    mode,
  );
  const fieldErr = formatRequiredFieldErrors(fieldResult);
  if (fieldErr) return fieldErr;

  const emptyLocaleErr = assertNotEmptyDetachedLocale({
    contentType,
    slug,
    locale,
    pageData: resolvedPage,
    contentRoot,
  });
  if (emptyLocaleErr) return emptyLocaleErr;

  const companionErr = formatSchemaOrgCompanionGateError({
    sections: resolvedPage.sections,
    contentType,
    slug,
    locale,
    contentRoot,
  });
  if (companionErr) return companionErr;

  return null;
}

/**
 * Block publishing / live writes of empty detached locales.
 */
export function assertNotEmptyDetachedLocale(opts: {
  contentType: string;
  slug: string;
  locale: string;
  pageData?: Record<string, unknown> | null;
  contentRoot?: string;
}): string | null {
  const contentRoot = opts.contentRoot ?? getDefaultContentRoot();
  if (!isEntryDetached(opts.contentType, opts.slug, contentRoot)) return null;

  let merged = opts.pageData;
  if (!merged) {
    try {
      merged =
        (contentIndex.loadMergedContent(opts.contentType, opts.slug, opts.locale)
          .data as Record<string, unknown> | null) ?? null;
    } catch {
      merged = null;
    }
  }

  if (!isEmptyDetachedLocale({ detached: true, merged })) return null;

  const folder = getFolder(opts.contentType, contentRoot);
  const filePath = path.join(folder, opts.slug, `${opts.locale}.yml`);
  const abs = path.join(contentRoot, filePath);
  const exists = fs.existsSync(abs);

  return (
    `EMPTY_LOCALE: detached locale "${opts.locale}" has no sections and no content` +
    (exists ? ` (${filePath}).` : ".") +
    " Translate the draft or remove the stub before publishing."
  );
}
