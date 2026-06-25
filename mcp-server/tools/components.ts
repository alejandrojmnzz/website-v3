import path from "path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  COMPONENT_REGISTRY_PATH,
  listComponents,
  getComponentSchema,
  getComponentVariant,
  resolveSiteContext,
} from "../lib/content.js";
import { assertSafeSegment, assertWithinBase } from "../lib/sanitize.js";
import { getTokenUsername } from "../lib/oauth.js";

const MAIN_SERVER_PORT = process.env.PORT || "5000";
const MCP_SERVER_SECRET = process.env.MCP_SERVER_SECRET || process.env.MCP_API_KEY || "";

function internalHeaders(mcpToken?: string): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (MCP_SERVER_SECRET) {
    headers["Authorization"] = `Bearer ${MCP_SERVER_SECRET}`;
  }
  if (mcpToken) {
    const username = getTokenUsername(mcpToken);
    if (username) headers["x-mcp-author"] = username;
  }
  return headers;
}

const SITE_PARAM_DESC = 'Domain of the target site, e.g. "fl.4geeks.com" (required in multi-site mode; ignored in single-site mode)';

export function registerComponentTools(mcp: McpServer, mcpToken?: string): void {
  // list_components
  mcp.tool(
    "list_components",
    "List all available section component types from the component registry, with version and variant options.",
    {
      site: z.string().optional().describe(SITE_PARAM_DESC),
    },
    async ({ site }) => {
      const siteResult = resolveSiteContext(site);
      if (!siteResult.ok) return { content: [{ type: "text", text: siteResult.error }], isError: true };
      const { contentPath } = siteResult;
      const components = listComponents(contentPath);
      return { content: [{ type: "text", text: JSON.stringify(components, null, 2) }] };
    }
  );

  // get_component_schema
  mcp.tool(
    "get_component_schema",
    "Get the top-level schema info for a component: name, description, when_to_use, and the list of variants (each with name, description, best_for). Use this to understand which variant fits your use case. Call get_component_variant next to get the field definitions and a worked YAML example for your chosen variant.",
    {
      componentType: z.string().describe("Component type name, e.g. 'faq', 'hero', 'two_column'"),
      site: z.string().optional().describe(SITE_PARAM_DESC),
    },
    async ({ componentType, site }) => {
      try {
        assertSafeSegment(componentType, "componentType");
      } catch (e) {
        return { content: [{ type: "text", text: (e as Error).message }], isError: true };
      }
      const siteResult = resolveSiteContext(site);
      if (!siteResult.ok) return { content: [{ type: "text", text: siteResult.error }], isError: true };
      const { contentPath } = siteResult;
      const registryPath = contentPath
        ? path.join(contentPath, "component-registry")
        : COMPONENT_REGISTRY_PATH;
      const componentPath = path.join(registryPath, componentType);
      try { assertWithinBase(componentPath, registryPath); } catch (e) {
        return { content: [{ type: "text", text: (e as Error).message }], isError: true };
      }
      const schema = getComponentSchema(componentType, contentPath);
      if (!schema) {
        return { content: [{ type: "text", text: `Component '${componentType}' not found in registry.` }], isError: true };
      }
      return { content: [{ type: "text", text: JSON.stringify({ componentType, ...schema }, null, 2) }] };
    }
  );

  // get_component_variant
  mcp.tool(
    "get_component_variant",
    "Get the field definitions (variant_props) and a worked YAML example for a specific component variant. Call get_component_schema first to see the available variants, then call this tool with your chosen variant to get everything you need to write the YAML.",
    {
      componentType: z.string().describe("Component type name, e.g. 'hero', 'faq', 'two_column'"),
      variant: z.string().describe("Variant name as listed by get_component_schema, e.g. 'singleColumn', 'showcase'"),
      site: z.string().optional().describe(SITE_PARAM_DESC),
    },
    async ({ componentType, variant, site }) => {
      try {
        assertSafeSegment(componentType, "componentType");
        assertSafeSegment(variant, "variant");
      } catch (e) {
        return { content: [{ type: "text", text: (e as Error).message }], isError: true };
      }
      const siteResult = resolveSiteContext(site);
      if (!siteResult.ok) return { content: [{ type: "text", text: siteResult.error }], isError: true };
      const { contentPath } = siteResult;
      const registryPath = contentPath
        ? path.join(contentPath, "component-registry")
        : COMPONENT_REGISTRY_PATH;
      const componentPath = path.join(registryPath, componentType);
      try { assertWithinBase(componentPath, registryPath); } catch (e) {
        return { content: [{ type: "text", text: (e as Error).message }], isError: true };
      }
      const detail = getComponentVariant(componentType, variant, contentPath);
      if (!detail) {
        return { content: [{ type: "text", text: `Variant '${variant}' not found for component '${componentType}'.` }], isError: true };
      }
      return { content: [{ type: "text", text: JSON.stringify(detail, null, 2) }] };
    }
  );

  // get_component_usage
  mcp.tool(
    "get_component_usage",
    "Investigate how a specific section component is used across the site — which pages include it, what position it appears at, and which components typically come before/after it. Scope the query by 'intent' or 'contentType' to keep the response focused and token-efficient. If neither is provided, the tool returns an error listing the available intents and content types so you can pick one.",
    {
      componentType: z.string().describe("Component type name, e.g. 'hero', 'faq', 'two_column'"),
      intent: z.string().optional().describe("Filter to pages with this intent slug (e.g. 'bootcamp'). Either intent or contentType is required."),
      contentType: z.string().optional().describe("Filter to pages of this content type (e.g. 'landing-page'). Either intent or contentType is required."),
      site: z.string().optional().describe(SITE_PARAM_DESC),
    },
    async ({ componentType, intent, contentType, site }) => {
      try {
        assertSafeSegment(componentType, "componentType");
      } catch (e) {
        return { content: [{ type: "text", text: (e as Error).message }], isError: true };
      }

      const siteResult = resolveSiteContext(site);
      if (!siteResult.ok) return { content: [{ type: "text", text: siteResult.error }], isError: true };
      const { domain } = siteResult;

      const params = new URLSearchParams();
      if (intent) params.set("intent", intent);
      if (contentType) params.set("contentType", contentType);
      params.set("__site", domain);

      const url = `http://localhost:${MAIN_SERVER_PORT}/api/private/component-insights/component/${encodeURIComponent(componentType)}?${params}`;
      try {
        const res = await fetch(url, { headers: internalHeaders(mcpToken) });
        const json = await res.json();
        if (!res.ok) {
          return { content: [{ type: "text", text: JSON.stringify(json, null, 2) }], isError: res.status !== 400 };
        }
        return { content: [{ type: "text", text: JSON.stringify(json, null, 2) }] };
      } catch (e) {
        return { content: [{ type: "text", text: `Failed to fetch component usage: ${(e as Error).message}` }], isError: true };
      }
    }
  );

}
