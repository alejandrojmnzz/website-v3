/**
 * Semantic rules for blog (and similar) `call_to_action` JSON fields.
 * JSON Schema checks structure; this enforces conversion_name + CRM tag allowlists.
 */

export type CallToActionSemanticsOpts = {
  conversionNames: string[];
  /** CRM tag allowlist from tracking.leads_expected_tags (CRM-agnostic). */
  crmTags: string[];
};

export type CallToActionSemanticsResult =
  | { ok: true }
  | { ok: false; error: string };

function splitCrmTags(raw: string): string[] {
  return raw
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

/**
 * Validate a coerced `call_to_action` object (or null/undefined = unset).
 */
export function validateCallToActionSemantics(
  value: unknown,
  opts: CallToActionSemanticsOpts,
): CallToActionSemanticsResult {
  if (value === null || value === undefined) return { ok: true };
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, error: "call_to_action must be an object or null" };
  }

  const obj = value as Record<string, unknown>;
  const conversionName = obj.conversion_name;
  if (typeof conversionName !== "string" || !conversionName.trim()) {
    return { ok: false, error: "call_to_action.conversion_name is required" };
  }
  const name = conversionName.trim();
  if (opts.conversionNames.length > 0 && !opts.conversionNames.includes(name)) {
    return {
      ok: false,
      error: `call_to_action.conversion_name "${name}" is not valid. Valid values: ${opts.conversionNames.join(", ")}. Call explain_site topic component-behaviors.`,
    };
  }

  const tagsRaw = obj.tags;
  if (tagsRaw === undefined || tagsRaw === null || tagsRaw === "") {
    return { ok: true };
  }
  if (typeof tagsRaw !== "string") {
    return { ok: false, error: "call_to_action.tags must be a string" };
  }

  const tokens = splitCrmTags(tagsRaw);
  if (tokens.length === 0) return { ok: true };

  if (opts.crmTags.length === 0) {
    return {
      ok: false,
      error:
        "call_to_action.tags is set but tracking.leads_expected_tags is empty. " +
        "Ask a human / populate Expected CRM tags in Leads settings. Never invent tags. " +
        "Or omit tags and rely on conversion event defaults.",
    };
  }

  const unknown = tokens.filter((t) => !opts.crmTags.includes(t));
  if (unknown.length > 0) {
    return {
      ok: false,
      error:
        `call_to_action.tags contains unknown CRM tag(s): ${unknown.join(", ")}. ` +
        `Allowed: ${opts.crmTags.join(", ")}. Ask a human if unsure — never invent tags. ` +
        `Call explain_site topic component-behaviors.`,
    };
  }

  return { ok: true };
}
