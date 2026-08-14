/**
 * Parse lead-form field `source` config.
 *
 * Object form (canonical):
 *   { content_type, query?, value_path, label_path }   — catalog via /api/query-options
 *   { database, query?, value_path, label_path }       — private DB catalog
 *   { related_field, value_path, label_path }          — this entry’s CT field
 *
 * Exactly one of content_type | database | related_field.
 * value_path and label_path are required whenever source is set.
 *
 * Legacy keys relation / value / label / name / string shorthand are rejected
 * (not aliased).
 */

export interface FormFieldSourceConfig {
  /** Catalog content-type key for /api/query-options */
  content_type?: string;
  /** Private database slug for /api/query-options */
  database?: string;
  /** This entry’s CT editor field name (≡ single.<field>) */
  related_field?: string;
  query?: string;
  value_path?: string;
  label_path?: string;
}

/** Raw YAML/JSON that may still contain forbidden legacy keys. */
export type FormFieldSourceRaw = FormFieldSourceConfig & {
  name?: string;
  relation?: string;
  value?: string;
  label?: string;
};

export type FormFieldSourceInput = string | FormFieldSourceRaw;

export type ParseFormFieldSourceResult =
  | { ok: true; config: FormFieldSourceConfig }
  | { ok: false; error: string };

function catalogKey(config: FormFieldSourceConfig): string | undefined {
  return config.content_type || config.database || undefined;
}

function nonempty(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function countCatalogKinds(config: {
  content_type?: string;
  database?: string;
  related_field?: string;
}): number {
  return [config.content_type, config.database, config.related_field].filter(
    (v) => typeof v === "string" && v.trim(),
  ).length;
}

function forbiddenLegacyError(source: FormFieldSourceRaw): string | null {
  if (nonempty(source.relation)) {
    return 'source.relation is not valid; use related_field (this entry’s field name)';
  }
  if (nonempty(source.value) || nonempty(source.label)) {
    return "source.value / source.label are not valid; use value_path and label_path";
  }
  if (nonempty(source.name) && !nonempty(source.content_type) && !nonempty(source.database)) {
    return "source.name is not valid; use content_type or database";
  }
  return null;
}

function requirePaths(
  source: FormFieldSourceRaw,
): { ok: true; value_path: string; label_path: string } | { ok: false; error: string } {
  const value_path = nonempty(source.value_path);
  const label_path = nonempty(source.label_path);
  if (!value_path || !label_path) {
    return {
      ok: false,
      error: "source must set value_path and label_path (dot-paths on each item)",
    };
  }
  return { ok: true, value_path, label_path };
}

/**
 * Parse + validate source. Prefer this when you need exclusivity errors.
 */
export function parseFormFieldSourceStrict(
  source: FormFieldSourceInput,
): ParseFormFieldSourceResult {
  if (typeof source === "string") {
    return {
      ok: false,
      error:
        "source must be an object with content_type, database, or related_field plus value_path and label_path",
    };
  }

  const legacy = forbiddenLegacyError(source);
  if (legacy) return { ok: false, error: legacy };

  const content_type = nonempty(source.content_type);
  const database = nonempty(source.database);
  const related_field = nonempty(source.related_field);

  const kinds = countCatalogKinds({ content_type, database, related_field });
  if (kinds > 1) {
    return {
      ok: false,
      error: "source cannot set more than one of content_type, database, or related_field",
    };
  }
  if (kinds === 0) {
    return {
      ok: false,
      error: "source must set content_type, database, or related_field",
    };
  }

  const paths = requirePaths(source);
  if (!paths.ok) return paths;

  const config: FormFieldSourceConfig = {
    value_path: paths.value_path,
    label_path: paths.label_path,
  };
  if (content_type) config.content_type = content_type;
  if (database) config.database = database;
  if (related_field) config.related_field = related_field;
  if (source.query) config.query = source.query;

  return { ok: true, config };
}

/**
 * Parse source for runtime. Invalid objects return a best-effort config
 * without inventing value_path / label_path.
 */
export function parseFormFieldSource(
  source: FormFieldSourceInput,
): FormFieldSourceConfig {
  const strict = parseFormFieldSourceStrict(source);
  if (strict.ok) return strict.config;
  if (typeof source !== "string") {
    return {
      content_type: nonempty(source.content_type),
      database: nonempty(source.database),
      related_field: nonempty(source.related_field),
      query: source.query || undefined,
      value_path: nonempty(source.value_path),
      label_path: nonempty(source.label_path),
    };
  }
  return {};
}

export function catalogSourceKey(source: FormFieldSourceConfig): string | undefined {
  return catalogKey(source);
}

/** Build `/api/query-options?...` from a catalog source + locale. */
export function buildQueryOptionsUrl(
  source: FormFieldSourceConfig,
  locale?: string,
): string {
  const contentType = source.content_type;
  const database = source.database;
  if (!contentType && !database) {
    throw new Error("buildQueryOptionsUrl requires source.content_type or source.database");
  }
  const params = new URLSearchParams();
  if (contentType) {
    params.set("content_type", contentType);
    params.set("source", contentType);
  } else if (database) {
    params.set("database", database);
    params.set("source", database);
  }
  if (source.value_path) params.set("value", source.value_path);
  if (source.label_path) params.set("label", source.label_path);
  if (locale) params.set("locale", locale);

  if (source.query) {
    const extra = new URLSearchParams(source.query);
    extra.forEach((val, key) => {
      if (!params.has(key)) params.set(key, val);
    });
  }

  return `/api/query-options?${params.toString()}`;
}
