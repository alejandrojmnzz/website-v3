/**
 * Validates editor.required fields are non-empty (and JSON-schema-valid) on live content entries.
 */

import type { Validator, ValidatorResult, ValidationContext, ValidationIssue } from "../shared/types";
import { getContentTypeConfig } from "../../../server/content-types";
import {
  listRequiredEditorFields,
  satisfyRequiredEditorField,
  effectiveRequiredMode,
  type EditorRequiredHint,
} from "../../../shared/validateRequiredFields";
import { isVariantLayerFile } from "../shared/draftFiles";
import {
  isEntryDetached,
  isSharedLayoutType,
} from "../../../server/shared-layout-entry";
import { getTrackingSettings } from "../../../server/settings";

function trackingOpts(contentRoot?: string): {
  conversionNames: string[];
  crmTags: string[];
} {
  try {
    const tracking = getTrackingSettings(contentRoot);
    const conversionNames = (tracking.conversion_events || [])
      .map((e) => (typeof e === "string" ? e : (e as { name?: string })?.name))
      .filter((n): n is string => typeof n === "string" && n.trim().length > 0);
    const crmTags = Array.isArray(tracking.leads_expected_tags)
      ? tracking.leads_expected_tags.filter((t): t is string => typeof t === "string")
      : [];
    return { conversionNames, crmTags };
  } catch {
    return { conversionNames: [], crmTags: [] };
  }
}

export const requiredFieldsValidator: Validator = {
  name: "required-fields",
  description:
    "Validates editor.required fields (true | attached) are satisfied on live entries",
  apiExposed: true,
  estimatedDuration: "fast",
  category: "content",

  async run(context: ValidationContext): Promise<ValidatorResult> {
    const startTime = Date.now();
    const errors: ValidationIssue[] = [];
    const warnings: ValidationIssue[] = [];
    const semantics = trackingOpts(context.contentRoot);

    for (const file of context.contentFiles) {
      if (isVariantLayerFile(file.filePath)) continue;
      const contentType = file.type;
      if (!contentType) continue;

      const config = getContentTypeConfig(contentType, context.contentRoot);
      const editor = (config?.editor || {}) as Record<string, EditorRequiredHint>;
      const shared = isSharedLayoutType(contentType, context.contentRoot);
      const detached = isEntryDetached(contentType, file.slug, context.contentRoot);
      const requiredOpts = { isSharedLayout: shared, isDetached: detached };
      const requiredKeys = listRequiredEditorFields(editor, requiredOpts);
      if (requiredKeys.length === 0) continue;

      const data = (file.entryFields || {
        title: file.title,
        description: file.description,
        slug: file.slug,
      }) as Record<string, unknown>;

      const entryLabel = `${contentType}/${file.slug}/${file.locale}`;

      for (const key of requiredKeys) {
        const hint = editor[key];
        const mode = effectiveRequiredMode(hint, requiredOpts);
        if (!mode) continue;
        const fieldErrors = satisfyRequiredEditorField(
          key,
          data[key],
          hint,
          mode,
          { ...requiredOpts, ...semantics },
        );
        for (const fe of fieldErrors) {
          const code =
            mode === "attached"
              ? "REQUIRED_ATTACHED_FIELD_EMPTY"
              : "REQUIRED_FIELD_EMPTY";
          const suggestion =
            mode === "attached"
              ? `Set a valid non-empty value for "${fe.field}" on the locale/_common fields (editor.required: attached), or detach the entry if it should own CTA/FAQ/body in sections instead of shared-template bindings.`
              : `Set a non-empty value for "${fe.field}" before publish / on live saves (editor.required: true).`;
          errors.push({
            type: "error",
            code,
            message:
              mode === "attached"
                ? `Required field "${fe.field}" is missing or invalid on live entry ${entryLabel} (editor.required: attached — enforced because this entry is attached to the shared layout). ${fe.message}`
                : `Required field "${fe.field}" is missing or invalid on live entry ${entryLabel} (editor.required: true). ${fe.message}`,
            file: file.filePath,
            suggestion,
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
