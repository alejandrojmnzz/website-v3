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
 */

import { contentIndex as defaultContentIndex } from "../../../server/content-index";
import {
  extractUrlPatternParams,
  getFullFieldMapping,
} from "../../../server/content-types";
import type { ContentFile } from "./types";

export function loadAllContent(ci?: typeof defaultContentIndex): ContentFile[] {
  const index = ci ?? defaultContentIndex;
  const entries = index.listAll();
  const files: ContentFile[] = [];

  for (const entry of entries) {
    for (const locale of entry.locales) {
      if (locale.startsWith("_") || locale.includes(".")) continue;

      const result = index.loadMergedContent(entry.contentType, entry.slug, locale);
      if (!result.data) continue;

      const data = result.data as Record<string, unknown>;
      const config = index.getContentTypeConfig(entry.contentType);
      const pattern =
        config?.url_pattern?.[locale] ||
        config?.url_pattern?.["default"] ||
        config?.url_pattern?.["en"];
      const localeSlug =
        typeof data.slug === "string" && data.slug ? data.slug : entry.slug;
      let url: string | undefined;
      if (pattern) {
        const mapping = getFullFieldMapping(entry.contentType, index.contentRoot);
        const { params } = extractUrlPatternParams(pattern, data, mapping);
        url = index.buildUrl(entry.contentType, locale, localeSlug, params);
      }

      files.push({
        slug: entry.slug,
        title: ((data.title || data.name || entry.title || entry.slug) as string) || entry.slug,
        description: typeof data.description === "string" ? data.description : undefined,
        meta: data.meta as ContentFile["meta"],
        schema: data.schema as ContentFile["schema"],
        seo: data.seo as ContentFile["seo"],
        type: entry.contentType,
        locale,
        filePath: result.filePath,
        url,
        entryFields: data,
      });
    }
  }

  return files;
}
