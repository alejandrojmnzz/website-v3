/**
 * Validates editor.required fields are non-empty on live content entries.
 */

import type { Validator, ValidatorResult, ValidationContext, ValidationIssue } from "../shared/types";
import { getContentTypeConfig } from "../../../server/content-types";
import {
  listRequiredEditorFields,
  isEmptyRequiredValue,
} from "../../../shared/validateRequiredFields";
import { isVariantLayerFile } from "../shared/draftFiles";

export const requiredFieldsValidator: Validator = {
  name: "required-fields",
  description: "Validates editor.required fields are non-empty on live entries",
  apiExposed: true,
  estimatedDuration: "fast",
  category: "content",

  async run(context: ValidationContext): Promise<ValidatorResult> {
    const startTime = Date.now();
    const errors: ValidationIssue[] = [];
    const warnings: ValidationIssue[] = [];

    for (const file of context.contentFiles) {
      if (isVariantLayerFile(file.filePath)) continue;
      const contentType = file.type;
      if (!contentType) continue;

      const config = getContentTypeConfig(contentType, context.contentRoot);
      const requiredKeys = listRequiredEditorFields(
        config?.editor as Record<string, { required?: boolean }> | undefined,
      );
      if (requiredKeys.length === 0) continue;

      const data = (file.entryFields || {
        title: file.title,
        description: file.description,
        slug: file.slug,
      }) as Record<string, unknown>;
      for (const key of requiredKeys) {
        if (isEmptyRequiredValue(data[key])) {
          errors.push({
            type: "error",
            code: "REQUIRED_FIELD_EMPTY",
            message: `Required field "${key}" is empty on a live entry`,
            file: file.filePath,
            suggestion: `Set a non-empty value for "${key}" (Required for publish)`,
          });
        }
      }
    }

    const duration = Date.now() - startTime;
    return {
      name: this.name,
      description: this.description,
      status: errors.length > 0 ? "failed" : "passed",
      errors,
      warnings,
      duration,
      artifacts: {
        emptyRequired: errors.length,
      },
    };
  },
};
