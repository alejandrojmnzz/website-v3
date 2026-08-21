/**
 * Per-field "required for publish" — editor.<field>.required: true | "attached".
 * Drafts may be empty; live publish/update requires satisfied values when the mode applies.
 */

import { coerceJsonFieldInput, type JsonSchema } from "./json-field";
import { validateCallToActionSemantics } from "./call-to-action-field";

/** `true` = always on live; `"attached"` = only when shared-layout and not detached. */
export type EditorRequiredFlag = boolean | "attached";

export type EditorRequiredHint = {
  required?: EditorRequiredFlag;
  type?: string;
  schema?: Record<string, unknown>;
};

export type RequiredFieldError = {
  field: string;
  message: string;
  /** `true` | `attached` for the editor.required mode that triggered this error. */
  requiredMode?: true | "attached";
};

export type ValidateRequiredFieldsResult =
  | { ok: true }
  | { ok: false; errors: RequiredFieldError[] };

export type ListRequiredEditorFieldsOpts = {
  /** When false/undefined and required is "attached", treat as always required. */
  isSharedLayout?: boolean;
  /** When true, skip fields with required: "attached". */
  isDetached?: boolean;
};

export type ValidateRequiredFieldsOpts = ListRequiredEditorFieldsOpts & {
  /** tracking.conversion_events names — for call_to_action semantics. */
  conversionNames?: string[];
  /** tracking.leads_expected_tags — for call_to_action semantics. */
  crmTags?: string[];
};

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

/** Normalize YAML/editor required flag. */
export function normalizeRequiredFlag(
  required: unknown,
): true | "attached" | false {
  if (required === true) return true;
  if (required === "attached") return "attached";
  return false;
}

/**
 * Whether this required flag applies given shared-layout / detach state.
 * Non-shared-layout: "attached" is treated as always required.
 */
export function requiredFlagApplies(
  flag: true | "attached" | false,
  opts: ListRequiredEditorFieldsOpts = {},
): boolean {
  if (flag === false) return false;
  if (flag === true) return true;
  // attached
  if (!opts.isSharedLayout) return true;
  if (opts.isDetached) return false;
  return true;
}

export function emptyRequiredFieldMessage(
  key: string,
  mode: true | "attached",
): string {
  if (mode === "attached") {
    return (
      `Field "${key}" is required when the entry is attached to the shared layout ` +
      `(editor.required: attached) and cannot be empty on a live entry.`
    );
  }
  return (
    `Field "${key}" is required for publish (editor.required: true) ` +
    `and cannot be empty on a live entry.`
  );
}

export function nestedRequiredFieldMessage(
  dottedPath: string,
  mode: true | "attached",
  detail: string,
): string {
  const modeBit =
    mode === "attached"
      ? "entry attached; editor.required: attached"
      : "editor.required: true";
  return `Field "${dottedPath}" is required by editor schema (${modeBit}). ${detail}`.trim();
}

/**
 * Collect field keys whose required flag applies for this entry context.
 */
export function listRequiredEditorFields(
  editor: Record<string, EditorRequiredHint> | null | undefined,
  opts: ListRequiredEditorFieldsOpts = {},
): string[] {
  if (!editor) return [];
  return Object.entries(editor)
    .filter(([, hint]) => {
      const flag = normalizeRequiredFlag(hint?.required);
      return requiredFlagApplies(flag, opts);
    })
    .map(([key]) => key);
}

/** Required mode for a key if it applies; otherwise null. */
export function effectiveRequiredMode(
  hint: EditorRequiredHint | null | undefined,
  opts: ListRequiredEditorFieldsOpts = {},
): true | "attached" | null {
  const flag = normalizeRequiredFlag(hint?.required);
  if (!requiredFlagApplies(flag, opts)) return null;
  return flag === "attached" ? "attached" : true;
}

function schemaPathToDotted(field: string, schemaPath: string): string {
  const cleaned = schemaPath.replace(/^\//, "").replace(/\//g, ".");
  if (!cleaned) return field;
  return `${field}.${cleaned}`;
}

/**
 * Check one required field: non-empty + JSON schema (+ CTA semantics when applicable).
 */
export function satisfyRequiredEditorField(
  key: string,
  value: unknown,
  hint: EditorRequiredHint | null | undefined,
  mode: true | "attached",
  opts: ValidateRequiredFieldsOpts = {},
): RequiredFieldError[] {
  if (isEmptyRequiredValue(value)) {
    return [{ field: key, message: emptyRequiredFieldMessage(key, mode), requiredMode: mode }];
  }

  if (hint?.type !== "json" || !hint.schema || typeof hint.schema !== "object") {
    return [];
  }

  const coerced = coerceJsonFieldInput(value, hint.schema as JsonSchema);
  if (!coerced.ok) {
    const errors: RequiredFieldError[] = [];
    if (coerced.errors && coerced.errors.length > 0) {
      for (const e of coerced.errors) {
        const dotted = schemaPathToDotted(key, e.path);
        errors.push({
          field: dotted,
          message: nestedRequiredFieldMessage(dotted, mode, e.message),
          requiredMode: mode,
        });
      }
    } else {
      errors.push({
        field: key,
        message: nestedRequiredFieldMessage(key, mode, coerced.error),
        requiredMode: mode,
      });
    }
    return errors;
  }

  if (key === "call_to_action") {
    const semantic = validateCallToActionSemantics(coerced.value, {
      conversionNames: opts.conversionNames ?? [],
      crmTags: opts.crmTags ?? [],
    });
    if (!semantic.ok) {
      const pathHint = semantic.error.includes("conversion_name")
        ? `${key}.conversion_name`
        : semantic.error.includes("tags")
          ? `${key}.tags`
          : key;
      return [
        {
          field: pathHint,
          message: nestedRequiredFieldMessage(pathHint, mode, semantic.error),
          requiredMode: mode,
        },
      ];
    }
  }

  return [];
}

export type ValidateRequiredFieldsMode = "publish" | "live_update";

/** Validate only selected required editor keys (micro-save). */
export function validateRequiredFieldsForKeys(
  editor: Record<string, EditorRequiredHint> | null | undefined,
  entryValues: Record<string, unknown>,
  keysToCheck: readonly string[],
  _mode: ValidateRequiredFieldsMode = "publish",
  opts: ValidateRequiredFieldsOpts = {},
): ValidateRequiredFieldsResult {
  if (keysToCheck.length === 0) return { ok: true };
  const required = new Set(listRequiredEditorFields(editor, opts));
  const errors: RequiredFieldError[] = [];
  for (const key of keysToCheck) {
    if (!required.has(key)) continue;
    const hint = editor?.[key];
    const mode = effectiveRequiredMode(hint, opts);
    if (!mode) continue;
    const value =
      key.includes(".")
        ? getNestedValue(entryValues, key)
        : entryValues[key];
    errors.push(...satisfyRequiredEditorField(key, value, hint, mode, opts));
  }
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true };
}

export function validateRequiredFields(
  editor: Record<string, EditorRequiredHint> | null | undefined,
  entryValues: Record<string, unknown>,
  _mode: ValidateRequiredFieldsMode = "publish",
  opts: ValidateRequiredFieldsOpts = {},
): ValidateRequiredFieldsResult {
  const keys = listRequiredEditorFields(editor, opts);
  return validateRequiredFieldsForKeys(editor, entryValues, keys, _mode, opts);
}

export function formatRequiredFieldErrors(
  result: ValidateRequiredFieldsResult,
): string | null {
  if (result.ok) return null;
  return result.errors.map((e) => e.message).join(" ");
}
