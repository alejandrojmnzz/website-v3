/**
 * Validate a published (or about-to-publish) variant layer with entry-local validators.
 */

import { ValidationService } from "../../scripts/validation/service";
import { ENTRY_LOCAL_VALIDATOR_NAMES } from "../../scripts/validation/shared/runClass";
import { entryKeyFromContentFile } from "../../scripts/validation/shared/entryKey";
import { getCanonicalUrl } from "../../scripts/validation/shared/canonicalUrls";
import type {
  ContentFile,
  ValidationIssue,
  ValidatorResult,
} from "../../scripts/validation/shared/types";
import type { ContentIndex } from "../content-index";
import { deepMerge } from "../utils/deepMerge";

export type VariantValidationResult = {
  ok: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  entryKey: string;
  /** Synthetic ContentFile used for the run (for cache apply). */
  contentFile?: ContentFile;
  /** Raw entry-local validator results (for cache apply when ok or warnings-only). */
  validators?: ValidatorResult[];
};

function hasRedirects(meta: unknown): boolean {
  if (!meta || typeof meta !== "object") return false;
  const redirects = (meta as { redirects?: unknown }).redirects;
  return Array.isArray(redirects) && redirects.length > 0;
}

function issueTouchesFile(issue: ValidationIssue, filePath: string): boolean {
  if (!issue.file) return true;
  return (
    issue.file === filePath ||
    issue.file.endsWith(filePath) ||
    filePath.endsWith(issue.file)
  );
}

/**
 * Run entry-local validators against merged common + variant YAML.
 * Rejects if meta.redirects is present on the variant file (variants cannot own redirects).
 */
export async function validatePublishedVariantLayer(args: {
  contentType: string;
  slug: string;
  locale: string;
  variantSlug: string;
  contentRoot: string;
  ci: ContentIndex;
  /** Raw variant file data (before merge) for redirect check */
  variantRaw: Record<string, unknown>;
  commonData: Record<string, unknown>;
}): Promise<VariantValidationResult> {
  const entryKey = `${args.contentType}/${args.slug}/${args.locale}@${args.variantSlug}`;

  if (hasRedirects(args.variantRaw.meta)) {
    return {
      ok: false,
      entryKey,
      errors: [
        {
          type: "error",
          code: "VARIANT_REDIRECTS_FORBIDDEN",
          message:
            "Published variants cannot have meta.redirects. Remove redirects from the variant YAML (redirects belong on the live locale file only).",
          suggestion: "Delete meta.redirects from the variant file, then assign traffic again.",
        },
      ],
      warnings: [],
    };
  }

  const merged = deepMerge(args.commonData, args.variantRaw) as Record<string, unknown>;
  if (merged.meta && typeof merged.meta === "object" && !Array.isArray(merged.meta)) {
    const { redirects: _r, ...rest } = merged.meta as Record<string, unknown>;
    merged.meta = rest;
  }

  const result = args.ci.loadMergedContent(
    args.contentType,
    args.slug,
    args.locale,
    args.variantSlug,
  );
  const filePath = result.filePath;

  const synthetic: ContentFile = {
    slug: args.slug,
    title: (typeof merged.title === "string" ? merged.title : args.slug) as string,
    description: typeof merged.description === "string" ? merged.description : undefined,
    meta: merged.meta as ContentFile["meta"],
    schema: merged.schema as ContentFile["schema"],
    seo: merged.seo as ContentFile["seo"],
    type: args.contentType,
    locale: args.locale,
    filePath,
    variant: args.variantSlug,
    entryFields: merged,
  };

  const service = new ValidationService();
  await service.buildContext({ contentRoot: args.contentRoot, ci: args.ci });
  const context = service.getContext();
  if (!context) {
    return {
      ok: false,
      entryKey,
      errors: [
        {
          type: "error",
          code: "VALIDATION_CONTEXT_FAILED",
          message: "Failed to build validation context",
        },
      ],
      warnings: [],
    };
  }

  const liveSibling = context.contentFiles.find(
    (f) =>
      f.type === args.contentType &&
      f.slug === args.slug &&
      f.locale === args.locale &&
      !f.variant,
  );
  synthetic.url = liveSibling ? getCanonicalUrl(liveSibling) : getCanonicalUrl(synthetic);

  const allFiles = context.contentFiles;
  context.contentFiles = [
    ...allFiles.filter(
      (f) =>
        !(
          f.type === args.contentType &&
          f.slug === args.slug &&
          f.locale === args.locale &&
          f.variant === args.variantSlug
        ),
    ),
    synthetic,
  ];

  try {
    const run = await service.runValidators({
      validators: [...ENTRY_LOCAL_VALIDATOR_NAMES],
      includeArtifacts: false,
    });
    const scopedValidators: ValidatorResult[] = run.validators.map((v) => ({
      ...v,
      errors: v.errors.filter((e) => issueTouchesFile(e, filePath)),
      warnings: v.warnings.filter((w) => issueTouchesFile(w, filePath)),
    }));
    const errors: ValidationIssue[] = [];
    const warnings: ValidationIssue[] = [];
    for (const v of scopedValidators) {
      for (const e of v.errors) {
        errors.push({ ...e, validator: v.name });
      }
      for (const w of v.warnings) {
        warnings.push({ ...w, validator: v.name });
      }
    }

    return {
      ok: errors.length === 0,
      entryKey: entryKeyFromContentFile(synthetic),
      errors,
      warnings,
      contentFile: synthetic,
      validators: scopedValidators,
    };
  } finally {
    context.contentFiles = allFiles;
  }
}
