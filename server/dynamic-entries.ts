import { databaseManager, type DatabaseManager } from "./database";
import {
  getLocaleKey,
  getLocaleDefault,
  getLocaleSource,
  resolveContentTypeUrl,
} from "./content-types";

export interface ResolveDynamicEntriesOptions {
  db?: DatabaseManager;
  contentRoot?: string;
}
import { applyTransformIfNeeded } from "./transform";
import { child } from "./logger";
const log = child({ module: "dynamic-entries" });



const SINGLE_VAR_PATTERN = /\{\{\s*single\.([a-zA-Z_][a-zA-Z0-9_.]*)\s*(?:\|\s*([^}]*?))?\s*\}\}/g;
const EXACT_SINGLE_VAR_PATTERN = /^\{\{\s*single\.([a-zA-Z_][a-zA-Z0-9_.]*)\s*(?:\|\s*([^}]*?))?\s*\}\}$/;

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

function resolveTemplateValue(template: unknown, item: Record<string, unknown>): unknown {
  if (typeof template === "string") {
    const exactMatch = template.match(EXACT_SINGLE_VAR_PATTERN);
    if (exactMatch) {
      const fieldPath = exactMatch[1];
      const fallback = exactMatch[2]?.trim();
      const value = getNestedValue(item, fieldPath);
      if (value !== undefined && value !== null) return value;
      if (fallback !== undefined) return fallback;
      return "";
    }

    if (!SINGLE_VAR_PATTERN.test(template)) return template;
    SINGLE_VAR_PATTERN.lastIndex = 0;

    return template.replace(SINGLE_VAR_PATTERN, (_match, fieldPath: string, fallback?: string) => {
      const value = getNestedValue(item, fieldPath);
      if (value !== undefined && value !== null) {
        if (typeof value === "object") return JSON.stringify(value);
        return String(value);
      }
      if (fallback !== undefined) return fallback.trim();
      return "";
    });
  }

  if (Array.isArray(template)) {
    return template.map(t => resolveTemplateValue(t, item));
  }

  if (template !== null && typeof template === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(template as Record<string, unknown>)) {
      result[key] = resolveTemplateValue(value, item);
    }
    return result;
  }

  return template;
}

function sortItems(items: Record<string, unknown>[], sortField: string): Record<string, unknown>[] {
  const desc = sortField.startsWith("-");
  const field = desc ? sortField.slice(1) : sortField;

  return [...items].sort((a, b) => {
    const aVal = a[field];
    const bVal = b[field];
    if (aVal == null && bVal == null) return 0;
    if (aVal == null) return 1;
    if (bVal == null) return -1;

    let cmp = 0;
    if (typeof aVal === "number" && typeof bVal === "number") {
      cmp = aVal - bVal;
    } else {
      cmp = String(aVal).localeCompare(String(bVal));
    }
    return desc ? -cmp : cmp;
  });
}

interface PermanentFilter {
  item_property_slug: string;
  value: unknown;
}

interface UserFilter {
  item_property_slug: string;
  component_renderer: string;
  default_value?: unknown;
  all_label?: string;
}

interface DynamicEntriesConfig {
  content_type?: string;
  database?: string;
  limit?: number;
  sort?: string;
  permanent_filters?: PermanentFilter[];
  user_filters?: UserFilter[];
  ignored_entries?: string[];
}

function faqItemKey(question: string): string {
  return question
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 80);
}

