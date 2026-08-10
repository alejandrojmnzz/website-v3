/**
 * MCP tools for product funnels (authored conversion steps + traffic sources).
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { checkCap, denyResponse } from "../lib/auth.js";
import { ok, fail, actionRequired } from "../lib/respond.js";
import { resolveSiteContext } from "../lib/content.js";
import { getTokenUsername } from "../lib/oauth.js";

const MAIN_SERVER_PORT = process.env.PORT || "5000";
const INTERNAL_SECRET = process.env.MCP_SERVER_SECRET || process.env.MCP_API_KEY || "";

function internalHeaders(mcpToken?: string): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (INTERNAL_SECRET) {
    headers.Authorization = `Bearer ${INTERNAL_SECRET}`;
    const username = mcpToken ? getTokenUsername(mcpToken) : undefined;
    if (username) headers["x-mcp-author"] = username;
  } else if (mcpToken) {
    const username = getTokenUsername(mcpToken);
    if (username) headers["x-mcp-author"] = username;
  }
  return headers;
}

export function registerEcommerceTools(mcp: McpServer, mcpToken?: string): void {
  mcp.tool(
    "get_product_funnel",
    "Get the effective conversion funnel for a purchasable product: funnel.traffic_sources (top-of-funnel types) + locked product page + authored funnel.steps + auto pages with ecommerce_products: all. Call explain_site topic ecommerce first if unsure. Not a section field — do not use update_section_field. Property paths: _ecommerce.yml funnel.steps, funnel.traffic_sources.",
    {
      slug: z.string().describe("Product content slug, e.g. ai-fluency"),
      site: z.string().optional().describe('Site domain when multi-site. Always pass site when multiple sites are configured; call list_sites if unsure.'),
    },
    async ({ slug, site }) => {
      const siteResult = resolveSiteContext(site);
      if (!siteResult.ok) return fail(siteResult.error);
      const domain = siteResult.domain;

      try {
        const url = `http://localhost:${MAIN_SERVER_PORT}/api/ecommerce/funnel/${encodeURIComponent(slug)}${
          domain ? `?__site=${encodeURIComponent(domain)}` : ""
        }`;
        const res = await fetch(url, { headers: internalHeaders(mcpToken) });
        const data = (await res.json()) as Record<string, unknown>;
        if (!res.ok) {
          return fail((data.error as string) || `Server error: ${res.status}`);
        }
        return ok(
          {
            message: `Effective funnel for ${slug}`,
            ...data,
          },
          {
            warnings: [
              {
                code: "auto_steps_not_in_put",
                message:
                  "Steps with source=auto come from pages with ecommerce_products: all and are not written via update_product_funnel.",
              },
              {
                code: "traffic_sources_not_url_steps",
                message:
                  "funnel.traffic_sources document inbound content types + role only. They are not resolvable URL steps and do not affect locked/auto resolution.",
              },
              {
                code: "no_cms_plans",
                message: "CMS does not manage billing plan catalogs. Prices are content-owned or off-site POS.",
              },
            ],
            next_actions: [],
          },
        );
      } catch (e) {
        return fail(`get_product_funnel failed: ${(e as Error).message}`);
      }
    },
  );

  mcp.tool(
    "update_product_funnel",
    "Replace authored funnel.steps and/or funnel.traffic_sources for a purchasable product. Writes programs/{slug}/_ecommerce.yml. Property paths: funnel.steps, funnel.traffic_sources. Omitting traffic_sources preserves existing sources. Does not write auto (ecommerce_products: all) steps. Not a section field.",
    {
      slug: z.string().describe("Product content slug, e.g. ai-fluency"),
      steps: z
        .array(
          z.object({
            content_type: z.string(),
            slug: z.string(),
            role: z.string().optional(),
          }),
        )
        .describe("Authored steps after the locked product page"),
      traffic_sources: z
        .array(
          z.object({
            content_type: z.string().describe("Inbound content type key"),
            role: z.string().describe("Staff description of how this type feeds the funnel"),
          }),
        )
        .optional()
        .describe(
          "Top-of-funnel inbound types (one per content_type). Omit to leave existing traffic_sources unchanged.",
        ),
      site: z.string().optional(),
    },
    async ({ slug, steps, traffic_sources, site }) => {
      if (mcpToken && !(await checkCap(mcpToken, "content_edit_structure", "program"))) {
        return denyResponse("content_edit_structure", "program");
      }

      const siteResult = resolveSiteContext(site);
      if (!siteResult.ok) return fail(siteResult.error);
      const domain = siteResult.domain;

      if (steps.some((s) => s.slug === slug && (s.content_type === "program" || s.content_type === "programs"))) {
        return actionRequired(
          {
            success: false,
            action_required: "remove_locked_product_from_steps",
            message:
              "Do not include the product entry in funnel.steps — it is always locked step 0. Property path: _ecommerce.yml funnel.steps",
            property_path: "funnel.steps",
          },
          [
            {
              tool: "explain_site",
              reason: "Funnel model: traffic_sources vs locked vs authored vs auto",
              args_hint: { topic: "ecommerce" },
              priority: "required",
            },
            {
              tool: "update_product_funnel",
              reason: "Retry without the product slug in steps",
              priority: "required",
            },
          ],
        );
      }

      try {
        const url = `http://localhost:${MAIN_SERVER_PORT}/api/ecommerce/funnel/${encodeURIComponent(slug)}${
          domain ? `?__site=${encodeURIComponent(domain)}` : ""
        }`;
        const body: Record<string, unknown> = { steps };
        if (traffic_sources !== undefined) {
          body.traffic_sources = traffic_sources;
        }
        const res = await fetch(url, {
          method: "PUT",
          headers: internalHeaders(mcpToken),
          body: JSON.stringify(body),
        });
        const data = (await res.json()) as Record<string, unknown>;
        if (!res.ok) {
          return fail((data.error as string) || `Server error: ${res.status}`, {
            property_path: "funnel.steps",
          });
        }
        const wroteSources = traffic_sources !== undefined;
        return ok(
          {
            message: wroteSources
              ? `Updated funnel.steps and funnel.traffic_sources for ${slug}`
              : `Updated authored funnel.steps for ${slug} (traffic_sources preserved)`,
            ...data,
          },
          {
            warnings: [
              {
                code: "auto_steps_not_writable",
                message:
                  "Auto steps (ecommerce_products: all pages) are not stored in funnel.steps and were not changed.",
              },
              {
                code: "traffic_sources_not_url_steps",
                message:
                  "funnel.traffic_sources are documentation only (content_type + role). They do not resolve URLs or change auto/locked steps.",
              },
              {
                code: "no_onsite_purchase",
                message: "This site never fires purchase; checkout completes off-site.",
              },
              {
                code: "no_locale_fanout",
                message: "Writing _ecommerce.yml does not fan out locale page content.",
              },
            ],
            side_effects: [
              {
                kind: "yaml_write",
                summary: wroteSources
                  ? `Wrote funnel.steps and funnel.traffic_sources on programs/${slug}/_ecommerce.yml (sync-state pending)`
                  : `Wrote funnel.steps on programs/${slug}/_ecommerce.yml; traffic_sources preserved (sync-state pending)`,
              },
            ],
            next_actions: [
              {
                tool: "get_product_funnel",
                reason: "Re-read effective funnel (traffic_sources + locked + authored + auto)",
                args_hint: { slug },
                priority: "recommended",
              },
            ],
          },
        );
      } catch (e) {
        return fail(`update_product_funnel failed: ${(e as Error).message}`);
      }
    },
  );
}
