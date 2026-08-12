/**
 * Validate / coerce `editor.type: relation` fields in save payloads.
 */
import {
  coerceRelationFieldInput,
  type RelationEditorHint,
} from "@shared/relation-field";
import type { ContentTypeEditorHint } from "./content-types";

export type RelationFieldValidationFailure = {
  field: string;
  error: string;
};

export type ValidateRelationFieldsResult =
  | { ok: true; fields: Record<string, unknown> }
  | { ok: false; failures: RelationFieldValidationFailure[] };

export function validateEditorHintsHaveRelationSources(
  editor: Record<string, ContentTypeEditorHint | { type?: string; source?: string }> | undefined | null,
): { ok: true } | { ok: false; error: string; field?: string } {
  if (!editor || typeof editor !== "object") return { ok: true };
  for (const [field, hint] of Object.entries(editor)) {
    if (!hint || hint.type !== "relation") continue;
    if (!hint.source || typeof hint.source !== "string" || !hint.source.trim()) {
      return {
        ok: false,
        field,
        error: `editor.${field}: type relation requires a non-empty source (content type or database slug)`,
      };
    }
  }
  return { ok: true };
}

export function validateAndCoerceRelationFields(
  fields: Record<string, unknown>,
  editor: Record<string, ContentTypeEditorHint | RelationEditorHint> | undefined | null,
): ValidateRelationFieldsResult {
  if (!editor) return { ok: true, fields };
  const out = { ...fields };
  const failures: RelationFieldValidationFailure[] = [];

  for (const [field, hint] of Object.entries(editor)) {
    if (!hint || hint.type !== "relation") continue;
    if (!Object.prototype.hasOwnProperty.call(fields, field)) continue;
    const coerced = coerceRelationFieldInput(fields[field], hint as RelationEditorHint);
    if (!coerced.ok) {
      failures.push({ field, error: coerced.error });
      continue;
    }
    out[field] = coerced.value;
  }

  if (failures.length) return { ok: false, failures };
  return { ok: true, fields: out };
}

export function relationFieldFailureHttpBody(failures: RelationFieldValidationFailure[]) {
  const first = failures[0];
  return {
    error: first
      ? `Invalid relation field "${first.field}": ${first.error}`
      : "Invalid relation field(s)",
    details: failures,
  };
}
