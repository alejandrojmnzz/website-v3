/**
 * Live SEO meta must resolve to real page_title + description (no leftover {{ }}).
 */

export type MetaFieldError = {
  field: "meta.page_title" | "meta.description";
  message: string;
};

export type ValidateRequiredMetaResult =
  | { ok: true }
  | { ok: false; errors: MetaFieldError[] };

const TEMPLATE_RE = /\{\{[\s\S]*?\}\}/;

function isUsableMetaString(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (TEMPLATE_RE.test(trimmed)) return false;
  return true;
}

/**
 * Validate resolved meta for a live page/entry.
 * Pass meta *after* {{ single.* }} (and similar) resolution.
 */
export function validateRequiredMeta(
  meta: unknown,
): ValidateRequiredMetaResult {
  const errors: MetaFieldError[] = [];
  const m =
    meta && typeof meta === "object" && !Array.isArray(meta)
      ? (meta as Record<string, unknown>)
      : {};

  if (!isUsableMetaString(m.page_title)) {
    errors.push({
      field: "meta.page_title",
      message:
        "meta.page_title is required before saving a live page (must be non-empty and fully resolved — no {{ }} templates).",
    });
  }
  if (!isUsableMetaString(m.description)) {
    errors.push({
      field: "meta.description",
      message:
        "meta.description is required before saving a live page (must be non-empty and fully resolved — no {{ }} templates).",
    });
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true };
}

export function formatMetaValidationErrors(
  result: ValidateRequiredMetaResult,
): string | null {
  if (result.ok) return null;
  return result.errors.map((e) => e.message).join(" ");
}
