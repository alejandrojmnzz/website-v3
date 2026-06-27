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

      files.push({
        slug: entry.slug,
        title: ((data.title || data.name || entry.title || entry.slug) as string) || entry.slug,
        meta: data.meta as ContentFile["meta"],
        schema: data.schema as ContentFile["schema"],
        seo: data.seo as ContentFile["seo"],
        type: entry.contentType,
        locale,
        filePath: result.filePath,
      });
    }
  }

  return files;
}