export async function resolveDynamicEntries(
  sections: unknown[],
  locale: string,
  options: ResolveDynamicEntriesOptions = {},
): Promise<unknown[]> {
  if (!Array.isArray(sections)) return sections;

  const db = options.db ?? databaseManager;
  const contentRoot = options.contentRoot;

  const resolved = [];
  for (const section of sections) {
    if (!section || typeof section !== "object") {
      resolved.push(section);
      continue;
    }

    const sec = section as Record<string, unknown>;
    const dynamicEntries = sec.dynamic_entries as (DynamicEntriesConfig & { item_template?: Record<string, unknown>; hardcoded_entries?: unknown[] }) | undefined;
    const itemTemplate = (dynamicEntries?.item_template || sec.item_template) as Record<string, unknown> | undefined;

    if (!dynamicEntries || (!dynamicEntries.content_type && !dynamicEntries.database)) {
      resolved.push(section);
      continue;
    }

    try {
      const contentType = dynamicEntries.content_type || "";
      let items: Record<string, unknown>[];

      if (contentType) {
        items = await db.fetchMappedItems(contentType);
      } else if (dynamicEntries.database) {
        const rawItems = await db.fetchItems(dynamicEntries.database);
        items = rawItems.items as Record<string, unknown>[];
        try {
          const dbConfig = db.get(dynamicEntries.database);
          if (dbConfig.filter_by_locale !== false && dbConfig.field_mapping?.locale) {
            const localeField = dbConfig.field_mapping.locale;
            items = items.filter(item => String(item[localeField] ?? "") === locale);
          }
        } catch {
          // DB not registered or no config — skip locale filter
        }
      } else {
        items = [];
      }

      if (contentType) {
        const localeKey = getLocaleKey(contentType, contentRoot) || "lang";
        const localeDefault = getLocaleDefault(contentType, contentRoot);
        const localeSource = getLocaleSource(contentType, contentRoot);
        const normalizedLocale = localeSource ? applyTransformIfNeeded(localeSource, locale) : locale;
        items = items.filter(item => {
          const rawItemLocale = String((item as any)[localeKey] || localeDefault);
          const itemLocale = localeSource ? applyTransformIfNeeded(localeSource, rawItemLocale) : rawItemLocale;
          return itemLocale === normalizedLocale;
        });
      }

      const permanentFilters = dynamicEntries.permanent_filters;
      if (permanentFilters && Array.isArray(permanentFilters) && permanentFilters.length > 0) {
        for (const pf of permanentFilters) {
          items = items.filter(item => {
            const itemVal = item[pf.item_property_slug];
            const values = Array.isArray(pf.value) ? pf.value : [pf.value];
            return values.some((v: unknown) => {
              if (itemVal && typeof itemVal === "object" && "slug" in (itemVal as any)) {
                return String((itemVal as any).slug) === String(v);
              }
              if (Array.isArray(itemVal)) {
                return itemVal.map(String).includes(String(v));
              }
              return String(itemVal) === String(v);
            });
          });
        }
      }

      if (dynamicEntries.ignored_entries && Array.isArray(dynamicEntries.ignored_entries) && dynamicEntries.ignored_entries.length > 0) {
        const ignoredSet = new Set(dynamicEntries.ignored_entries.map((k: string) => k.toLowerCase().trim()));
        items = items.filter(item => {
          const q = String((item as Record<string, unknown>).question ?? "");
          return !ignoredSet.has(faqItemKey(q));
        });
      }

      // Match-count sort: when a permanent_filter has multiple values, items that
      // match more of those values float to the top. If an explicit sort is also
      // configured it becomes the tiebreaker within each match-count group.
      // If no multi-value filter exists, fall back to the explicit sort alone.
      const multiValueFilter = permanentFilters && Array.isArray(permanentFilters)
        ? permanentFilters.find(
            (pf: PermanentFilter) => Array.isArray(pf.value) && (pf.value as unknown[]).length > 1
          )
        : null;

      if (multiValueFilter) {
        const filterValues = (multiValueFilter.value as unknown[]).map(String);
        const slug = multiValueFilter.item_property_slug;
        const explicitSortDesc = dynamicEntries.sort?.startsWith("-") ?? false;
        const explicitSortField = dynamicEntries.sort
          ? (explicitSortDesc ? dynamicEntries.sort.slice(1) : dynamicEntries.sort)
          : null;

        items = [...items].sort((a, b) => {
          const aVal = a[slug];
          const bVal = b[slug];
          const aArr = Array.isArray(aVal) ? aVal.map(String) : [String(aVal ?? "")];
          const bArr = Array.isArray(bVal) ? bVal.map(String) : [String(bVal ?? "")];
          const aCount = filterValues.filter(v => aArr.includes(v)).length;
          const bCount = filterValues.filter(v => bArr.includes(v)).length;
          if (bCount !== aCount) return bCount - aCount;

          // Tiebreaker: explicit sort field, or priority as default
          const tieField = explicitSortField ?? "priority";
          const aT = a[tieField];
          const bT = b[tieField];
          if (aT == null && bT == null) return 0;
          if (aT == null) return 1;
          if (bT == null) return -1;
          let cmp = 0;
          if (typeof aT === "number" && typeof bT === "number") {
            cmp = aT - bT;
          } else {
            cmp = String(aT).localeCompare(String(bT));
          }
          return explicitSortField && explicitSortDesc ? -cmp : cmp;
        });
      } else if (dynamicEntries.sort) {
        items = sortItems(items, dynamicEntries.sort);
      }

      const hardcodedEntries = (dynamicEntries?.hardcoded_entries || sec.hardcoded_entries) as unknown[] | undefined;
      const hardcodedCount = Array.isArray(hardcodedEntries) ? hardcodedEntries.length : 0;

      if (dynamicEntries.limit && dynamicEntries.limit > 0) {
        const remainingSlots = Math.max(0, dynamicEntries.limit - hardcodedCount);
        items = items.slice(0, remainingSlots);
      }

      let resolvedItems: unknown[];
      if (itemTemplate) {
        resolvedItems = items.map(item => {
          const enriched = { ...item };
          if (contentType) {
            const url = resolveContentTypeUrl(contentType, item, locale, contentRoot);
            if (url) enriched._resolved_url = url;
          }
          return resolveTemplateValue(itemTemplate, enriched as Record<string, unknown>);
        });
      } else {
        resolvedItems = items.map(item => {
          if (contentType) {
            const url = resolveContentTypeUrl(contentType, item, locale, contentRoot);
            if (url) (item as any)._resolved_url = url;
          }
          return item;
        });
      }

      const finalItems = [
        ...(Array.isArray(hardcodedEntries) ? hardcodedEntries : []),
        ...resolvedItems,
      ];

      resolved.push({
        ...sec,
        items: finalItems,
        _dynamic_meta: {
          content_type: contentType || dynamicEntries.database,
          total: finalItems.length,
          locale,
        },
      });
    } catch (err) {
      log.error({ err: err }, "[DynamicEntries] Error resolving section:");
      resolved.push(section);
    }
  }

  return resolved;
}
