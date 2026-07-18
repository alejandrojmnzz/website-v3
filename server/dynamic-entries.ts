import { databaseManager, type DatabaseManager } from "./database";
import { contentIndex, type ContentIndex } from "./content-index";
import { resolveContentTypeUrl } from "./content-types";
import { queryEntries, type QueryFilter } from "./query-entries";
import { child } from "./logger";

const log = child({ module: "dynamic-entries" });

export interface ResolveDynamicEntriesOptions {
  db?: DatabaseManager;
  contentRoot?: string;
  contentIndex?: ContentIndex;
}

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
    return template.map((t) => resolveTemplateValue(t, item));
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

export function faqItemKey(question: string): string {
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
  const ci = options.contentIndex ?? contentIndex;

  const resolved = [];
  for (const section of sections) {
    if (!section || typeof section !== "object") {
      resolved.push(section);
      continue;
    }

    const sec = section as Record<string, unknown>;
    const dynamicEntries = sec.dynamic_entries as
      | (DynamicEntriesConfig & {
          item_template?: Record<string, unknown>;
          hardcoded_entries?: unknown[];
        })
      | undefined;
    const itemTemplate = (dynamicEntries?.item_template || sec.item_template) as
      | Record<string, unknown>
      | undefined;

    if (!dynamicEntries || (!dynamicEntries.content_type && !dynamicEntries.database)) {
      resolved.push(section);
      continue;
    }

    try {
      const contentType = dynamicEntries.content_type || "";
      const hardcodedEntries = (dynamicEntries?.hardcoded_entries || sec.hardcoded_entries) as
        | unknown[]
        | undefined;
      const hardcodedCount = Array.isArray(hardcodedEntries) ? hardcodedEntries.length : 0;
      const hasIgnored =
        Array.isArray(dynamicEntries.ignored_entries) &&
        dynamicEntries.ignored_entries.length > 0;

      const filters: QueryFilter[] | undefined = dynamicEntries.permanent_filters?.map((pf) => ({
        field: pf.item_property_slug,
        value: pf.value,
      }));

      // When ignored_entries exist, fetch without limit so FAQ ignores apply before slicing.
      const queryLimit =
        !hasIgnored && dynamicEntries.limit && dynamicEntries.limit > 0
          ? Math.max(0, dynamicEntries.limit - hardcodedCount)
          : undefined;

      const from = contentType
        ? ({ contentType } as const)
        : ({ database: dynamicEntries.database! } as const);

      const result = await queryEntries(
        {
          from,
          locale,
          filters,
          sort: dynamicEntries.sort,
          limit: queryLimit,
        },
        { db, contentIndex: ci, contentRoot: contentRoot ?? ci.contentRoot },
      );

      let items = result.items;

      if (hasIgnored) {
        const ignoredSet = new Set(
          dynamicEntries.ignored_entries!.map((k: string) => k.toLowerCase().trim()),
        );
        items = items.filter((item) => {
          const q = String(item.question ?? "");
          return !ignoredSet.has(faqItemKey(q));
        });
        if (dynamicEntries.limit && dynamicEntries.limit > 0) {
          const remainingSlots = Math.max(0, dynamicEntries.limit - hardcodedCount);
          items = items.slice(0, remainingSlots);
        }
      }

      let resolvedItems: unknown[];
      if (itemTemplate) {
        resolvedItems = items.map((item) => {
          const enriched = { ...item };
          if (contentType && !enriched._resolved_url) {
            const url = resolveContentTypeUrl(contentType, item, locale, contentRoot);
            if (url) enriched._resolved_url = url;
          }
          return resolveTemplateValue(itemTemplate, enriched);
        });
      } else {
        resolvedItems = items.map((item) => {
          if (contentType && !(item as { _resolved_url?: string })._resolved_url) {
            const url = resolveContentTypeUrl(contentType, item, locale, contentRoot);
            if (url) (item as Record<string, unknown>)._resolved_url = url;
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
