/**
 * Draft / variant-layer helpers for validators.
 *
 * Variant files (`draft.en.yml`, `v2.en.yml`) overlay a live locale. Those must
 * not be scored as their own page (meta is inherited from the live file).
 * Unpublished draft-only entries have no live locale — they ARE the page and
 * should be validated.
 */

import type { ContentFile } from "./types";

export function isVariantLayerFile(filePath: string): boolean {
  const base = filePath.split(/[/\\]/).pop() || "";
  return /^[a-z0-9-]+\.[a-z]{2}(-[a-z]{2})?\.ya?ml$/i.test(base) && !/^single\./i.test(base);
}

/** Skip A/B overlays of published pages; still validate unpublished drafts. */
export function skipLiveVariantOverlay(file: ContentFile): boolean {
  if (file.isDraft) return false;
  return isVariantLayerFile(file.filePath);
}
