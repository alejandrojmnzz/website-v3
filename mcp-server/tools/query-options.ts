/**
 * MCP inspection tool wrapping GET /api/query-options.
 * Does not auto-filter purchasable.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ok, fail } from "../lib/respond.js";
import { resolveSiteContext } from "../lib/content.js";
import { SITE_PARAM_DESC } from "../lib/entry-helpers.js";

const MAIN_SERVER_PORT = process.env.PORT || "5000";

export function registerQueryOptionsTools(mcp: McpServer): void {
  mcp.tool(
    "query_options",
    "List catalog dropdown options from a content type XOR a private database. " +
      "Does not auto-filter purchasable — CMS relation pickers need the full list. " +
      "Pass query (e.g. purchasable=true or slug=a,b) to filter. " +
      "Items include purchasable when the type has ecommerce products. Inspection only — does not write YAML.",
    {
      content_type: z
        .string()
        .optional()
        .describe("Content type key, e.g. program. Mutually exclusive with database."),
      database: z
        .string()
        .optional()
        .describe("Private database slug. Mutually exclusive with content_type."),
      query: z
        .string()
        .optional()
        .describe('Filter string, e.g. "purchasable=true" or "slug=ai-fluency,ai-flex"'),
      locale: z.string().optional().describe("Locale code. Omit to include all locales (deduped)."),
      site: z.string().optional().describe(SITE_PARAM_DESC),
    },
    async ({ content_type, database, query, locale, site }) => {
      const hasType = typeof content_type === "string" && content_type.trim().length > 0;
      const hasDb = typeof database === "string" && database.trim().length > 0;
      if (hasType === hasDb) {
        return fail("Pass exactly one of content_type or database");
      }
      const siteResult = resolveSiteContext(site);
      if (!siteResult.ok) return fail(siteResult.error);
      const { domain } = siteResult;

      const params = new URLSearchParams();
      if (hasType) params.set("content_type", content_type!.trim());
      if (hasDb) params.set("database", database!.trim());
      if (locale) params.set("locale", locale);
      if (domain) params.set("__site", domain);
      if (query && query.trim()) {
        const extra = new URLSearchParams(query.trim());
        extra.forEach((val, key) => {
          if (!params.has(key)) params.set(key, val);
        });
      }

      try {
        const url = `http://localhost:${MAIN_SERVER_PORT}/api/query-options?${params.toString()}`;
        const res = await fetch(url);
        const data = (await res.json()) as Record<string, unknown>;
        if (!res.ok) {
          return fail((data.error as string) || `Server error: ${res.status}`);
        }
        return ok(
          {
            message: `Options for ${hasType ? `content_type=${content_type}` : `database=${database}`}${query ? ` query=${query}` : " (unfiltered)"}`,
            ...data,
          },
          {
            warnings: [
              {
                code: "no_implicit_purchasable_filter",
                message:
                  "query_options does not filter by purchasable unless query includes it. Relation pickers need the full list.",
              },
              {
                code: "catalog_forms_need_query",
                message:
                  "Lead-form catalogs on ecommerce types must set source.query in YAML (typically purchasable=true). This tool does not write YAML. Confirm subsets with the user. Do not write single.purchasable.",
              },
            ],
            next_actions: [],
          },
        );
      } catch (e) {
        return fail(`query_options failed: ${(e as Error).message}`);
      }
    },
  );
}
