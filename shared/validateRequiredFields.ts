/**
 * Per-field "required for publish" — editor.<field>.required: true.
 * Drafts may be empty; live publish/update requires non-empty values.
 */

export type EditorRequiredHint = {
  required?: boolean;
};

export type RequiredFieldError = {
  field: string;
  message: string;
};

export type ValidateRequiredFieldsResult =
  | { ok: true }
  | { ok: false; errors: RequiredFieldError[] };

const TEMPLATE_RE = /\{\{[\s\S]*?\}\}/;

export function isEmptyRequiredValue(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return true;
    if (TEMPLATE_RE.test(trimmed)) return true;
    return false;
  }
  if (typeof value === "number" || typeof value === "boolean") return false;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value as object).length === 0;
  return false;
}

function getNestedValue(obj: Record<string, unknown>, dotPath: string): unknown {
  const parts = dotPath.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/**
 * Collect field keys marked required in the content-type editor map.
 */
export function listRequiredEditorFields(
  editor: Record<string, EditorRequiredHint> | null | undefined,
): string[] {
  if (!editor) return [];
  return Object.entries(editor)
    .filter(([, hint]) => hint?.required === true)
    .map(([key]) => key);
}

export type ValidateRequiredFieldsMode = "publish" | "live_update";

/**
 * Validate required editor fields against merged entry values.
 * For live_update, empty values fail (cleared or never set on a live entry).
 * For publish, same non-empty rule (going live).
 */
/** Validate only selected required editor keys (micro-save). */
export function validateRequiredFieldsForKeys(
  editor: Record<string, EditorRequiredHint> | null | undefined,
  entryValues: Record<string, unknown>,
  keysToCheck: readonly string[],
  _mode: ValidateRequiredFieldsMode = "publish",
): ValidateRequiredFieldsResult {
  if (keysToCheck.length === 0) return { ok: true };
  const required = new Set(listRequiredEditorFields(editor));
  const errors: RequiredFieldError[] = [];
  for (const key of keysToCheck) {
    if (!required.has(key)) continue;
    const value =
      key.includes(".")
        ? getNestedValue(entryValues, key)
        : entryValues[key];
    if (isEmptyRequiredValue(value)) {
      errors.push({
        field: key,
        message:
          `Field "${key}" is required for publish and cannot be empty on a live entry.`,
      });
    }
  }
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true };
}

export function validateRequiredFields(
  editor: Record<string, EditorRequiredHint> | null | undefined,
  entryValues: Record<string, unknown>,
  _mode: ValidateRequiredFieldsMode = "publish",
): ValidateRequiredFieldsResult {
  const keys = listRequiredEditorFields(editor);
  return validateRequiredFieldsForKeys(editor, entryValues, keys, _mode);
}

export function formatRequiredFieldErrors(
  result: ValidateRequiredFieldsResult,
): string | null {
  if (result.ok) return null;
  return result.errors.map((e) => e.message).join(" ");
}
