/**
 * Parse lead-form field `source` config (string shorthand or object).
 *
 * String forms (catalog only):
 *   "program"
 *   "program:slug=full-stack,data-science"
 * Object form:
 *   { name, query?, value?, label? }           — catalog via /api/query-options
 *   { relation, value?, label? }               — entry CT relation field
 *
 * Exactly one of `name` | `relation` when object (string shorthand = name).
 */

export interface FormFieldSourceConfig {
  /** Catalog CT/DB source name for /api/query-options */
  name?: string;
  /** Entry content-type relation field name (≡ single.<field>) */
  relation?: string;
  query?: string;
  value?: string;
  label?: string;
}

export type FormFieldSourceInput = string | FormFieldSourceConfig;

export type ParseFormFieldSourceResult =
  | { ok: true; config: FormFieldSourceConfig }
  | { ok: false; error: string };

/**
 * Parse + validate source. Prefer this when you need relation/name exclusivity errors.
 */
export function parseFormFieldSourceStrict(
  source: FormFieldSourceInput,
): ParseFormFieldSourceResult {
  if (typeof source === "string") {
    const idx = source.indexOf(":");
    if (idx === -1) {
      const name = source.trim();
      if (!name) return { ok: false, error: "source name is empty" };
      return { ok: true, config: { name } };
    }
    const name = source.slice(0, idx).trim();
    const query = source.slice(idx + 1).trim();
    if (!name) return { ok: false, error: "source name is empty" };
    return {
      ok: true,
      config: { name, query: query || undefined },
    };
  }

  const name =
    typeof source.name === "string" && source.name.trim()
      ? source.name.trim()
      : undefined;
  const relation =
    typeof source.relation === "string" && source.relation.trim()
      ? source.relation.trim()
      : undefined;

  if (name && relation) {
    return {
      ok: false,
      error: "source cannot set both name (catalog) and relation (entry field)",
    };
  }
  if (!name && !relation) {
    return {
      ok: false,
      error: "source must set either name (catalog) or relation (entry field)",
    };
  }

  return {
    ok: true,
    config: {
      name,
      relation,
      query: source.query || undefined,
      value: source.value || undefined,
      label: source.label || undefined,
    },
  };
}

/**
 * Parse source for runtime. Catalog string shorthand unchanged.
 * Invalid objects (both/neither) return a config with empty name for backward compat
 * callers that only check name — prefer parseFormFieldSourceStrict for validation.
 */
export function parseFormFieldSource(
  source: FormFieldSourceInput,
): FormFieldSourceConfig {
  const strict = parseFormFieldSourceStrict(source);
  if (strict.ok) return strict.config;
  if (typeof source !== "string") {
    return {
      name: source.name,
      relation: source.relation,
      query: source.query || undefined,
      value: source.value || undefined,
      label: source.label || undefined,
    };
  }
  return { name: source.trim() || undefined };
}

/** Build `/api/query-options?...` from a catalog source + locale. Requires config.name. */
export function buildQueryOptionsUrl(
  source: FormFieldSourceConfig,
  locale?: string,
): string {
  if (!source.name) {
    throw new Error("buildQueryOptionsUrl requires source.name (catalog)");
  }
  const params = new URLSearchParams();
  params.set("source", source.name);
  if (source.value) params.set("value", source.value);
  if (source.label) params.set("label", source.label);
  if (locale) params.set("locale", locale);

  if (source.query) {
    const extra = new URLSearchParams(source.query);
    extra.forEach((val, key) => {
      if (!params.has(key)) params.set(key, val);
    });
  }

  return `/api/query-options?${params.toString()}`;
}
