import { getAllTypes, getContentTypeConfig } from "./content-types";
import { databaseManager, type DatabaseManager } from "./database";
import {
  queryEntries,
  type QueryFilter,
  type QueryEntriesOptions,
} from "./query-entries";
import { child } from "./logger";

const log = child({ module: "query-options" });

const RESERVED_QUERY_KEYS = new Set([
  "source",
  "value",
  "label",
  "sort",
  "limit",
  "locale",
]);

export type ResolvedSource =
  | { kind: "contentType"; name: string }
  | { kind: "database"; name: string }
  | { kind: "collision"; name: string }
  | { kind: "not_found"; name: string };

export interface QueryOption {
  value: string;
  label: string;
}

/** Exact-name collisions between content-type keys and database slugs. */
export function findSourceNameCollisions(
  contentRoot?: string,
  db: DatabaseManager = databaseManager,
): string[] {
  const dbNames = new Set(db.list().map((d) => d.name));
  return getAllTypes(contentRoot).filter((t) => dbNames.has(t));
}

export function logSourceNameCollisions(
  contentRoot?: string,
  db: DatabaseManager = databaseManager,
): string[] {
  const collisions = findSourceNameCollisions(contentRoot, db);
  if (collisions.length > 0) {
    log.error(
      { collisions },
      "[QueryOptions] Content type keys collide with database slugs — rename one side so `source` is unambiguous",
    );
  }
  return collisions;
}

export function resolveSourceName(
  name: string,
  contentRoot?: string,
  db: DatabaseManager = databaseManager,
): ResolvedSource {
  if (!name) return { kind: "not_found", name };

  const hasType = !!getContentTypeConfig(name, contentRoot);
  const hasDb = db.exists(name);

  if (hasType && hasDb) return { kind: "collision", name };
  if (hasType) return { kind: "contentType", name };
  if (hasDb) return { kind: "database", name };
  return { kind: "not_found", name };
}

/**
 * Content-type keys and database slugs share one namespace for relation /
 * query-options `source`. Reject creating a name that already exists on the
 * other side.
 */
export function assertSourceNameAvailable(
  name: string,
  as: "contentType" | "database",
  contentRoot?: string,
  db: DatabaseManager = databaseManager,
): void {
  if (!name) throw new Error("Source name is required");
  if (as === "contentType" && db.exists(name)) {
    throw new Error(
      `Cannot create content type "${name}": a database with the same slug already exists. Content-type keys and database slugs must be unique across both namespaces.`,
    );
  }
  if (as === "database" && getContentTypeConfig(name, contentRoot)) {
    throw new Error(
      `Cannot create database "${name}": a content type with the same key already exists. Content-type keys and database slugs must be unique across both namespaces.`,
    );
  }
}

export function parseFilterQueryParams(
  query: Record<string, unknown>,
): {
  filters: QueryFilter[];
  sort?: string;
  limit?: number;
  locale?: string;
  valuePath?: string;
  labelPath?: string;
  source?: string;
} {
  const source =
    typeof query.source === "string" && query.source ? query.source : undefined;
  const valuePath =
    typeof query.value === "string" && query.value ? query.value : undefined;
  const labelPath =
    typeof query.label === "string" && query.label ? query.label : undefined;
  const sort =
    typeof query.sort === "string" && query.sort ? query.sort : undefined;
  const locale =
    typeof query.locale === "string" && query.locale ? query.locale : undefined;

  let limit: number | undefined;
  if (query.limit !== undefined && query.limit !== "") {
    const n = parseInt(String(query.limit), 10);
    if (!Number.isNaN(n) && n > 0) limit = n;
  }

  const filters: QueryFilter[] = [];
  for (const [key, raw] of Object.entries(query)) {
    if (RESERVED_QUERY_KEYS.has(key)) continue;
    if (raw === undefined || raw === null || raw === "") continue;
    const str = Array.isArray(raw) ? String(raw[0]) : String(raw);
    if (!str) continue;
    const value = str.includes(",")
      ? str.split(",").map((s) => s.trim()).filter(Boolean)
      : str;
    filters.push({ field: key, value });
  }

  return { filters, sort, limit, locale, valuePath, labelPath, source };
}

function pickField(
  item: Record<string, unknown>,
  path: string,
): unknown {
  if (!path.includes(".")) return item[path];
  const parts = path.split(".");
  let cur: unknown = item;
  for (const part of parts) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

export function mapItemToOption(
  item: Record<string, unknown>,
  valuePath?: string,
  labelPath?: string,
): QueryOption | null {
  const rawValue = valuePath
    ? pickField(item, valuePath)
    : (item.bc_slug ?? item.slug ?? item.id);
  const rawLabel = labelPath
    ? pickField(item, labelPath)
    : (item.title ?? item.name ?? item.label ?? item.slug);

  const value = rawValue == null || rawValue === "" ? "" : String(rawValue);
  const label = rawLabel == null || rawLabel === "" ? "" : String(rawLabel);
  if (!value) return null;
  return { value, label: label || value };
}

export async function fetchQueryOptions(
  input: {
    source: string;
    filters?: QueryFilter[];
    sort?: string;
    limit?: number;
    locale?: string;
    valuePath?: string;
    labelPath?: string;
  },
  options: QueryEntriesOptions = {},
): Promise<
  | { ok: true; options: QueryOption[]; meta: { source: string; kind: string } }
  | { ok: false; status: number; error: string }
> {
  const contentRoot = options.contentRoot;
  const db = options.db ?? databaseManager;
  const resolved = resolveSourceName(input.source, contentRoot, db);

  if (resolved.kind === "collision") {
    return {
      ok: false,
      status: 409,
      error: `Source name "${input.source}" matches both a content type and a database — rename one to remove the collision`,
    };
  }
  if (resolved.kind === "not_found") {
    return {
      ok: false,
      status: 404,
      error: `Source "${input.source}" not found as a content type or database`,
    };
  }

  const { items, meta } = await queryEntries(
    {
      from:
        resolved.kind === "contentType"
          ? { contentType: resolved.name }
          : { database: resolved.name },
      locale: input.locale,
      filters: input.filters?.length ? input.filters : undefined,
      sort: input.sort,
      limit: input.limit,
    },
    options,
  );

  const mapped: QueryOption[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const opt = mapItemToOption(item, input.valuePath, input.labelPath);
    if (!opt || seen.has(opt.value)) continue;
    seen.add(opt.value);
    mapped.push(opt);
  }

  return {
    ok: true,
    options: mapped,
    meta: { source: meta.key, kind: resolved.kind },
  };
}
