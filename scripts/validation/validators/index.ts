/**
 * Validators Registry
 * 
 * Exports all available validators and provides discovery utilities.
 */

import type { Validator, ValidatorMetadata } from "../shared/types";
import { redirectValidator } from "./redirects";
import { metaValidator } from "./meta";
import { schemaValidator } from "./schema";
import { sitemapValidator } from "./sitemap";
import { componentsValidator } from "./components";
import { backgroundsValidator } from "./backgrounds";
import { faqsValidator } from "./faqs";
import { seoDepthValidator } from "./seo-depth";
import { schemaCompletenessValidator } from "./schema-completeness";
import { imagesValidator } from "./images";
import { contentQualityValidator } from "./content-quality";
import { databaseSinglesValidator } from "./database-singles";
import { databaseHealthValidator } from "./database-health";
import { slugConflictsValidator } from "./slug-conflicts";
import { seoIntentValidator } from "./seo-intent";
import { imageOptimizationValidator } from "./image-optimization";
import { heroImageTagsValidator } from "./hero-image-tags";
import { imageTagsValidator } from "./image-tags";
import { lighthouseValidator } from "./lighthouse";
import { fieldMappingsValidator } from "./field-mappings";
import { orphanedFilesValidator } from "./orphaned-files";
import { formsValidator } from "./forms";
import { consentLegacyKeysValidator } from "./consent-legacy-keys";
import { bindingIntegrityValidator } from "./binding-integrity";
import { brokenAnchorsValidator } from "./broken-anchors";
import { sectionVariantsValidator } from "./section-variants";

export const validators: Validator[] = [
  redirectValidator,
  metaValidator,
  schemaValidator,
  sitemapValidator,
  componentsValidator,
  sectionVariantsValidator,
  backgroundsValidator,
  faqsValidator,
  seoDepthValidator,
  schemaCompletenessValidator,
  imagesValidator,
  contentQualityValidator,
  databaseSinglesValidator,
  databaseHealthValidator,
  slugConflictsValidator,
  seoIntentValidator,
  imageOptimizationValidator,
  heroImageTagsValidator,
  imageTagsValidator,
  fieldMappingsValidator,
  orphanedFilesValidator,
  formsValidator,
  consentLegacyKeysValidator,
  bindingIntegrityValidator,
  brokenAnchorsValidator,
];

export const slowValidators: Validator[] = [lighthouseValidator];

export const allValidators = [...validators, ...slowValidators];

export const validatorMap = new Map<string, Validator>(
  validators.map((v) => [v.name, v])
);

/** Ensures a validator is in the registry (e.g. after hot reload with a stale validators array). */
export function ensureValidatorRegistered(validator: Validator | undefined): void {
  if (!validator || validatorMap.has(validator.name)) return;
  validators.push(validator);
  validatorMap.set(validator.name, validator);
  const slowIdx = slowValidators.findIndex((v) => v.name === validator.name);
  if (slowIdx >= 0) {
    allValidators.splice(0, allValidators.length, ...validators, ...slowValidators);
  } else if (!allValidators.some((v) => v.name === validator.name)) {
    allValidators.push(validator);
  }
}

export function getValidator(name: string): Validator | undefined {
  return validatorMap.get(name) ?? slowValidators.find((v) => v.name === name);
}

export function listValidators(): ValidatorMetadata[] {
  return allValidators.map((v) => ({
    name: v.name,
    description: v.description,
    apiExposed: v.apiExposed,
    estimatedDuration: v.estimatedDuration,
    category: v.category,
  }));
}

export function getApiExposedValidators(): Validator[] {
  return validators.filter((v) => v.apiExposed);
}

export {
  redirectValidator,
  metaValidator,
  schemaValidator,
  sitemapValidator,
  componentsValidator,
  backgroundsValidator,
  faqsValidator,
  seoDepthValidator,
  schemaCompletenessValidator,
  imagesValidator,
  contentQualityValidator,
  databaseSinglesValidator,
  databaseHealthValidator,
  slugConflictsValidator,
  seoIntentValidator,
  imageOptimizationValidator,
  heroImageTagsValidator,
  imageTagsValidator,
  lighthouseValidator,
  fieldMappingsValidator,
  orphanedFilesValidator,
  formsValidator,
  consentLegacyKeysValidator,
  bindingIntegrityValidator,
  brokenAnchorsValidator,
};
