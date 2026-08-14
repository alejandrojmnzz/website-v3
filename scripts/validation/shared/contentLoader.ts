/**
 * Content Loader
 *
 * Builds the list of resolved ContentFile entries for validation by delegating
 * entirely to ContentIndex, which is the single source of truth for content
 * merging (_common.single.yml → _common.yml → locale.yml).
 *
 * Previously this module read individual YAML files in isolation, which caused
 * false-positive validation errors for fields inherited from parent files
 * (schema, meta, etc.). Now it reuses the same merge logic used at serve-time.
 *
 * Unpublished draft-only folders are skipped by ContentIndex (no live locale
 * files). They are appended here so diagnostics and sitemap badges can score
 * them without making drafts publicly routable.
 */

import { contentIndex as defaultContentIndex } from "../../../server/content-index";
import type { ContentIndex } from "../../../server/content-index";
import {
  extractUrlPatternParams,
  getFullFieldMapping,
} from "../../../server/content-types";
import {
  findSourceDraftVariant,
  getEntryContentDir,
  isDraftEntry,
  listDraftLocales,
} from "../../../server/draft-entry";
import { isTemplateVersioningSlug } from "../../../server/shared-layout-entry";
import type { ContentFile } from "./types";

function toContentFile(
  index: ContentIndex,
  contentType: string,
  slug: string,
  locale: string,
  data: Record<string, unknown>,
  filePath: string,
  extra?: Partial<ContentFile>,
): ContentFile {
  const config = index.getContentTypeConfig(contentType);
  const pattern =
    config?.url_pattern?.[locale] ||
    config?.url_pattern?.["default"] ||
    config?.url_pattern?.["en"];
  const localeSlug =
    typeof data.slug === "string" && data.slug ? data.slug : slug;
  let url: string | undefined;
  if (pattern) {
    const mapping = getFullFieldMapping(contentType, index.contentRoot);
    const { params } = extractUrlPatternParams(pattern, data, mapping);
    url = index.buildUrl(contentType, locale, localeSlug, params);
  }

  return {
    slug,
    title: ((data.title || data.name || slug) as string) || slug,
    description: typeof data.description === "string" ? data.description : undefined,
    meta: data.meta as ContentFile["meta"],
    schema: data.schema as ContentFile["schema"],
    seo: data.seo as ContentFile["seo"],
    type: contentType,
    locale,
    filePath,
    url,
    entryFields: data,
    ...extra,
  };
}

function loadLiveContent(index: ContentIndex): ContentFile[] {
  const entries = index.listAll();
  const files: ContentFile[] = [];

  for (const entry of entries) {
    for (const locale of entry.locales) {
      if (locale.startsWith("_") || locale.includes(".")) continue;

      const result = index.loadMergedContent(entry.contentType, entry.slug, locale);
      if (!result.data) continue;

      files.push(
        toContentFile(
          index,
          entry.contentType,
          entry.slug,
          locale,
          result.data as Record<string, unknown>,
          result.filePath,
        ),
      );
    }
  }

  return files;
}

function loadDraftOnlyContent(index: ContentIndex): ContentFile[] {
  const files: ContentFile[] = [];
  const indexed = new Set(
    index.listAll().map((e) => `${e.contentType}:${e.slug}`),
  );

  for (const contentType of index.getContentTypes()) {
    const config = index.getContentTypeConfig(contentType);
    if (config?.database?.slug) continue;

    for (const slug of index.listContentSlugs(contentType)) {
      if (indexed.has(`${contentType}:${slug}`)) continue;
      if (!isDraftEntry(contentType, slug, index.contentRoot)) continue;

      const templateMode = isTemplateVersioningSlug(slug);
      const dir = getEntryContentDir(contentType, slug, index.contentRoot);
      const locales = listDraftLocales(dir, templateMode);
      for (const locale of locales) {
        const variant = findSourceDraftVariant(dir, locale, undefined, templateMode);
        if (!variant) continue;
        const result = index.loadMergedContent(contentType, slug, locale, variant);
        if (!result.data) continue;
        files.push(
          toContentFile(
            index,
            contentType,
            slug,
            locale,
            result.data as Record<string, unknown>,
            result.filePath,
            { variant, isDraft: true },
          ),
        );
      }
    }
  }

  return files;
}

export function loadAllContent(ci?: typeof defaultContentIndex): ContentFile[] {
  const index = ci ?? defaultContentIndex;
  return [...loadLiveContent(index), ...loadDraftOnlyContent(index)];
}
