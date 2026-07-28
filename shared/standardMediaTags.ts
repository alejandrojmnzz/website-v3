/**
 * Standard Media Gallery tags applied automatically in their pick contexts.
 * Keep in sync with image-registry.json tagDefinitions and ImagePickerDialog ensureTagsOnSave usages.
 */
export const STANDARD_MEDIA_TAGS = {
  /** Social / Open Graph share images */
  OG_IMAGE: "og-image",
  /** Logo-shaped assets (company, partner, etc.) */
  LOGO: "logo",
  /** Primary site brand mark (paired with logo for Brand Settings / navbar) */
  BRAND: "brand",
} as const;

export const BRAND_LOGO_ENSURE_TAGS = [
  STANDARD_MEDIA_TAGS.LOGO,
  STANDARD_MEDIA_TAGS.BRAND,
] as const;

export const OG_IMAGE_ENSURE_TAGS = [STANDARD_MEDIA_TAGS.OG_IMAGE] as const;
