import { databaseManager, type DatabaseManager } from "./database";
import { contentIndex, type ContentIndex } from "./content-index";
import { resolveContentTypeUrl } from "./content-types";
import { queryEntries, type QueryFilter, applyFilters, applyMatchCountSort } from "./query-entries";
import { child } from "./logger";
import { resolveSingleTemplateValue } from "@shared/json-field";
import { applyIgnoredEntries, faqItemKey } from "@shared/faq-listing";

export { faqItemKey, applyIgnoredEntries } from "@shared/faq-listing";

const log = child({ module: "dynamic-entries" });

export interface ResolveDynamicEntriesOptions {
  db?: DatabaseManager;
  contentRoot?: string;
  contentIndex?: ContentIndex;
  /**
   * Current page's single entry (DB or YAML-mapped fields).
   * Used to resolve `{{ single.* }}` in permanent_filters, search, and
   * hardcoded_entries before querying/merging (resolveSingleVars runs too late).
   */
  singleEntry?: Record<string, unknown>;
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
  search?: string;
  permanent_filters?: PermanentFilter[];
  user_filters?: UserFilter[];
  ignored_entries?: string[];
}

const MIN_SEARCH_CHARS = 3;

/** Resolve `{{ single.* }}` against the page entry (or pipe fallback when missing). */
function resolveAgainstSingle(
  value: unknown,
  singleEntry?: Record<string, unknown>,
): unknown {
  return resolveSingleTemplateValue(value, singleEntry ?? {});
}

/**
 * Resolve hardcoded_entries when still a `{{ single.* }}` bind string.
 * Exported for unit tests.
 */
export function resolveHardcodedEntriesForDynamic(
  raw: unknown,
  singleEntry?: Record<string, unknown>,
): unknown[] {
  const resolved = resolveAgainstSingle(raw, singleEntry);
  return Array.isArray(resolved) ? resolved : [];
}

/**
 * Resolve dynamic_entries.search when still a `{{ single.* }}` bind.
 * Exported for unit tests.
 */
export function resolveSearchPhraseForDynamic(
  raw: unknown,
  singleEntry?: Record<string, unknown>,
): string {
  const resolved = resolveAgainstSingle(raw, singleEntry);
  return typeof resolved === "string" ? resolved.trim() : "";
}

/**
 * Manually-added FAQs first, then DB — total capped at `limit` when set.
 * Exported for unit tests.
 */
export function mergeFaqItemsWithLimit(
  hardcoded: unknown[],
  dbItems: unknown[],
  limit?: number,
): unknown[] {
  if (!limit || limit <= 0) return [...hardcoded, ...dbItems];
  const includedHardcoded = hardcoded.slice(0, limit);
  const remaining = Math.max(0, limit - includedHardcoded.length);
  return [...includedHardcoded, ...dbItems.slice(0, remaining)];
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
  const singleEntry = options.singleEntry;

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
      // Resolve before merge/limit — resolveSingleVars runs after this function.
      const hardcodedEntries = resolveHardcodedEntriesForDynamic(
        dynamicEntries?.hardcoded_entries ?? sec.hardcoded_entries,
        singleEntry,
      );
      const limit =
        dynamicEntries.limit && dynamicEntries.limit > 0
          ? dynamicEntries.limit
          : undefined;
      // Cap manually-added rows too — limit is total questions shown, not DB-only.
      const includedHardcoded =
        limit != null ? hardcodedEntries.slice(0, limit) : hardcodedEntries;
      const hardcodedCount = includedHardcoded.length;
      const hasIgnored =
        Array.isArray(dynamicEntries.ignored_entries) &&
        dynamicEntries.ignored_entries.length > 0;

      // Resolve {{ single.* }} in filter values against the page's singleEntry
      // before querying (resolveSingleVars runs too late for listing filters).
      const filters: QueryFilter[] | undefined = dynamicEntries.permanent_filters?.map((pf) => ({
        field: pf.item_property_slug,
        value: resolveAgainstSingle(pf.value, singleEntry),
      }));

      const searchPhrase = resolveSearchPhraseForDynamic(
        dynamicEntries.search,
        singleEntry,
      );
      const useSearch =
        Boolean(dynamicEntries.database) &&
        searchPhrase.length >= MIN_SEARCH_CHARS;

      let items: Record<string, unknown>[];

      if (useSearch) {
        const {
          searchDatabaseItems,
          SEARCH_CACHE_CEILING,
          intersectSearchWithFiltersAndBackfill,
        } = await import("./database-search");

        const remainingSlots =
          limit != null ? Math.max(0, limit - hardcodedCount) : SEARCH_CACHE_CEILING;

        const searchResult = await searchDatabaseItems(dynamicEntries.database!, searchPhrase, {
          limit: SEARCH_CACHE_CEILING,
          locale,
          db,
        });

        let searchHits = applyFilters(searchResult.items, filters);
        searchHits = applyIgnoredEntries(searchHits, dynamicEntries.ignored_entries);

        // Filter-only pool for 1B backfill (and when search ∩ filters is short)
        const filterOnlyResult = await queryEntries(
          {
            from: { database: dynamicEntries.database! },
            locale,
            filters,
            sort: dynamicEntries.sort,
            limit: undefined,
          },
          { db, contentIndex: ci, contentRoot: contentRoot ?? ci.contentRoot },
        );
        const filterOnly = applyMatchCountSort(
          applyIgnoredEntries(filterOnlyResult.items, dynamicEntries.ignored_entries),
          filters,
          dynamicEntries.sort,
        );

        items = intersectSearchWithFiltersAndBackfill(
          searchHits,
          filterOnly,
          remainingSlots,
          (item) => {
            const slug = item.slug ?? item.id;
            if (slug !== undefined && slug !== null && String(slug)) return `slug:${String(slug)}`;
            return `q:${faqItemKey(String(item.question ?? ""))}`;
          },
        );
      } else {
        // When ignored_entries exist, fetch without limit so FAQ ignores apply before slicing.
        const queryLimit =
          !hasIgnored && limit != null
            ? Math.max(0, limit - hardcodedCount)
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

        items = result.items;

        if (hasIgnored) {
          items = applyIgnoredEntries(items, dynamicEntries.ignored_entries);
          if (limit != null) {
            items = items.slice(0, Math.max(0, limit - hardcodedCount));
          }
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
          return resolveAgainstSingle(itemTemplate, enriched);
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

      const finalItems = mergeFaqItemsWithLimit(
        includedHardcoded,
        resolvedItems,
        limit,
      );

      resolved.push({
        ...sec,
        // Keep resolved array on the section so FAQ UI / schema see it before
        // the later resolveAllTemplateVars pass.
        ...(hardcodedEntries.length > 0 ? { hardcoded_entries: hardcodedEntries } : {}),
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
