/**
 * SEO-category validators only target live locale pages (not A/B variants).
 * Variants are not Google-indexed SEO surfaces.
 */

import type { ContentFile, ValidationContext } from "./types";
import { skipLiveVariantOverlay } from "./draftFiles";

/** True when this ContentFile should receive SEO-category validation. */
export function isSeoValidationTarget(file: ContentFile): boolean {
  if (file.variant) return false;
  if (skipLiveVariantOverlay(file)) return false;
  return true;
}

/** Live (non-variant) content files for SEO-category validators. */
export function liveFilesForSeo(context: ValidationContext): ContentFile[] {
  return context.contentFiles.filter(isSeoValidationTarget);
}
