/**
 * Validate / coerce `editor.type: json` fields in save payloads.
 */
import {
  coerceJsonFieldInput,
  compileJsonSchema,
  type JsonSchema,
} from "@shared/json-field";
import { validateCallToActionSemantics } from "@shared/call-to-action-field";
import type { ContentTypeEditorHint } from "./content-types";

export type JsonFieldValidationFailure = {
  field: string;
  error: string;
  errors?: Array<{ path: string; message: string }>;
  schema?: JsonSchema;
};

export type ValidateJsonFieldsResult =
  | { ok: true; fields: Record<string, unknown> }
  | { ok: false; failures: JsonFieldValidationFailure[] };

export type JsonFieldSemanticContext = {
  /** Known tracking.conversion_events names */
  conversionNames?: string[];
  /** tracking.leads_expected_tags CRM allowlist */
  crmTags?: string[];
};

export function validateEditorHintsHaveJsonSchemas(
  editor: Record<string, ContentTypeEditorHint | { type?: string; schema?: unknown }> | undefined | null,
): { ok: true } | { ok: false; error: string; field?: string } {
  if (!editor || typeof editor !== "object") return { ok: true };
  for (const [field, hint] of Object.entries(editor)) {
    if (!hint || hint.type !== "json") continue;
    if (!hint.schema || typeof hint.schema !== "object" || Array.isArray(hint.schema)) {
      return {
        ok: false,
        field,
        error: `editor.${field}: type json requires a compilable schema object`,
      };
    }
    const compiled = compileJsonSchema(hint.schema);
    if (!compiled.ok) {
      return { ok: false, field, error: `editor.${field}: ${compiled.error}` };
    }
  }
  return { ok: true };
}

/**
 * For each key in `fields` whose editor type is json: coerce (parse string once) + schema-validate.
 * Non-json keys pass through unchanged. Missing editor type → pass through.
 * When `semantics` is provided, `call_to_action` also checks conversion_name + CRM tags.
 */
export function validateAndCoerceJsonFields(
  fields: Record<string, unknown>,
  editor: Record<string, { type?: string; schema?: unknown }> | undefined | null,
  semantics?: JsonFieldSemanticContext,
): ValidateJsonFieldsResult {
  if (!editor) return { ok: true, fields: { ...fields } };
  const out: Record<string, unknown> = { ...fields };
  const failures: JsonFieldValidationFailure[] = [];

  for (const [field, raw] of Object.entries(fields)) {
    const hint = editor[field];
    if (!hint || hint.type !== "json") continue;
    const schema =
      hint.schema && typeof hint.schema === "object" && !Array.isArray(hint.schema)
        ? (hint.schema as JsonSchema)
        : null;
    const coerced = coerceJsonFieldInput(raw, schema);
    if (!coerced.ok) {
      failures.push({
        field,
        error: coerced.error,
        errors: coerced.errors,
        schema: coerced.schema ?? (schema ?? undefined),
      });
      continue;
    }
    out[field] = coerced.value;

    if (field === "call_to_action" && semantics) {
      const semantic = validateCallToActionSemantics(coerced.value, {
        conversionNames: semantics.conversionNames ?? [],
        crmTags: semantics.crmTags ?? [],
      });
      if (!semantic.ok) {
        failures.push({ field, error: semantic.error });
      }
    }
  }

  if (failures.length > 0) return { ok: false, failures };
  return { ok: true, fields: out };
}

export function jsonFieldFailureHttpBody(failures: JsonFieldValidationFailure[]) {
  const first = failures[0];
  return {
    error: first
      ? `Invalid json field "${first.field}": ${first.error}`
      : "Invalid json field(s)",
    details: failures,
    schema: first?.schema,
    errors: first?.errors,
  };
}
