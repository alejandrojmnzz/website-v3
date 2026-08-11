import type { Validator, ValidatorResult, ValidationContext, ValidationIssue } from "../shared/types";
import { resolveContentTypeUrl } from "../../../server/content-types";

export const seoDepthValidator: Validator = {
  name: "seo-depth",
  description: "Validates SEO depth: title/description length, OG image, canonical URL, and duplicates",
  apiExposed: true,
  estimatedDuration: "fast",
  category: "seo",

  async run(context: ValidationContext): Promise<ValidatorResult> {
    const startTime = Date.now();
    const errors: ValidationIssue[] = [];
    const warnings: ValidationIssue[] = [];

    const titleMap = new Map<string, string[]>();
    const descriptionMap = new Map<string, string[]>();
    let pagesWithOptimalTitles = 0;
    let pagesWithOptimalDescriptions = 0;

    for (const file of context.contentFiles) {
      const pageTitle = file.meta?.page_title;
      const description = file.meta?.description;
      if (pageTitle) {
        if (pageTitle.length < 30) {
          warnings.push({
            type: "warning",
            code: "TITLE_TOO_SHORT",
            message: `Page title is too short (${pageTitle.length} chars): "${pageTitle}"`,
            file: file.filePath,
            suggestion: "Aim for a page title between 30-60 characters for optimal SEO",
          });
        } else if (pageTitle.length > 60) {
          warnings.push({
            type: "warning",
            code: "TITLE_TOO_LONG",
            message: `Page title is too long (${pageTitle.length} chars): "${pageTitle.substring(0, 60)}..."`,
            file: file.filePath,
            suggestion: "Keep page title under 60 characters to avoid truncation in search results",
          });
        } else {
          pagesWithOptimalTitles++;
        }

        const existing = titleMap.get(pageTitle) || [];
        existing.push(file.filePath);
        titleMap.set(pageTitle, existing);
      }

      if (description) {
        if (description.length < 70) {
          warnings.push({
            type: "warning",
            code: "DESCRIPTION_TOO_SHORT",
            message: `Description is too short (${description.length} chars)`,
            file: file.filePath,
            suggestion: "Aim for a meta description between 70-160 characters",
          });
        } else if (description.length > 160) {
          warnings.push({
            type: "warning",
            code: "DESCRIPTION_TOO_LONG",
            message: `Description is too long (${description.length} chars)`,
            file: file.filePath,
            suggestion: "Keep meta description under 160 characters to avoid truncation",
          });
        } else {
          pagesWithOptimalDescriptions++;
        }

        const existing = descriptionMap.get(description) || [];
        existing.push(file.filePath);
        descriptionMap.set(description, existing);
      }

      if (!file.meta?.og_image) {
        warnings.push({
          type: "warning",
          code: "MISSING_OG_IMAGE",
          message: "Missing og_image in meta",
          file: file.filePath,
          suggestion:
            "Add meta.og_image, or call regenerate_entry_previews with this slug and locales when the content type has preview: / og_image_preview configured",
        });
      }

      if (!file.meta?.canonical_url) {
        const resolvedPath = resolveContentTypeUrl(
          file.type,
          { slug: file.slug },
          file.locale,
        );
        const isResolvable =
          resolvedPath !== null &&
          !resolvedPath.includes(":") &&
          !resolvedPath.includes("undefined");
        if (!isResolvable) {
          warnings.push({
            type: "warning",
            code: "MISSING_CANONICAL",
            message: "Missing canonical_url in meta",
            file: file.filePath,
            suggestion: "Add a canonical_url to avoid duplicate content issues",
          });
        }
      }
    }

    let duplicateTitles = 0;
    titleMap.forEach((files, title) => {
      if (files.length > 1) {
        duplicateTitles++;
        errors.push({
          type: "error",
          code: "DUPLICATE_TITLE",
          message: `Duplicate page_title "${title}" used by ${files.length} files`,
          file: files[0],
          suggestion: `Also used in: ${files.slice(1).join(", ")}`,
        });
      }
    });

    let duplicateDescriptions = 0;
    descriptionMap.forEach((files, desc) => {
      if (files.length > 1) {
        duplicateDescriptions++;
        errors.push({
          type: "error",
          code: "DUPLICATE_DESCRIPTION",
          message: `Duplicate description used by ${files.length} files: "${desc.substring(0, 60)}..."`,
          file: files[0],
          suggestion: `Also used in: ${files.slice(1).join(", ")}`,
        });
      }
    });

    const duration = Date.now() - startTime;
    return {
      name: this.name,
      description: this.description,
      status: errors.length > 0 ? "failed" : warnings.length > 0 ? "warning" : "passed",
      errors,
      warnings,
      duration,
      artifacts: {
        pagesChecked: context.contentFiles.length,
        pagesWithOptimalTitles,
        pagesWithOptimalDescriptions,
        duplicateTitles,
        duplicateDescriptions,
      },
    };
  },
};
