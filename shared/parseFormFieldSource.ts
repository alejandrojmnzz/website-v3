/**
 * Parse lead-form field `source` config.
 *
 * Object form (canonical):
 *   { content_type, query?, value?, label? }   — catalog via /api/query-options
 *   { database, query?, value?, label? }       — private DB catalog
 *   { relation, value?, label? }               — entry CT relation field
 *
 * Exactly one of content_type | database | relation.
 *
 * Legacy (still parsed, not taught):
 *   string "program" / "program:slug=a,b"
 *   { name }  — treated as content_type
 */

export interface FormFieldSourceConfig {
  /** Catalog content-type key for /api/query-options */
  content_type?: string;
  /** Private database slug for /api/query-options */
  database?: string;
  /** @deprecated Prefer content_type or database. Still read during migration. */
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

function catalogKey(config: FormFieldSourceConfig): string | undefined {
  return config.content_type || config.database || config.name || undefined;
}

function countCatalogKinds(config: {
  content_type?: string;
  database?: string;
  name?: string;
  relation?: string;
}): number {
  return [
    config.content_type,
    config.database,
    config.relation,
    !config.content_type && !config.database ? config.name : undefined,
  ].filter((v) => typeof v === "string" && v.trim()).length;
}

/**
 * Parse + validate source. Prefer this when you need exclusivity errors.
 */
export function parseFormFieldSourceStrict(
  source: FormFieldSourceInput,
): ParseFormFieldSourceResult {
  if (typeof source === "string") {
    const idx = source.indexOf(":");
    if (idx === -1) {
      const name = source.trim();
      if (!name) return { ok: false, error: "source name is empty" };
      return { ok: true, config: { content_type: name, name } };
    }
    const name = source.slice(0, idx).trim();
    const query = source.slice(idx + 1).trim();
    if (!name) return { ok: false, error: "source name is empty" };
    return {
      ok: true,
      config: { content_type: name, name, query: query || undefined },
    };
  }

  const content_type =
    typeof source.content_type === "string" && source.content_type.trim()
      ? source.content_type.trim()
      : undefined;
  const database =
    typeof source.database === "string" && source.database.trim()
      ? source.database.trim()
      : undefined;
  const name =
    typeof source.name === "string" && source.name.trim()
      ? source.name.trim()
      : undefined;
  const relation =
    typeof source.relation === "string" && source.relation.trim()
      ? source.relation.trim()
      : undefined;

  const kinds = countCatalogKinds({ content_type, database, name, relation });
  if (kinds > 1) {
    return {
      ok: false,
      error: "source cannot set more than one of content_type, database, or relation",
    };
  }
  if (kinds === 0) {
    return {
      ok: false,
      error: "source must set content_type, database, or relation",
    };
  }

  const resolvedType = content_type || (!database && !relation ? name : undefined);

  const config: FormFieldSourceConfig = {};
  if (resolvedType) {
    config.content_type = resolvedType;
    config.name = resolvedType;
  }
  if (database) {
    config.database = database;
    if (!config.name) config.name = database;
  }
  if (relation) config.relation = relation;
  if (source.query) config.query = source.query;
  if (source.value) config.value = source.value;
  if (source.label) config.label = source.label;
  if (!config.name && name) config.name = name;

  return { ok: true, config };
}

/**
 * Parse source for runtime. Invalid objects return a best-effort config.
 */
export function parseFormFieldSource(
  source: FormFieldSourceInput,
): FormFieldSourceConfig {
  const strict = parseFormFieldSourceStrict(source);
  if (strict.ok) return strict.config;
  if (typeof source !== "string") {
    const content_type = source.content_type || (!source.database ? source.name : undefined);
    return {
      content_type,
      database: source.database,
      name: content_type || source.database || source.name,
      relation: source.relation,
      query: source.query || undefined,
      value: source.value || undefined,
      label: source.label || undefined,
    };
  }
  const trimmed = source.trim();
  return { content_type: trimmed || undefined, name: trimmed || undefined };
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
  const legacy = source.name;
  if (!contentType && !database && !legacy) {
    throw new Error("buildQueryOptionsUrl requires source.content_type or source.database");
  }
  const params = new URLSearchParams();
  if (contentType) {
    params.set("content_type", contentType);
    params.set("source", contentType);
  } else if (database) {
    params.set("database", database);
    params.set("source", database);
  } else if (legacy) {
    params.set("source", legacy);
  }
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
