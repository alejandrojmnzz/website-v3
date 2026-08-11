/**
 * Validate / coerce `editor.type: json` fields in save payloads.
 */
import {
  coerceJsonFieldInput,
  compileJsonSchema,
  type JsonSchema,
} from "@shared/json-field";
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
 */
export function validateAndCoerceJsonFields(
  fields: Record<string, unknown>,
  editor: Record<string, { type?: string; schema?: unknown }> | undefined | null,
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
