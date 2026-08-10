/**
 * Conversion / ecommerce identity validation for save and publish.
 * Missing keys fail; explicit null (conversion / ecommerce_products) or CTA `none` means opted off.
 */

import {
  validateFormSection,
  validateRequiredConversionName,
} from "./validateFormSection";
import {
  resolveBoundCtaPaths,
  validateCtaPurchasable,
  validateCtaTracking,
} from "./validateCtaTracking";
import { resolveBoundFormSettingsPath } from "./wipeOnDuplicate";
import {
  validateProductScope,
  type ProductResolveFn,
  type ProductScopeContext,
} from "./resolveProductScope";

export type SectionIdentityOpts = {
  fieldEditors: Record<string, string>;
  hasEcommerceBehavior: boolean;
  contentType?: string;
  contentSlug?: string;
  conversionNames?: string[];
  resolveProduct: ProductResolveFn;
  sectionIndex?: number;
  /** Skip conversion/CTA/product identity checks (e.g. freshly duplicated section). */
  skipIdentity?: boolean;
};

/**
 * Validate one section's conversion + CTA + product-scope identity.
 * Returns error message or null.
 */
export function validateSectionIdentity(
  section: Record<string, unknown>,
  opts: SectionIdentityOpts,
): string | null {
  const conversionNames = opts.conversionNames;
  const formErr = validateFormSection(section, conversionNames);
  if (formErr) return formErr;

  if (opts.skipIdentity) return null;

  const variant = typeof section.variant === "string" ? section.variant : undefined;
  const formSettingsPath = resolveBoundFormSettingsPath(opts.fieldEditors, variant);
  const convErr = validateRequiredConversionName(section, formSettingsPath);
  if (convErr) return convErr;

  const ctaPaths = resolveBoundCtaPaths(opts.fieldEditors, variant);
  const trackingErr = validateCtaTracking(section, ctaPaths);
  if (trackingErr) return trackingErr;

  const purchasableErr = validateCtaPurchasable(section, ctaPaths, {
    contentSlug: opts.contentSlug,
    contentType: opts.contentType,
    resolveProduct: opts.resolveProduct,
  });
  if (purchasableErr) return purchasableErr;

  const scopeErr = validateProductScope(section, {
    contentSlug: opts.contentSlug,
    contentType: opts.contentType,
    hasEcommerceBehavior: opts.hasEcommerceBehavior,
    ctaPaths,
    fieldEditors: opts.fieldEditors,
    resolveProduct: opts.resolveProduct,
    sectionIndex: opts.sectionIndex,
  });
  if (scopeErr) return scopeErr;

  return null;
}

export type DocumentIdentityOpts = {
  fieldEditorsByType: Record<string, Record<string, string>>;
  /** sectionType → has ecommerce behavior */
  hasEcommerceBehavior: (sectionType: string) => boolean;
  contentType?: string;
  contentSlug?: string;
  conversionNames?: string[];
  resolveProduct: ProductResolveFn;
  skipIdentityIndexes?: Set<number>;
};

/**
 * Validate all sections in a locale/content document.
 * Returns first error prefixed with sections[i], or null.
 */
export function validateDocumentSectionsIdentity(
  doc: Record<string, unknown>,
  opts: DocumentIdentityOpts,
): string | null {
  const sections = doc.sections;
  if (!Array.isArray(sections)) return null;

  for (let i = 0; i < sections.length; i++) {
    const sec = sections[i];
    if (!sec || typeof sec !== "object" || Array.isArray(sec)) continue;
    const section = sec as Record<string, unknown>;
    const sectionType = String(section.type ?? "");
    const err = validateSectionIdentity(section, {
      fieldEditors: opts.fieldEditorsByType[sectionType] ?? {},
      hasEcommerceBehavior: opts.hasEcommerceBehavior(sectionType),
      contentType: opts.contentType,
      contentSlug: opts.contentSlug,
      conversionNames: opts.conversionNames,
      resolveProduct: opts.resolveProduct,
      sectionIndex: i,
      skipIdentity: opts.skipIdentityIndexes?.has(i),
    });
    if (err) {
      return err.startsWith(`sections[${i}]`) ? err : `sections[${i}]: ${err}`;
    }
  }
  return null;
}

export type { ProductScopeContext };
