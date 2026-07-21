/**
 * Parse lead-form field `source` config (string shorthand or object).
 *
 * String forms:
 *   "program"
 *   "program:slug=full-stack,data-science"
 * Object form:
 *   { name, query?, value?, label? }
 */

export interface FormFieldSourceConfig {
  name: string;
  query?: string;
  value?: string;
  label?: string;
}

export type FormFieldSourceInput = string | FormFieldSourceConfig;

export function parseFormFieldSource(
  source: FormFieldSourceInput,
): FormFieldSourceConfig {
  if (typeof source !== "string") {
    return {
      name: source.name,
      query: source.query || undefined,
      value: source.value || undefined,
      label: source.label || undefined,
    };
  }

  const idx = source.indexOf(":");
  if (idx === -1) {
    return { name: source.trim() };
  }

  const name = source.slice(0, idx).trim();
  const query = source.slice(idx + 1).trim();
  return {
    name,
    query: query || undefined,
  };
}

/** Build `/api/query-options?...` from a parsed source + locale. */
export function buildQueryOptionsUrl(
  source: FormFieldSourceConfig,
  locale?: string,
): string {
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
