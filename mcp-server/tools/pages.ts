import fs from "fs";
import path from "path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  MARKETING_CONTENT_PATH,
  getDirectory,
  loadContentTypes,
  isDbBacked,
  isSharedLayoutConfig,
  resolveContentType,
  scanPages,
  loadPage,
  loadVariantPage,
  safeLoad,
  safeDump,
  setValueAtPath,
  resolveSiteContext,
  listMcpSites,
} from "../lib/content.js";
import { assertSafeSegment, assertSafeLocale, assertWithinBase } from "../lib/sanitize.js";
import { checkCap, denyResponse } from "../lib/auth.js";
import { getTokenUsername } from "../lib/oauth.js";
import { promoteWarnings, VARIANT_WARNINGS, actionRequired, type McpTextResult, type McpWarning, type NextAction, type McpSideEffect } from "../lib/respond.js";
import {
  ok,
  fail,
  confirmLiveEditGate,
  resolveLayoutTargetGate,
  LAYOUT_TARGET_DESC,
  variantWarningsIfNeeded,
  wrotePayload,
  sharedStructuralEnvelope,
  type LayoutTarget,
} from "../lib/page-tool-helpers.js";
import {
  pathForLayoutTarget,
  versioningApiSlug,
  sharedTemplateBlastSideEffect,
  BATCH_BINDING_WARNING,
  ADD_SECTION_NO_BINDING_FANOUT,
  REMOVE_SECTION_NO_BINDING_FANOUT,
  REPLACE_NO_BINDING_FANOUT,
  REORDER_NO_BINDING_FANOUT,
  CREATE_ENTRY_SHARED_LAYOUT_WARNING,
} from "../lib/shared-layout.js";
import {
  hintsAfterAddArticle,
  hintsAfterReplaceSections,
  prepareArticleAddStamp,
} from "../lib/article-hints.js";
import {
  SITE_PARAM_DESC,
  MULTI_SITE_TOOL_BLURB,
  siteFailResult,
  safeTopLevelFieldsForConfig,
  listExtraUrlPatternParams,
  observeParamValues,
  collectProposedUrlParamValues,
  missingRequiredFields,
  getEditorConfig,
  bodyModelForConfig,
  createViaForConfig,
} from "../lib/entry-helpers.js";

const MAIN_SERVER_PORT = process.env.PORT || "5000";
// Internal credential for loopback calls to capability-gated main-server endpoints.
// Must match the value used in server/routes/_helpers.ts trusted-internal bypass.
export const MCP_SERVER_SECRET = process.env.MCP_SERVER_SECRET || process.env.MCP_API_KEY || "";

/** Page-level WebSite/Organization schema_org overrides — site schema-org.yml is unchanged. */
function schemaOrgPageOverrideWarnings(section: Record<string, unknown> | null | undefined): McpWarning[] {
  if (!section || String(section.type ?? "") !== "schema_org") return [];
  const t = String(section.schema_type ?? "");
  if (t === "WebSite") {
    return [
      {
        code: "schema_org_website_page_override",
        message:
          "Page-level schema_org WebSite section: properties were/are prefilled from site schema-org.yml but edits apply only to this page's JSON-LD. schema-org.yml is not modified.",
      },
    ];
  }
  if (t === "Organization") {
    return [
      {
        code: "schema_org_organization_page_override",
        message:
          "Page-level schema_org Organization section: properties were/are prefilled from site schema-org.yml but edits apply only to this page's JSON-LD. schema-org.yml is not modified.",
      },
    ];
  }
  return [];
}

function schemaOrgOverrideWarningsFromFieldUpdates(
  fields: Record<string, unknown>,
  existingSections?: Array<Record<string, unknown>>,
): McpWarning[] {
  const warnings: McpWarning[] = [];
  const seen = new Set<string>();
  for (const [pathKey, value] of Object.entries(fields)) {
    const m = /^sections\.(\d+)\.(schema_type|type)$/.exec(pathKey);
    if (m && pathKey.endsWith("schema_type")) {
      const t = String(value ?? "");
      if (t === "WebSite" || t === "Organization") {
        const code =
          t === "WebSite"
            ? "schema_org_website_page_override"
            : "schema_org_organization_page_override";
        if (!seen.has(code)) {
          seen.add(code);
          warnings.push(...schemaOrgPageOverrideWarnings({ type: "schema_org", schema_type: t }));
        }
      }
    }
    const secMatch = /^sections\.(\d+)(?:\.|$)/.exec(pathKey);
    if (secMatch && existingSections) {
      const idx = Number(secMatch[1]);
      const sec = existingSections[idx];
      for (const w of schemaOrgPageOverrideWarnings(sec)) {
        if (!seen.has(w.code)) {
          seen.add(w.code);
          warnings.push(w);
        }
      }
    }
  }
  return warnings;
}

/**
 * Build the Authorization + author headers for loopback calls to the main
 * server's capability-gated endpoints (e.g. /api/content/edit-sections).
 * Always sets x-mcp-author when MCP_SERVER_SECRET is set so the main server
 * skips shared-layout locale fan-out (agent owns sibling sync via next_actions).
 */
function internalHeaders(mcpToken?: string): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (MCP_SERVER_SECRET) {
    headers["Authorization"] = `Bearer ${MCP_SERVER_SECRET}`;
    const username = mcpToken ? getTokenUsername(mcpToken) : undefined;
    headers["x-mcp-author"] = username || "mcp";
  } else if (mcpToken) {
    const username = getTokenUsername(mcpToken);
    if (username) headers["x-mcp-author"] = username;
  }
  return headers;
}

/**
 * Checks for a remote conflict before writing fields to a file.
 * Reads the file, applies the field entries, computes intended content,
 * then checks for remote conflicts. Returns a conflict error or null if safe to proceed.
 */
async function getConflictError(
  filePath: string,
  relativePath: string,
  fieldEntries: Array<[string, unknown]>,
  intendedChangeLabel: Record<string, unknown>,
  domain?: string
): Promise<McpTextResult | null> {
  const currentData = (fs.existsSync(filePath) ? safeLoad(fs.readFileSync(filePath, "utf-8")) : null) || {};
  for (const [fp, val] of fieldEntries) {
    setValueAtPath(currentData, fp, val);
  }
  const intendedContent = safeDump(currentData);
  const conflictCheck = await checkRemoteConflict(relativePath, domain);
  if (conflictCheck.conflict) {
    return conflictError({
      relativePath,
      remoteContent: conflictCheck.remoteContent,
      intendedContent,
      intendedChange: intendedChangeLabel,
    });
  }
  return null;
}

/**
 * Call the main server's /api/content/edit-sections endpoint.
 * Returns { error } on failure or { data } on success (may include boundUpdates).
 */
async function callEditSectionsApi(
  params: {
    contentType: string;
    slug: string;
    locale: string;
    variant?: string;
    operations: Record<string, unknown>[];
    layoutTarget?: "entry" | "type_single";
  },
  mcpToken?: string,
  domain?: string,
): Promise<{ error: McpTextResult } | { data: Record<string, unknown> }> {
  try {
    const url = `http://localhost:${MAIN_SERVER_PORT}/api/content/edit-sections${domain ? `?__site=${encodeURIComponent(domain)}` : ""}`;
    const res = await fetch(url, {
      method: "POST",
      headers: internalHeaders(mcpToken),
      body: JSON.stringify({
        contentType: params.contentType,
        slug: params.slug,
        locale: params.locale,
        operations: params.operations,
        ...(params.variant ? { variant: params.variant } : {}),
        ...(params.layoutTarget ? { layoutTarget: params.layoutTarget } : {}),
      }),
    });
    const data = await res.json() as Record<string, unknown>;
    if (!res.ok) {
      const errMsg = (data.error as string) || `Server error: ${res.status}`;
      // Product-scope / ecommerce validation — guide agents to exact property paths
      if (
        /ecommerce_products|programs\[\]\.id|ecommerce scope|purchasable product/i.test(errMsg)
      ) {
        const pathMatch = errMsg.match(/sections\[\d+\]\.data\.[^\s]+|programs\[\]\.id|ecommerce_products/);
        return {
          error: actionRequired(
            {
              success: false,
              action_required: "fix_ecommerce_product_scope",
              message: errMsg,
              property_path: pathMatch?.[0] ?? "ecommerce_products",
              details: {
                allowed:
                  'ecommerce_products: string[] | "all", or programs[].id, or inherit on program entry',
              },
            },
            [
              {
                tool: "explain_site",
                reason: "Read ecommerce product scope + funnel property paths",
                args_hint: { topic: "ecommerce" },
                priority: "required",
              },
              {
                tool: "get_component_schema",
                reason: "Confirm field-editor binds for this section type",
                priority: "recommended",
              },
              {
                tool: "update_section_field",
                reason: "Set the cited property_path (e.g. sections[N].data.ecommerce_products or programs[].id)",
                priority: "required",
              },
            ],
          ),
        };
      }
      return { error: fail(errMsg) };
    }
    return { data };
  } catch (e) {
    return { error: fail(`Failed to call edit-sections API: ${(e as Error).message}`) };
  }
}

/**
 * Call the main server's /api/content/edit-common endpoint.
 * Returns an error response on failure, or null on success.
 */
async function callEditCommonApi(
  params: { contentType: string; slug: string; operations: Record<string, unknown>[] },
  mcpToken?: string,
  domain?: string
): Promise<McpTextResult | null> {
  try {
    const url = `http://localhost:${MAIN_SERVER_PORT}/api/content/edit-common${domain ? `?__site=${encodeURIComponent(domain)}` : ""}`;
    const res = await fetch(url, {
      method: "POST",
      headers: internalHeaders(mcpToken),
      body: JSON.stringify({
        contentType: params.contentType,
        slug: params.slug,
        operations: params.operations,
      }),
    });
    const data = await res.json() as Record<string, unknown>;
    if (!res.ok) {
      return fail((data.error as string) || `Server error: ${res.status}`);
    }
    return null;
  } catch (e) {
    return fail(`Failed to call edit-common API: ${(e as Error).message}`);
  }
}

/**
 * Call the main server's /api/content/refresh-cache endpoint to flush
 * the in-memory content index after a direct FS write.
 */
async function callRefreshCacheApi(contentType?: string, domain?: string): Promise<void> {
  try {
    const url = `http://localhost:${MAIN_SERVER_PORT}/api/content/refresh-cache${domain ? `?__site=${encodeURIComponent(domain)}` : ""}`;
    await fetch(url, {
      method: "POST",
      headers: internalHeaders(),
      body: JSON.stringify(contentType ? { contentType } : {}),
    });
  } catch {
    // Non-fatal: cache will be refreshed on the next request.
  }
}

/**
 * Call the main server's /api/github/commit-file endpoint to immediately
 * commit a file to GitHub after a direct FS write.
 * Returns the commit SHA on success, or a warning string on failure.
 */
async function callCommitFileApi(
  relativePath: string,
  message: string,
  mcpToken?: string,
  domain?: string
): Promise<{ commitSha?: string; warning?: string }> {
  try {
    const url = `http://localhost:${MAIN_SERVER_PORT}/api/github/commit-file${domain ? `?__site=${encodeURIComponent(domain)}` : ""}`;
    const author = mcpToken ? getTokenUsername(mcpToken) : undefined;
    const res = await fetch(url, {
      method: "POST",
      headers: internalHeaders(mcpToken),
      body: JSON.stringify({ filePath: relativePath, message, ...(author ? { author } : {}) }),
    });
    const data = await res.json() as Record<string, unknown>;
    if (res.ok && data.success) {
      return { commitSha: data.commitSha as string | undefined };
    }
    return { warning: `File written to disk but GitHub commit failed: ${(data.error as string) || `HTTP ${res.status}`}` };
  } catch (e) {
    return { warning: `File written to disk but GitHub commit failed: ${(e as Error).message}` };
  }
}

/**
 * Check whether a file has a remote conflict before writing it.
 * Returns conflict info (including remote content) if a conflict is detected,
 * or null if it's safe to proceed.
 */
async function checkRemoteConflict(
  filePath: string,
  domain?: string
): Promise<{ conflict: true; remoteContent: string } | { conflict: false }> {
  try {
    const url = `http://localhost:${MAIN_SERVER_PORT}/api/github/file-status?file=${encodeURIComponent(filePath)}${domain ? `&__site=${encodeURIComponent(domain)}` : ""}`;
    const res = await fetch(url);
    if (!res.ok) return { conflict: false };
    const data = await res.json() as {
      hasConflict?: boolean;
      remoteContent?: string;
    };
    if (data.hasConflict && typeof data.remoteContent === "string") {
      return { conflict: true, remoteContent: data.remoteContent };
    }
    return { conflict: false };
  } catch {
    return { conflict: false };
  }
}

/** Build a structured conflict error including both remote and intended content. */
function conflictError(opts: {
  relativePath: string;
  remoteContent: string;
  intendedContent: string;
  intendedChange?: Record<string, unknown>;
}): McpTextResult {
  return {
    content: [{
      type: "text",
      text: JSON.stringify({
        error: "conflict",
        message:
          `Remote conflict detected on ${opts.relativePath}. ` +
          "The remote has been modified since the last pull. " +
          "Merge remoteContent with intendedContent and retry.",
        conflictedFile: opts.relativePath,
        remoteContent: opts.remoteContent,
        intendedContent: opts.intendedContent,
        ...(opts.intendedChange ? { intendedChange: opts.intendedChange } : {}),
      }, null, 2),
    }],
    isError: true,
  };
}

// ── Validation cache reader ──────────────────────────────────────────────────

const VALIDATION_CACHE_PATH = path.join(
  process.cwd(), "4geeks-com", "validation-cache.json"
);


interface MappedValidationIssue {
  code: string;
  message: string;
  severity: "error" | "warning";
  category: string;
  file?: string;
  suggestion?: string;
}

/**
 * Read cached validation issues for a page URL from validation-cache.json.
 * Optionally filter to specific categories (e.g. ["seo"]).
 * Returns an empty array if the cache is missing or the URL has no entry.
 */
function getCachedValidationIssues(
  url: string,
  categoryFilter?: string[],
  contentPath?: string
): MappedValidationIssue[] {
  const cachePath = contentPath
    ? path.join(contentPath, "validation-cache.json")
    : VALIDATION_CACHE_PATH;
  try {
    if (!fs.existsSync(cachePath)) return [];
    const raw = fs.readFileSync(cachePath, "utf-8");
    const cache = JSON.parse(raw) as {
      pages: Record<string, {
        errors: Array<{ type?: string; code: string; message: string; category?: string; file?: string; suggestion?: string }>;
        warnings: Array<{ type?: string; code: string; message: string; category?: string; file?: string; suggestion?: string }>;
      }>;
    };
    const entry = cache.pages?.[url];
    if (!entry) return [];

    const all: MappedValidationIssue[] = [
      ...(entry.errors ?? []).map(e => ({
        code: e.code,
        message: e.message,
        severity: "error" as const,
        category: e.category ?? "other",
        ...(e.file ? { file: e.file } : {}),
        ...(e.suggestion ? { suggestion: e.suggestion } : {}),
      })),
      ...(entry.warnings ?? []).map(w => ({
        code: w.code,
        message: w.message,
        severity: "warning" as const,
        category: w.category ?? "other",
        ...(w.file ? { file: w.file } : {}),
        ...(w.suggestion ? { suggestion: w.suggestion } : {}),
      })),
    ];

    if (categoryFilter && categoryFilter.length > 0) {
      const catSet = new Set(categoryFilter);
      return all.filter(i => catSet.has(i.category));
    }

    return all;
  } catch {
    return [];
  }
}

export function registerPageTools(mcp: McpServer, _mcpAuthor?: string, mcpToken?: string): void {
  // list_sites
  mcp.tool(
    "list_sites",
    "List configured site domains and content folders from sites.yml. " +
    "Call this first in multi-site setups, then pass site (domain) on every other tool. " +
    MULTI_SITE_TOOL_BLURB,
    {},
    async () => {
      try {
        const sites = listMcpSites();
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              count: sites.length,
              sites,
              hint: sites.length > 1
                ? "Pass site with one of these domains on subsequent tool calls."
                : "Only one site configured; site parameter is optional.",
            }, null, 2),
          }],
        };
      } catch (e) {
        return fail((e as Error).message);
      }
    }
  );

  // list_entries
  mcp.tool(
    "list_entries",
    "List YAML-driven content entries (any content type that is not database-backed). " +
    "Returns slug, contentType, locales, title, and urls. " +
    "IMPORTANT: Types with database.slug in content-types.yml are NOT listed here. " +
    "Static single_template types (e.g. blog) ARE listed — they are YAML, not DB. " +
    "Use get_content_type_info to see db_backed vs single_template. " +
    MULTI_SITE_TOOL_BLURB + " " +
    "Optional filters (AND): contentType, locale, slugs, search.",
    {
      contentType: z.string().optional().describe("Restrict to one content type, e.g. 'program', 'blog', or 'landing'"),
      locale: z.string().optional().describe("Only return entries that have this locale available, e.g. 'en' or 'es'"),
      slugs: z.array(z.string()).optional().describe("Restrict to a specific list of slugs"),
      search: z.string().optional().describe("Case-insensitive substring match against slug and title"),
      site: z.string().optional().describe(SITE_PARAM_DESC),
    },
    async ({ contentType, locale, slugs, search, site }) => {
      const siteResult = resolveSiteContext(site);
      if (!siteResult.ok) return siteFailResult(siteResult.error, "list_entries", { contentType, locale, slugs, search });
      const { contentPath } = siteResult;
      let pages = scanPages(contentPath);
      if (contentType) {
        pages = pages.filter(p => p.contentType === contentType);
      }
      if (locale) {
        pages = pages.filter(p => p.locales.includes(locale));
      }
      if (slugs && slugs.length > 0) {
        const slugSet = new Set(slugs);
        pages = pages.filter(p => slugSet.has(p.slug));
      }
      if (search) {
        const q = search.toLowerCase();
        pages = pages.filter(p =>
          p.slug.toLowerCase().includes(q) ||
          (p.title ?? "").toLowerCase().includes(q)
        );
      }
      return { content: [{ type: "text", text: JSON.stringify(pages, null, 2) }] };
    }
  );

  // ── Shared resolution helper used by get_entry_content and get_entry_seo ──────

  type PagePayload = {
    contentType: string;
    slug: string;
    locale: string;
    locales: string[];
    urls?: Record<string, string>;
    data: Record<string, unknown>;
  };

  type PagePayloadError = { content: [{ type: "text"; text: string }]; isError: true };

  function resolvePagePayload(slug: string, locale: string, contentType: string | undefined, contentPath?: string): PagePayload | PagePayloadError {
    try {
      assertSafeSegment(slug, "slug");
      assertSafeLocale(locale);
      if (contentType) assertSafeSegment(contentType, "contentType");
    } catch (e) {
      return { content: [{ type: "text", text: (e as Error).message }], isError: true };
    }
    const resolved = resolveContentType(slug, contentType, contentPath);
    if (!resolved) {
      return { content: [{ type: "text", text: `Page not found for slug '${slug}'${contentType ? ` (contentType: ${contentType})` : ""}` }], isError: true };
    }
    const result = loadPage(resolved.contentType, slug, locale, contentPath);
    if (!result) {
      return { content: [{ type: "text", text: `Locale '${locale}' not found for page '${slug}' (contentType: ${resolved.contentType})` }], isError: true };
    }

    const basePath = contentPath || MARKETING_CONTENT_PATH;
    const pageDir = path.join(basePath, getDirectory(resolved.contentType, resolved.config), slug);
    const dirFiles = fs.existsSync(pageDir) ? fs.readdirSync(pageDir) : [];
    const locales = dirFiles
      .map((f: string) => f.replace(/\.(yml|yaml)$/, ""))
      .filter((n: string) => /^[a-z]{2}(-[a-z]{2})?$/.test(n));

    const urlPattern = resolved.config.url_pattern;
    let urls: Record<string, string> | undefined;
    if (urlPattern) {
      const resolvedUrls: Record<string, string> = {};
      if (urlPattern["default"]) {
        const p = urlPattern["default"].replace(":slug", slug);
        for (const l of locales) resolvedUrls[l] = p;
      } else {
        for (const l of locales) {
          if (urlPattern[l]) resolvedUrls[l] = urlPattern[l].replace(":slug", slug);
        }
      }
      if (Object.keys(resolvedUrls).length > 0) urls = resolvedUrls;
    }

    return { contentType: resolved.contentType, slug, locale, locales, ...(urls ? { urls } : {}), data: result.data as Record<string, unknown> };
  }

  // get_entry_content
  mcp.tool(
    "get_entry_content",
    "Get the merged content of a page (sections, title, and all other top-level YAML keys) without the meta/SEO block. " +
    "Also returns locales (all available locale codes for this page), urls (per-locale resolved paths), and " +
    "validation_issues (all cached validation issues for this page across all categories — each with code, message, severity, and category). " +
    "validation_issues is always present (empty array if no issues are cached). " +
    "Merges _common.yml with the locale file. contentType is optional — omit it and the server will auto-detect it from the slug. " +
    "Use get_entry_seo to fetch only the SEO/meta fields. " +
    "Supply 'variant' to read a draft variant file ({variantSlug}.{locale}.yml) instead of the live locale file.",
    {
      slug: z.string().describe("Page slug (folder name), e.g. 'home' or 'full-stack-developer'"),
      locale: z.string().default("en").describe("Locale code, e.g. 'en' or 'es'"),
      contentType: z.string().optional().describe("Content type hint (e.g. 'page', 'program'). Omit to auto-detect from slug."),
      variant: z.string().optional().describe("Variant slug to read (e.g. 'draft-v2'). When provided, reads {variantSlug}.{locale}.yml instead of the live locale file."),
      site: z.string().optional().describe(SITE_PARAM_DESC),
    },
    async ({ slug, locale, contentType, variant, site }) => {
      const siteResult = resolveSiteContext(site);
      if (!siteResult.ok) return siteFailResult(siteResult.error);
      const { contentPath } = siteResult;
      try {
        assertSafeSegment(slug, "slug");
        assertSafeLocale(locale);
        if (contentType) assertSafeSegment(contentType, "contentType");
        if (variant) assertSafeSegment(variant, "variant");
      } catch (e) {
        return { content: [{ type: "text", text: (e as Error).message }], isError: true };
      }

      if (variant) {
        const resolved = resolveContentType(slug, contentType, contentPath);
        if (!resolved) {
          return { content: [{ type: "text", text: `Page not found for slug '${slug}'${contentType ? ` (contentType: ${contentType})` : ""}` }], isError: true };
        }
        const result = loadVariantPage(resolved.contentType, slug, locale, variant, contentPath);
        if (!result) {
          return { content: [{ type: "text", text: `Variant '${variant}' not found for page '${slug}' locale '${locale}' (file: ${variant}.${locale}.yml)` }], isError: true };
        }
        const { meta: _meta, ...dataWithoutMeta } = result.data;
        return { content: [{ type: "text", text: JSON.stringify({ contentType: resolved.contentType, slug, locale, variant, ...dataWithoutMeta, validation_issues: [] }, null, 2) }] };
      }

      const payload = resolvePagePayload(slug, locale, contentType, contentPath);
      if ("isError" in payload) return payload;

      const { meta: _meta, ...dataWithoutMeta } = payload.data;
      const envelope = { contentType: payload.contentType, slug: payload.slug, locale: payload.locale, locales: payload.locales, ...(payload.urls ? { urls: payload.urls } : {}) };

      // Inject cached validation issues (all categories) for this page's URL
      const pageUrl = payload.urls?.[locale];
      const validation_issues = pageUrl ? getCachedValidationIssues(pageUrl, undefined, contentPath) : [];

      return { content: [{ type: "text", text: JSON.stringify({ ...envelope, ...dataWithoutMeta, validation_issues }, null, 2) }] };
    }
  );

  // get_entry_seo
  mcp.tool(
    "get_entry_seo",
    "Get the SEO/meta block plus structured-data preview for a page, with the identifying envelope (contentType, slug, locale, locales, urls). " +
    "Returns meta, validation_issues (cached SEO-category issues from meta / seo-depth / seo-intent), and a rich schema_org block: " +
    "resolved JSON-LD documents + sources (same pipeline as SSR section contributors + Organization dual-emit), " +
    "content-type requirements / hero companion gaps. " +
    "Use this to inspect what Google gets — not for editing schema_org YAML (use get_entry_content / section tools). " +
    "Do not expect a derived JSON-LD dump on get_entry_content. " +
    "Supply 'variant' to read a draft variant file ({variantSlug}.{locale}.yml) instead of the live locale file.",
    {
      slug: z.string().describe("Page slug (folder name), e.g. 'home' or 'full-stack-developer'"),
      locale: z.string().default("en").describe("Locale code, e.g. 'en' or 'es'"),
      contentType: z.string().optional().describe("Content type hint (e.g. 'page', 'program'). Omit to auto-detect from slug."),
      variant: z.string().optional().describe("Variant slug to read (e.g. 'draft-v2'). When provided, reads {variantSlug}.{locale}.yml instead of the live locale file."),
      site: z.string().optional().describe(SITE_PARAM_DESC),
    },
    async ({ slug, locale, contentType, variant, site }) => {
      const siteResult = resolveSiteContext(site);
      if (!siteResult.ok) return siteFailResult(siteResult.error);
      const { contentPath } = siteResult;
      try {
        assertSafeSegment(slug, "slug");
        assertSafeLocale(locale);
        if (contentType) assertSafeSegment(contentType, "contentType");
        if (variant) assertSafeSegment(variant, "variant");
      } catch (e) {
        return { content: [{ type: "text", text: (e as Error).message }], isError: true };
      }

      async function buildSchemaOrgBlock(
        ct: string,
        pageSlug: string,
        pageLocale: string,
        data: Record<string, unknown>,
      ): Promise<Record<string, unknown>> {
        const { collectSectionSchemasDetailed } = await import("../../server/schema-components/index.js");
        const {
          getSchemaOrgRequirementGaps,
          validateHeroCourseCompanions,
          getContentTypeSchemaOrgRequirements,
        } = await import("../../server/schema-org-requirements.js");
        const { getBaseUrl } = await import("../../server/hreflang.js");
        const sections = Array.isArray(data.sections)
          ? (data.sections as Array<Record<string, unknown>>)
          : [];
        const meta = (data.meta && typeof data.meta === "object" ? data.meta : {}) as Record<string, unknown>;
        const detailed = collectSectionSchemasDetailed(sections, {
          locale: pageLocale,
          contentRoot: contentPath,
          baseUrl: getBaseUrl(),
          contentType: ct,
          pageUrl: undefined,
          title: typeof data.title === "string" ? data.title : typeof data.name === "string" ? data.name : undefined,
          description:
            typeof meta.description === "string"
              ? meta.description
              : typeof data.description === "string"
                ? data.description
                : undefined,
        });
        const ctGaps = getSchemaOrgRequirementGaps(sections, ct, contentPath, { slug: pageSlug });
        const heroGaps = validateHeroCourseCompanions(sections, {
          contentType: ct,
          slug: pageSlug,
          locale: pageLocale,
        });
        const requirements = getContentTypeSchemaOrgRequirements(ct, contentPath);
        return {
          documents: detailed.documents,
          preview: detailed.preview,
          sources: detailed.preview.map((p) => p.source),
          requirements,
          companion_gaps: [...ctGaps, ...heroGaps],
          requirements_ok: ctGaps.length === 0,
          hero_course_companion_ok: heroGaps.length === 0,
        };
      }

      if (variant) {
        const resolved = resolveContentType(slug, contentType, contentPath);
        if (!resolved) {
          return { content: [{ type: "text", text: `Page not found for slug '${slug}'${contentType ? ` (contentType: ${contentType})` : ""}` }], isError: true };
        }
        const result = loadVariantPage(resolved.contentType, slug, locale, variant, contentPath);
        if (!result) {
          return { content: [{ type: "text", text: `Variant '${variant}' not found for page '${slug}' locale '${locale}' (file: ${variant}.${locale}.yml)` }], isError: true };
        }
        const schema_org = await buildSchemaOrgBlock(
          resolved.contentType,
          slug,
          locale,
          result.data as Record<string, unknown>,
        );
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  contentType: resolved.contentType,
                  slug,
                  locale,
                  variant,
                  meta: result.data.meta,
                  schema_org,
                  validation_issues: [],
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      const payload = resolvePagePayload(slug, locale, contentType, contentPath);
      if ("isError" in payload) return payload;

      // Inject cached SEO-only validation issues for this page's URL
      const pageUrl = payload.urls?.[locale];
      const validation_issues = pageUrl ? getCachedValidationIssues(pageUrl, ["seo"], contentPath) : [];

      const schema_org = await buildSchemaOrgBlock(
        payload.contentType,
        payload.slug,
        payload.locale,
        payload.data,
      );

      const seoPayload = {
        contentType: payload.contentType,
        slug: payload.slug,
        locale: payload.locale,
        locales: payload.locales,
        ...(payload.urls ? { urls: payload.urls } : {}),
        meta: payload.data.meta,
        schema_org,
        validation_issues,
      };

      return { content: [{ type: "text", text: JSON.stringify(seoPayload, null, 2) }] };
    }
  );

  // regenerate_entry_previews
  mcp.tool(
    "regenerate_entry_previews",
    "Queue Cloudflare Browser Run captures for entry-preview / OG images. " +
    "Requires locales (non-empty). Optional slugs scopes to those entries. " +
    "mode: missing (needs capture), all (force dirty+regen), failed (retry failures). " +
    "On success writes WebP under images/entry-previews/ and updates live locale YAML meta.og_image " +
    "(with ?t= cache-bust) unless a distinct gallery/editorial image is set. Variants are never captured. " +
    "Does not commit/push content GitHub by itself (AutoCommitQueue when enabled). " +
    "Cloudflare creds: host env only (CLOUDFLARE_* / ENTRY_PREVIEW_CAPTURE_SECRET; staff SEO/GEO → OG Image is display/test only). " +
    "Does not edit Brand or schema-org.yml. " +
    "Requires content_edit_media.",
    {
      content_type: z.string().describe("Content type with preview: config, e.g. 'blog'"),
      locales: z.array(z.string()).min(1).describe("Required live locales to capture (e.g. ['en','es']). No implicit all/primary."),
      mode: z.enum(["missing", "all", "failed"]).default("missing"),
      slugs: z.array(z.string()).optional().describe("Optional entry slugs to regenerate; omit for all in those locales"),
      site: z.string().optional().describe(SITE_PARAM_DESC),
    },
    async ({ content_type, locales, mode, slugs, site }) => {
      if (mcpToken && !(await checkCap(mcpToken, "content_edit_media"))) {
        return denyResponse("content_edit_media");
      }
      const siteResult = resolveSiteContext(site);
      if (!siteResult.ok) return siteFailResult(siteResult.error);
      const { domain } = siteResult;
      try {
        assertSafeSegment(content_type, "content_type");
        for (const loc of locales) assertSafeLocale(loc);
        if (slugs) for (const s of slugs) assertSafeSegment(s, "slug");
      } catch (e) {
        return fail((e as Error).message);
      }

      const q = domain ? `?__site=${encodeURIComponent(domain)}` : "";
      try {
        const res = await fetch(
          `http://localhost:${MAIN_SERVER_PORT}/api/content-types/${encodeURIComponent(content_type)}/entry-previews/enqueue${q}`,
          {
            method: "POST",
            headers: { ...internalHeaders(mcpToken), "Content-Type": "application/json" },
            body: JSON.stringify({
              locales,
              mode: mode ?? "missing",
              slugs: slugs && slugs.length > 0 ? slugs : undefined,
            }),
          },
        );
        const data = (await res.json()) as Record<string, unknown>;
        if (!res.ok) {
          return fail(String(data.error ?? data.message ?? `enqueue failed (${res.status})`), {
            code: data.code,
            ...data,
          });
        }

        const omitted = Array.isArray(data.omittedLocales)
          ? (data.omittedLocales as string[])
          : [];
        const warnings: McpWarning[] = [];
        if (omitted.length > 0) {
          warnings.push({
            code: "locales_not_regenerated",
            message: `These entry locales exist but were not in locales[] and will not be regenerated: ${omitted.join(", ")}`,
          });
        }
        warnings.push({
          code: "editorial_og_not_overwritten",
          message:
            "Entries with a distinct gallery/editorial meta.og_image or _image keep that URL; YAML is not overwritten.",
        });
        warnings.push({
          code: "no_content_github_push",
          message:
            "YAML meta.og_image is markFileAsModified + AutoCommitQueue when GITHUB_SYNC_ENABLED and GITHUB_AUTO_COMMIT_ENABLED; WebPs are gitignored under images/entry-previews/.",
        });
        warnings.push({
          code: "variants_skipped",
          message: "Draft/variant YAML files are never captured or written.",
        });
        warnings.push({
          code: "creds_env_only",
          message:
            "Capture uses host env CLOUDFLARE_* / ENTRY_PREVIEW_CAPTURE_SECRET (else SESSION_SECRET). This tool does not write those credentials, settings.yml, Brand, or schema-org.yml.",
        });

        const enqueued = Array.isArray(data.enqueued) ? (data.enqueued as string[]) : [];
        return ok(
          {
            content_type,
            mode: mode ?? "missing",
            locales,
            slugs: slugs ?? null,
            enqueued_count: enqueued.length,
            enqueued,
            skipped: data.skipped ?? [],
            omitted_locales: omitted,
            queue: data.queue ?? null,
            message: `Queued ${enqueued.length} entry-preview capture job(s).`,
          },
          {
            warnings,
            side_effects: [
              {
                kind: "queue_entry_preview_capture",
                summary: `Cloudflare Browser Run jobs for ${content_type} (${enqueued.length} keys)`,
              },
              {
                kind: "write_entry_preview_webp",
                summary:
                  "On success: images/entry-previews/{type}/{slug}/{locale}/{width}.webp (+ .meta.json)",
              },
              {
                kind: "write_locale_meta_og_image",
                summary:
                  "On success (non-editorial): live {locale}.yml meta.og_image with ?t= cache-bust",
              },
            ],
            next_actions: [
              {
                tool: "run_entry_diagnostics",
                reason: "After jobs finish, hard-refresh SEO diagnostics to confirm MISSING_OG_IMAGE cleared",
                args_hint: {
                  freshness: "hard",
                  ...(slugs && slugs.length ? { slugs } : {}),
                  categories: ["seo"],
                  ...(site ? { site } : {}),
                },
                priority: "recommended",
              },
            ],
          },
        );
      } catch (e) {
        return fail(`Failed to enqueue entry previews: ${(e as Error).message}`);
      }
    },
  );

  // run_entry_diagnostics (async — returns cached or queues a background job)
  mcp.tool(
    "run_entry_diagnostics",
    "Start or read page diagnostics. Does NOT wait for validators to finish. " +
    "Returns status 'cached' (issues from validation-cache when fresh) or 'queued'/'running' with job_id. " +
    "When queued/running: wait retry_after_seconds then call get_diagnostics_job — do NOT re-call this tool to poll. " +
    "freshness 'max_age' (default) recomputes only URLs whose lastFullRunAt is older than max_age_seconds (default 86400); " +
    "'hard' forces a recompute. Optional slugs scopes the run. categories filters the response only (cache always stores full issues). " +
    "Empty issues without lastFullRunAt means cache_miss, not clean. After edits prefer freshness 'hard' + slugs.",
    {
      slugs: z.array(z.string()).optional().describe("Optional page slugs to scope. Omit for all YAML-backed pages."),
      categories: z.array(z.string()).optional().describe("Filter returned issues to categories (e.g. ['seo']). Does not narrow the job."),
      freshness: z.enum(["hard", "max_age"]).optional().describe("max_age (default) uses lastFullRunAt; hard always recomputes."),
      max_age_seconds: z.number().optional().describe("TTL for max_age freshness (default 86400). Ignored when freshness is hard."),
      site: z.string().optional().describe(SITE_PARAM_DESC),
    },
    async ({ slugs, categories, freshness, max_age_seconds, site }) => {
      const siteResult = resolveSiteContext(site);
      if (!siteResult.ok) return siteFailResult(siteResult.error);
      const { domain } = siteResult;
      const q = domain ? `?__site=${encodeURIComponent(domain)}` : "";
      try {
        const res = await fetch(
          `http://localhost:${MAIN_SERVER_PORT}/api/validation/diagnostics-jobs${q}`,
          {
            method: "POST",
            headers: internalHeaders(),
            body: JSON.stringify({
              slugs: slugs && slugs.length > 0 ? slugs : undefined,
              categories,
              freshness: freshness ?? "max_age",
              max_age_seconds: max_age_seconds ?? 86400,
            }),
          },
        );
        const data = await res.json() as Record<string, unknown>;

        if (res.status === 409 || data.status === "busy") {
          const jobId = String(data.job_id ?? "");
          const retry = Number(data.retry_after_seconds ?? 5);
          return ok(
            {
              status: "busy",
              code: "diagnostics_busy",
              job_id: jobId,
              retry_after_seconds: retry,
              message: String(data.message ?? "Another diagnostics job is running for this site."),
            },
            {
              warnings: [{
                code: "diagnostics_busy",
                message: "A different diagnostics job is already running. Poll that job_id or wait retry_after_seconds then retry.",
              }],
              next_actions: jobId
                ? [{
                    tool: "get_diagnostics_job",
                    reason: "Poll the in-flight job until completed",
                    args_hint: { job_id: jobId, ...(site ? { site } : {}) },
                    priority: "required",
                  }]
                : [],
            },
          );
        }

        if (!res.ok) {
          return fail(String(data.message ?? data.error ?? `diagnostics-jobs failed (${res.status})`), data);
        }

        if (data.status === "cached") {
          const cacheMisses = Array.isArray(data.cacheMisses) ? data.cacheMisses as string[] : [];
          return ok(
            {
              status: "cached",
              issuesBySlug: data.issuesBySlug ?? {},
              lastFullRunAtBySlug: data.lastFullRunAtBySlug ?? {},
              cache_misses: cacheMisses,
              message: cacheMisses.length
                ? "Returned cache; some slugs have no lastFullRunAt (cache_miss — not necessarily clean)."
                : "Returned fresh-enough cached diagnostics (lastFullRunAt within max_age).",
            },
            { warnings: [], next_actions: [] },
          );
        }

        const jobId = String(data.job_id ?? "");
        const retry = Number(data.retry_after_seconds ?? 5);
        const reused = data.reused === true;
        return ok(
          {
            status: data.status ?? "queued",
            job_id: jobId,
            retry_after_seconds: retry,
            scope: data.scope,
            message: "Diagnostics started in the background. Do not wait on this call for results.",
          },
          {
            warnings: [
              {
                code: "diagnostics_async",
                message: "This call did not return validation issues. Poll get_diagnostics_job after retry_after_seconds.",
              },
              ...(reused
                ? [{
                    code: "diagnostics_job_reused",
                    message: "Returned an existing in-flight job with the same scope (exact dedupe).",
                  }]
                : []),
            ],
            side_effects: [{
              kind: "diagnostics_job",
              summary: `Background job ${jobId} will write validation-cache.json when completed.`,
            }],
            next_actions: [{
              tool: "get_diagnostics_job",
              reason: "Poll until status is completed or failed",
              args_hint: { job_id: jobId, ...(site ? { site } : {}) },
              priority: "required",
            }],
          },
        );
      } catch (e) {
        return fail(`Failed to start diagnostics: ${(e as Error).message}`);
      }
    }
  );

  mcp.tool(
    "get_diagnostics_job",
    "Poll an async diagnostics job started by run_entry_diagnostics. " +
    "If status is queued/running: wait retry_after_seconds then call this tool again with the same job_id. " +
    "Do not call run_entry_diagnostics to poll. Terminal: completed (issuesBySlug + cache_updated), failed, or not_found " +
    "(diagnostics_job_lost — start a new run_entry_diagnostics).",
    {
      job_id: z.string().describe("Job id from run_entry_diagnostics"),
      site: z.string().optional().describe(SITE_PARAM_DESC),
    },
    async ({ job_id, site }) => {
      const siteResult = resolveSiteContext(site);
      if (!siteResult.ok) return siteFailResult(siteResult.error);
      const { domain } = siteResult;
      const q = domain ? `?__site=${encodeURIComponent(domain)}` : "";
      try {
        const res = await fetch(
          `http://localhost:${MAIN_SERVER_PORT}/api/validation/diagnostics-jobs/${encodeURIComponent(job_id)}${q}`,
          { headers: internalHeaders() },
        );
        const data = await res.json() as Record<string, unknown>;

        if (res.status === 404 || data.status === "not_found") {
          return ok(
            {
              status: "not_found",
              code: "diagnostics_job_lost",
              job_id,
              message: String(data.message ?? "Job lost or expired."),
            },
            {
              warnings: [{
                code: "diagnostics_job_lost",
                message: "Job expired, evicted, or lost on restart. Call run_entry_diagnostics again — do not keep polling this job_id.",
              }],
              next_actions: [{
                tool: "run_entry_diagnostics",
                reason: "Start a new diagnostics job",
                args_hint: { freshness: "hard", ...(site ? { site } : {}) },
                priority: "recommended",
              }],
            },
          );
        }

        if (!res.ok) {
          return fail(String(data.message ?? data.error ?? `get job failed (${res.status})`), data);
        }

        const status = String(data.status ?? "");
        if (status === "queued" || status === "running") {
          const retry = Number(data.retry_after_seconds ?? 5);
          return ok(
            {
              status,
              job_id,
              processed: data.processed,
              total: data.total,
              retry_after_seconds: retry,
              scope: data.scope,
            },
            {
              warnings: [{
                code: "diagnostics_async",
                message: "Job still running. Wait retry_after_seconds then call get_diagnostics_job again.",
              }],
              next_actions: [{
                tool: "get_diagnostics_job",
                reason: "Continue polling",
                args_hint: { job_id, ...(site ? { site } : {}) },
                priority: "required",
              }],
            },
          );
        }

        if (status === "failed") {
          return ok(
            {
              status: "failed",
              job_id,
              error: data.error,
              message: String(data.error ?? "Diagnostics job failed"),
            },
            {
              warnings: [{ code: "diagnostics_failed", message: String(data.error ?? "Job failed") }],
              next_actions: [{
                tool: "run_entry_diagnostics",
                reason: "Start a new diagnostics job after failure",
                args_hint: { freshness: "hard", ...(site ? { site } : {}) },
                priority: "optional",
              }],
            },
          );
        }

        return ok(
          {
            status: "completed",
            job_id,
            cache_updated: data.cache_updated === true,
            issuesBySlug: data.issuesBySlug ?? {},
            summary: data.summary,
            scope: data.scope,
          },
          { warnings: [], next_actions: [] },
        );
      } catch (e) {
        return fail(`Failed to get diagnostics job: ${(e as Error).message}`);
      }
    }
  );

  // ── Shared helpers for the new split tools ──────────────────────────────────

  // Safe top-level paths are resolved per content-type via safeTopLevelFieldsForConfig (editor.type).

  const META_COMMON_FIELDS = new Set(["robots", "priority", "change_frequency"]);
  const META_LOCALE_FIELDS = new Set([
    "page_title", "description", "og_image", "og_type",
    "og_url", "og_locale", "canonical_url",
  ]);
  const ALL_KNOWN_META_FIELDS = new Set([...META_COMMON_FIELDS, ...META_LOCALE_FIELDS]);

  const layoutTargetSchema = z
    .enum(["auto", "entry", "type_single"])
    .optional()
    .default("auto")
    .describe(LAYOUT_TARGET_DESC);
  const confirmLayoutTargetSchema = z
    .boolean()
    .optional()
    .describe('Set true after choosing layout_target "entry" or "type_single" when confirm_layout_target was required.');

  function bindingPropagateSideEffects(boundUpdates: unknown): McpSideEffect[] | undefined {
    if (!Array.isArray(boundUpdates) || boundUpdates.length === 0) return undefined;
    return [{
      kind: "binding_propagate",
      summary: `Server propagated bound section updates to ${boundUpdates.length} sibling file(s): ${boundUpdates.join(", ")}`,
    }];
  }

  // update_section_field
  mcp.tool(
    "update_section_field",
    "Update a single section field (or safe top-level page field) in a page's locale YAML file. " +
    "Use this for all content/section edits — field_path must start with 'sections.' or be a safe " +
    "top-level field allowed by the content type editor (title, slug, settings, and editor.type-safe mapping keys such as description/content). " +
    "Do NOT use this for SEO/meta fields — use update_meta_field instead. " +
    "contentType is optional — omit it and the server will auto-detect from slug.\n\n" +
    MULTI_SITE_TOOL_BLURB + "\n\n" +
    "IMPORTANT — versioning safety: If the page has active variants (a versioning.yml exists), " +
    "you MUST ask the principal before calling this tool: " +
    "'Do you want to edit the live version directly, or create a new draft variant first?' " +
    "To edit the live version directly pass confirm_live_edit: true. " +
    "To edit a variant, call create_variant first and pass the returned slug as the 'variant' parameter here.",
    {
      slug: z.string().describe("Page slug"),
      locale: z.string().default("en").describe("Locale code, e.g. 'en' or 'es'"),
      field_path: z.string().describe(
        "Dot-notation path targeting section content. Must start with 'sections.' (e.g. 'sections.0.title') " +
        "or be a safe top-level field for this content type (title, slug, description, content, …). " +
        "Paths starting with 'meta.' are rejected — use update_meta_field instead."
      ),
      value: z.unknown().describe("New value for the field"),
      contentType: z.string().optional().describe("Content type hint. Omit to auto-detect from slug."),
      variant: z.string().optional().describe("Variant slug to write to (e.g. 'draft-v2'). Writes to {variantSlug}.{locale}.yml instead of the live locale file."),
      confirm_live_edit: z.boolean().optional().describe("Set to true to confirm you want to overwrite the live locale file directly when a versioning.yml exists. Required when no 'variant' is supplied and the page has active variants."),
      layout_target: layoutTargetSchema,
      confirm_layout_target: confirmLayoutTargetSchema,
      site: z.string().optional().describe(SITE_PARAM_DESC),
    },
    async ({ slug, locale, field_path: fieldPath, value, contentType, variant, confirm_live_edit, layout_target, confirm_layout_target, site }) => {
      const siteResult = resolveSiteContext(site);
      if (!siteResult.ok) return siteFailResult(siteResult.error);
      const { contentPath, contentFolder, domain } = siteResult;
      try {
        assertSafeSegment(slug, "slug");
        assertSafeLocale(locale);
        if (contentType) assertSafeSegment(contentType, "contentType");
        if (variant) assertSafeSegment(variant, "variant");
      } catch (e) {
        return fail((e as Error).message);
      }

      if (fieldPath.startsWith("meta.")) {
        return fail(`field_path '${fieldPath}' targets a meta field. Use update_meta_field instead.`);
      }

      const resolved = resolveContentType(slug, contentType, contentPath, { allowSharedLayout: true });
      if (!resolved) {
        return fail(`Page not found for slug '${slug}'${contentType ? ` (contentType: ${contentType})` : ""}`);
      }

      const safeTop = safeTopLevelFieldsForConfig(resolved.config);
      if (!fieldPath.startsWith("sections.") && !safeTop.has(fieldPath)) {
        return fail(`field_path '${fieldPath}' is not allowed. Must start with 'sections.' or be one of: ${[...safeTop].join(", ")}.`);
      }

      if (mcpToken) {
        if (!await checkCap(mcpToken, "content_edit_text", resolved.contentType)) {
          return denyResponse("content_edit_text", resolved.contentType);
        }
      }

      const liveGate = confirmLiveEditGate({
        tool: "update_section_field",
        slug,
        contentType: resolved.contentType,
        locale,
        contentPath,
        variant,
        confirm_live_edit,
        extraArgsHint: { field_path: fieldPath, value, layout_target, confirm_layout_target },
      });
      if (liveGate) return liveGate;

      const layoutGate = resolveLayoutTargetGate({
        tool: "update_section_field",
        contentType: resolved.contentType,
        config: resolved.config,
        slug,
        locale,
        layout_target: layout_target as LayoutTarget | undefined,
        confirm_layout_target,
        requireConfirmWhenAuto: fieldPath.startsWith("sections."),
      });
      if ("gate" in layoutGate) return layoutGate.gate;
      const layoutTarget = layoutGate.target;

      const pathInfo = pathForLayoutTarget({
        contentPath,
        contentType: resolved.contentType,
        config: resolved.config,
        slug,
        locale,
        layoutTarget,
        variant,
      });
      try { assertWithinBase(pathInfo.filePath, contentPath); } catch (e) {
        return fail((e as Error).message);
      }
      if (!fs.existsSync(pathInfo.filePath)) {
        return fail(`File not found: ${pathInfo.relativeHint}`);
      }

      const relativePath = `${contentFolder}/${pathInfo.relativeHint}`;
      const conflictErr = await getConflictError(pathInfo.filePath, relativePath, [[fieldPath, value]], { fieldPath, value }, domain);
      if (conflictErr) return conflictErr;
      const apiResult = await callEditSectionsApi(
        {
          contentType: resolved.contentType,
          slug,
          locale,
          variant,
          layoutTarget,
          operations: [{ action: "update_field", path: fieldPath, value }],
        },
        mcpToken,
        domain,
      );
      if ("error" in apiResult) return apiResult.error;
      const boundUpdates = apiResult.data.boundUpdates;
      const schemaWarnings =
        fieldPath.includes("schema_type") || fieldPath.startsWith("sections.")
          ? schemaOrgOverrideWarningsFromFieldUpdates({ [fieldPath]: value })
          : [];
      return ok(
        {
          message: `Updated '${fieldPath}' in ${pathInfo.relativeHint}`,
          ...wrotePayload({
            layer: pathInfo.layer,
            contentType: resolved.contentType,
            path: pathInfo.relativeHint,
            locale,
            slug,
          }),
          ...(Array.isArray(boundUpdates) && boundUpdates.length > 0 ? { bound_updates: boundUpdates } : {}),
        },
        {
          warnings: [...variantWarningsIfNeeded(variant), ...schemaWarnings],
          next_actions: [],
          side_effects: bindingPropagateSideEffects(boundUpdates),
        },
      );
    }
  );

  // update_section_fields (bulk)
  mcp.tool(
    "update_section_fields",
    "Update multiple section fields (or safe top-level page fields) in a single write to a page's locale YAML file. " +
    "Use this for all content/section edits — every key in 'fields' must start with 'sections.' or be one of " +
    "the safe top-level fields ('title', 'slug'). " +
    "Do NOT use this for SEO/meta fields — use update_meta_fields instead. " +
    "contentType is optional — omit it and the server will auto-detect from slug.\n\n" +
    "IMPORTANT — versioning safety: If the page has active variants (a versioning.yml exists), " +
    "you MUST ask the user before calling this tool: " +
    "'Do you want to edit the live version directly, or create a new draft variant first?' " +
    "To edit the live version directly pass confirm_live_edit: true. " +
    "To edit a variant, call create_variant first and pass the returned slug as the 'variant' parameter here.",
    {
      slug: z.string().describe("Page slug"),
      locale: z.string().default("en").describe("Locale code, e.g. 'en' or 'es'"),
      fields: z.record(z.unknown()).describe(
        "Map of dot-notation field paths to new values. Keys must start with 'sections.' or be 'title'/'slug'. " +
        "E.g. { 'sections.0.title': 'New Title', 'sections.0.subtitle': 'Sub' }"
      ),
      contentType: z.string().optional().describe("Content type hint. Omit to auto-detect from slug."),
      variant: z.string().optional().describe("Variant slug to write to (e.g. 'draft-v2'). Writes to {variantSlug}.{locale}.yml instead of the live locale file."),
      confirm_live_edit: z.boolean().optional().describe("Set to true to confirm you want to overwrite the live locale file directly when a versioning.yml exists. Required when no 'variant' is supplied and the page has active variants."),
      layout_target: layoutTargetSchema,
      confirm_layout_target: confirmLayoutTargetSchema,
      site: z.string().optional().describe(SITE_PARAM_DESC),
    },
    async ({ slug, locale, fields, contentType, variant, confirm_live_edit, layout_target, confirm_layout_target, site }) => {
      const siteResult = resolveSiteContext(site);
      if (!siteResult.ok) return siteFailResult(siteResult.error);
      const { contentPath, contentFolder, domain } = siteResult;
      try {
        assertSafeSegment(slug, "slug");
        assertSafeLocale(locale);
        if (contentType) assertSafeSegment(contentType, "contentType");
        if (variant) assertSafeSegment(variant, "variant");
      } catch (e) {
        return fail((e as Error).message);
      }

      const metaPaths = Object.keys(fields).filter(fp => fp.startsWith("meta."));
      if (metaPaths.length > 0) {
        return fail(`field_path(s) target meta fields: ${metaPaths.join(", ")}. Use update_meta_fields instead.`);
      }

      const resolved = resolveContentType(slug, contentType, contentPath, { allowSharedLayout: true });
      if (!resolved) {
        return fail(`Page not found for slug '${slug}'${contentType ? ` (contentType: ${contentType})` : ""}`);
      }

      const safeTop = safeTopLevelFieldsForConfig(resolved.config);
      const badPaths = Object.keys(fields).filter(fp => !fp.startsWith("sections.") && !safeTop.has(fp));
      if (badPaths.length > 0) {
        return fail(`Disallowed field_path(s): ${badPaths.join(", ")}. Must start with 'sections.' or be one of: ${[...safeTop].join(", ")}.`);
      }

      if (mcpToken) {
        if (!await checkCap(mcpToken, "content_edit_text", resolved.contentType)) {
          return denyResponse("content_edit_text", resolved.contentType);
        }
      }

      const liveGate = confirmLiveEditGate({
        tool: "update_section_fields",
        slug,
        contentType: resolved.contentType,
        locale,
        contentPath,
        variant,
        confirm_live_edit,
        extraArgsHint: { fields, layout_target, confirm_layout_target },
      });
      if (liveGate) return liveGate;

      const touchesSections = Object.keys(fields).some(k => k.startsWith("sections."));
      const layoutGate = resolveLayoutTargetGate({
        tool: "update_section_fields",
        contentType: resolved.contentType,
        config: resolved.config,
        slug,
        locale,
        layout_target: layout_target as LayoutTarget | undefined,
        confirm_layout_target,
        requireConfirmWhenAuto: touchesSections,
      });
      if ("gate" in layoutGate) return layoutGate.gate;
      const layoutTarget = layoutGate.target;

      const pathInfo = pathForLayoutTarget({
        contentPath,
        contentType: resolved.contentType,
        config: resolved.config,
        slug,
        locale,
        layoutTarget,
        variant,
      });
      try { assertWithinBase(pathInfo.filePath, contentPath); } catch (e) {
        return fail((e as Error).message);
      }
      if (!fs.existsSync(pathInfo.filePath)) {
        return fail(`File not found: ${pathInfo.relativeHint}`);
      }

      const relativePath = `${contentFolder}/${pathInfo.relativeHint}`;
      const fieldEntries = Object.entries(fields);
      const conflictErr = await getConflictError(pathInfo.filePath, relativePath, fieldEntries, { fields }, domain);
      if (conflictErr) return conflictErr;
      let existingSections: Array<Record<string, unknown>> = [];
      try {
        const before = safeLoad(fs.readFileSync(pathInfo.filePath, "utf-8")) || {};
        if (Array.isArray(before.sections)) {
          existingSections = before.sections as Array<Record<string, unknown>>;
        }
      } catch {
        /* ignore */
      }
      const schemaWarnings = schemaOrgOverrideWarningsFromFieldUpdates(fields, existingSections);
      const operations = fieldEntries.map(([p, v]) => ({ action: "update_field", path: p, value: v }));
      const apiResult = await callEditSectionsApi(
        { contentType: resolved.contentType, slug, locale, variant, layoutTarget, operations },
        mcpToken,
        domain,
      );
      if ("error" in apiResult) return apiResult.error;
      const boundUpdates = apiResult.data.boundUpdates;
      const count = Object.keys(fields).length;
      return ok(
        {
          message: `Updated ${count} field${count !== 1 ? "s" : ""} in ${pathInfo.relativeHint}`,
          ...wrotePayload({
            layer: pathInfo.layer,
            contentType: resolved.contentType,
            path: pathInfo.relativeHint,
            locale,
            slug,
          }),
          ...(Array.isArray(boundUpdates) && boundUpdates.length > 0 ? { bound_updates: boundUpdates } : {}),
        },
        {
          warnings: [...variantWarningsIfNeeded(variant), ...schemaWarnings],
          next_actions: [],
          side_effects: bindingPropagateSideEffects(boundUpdates),
        },
      );
    }
  );

  // update_meta_field
  mcp.tool(
    "update_meta_field",
    "Update a single SEO/meta field on a page. Always writes nested under meta.<field> in the correct file. " +
    "Known fields are auto-routed: robots/priority/change_frequency → _common.yml; " +
    "page_title/description/og_image/og_type/og_url/og_locale/canonical_url → {locale}.yml. " +
    "Use 'custom_fields' + 'target' for non-standard meta fields not in the known list — target must be explicit ('locale' or 'common'). " +
    "Do NOT use this for section/content edits — use update_section_field instead.\n\n" +
    "Live gate: live locale saves require resolved non-empty meta.page_title + meta.description " +
    "(draft-only writes exempt). Clearing either on a live page fails. " +
    "editor.required fields (e.g. blog title/description) are separate — drafts may be empty; publish/live cannot clear.\n\n" +
    "IMPORTANT — versioning safety: If the page has active variants (a versioning.yml exists), " +
    "you MUST ask the user before calling this tool: " +
    "'Do you want to edit the live version directly, or create a new draft variant first?' " +
    "To edit the live version directly pass confirm_live_edit: true. " +
    "To edit a variant's locale file, pass 'variant' (e.g. 'draft-v2') — locale-routed fields write to {variantSlug}.{locale}.yml.",
    {
      slug: z.string().describe("Page slug"),
      contentType: z.string().optional().describe("Content type hint. Omit to auto-detect from slug."),
      field: z.enum([
        "page_title", "description", "og_image", "og_type", "og_url", "og_locale", "canonical_url",
        "robots", "priority", "change_frequency",
      ]).optional().describe(
        "Known meta field to update. Auto-routed to the correct file. " +
        "Locale fields (page_title, description, og_image, og_type, og_url, og_locale, canonical_url) → {locale}.yml (or {variant}.{locale}.yml when variant is set). " +
        "Common fields (robots, priority, change_frequency) → _common.yml (variant has no effect on common fields)."
      ),
      value: z.unknown().optional().describe("New value for the known 'field'. Required when 'field' is provided."),
      locale: z.string().default("en").describe("Locale code used when writing to a locale file, e.g. 'en' or 'es'"),
      custom_fields: z.record(z.unknown()).optional().describe(
        "Map of non-standard meta field names to values. Cannot contain known field names (use 'field' for those). " +
        "Requires 'target' to be explicitly set."
      ),
      target: z.enum(["locale", "common"]).optional().describe(
        "Required when 'custom_fields' is provided. 'locale' writes to {locale}.yml (or {variant}.{locale}.yml), 'common' writes to _common.yml."
      ),
      variant: z.string().optional().describe("Variant slug (e.g. 'draft-v2'). When set, locale-routed fields write to {variantSlug}.{locale}.yml instead of {locale}.yml."),
      confirm_live_edit: z.boolean().optional().describe("Set to true to confirm you want to overwrite the live locale file directly when a versioning.yml exists. Required when no 'variant' is supplied and the page has active variants."),
      site: z.string().optional().describe(SITE_PARAM_DESC),
    },
    async ({ slug, contentType, field, value, locale, custom_fields, target, variant, confirm_live_edit, site }) => {
      const siteResult = resolveSiteContext(site);
      if (!siteResult.ok) return siteFailResult(siteResult.error);
      const { contentPath, contentFolder, domain } = siteResult;
      try {
        assertSafeSegment(slug, "slug");
        assertSafeLocale(locale);
        if (contentType) assertSafeSegment(contentType, "contentType");
        if (variant) assertSafeSegment(variant, "variant");
      } catch (e) {
        return fail((e as Error).message);
      }

      if (!field && !custom_fields) {
        return fail("Provide either 'field' + 'value' for a known meta field, or 'custom_fields' + 'target' for non-standard fields.");
      }
      if (custom_fields && !target) {
        return fail("'target' is required when providing 'custom_fields'. Set target to 'locale' or 'common'.");
      }
      if (custom_fields) {
        const knownInCustom = Object.keys(custom_fields).filter(k => ALL_KNOWN_META_FIELDS.has(k));
        if (knownInCustom.length > 0) {
          return fail(`'custom_fields' contains known meta field(s): ${knownInCustom.join(", ")}. Use 'field' parameter instead for auto-routing.`);
        }
      }

      const resolved = resolveContentType(slug, contentType, contentPath, { allowSharedLayout: true });
      if (!resolved) {
        return fail(`Page not found for slug '${slug}'${contentType ? ` (contentType: ${contentType})` : ""}`);
      }

      if (mcpToken) {
        if (!await checkCap(mcpToken, "seo_edit")) {
          return denyResponse("seo_edit");
        }
      }

      const liveGate = confirmLiveEditGate({
        tool: "update_meta_field",
        slug,
        contentType: resolved.contentType,
        locale,
        contentPath,
        variant,
        confirm_live_edit,
        extraArgsHint: { field, value, custom_fields, target },
      });
      if (liveGate) return liveGate;

      const dir = path.join(contentPath, getDirectory(resolved.contentType, resolved.config), slug);
      const ctDir = getDirectory(resolved.contentType, resolved.config);
      const results: string[] = [];

      if (field) {
        if (value === undefined) {
          return fail("'value' is required when 'field' is provided.");
        }
        const isCommon = META_COMMON_FIELDS.has(field);
        // Metafields always use live locale (variants share meta; never write variant files for meta).
        const fileName = isCommon ? "_common.yml" : `${locale}.yml`;
        const filePath = path.join(dir, fileName);
        try { assertWithinBase(filePath, contentPath); } catch (e) {
          return fail((e as Error).message);
        }
        const relativePath = `${contentFolder}/${ctDir}/${slug}/${fileName}`;
        const conflictErrF = await getConflictError(filePath, relativePath, [[`meta.${field}`, value]], { field, value }, domain);
        if (conflictErrF) return conflictErrF;
        const metaOp = { action: "update_field", path: `meta.${field}`, value };
        if (isCommon) {
          const apiErrF = await callEditCommonApi({ contentType: resolved.contentType, slug, operations: [metaOp] }, mcpToken, domain);
          if (apiErrF) return apiErrF;
        } else {
          // No variant — live locale only; API creates overlay if missing
          const apiResultF = await callEditSectionsApi({ contentType: resolved.contentType, slug, locale, operations: [metaOp] }, mcpToken, domain);
          if ("error" in apiResultF) return apiResultF.error;
        }
        results.push(`meta.${field} → ${fileName}`);
      }

      if (custom_fields && target) {
        const fileName = target === "common" ? "_common.yml" : `${locale}.yml`;
        const filePath = path.join(dir, fileName);
        try { assertWithinBase(filePath, contentPath); } catch (e) {
          return fail((e as Error).message);
        }
        const entries: Array<[string, unknown]> = Object.entries(custom_fields).map(([k, v]) => [`meta.${k}`, v]);
        const relativePath = `${contentFolder}/${ctDir}/${slug}/${fileName}`;
        const conflictErrC = await getConflictError(filePath, relativePath, entries, { custom_fields, target }, domain);
        if (conflictErrC) return conflictErrC;
        const ops = entries.map(([p, v]) => ({ action: "update_field", path: p, value: v }));
        if (target === "common") {
          const apiErrC = await callEditCommonApi({ contentType: resolved.contentType, slug, operations: ops }, mcpToken, domain);
          if (apiErrC) return apiErrC;
        } else {
          const apiResultC = await callEditSectionsApi({ contentType: resolved.contentType, slug, locale, operations: ops }, mcpToken, domain);
          if ("error" in apiResultC) return apiResultC.error;
        }
        results.push(`${Object.keys(custom_fields).map(k => `meta.${k}`).join(", ")} → ${fileName}`);
      }

      return ok(
        { message: `Updated ${results.join("; ")} in ${resolved.contentType}/${slug}` },
        { warnings: variantWarningsIfNeeded(variant), next_actions: [] },
      );
    }
  );

  // update_meta_fields (bulk)
  mcp.tool(
    "update_meta_fields",
    "Update multiple SEO/meta fields on a page in a single call. Auto-routes each known field to the correct file " +
    "(may write to both _common.yml and a locale file in one call if the fields span both). " +
    "Known fields: robots/priority/change_frequency → _common.yml; " +
    "page_title/description/og_image/og_type/og_url/og_locale/canonical_url → {locale}.yml. " +
    "Use 'custom_fields' + 'target' for non-standard meta fields. " +
    "Do NOT use this for section/content edits — use update_section_fields instead.\n\n" +
    "Live gate: live saves need resolved meta.page_title + meta.description; drafts exempt. " +
    "Clearing required live meta or editor.required fields fails.\n\n" +
    "IMPORTANT — versioning safety: If the page has active variants (a versioning.yml exists), " +
    "you MUST ask the user before calling this tool: " +
    "'Do you want to edit the live version directly, or create a new draft variant first?' " +
    "To edit the live version directly pass confirm_live_edit: true. " +
    "To edit a variant's locale file, pass 'variant' (e.g. 'draft-v2') — locale-routed fields write to {variantSlug}.{locale}.yml.",
    {
      slug: z.string().describe("Page slug"),
      contentType: z.string().optional().describe("Content type hint. Omit to auto-detect from slug."),
      fields: z.record(z.unknown()).optional().describe(
        "Map of known meta field names to values. Auto-routed per field. " +
        "E.g. { page_title: 'New Title', robots: 'index, follow' }"
      ),
      locale: z.string().default("en").describe("Locale code used when writing to a locale file, e.g. 'en' or 'es'"),
      custom_fields: z.record(z.unknown()).optional().describe(
        "Map of non-standard meta field names to values. Cannot contain known field names. Requires 'target'."
      ),
      target: z.enum(["locale", "common"]).optional().describe(
        "Required when 'custom_fields' is provided. 'locale' writes to {locale}.yml (or {variant}.{locale}.yml), 'common' writes to _common.yml."
      ),
      variant: z.string().optional().describe("Variant slug (e.g. 'draft-v2'). When set, locale-routed fields write to {variantSlug}.{locale}.yml instead of {locale}.yml."),
      confirm_live_edit: z.boolean().optional().describe("Set to true to confirm you want to overwrite the live locale file directly when a versioning.yml exists. Required when no 'variant' is supplied and the page has active variants."),
      site: z.string().optional().describe(SITE_PARAM_DESC),
    },
    async ({ slug, contentType, fields, locale, custom_fields, target, variant, confirm_live_edit, site }) => {
      const siteResult = resolveSiteContext(site);
      if (!siteResult.ok) return siteFailResult(siteResult.error);
      const { contentPath, contentFolder, domain } = siteResult;
      try {
        assertSafeSegment(slug, "slug");
        assertSafeLocale(locale);
        if (contentType) assertSafeSegment(contentType, "contentType");
        if (variant) assertSafeSegment(variant, "variant");
      } catch (e) {
        return fail((e as Error).message);
      }

      if (!fields && !custom_fields) {
        return fail("Provide 'fields' for known meta fields, or 'custom_fields' + 'target' for non-standard fields, or both.");
      }
      if (custom_fields && !target) {
        return fail("'target' is required when providing 'custom_fields'. Set target to 'locale' or 'common'.");
      }
      if (fields) {
        const unknownFields = Object.keys(fields).filter(k => !ALL_KNOWN_META_FIELDS.has(k));
        if (unknownFields.length > 0) {
          return fail(`Unknown meta field(s) in 'fields': ${unknownFields.join(", ")}. Use 'custom_fields' + 'target' for non-standard fields.`);
        }
      }
      if (custom_fields) {
        const knownInCustom = Object.keys(custom_fields).filter(k => ALL_KNOWN_META_FIELDS.has(k));
        if (knownInCustom.length > 0) {
          return fail(`'custom_fields' contains known meta field(s): ${knownInCustom.join(", ")}. Use 'fields' instead for auto-routing.`);
        }
      }

      const resolved = resolveContentType(slug, contentType, contentPath, { allowSharedLayout: true });
      if (!resolved) {
        return fail(`Page not found for slug '${slug}'${contentType ? ` (contentType: ${contentType})` : ""}`);
      }

      if (mcpToken) {
        if (!await checkCap(mcpToken, "seo_edit")) {
          return denyResponse("seo_edit");
        }
      }

      const liveGate = confirmLiveEditGate({
        tool: "update_meta_fields",
        slug,
        contentType: resolved.contentType,
        locale,
        contentPath,
        variant,
        confirm_live_edit,
        extraArgsHint: { fields, custom_fields, target },
      });
      if (liveGate) return liveGate;

      const dir = path.join(contentPath, getDirectory(resolved.contentType, resolved.config), slug);
      const ctDir = getDirectory(resolved.contentType, resolved.config);
      const results: string[] = [];

      if (fields && Object.keys(fields).length > 0) {
        const commonEntries: Array<[string, unknown]> = [];
        const localeEntries: Array<[string, unknown]> = [];

        for (const [k, v] of Object.entries(fields)) {
          if (META_COMMON_FIELDS.has(k)) {
            commonEntries.push([`meta.${k}`, v]);
          } else {
            localeEntries.push([`meta.${k}`, v]);
          }
        }

        if (commonEntries.length > 0) {
          const filePath = path.join(dir, "_common.yml");
          try { assertWithinBase(filePath, contentPath); } catch (e) {
            return fail((e as Error).message);
          }
          const relativePath = `${contentFolder}/${ctDir}/${slug}/_common.yml`;
          const conflictErrCE = await getConflictError(filePath, relativePath, commonEntries, { fields: Object.fromEntries(commonEntries) }, domain);
          if (conflictErrCE) return conflictErrCE;
          const apiErrCE = await callEditCommonApi(
            { contentType: resolved.contentType, slug, operations: commonEntries.map(([p, v]) => ({ action: "update_field", path: p, value: v })) },
            mcpToken,
            domain
          );
          if (apiErrCE) return apiErrCE;
          results.push(`${commonEntries.map(([k]) => k).join(", ")} → _common.yml`);
        }

        if (localeEntries.length > 0) {
          // Live locale only — variants share metafields
          const fileName = `${locale}.yml`;
          const filePath = path.join(dir, fileName);
          try { assertWithinBase(filePath, contentPath); } catch (e) {
            return fail((e as Error).message);
          }
          const relativePath = `${contentFolder}/${ctDir}/${slug}/${fileName}`;
          const conflictErrLE = await getConflictError(filePath, relativePath, localeEntries, { fields: Object.fromEntries(localeEntries) }, domain);
          if (conflictErrLE) return conflictErrLE;
          const apiResultLE = await callEditSectionsApi(
            { contentType: resolved.contentType, slug, locale, operations: localeEntries.map(([p, v]) => ({ action: "update_field", path: p, value: v })) },
            mcpToken,
            domain
          );
          if ("error" in apiResultLE) return apiResultLE.error;
          results.push(`${localeEntries.map(([k]) => k).join(", ")} → ${fileName}`);
        }
      }

      if (custom_fields && target) {
        const fileName = target === "common" ? "_common.yml" : `${locale}.yml`;
        const filePath = path.join(dir, fileName);
        try { assertWithinBase(filePath, contentPath); } catch (e) {
          return fail((e as Error).message);
        }
        const entries: Array<[string, unknown]> = Object.entries(custom_fields).map(([k, v]) => [`meta.${k}`, v]);
        const relativePath = `${contentFolder}/${ctDir}/${slug}/${fileName}`;
        const conflictErrMF = await getConflictError(filePath, relativePath, entries, { custom_fields, target }, domain);
        if (conflictErrMF) return conflictErrMF;
        const opsMF = entries.map(([p, v]) => ({ action: "update_field", path: p, value: v }));
        if (target === "common") {
          const apiErrMF = await callEditCommonApi({ contentType: resolved.contentType, slug, operations: opsMF }, mcpToken, domain);
          if (apiErrMF) return apiErrMF;
        } else {
          const apiResultMF = await callEditSectionsApi({ contentType: resolved.contentType, slug, locale, operations: opsMF }, mcpToken, domain);
          if ("error" in apiResultMF) return apiResultMF.error;
        }
        results.push(`${Object.keys(custom_fields).map(k => `meta.${k}`).join(", ")} → ${fileName}`);
      }

      return ok(
        { message: `Updated ${results.join("; ")} in ${resolved.contentType}/${slug}` },
        { warnings: variantWarningsIfNeeded(variant), next_actions: [] },
      );
    }
  );

  // update_entry_field — DB override OR CT mapped fields (one level per call)
  mcp.tool(
    "update_entry_field",
    "Set one mapping field at exactly one level. " +
    "Precedence: ct_override > db_override > original (DB types). " +
    "level=content_type → PUT .../field-overrides (URL name is historical): " +
    "static types write a top-level root key on the layer YAML file; DB-backed types write the field_overrides bag. " +
    "Optional variant targets {variant}.{locale}.yml (must exist; missing file fails — no live fallback). " +
    "All-draft entries without variant auto-resolve to draft.{locale}.yml when no live file exists. " +
    "level=database → db/{dbSlug}/overrides.json (listings + pages; all locales). " +
    "Never both levels in one call. Inspect with get_entry_fields first. Not for SEO meta.* (use update_meta_field).",
    {
      slug: z.string().describe("Entry slug"),
      contentType: z.string().optional().describe("Content type hint. Omit to auto-detect."),
      field: z.string().describe("Mapping field name, e.g. 'title' or 'author_name'"),
      value: z.unknown().describe("New value for the field"),
      level: z.enum(["database", "content_type"]).describe(
        "database = overrides.json. content_type = mapped field on locale/variant YAML (static: root key; DB: field_overrides bag)."
      ),
      locale: z.string().default("en").describe("Locale for content_type level (ignored for database level)"),
      variant: z
        .string()
        .optional()
        .describe(
          "Optional variant slug (e.g. draft, lumi-version). Writes {variant}.{locale}.yml when set; file must exist.",
        ),
      site: z.string().optional().describe(SITE_PARAM_DESC),
    },
    async ({ slug, contentType, field, value, level, locale, variant, site }) => {
      const siteResult = resolveSiteContext(site);
      if (!siteResult.ok) return siteFailResult(siteResult.error);
      const { domain } = siteResult;
      try {
        assertSafeSegment(slug, "slug");
        assertSafeLocale(locale);
        if (contentType) assertSafeSegment(contentType, "contentType");
        assertSafeSegment(field, "field");
        if (variant) assertSafeSegment(variant, "variant");
      } catch (e) {
        return fail((e as Error).message);
      }

      const resolved = resolveContentType(slug, contentType, siteResult.contentPath, { allowSharedLayout: true });
      if (!resolved) {
        return fail(`Page not found for slug '${slug}'${contentType ? ` (contentType: ${contentType})` : ""}`);
      }
      if (mcpToken && !(await checkCap(mcpToken, "seo_edit"))) {
        return denyResponse("seo_edit");
      }

      const ct = resolved.contentType;
      const ctDir = getDirectory(ct, resolved.config);
      const dbSlug = resolved.config.database?.slug as string | undefined;
      const isStatic = !dbSlug;
      const q = domain ? `?__site=${encodeURIComponent(domain)}` : "";
      const getHint = {
        tool: "get_entry_fields",
        reason: "Re-check provenance after write",
        args_hint: { slug, contentType: ct, locale, ...(variant ? { variant } : {}) },
        priority: "recommended" as const,
      };

      try {
        if (level === "database") {
          const relPath = `db/${dbSlug || "<database>"}/overrides.json`;
          const url = `http://localhost:${MAIN_SERVER_PORT}/api/content-types/${encodeURIComponent(ct)}/db-overrides/${encodeURIComponent(slug)}${q}`;
          const res = await fetch(url, {
            method: "PUT",
            headers: internalHeaders(mcpToken),
            body: JSON.stringify({ fields: { [field]: value } }),
          });
          const data = await res.json() as { error?: string };
          if (!res.ok) return fail(data.error || `Server error: ${res.status}`);
          return ok(
            { message: `Database override set for ${ct}/${slug}.${field} → ${relPath}` },
            {
              warnings: [
                {
                  code: "db_override_affects_listings",
                  message: `Wrote ${relPath}. Affects listings, dropdowns, and pages; shared across locales. Does not write field_overrides YAML.`,
                },
              ],
              side_effects: [
                { kind: "wrote_file", summary: relPath },
                { kind: "cache", summary: "Database item cache / listings may refresh for this slug" },
              ],
              next_actions: [getHint],
            },
          );
        }

        const layerFile = variant ? `${variant}.${locale}.yml` : `${locale}.yml`;
        const relPathFallback = `${ctDir}/${slug}/${layerFile}`;
        const url = `http://localhost:${MAIN_SERVER_PORT}/api/content-types/${encodeURIComponent(ct)}/field-overrides/${encodeURIComponent(slug)}${q}`;
        const res = await fetch(url, {
          method: "PUT",
          headers: internalHeaders(mcpToken),
          body: JSON.stringify({
            locale,
            variant: variant || undefined,
            fields: { [field]: value },
          }),
        });
        const data = await res.json() as {
          error?: string;
          storage?: "root_key" | "field_overrides";
          path?: string;
          isVariantLayer?: boolean;
        };
        if (!res.ok) return fail(data.error || `Server error: ${res.status}`);
        const storage = data.storage || (isStatic ? "root_key" : "field_overrides");
        const writtenPath = data.path || relPathFallback;
        const isPublishedAt = field === "published_at";
        return ok(
          {
            message: isPublishedAt
              ? `published_at set for ${ct}/${slug} on _common.yml (static) or DB override`
              : storage === "root_key"
                ? `Static root key set for ${ct}/${slug}.${field} → ${writtenPath}`
                : `Content-type field_overrides set for ${ct}/${slug}.${field} → ${writtenPath}`,
            storage,
            path: writtenPath,
          },
          {
            warnings: isPublishedAt
              ? [
                  {
                    code: "published_at_common",
                    message:
                      "Static published_at writes _common.yml (listings sort from there). Locale published_at cleared. Cannot clear to empty. Paths: server/published-at.ts, writeMappedFields.",
                  },
                ]
              : [
                  {
                    code: storage === "root_key" ? "static_root_key" : "ct_override_page_only",
                    message:
                      storage === "root_key"
                        ? `Wrote root key on ${writtenPath} (API still named field-overrides; no field_overrides bag on static).`
                        : `Wrote field_overrides on ${writtenPath}. Page/YAML only; does not change database listings.`,
                  },
                  {
                    code: "ct_override_locale_only",
                    message: data.isVariantLayer
                      ? `Variant layer only (${writtenPath}); published ${locale}.yml unchanged until promote.`
                      : `Locale ${locale} only; sibling locales unchanged. Live file only (not _common.yml) except published_at.`,
                  },
                ],
            side_effects: [
              {
                kind: "wrote_file",
                summary: isPublishedAt
                  ? `${ctDir}/${slug}/_common.yml#published_at`
                  : `${writtenPath}#${storage === "root_key" ? field : `field_overrides.${field}`}`,
              },
              {
                kind: "other",
                summary: `storage=${storage}`,
              },
            ],
            next_actions: [getHint],
          },
        );
      } catch (e) {
        return fail((e as Error).message);
      }
    },
  );

  mcp.tool(
    "get_entry_fields",
    "List mapping fields with effective value and provenance " +
    "(original | db_override | ct_override | entry_default). " +
    "Static types: values come from root keys on the layer file (entry_default); leftover field_overrides bags are still applied until migrated. " +
    "DB types: ct_override = field_overrides bag; db_override = overrides.json. " +
    "Optional variant reads {variant}.{locale}.yml. Use before update_entry_field / reset_entry_field.",
    {
      slug: z.string(),
      contentType: z.string().optional(),
      locale: z.string().default("en"),
      variant: z
        .string()
        .optional()
        .describe("Optional variant slug to inspect that layer file instead of live {locale}.yml"),
      site: z.string().optional().describe(SITE_PARAM_DESC),
    },
    async ({ slug, contentType, locale, variant, site }) => {
      const siteResult = resolveSiteContext(site);
      if (!siteResult.ok) return siteFailResult(siteResult.error);
      const { domain } = siteResult;
      try {
        if (variant) assertSafeSegment(variant, "variant");
      } catch (e) {
        return fail((e as Error).message);
      }
      const resolved = resolveContentType(slug, contentType, siteResult.contentPath, { allowSharedLayout: true });
      if (!resolved) {
        return fail(`Page not found for slug '${slug}'`);
      }
      const q = new URLSearchParams({ locale });
      if (domain) q.set("__site", domain);
      if (variant) q.set("variant", variant);
      try {
        const url = `http://localhost:${MAIN_SERVER_PORT}/api/content-types/${encodeURIComponent(resolved.contentType)}/field-provenance/${encodeURIComponent(slug)}?${q}`;
        const res = await fetch(url, { headers: internalHeaders(mcpToken) });
        const data = await res.json();
        if (!res.ok) return fail((data as { error?: string }).error || `Server error: ${res.status}`);
        return ok(
          {
            message: `Fields for ${resolved.contentType}/${slug} (${locale}${variant ? `, variant=${variant}` : ""})`,
            ...(data as Record<string, unknown>),
          },
          { warnings: [], next_actions: [] },
        );
      } catch (e) {
        return fail((e as Error).message);
      }
    },
  );

  mcp.tool(
    "reset_entry_field",
    "Reset a mapping field. " +
    "DB-backed: clears overrides.json and CT field_overrides for that field. " +
    "Static: deletes the root key only if present on this layer file (no-op when value comes only from _common.yml). " +
    "Optional variant targets that layer. API path remains field-reset.",
    {
      slug: z.string(),
      contentType: z.string().optional(),
      field: z.string(),
      locale: z.string().default("en"),
      variant: z.string().optional().describe("Optional variant layer to reset"),
      site: z.string().optional().describe(SITE_PARAM_DESC),
    },
    async ({ slug, contentType, field, locale, variant, site }) => {
      const siteResult = resolveSiteContext(site);
      if (!siteResult.ok) return siteFailResult(siteResult.error);
      const { domain } = siteResult;
      try {
        if (variant) assertSafeSegment(variant, "variant");
      } catch (e) {
        return fail((e as Error).message);
      }
      const resolved = resolveContentType(slug, contentType, siteResult.contentPath, { allowSharedLayout: true });
      if (!resolved) return fail(`Page not found for slug '${slug}'`);
      if (mcpToken && !(await checkCap(mcpToken, "seo_edit"))) return denyResponse("seo_edit");
      const ct = resolved.contentType;
      const ctDir = getDirectory(ct, resolved.config);
      const dbSlug = resolved.config.database?.slug as string | undefined;
      const isStatic = !dbSlug;
      const layerFile = variant ? `${variant}.${locale}.yml` : `${locale}.yml`;
      const dbPath = `db/${dbSlug || "<database>"}/overrides.json`;
      const ctPath = `${ctDir}/${slug}/${layerFile}`;
      const q = domain ? `?__site=${encodeURIComponent(domain)}` : "";
      try {
        const url = `http://localhost:${MAIN_SERVER_PORT}/api/content-types/${encodeURIComponent(ct)}/field-reset/${encodeURIComponent(slug)}${q}`;
        const res = await fetch(url, {
          method: "POST",
          headers: internalHeaders(mcpToken),
          body: JSON.stringify({ field, locale, variant: variant || undefined }),
        });
        const data = await res.json() as {
          error?: string;
          storage?: string;
          path?: string;
          noop?: boolean;
          message?: string;
        };
        if (!res.ok) return fail(data.error || `Server error: ${res.status}`);
        const writtenPath = data.path || ctPath;
        const storage = data.storage || (isStatic ? "root_key" : "field_overrides");
        if (isStatic) {
          return ok(
            {
              message: data.noop
                ? `No-op reset for ${ct}/${slug}.${field} (key not on layer; may live only on _common.yml)`
                : `Reset static ${ct}/${slug}.${field} on ${writtenPath}`,
              storage,
              path: writtenPath,
              noop: !!data.noop,
            },
            {
              warnings: [
                {
                  code: data.noop ? "static_reset_noop" : "static_reset_layer_only",
                  message: data.noop
                    ? `Key absent on ${writtenPath}; reset does not rewrite _common.yml.`
                    : `Deleted root key on ${writtenPath} only. Does not touch _common.yml.`,
                },
              ],
              side_effects: data.noop
                ? [{ kind: "other", summary: `storage=${storage}; noop` }]
                : [
                    { kind: "wrote_file", summary: `${writtenPath}#${field}` },
                    { kind: "other", summary: `storage=${storage}` },
                  ],
              next_actions: [{
                tool: "get_entry_fields",
                reason: "Confirm provenance after reset",
                args_hint: { slug, contentType: ct, locale, ...(variant ? { variant } : {}) },
                priority: "recommended",
              }],
            },
          );
        }
        return ok(
          { message: `Reset ${ct}/${slug}.${field} → cleared ${dbPath} + ${writtenPath}#field_overrides` },
          {
            warnings: [
              {
                code: "reset_clears_both_layers",
                message: `Cleared DB override (${dbPath}) and CT field_overrides on ${writtenPath} for this field. Baseline restored.`,
              },
            ],
            side_effects: [
              { kind: "wrote_file", summary: dbPath },
              { kind: "wrote_file", summary: `${writtenPath}#field_overrides` },
              { kind: "cache", summary: "Database item cache / listings may refresh for this slug" },
              { kind: "other", summary: `storage=${storage}` },
            ],
            next_actions: [{
              tool: "get_entry_fields",
              reason: "Confirm provenance is original after reset",
              args_hint: { slug, contentType: ct, locale, ...(variant ? { variant } : {}) },
              priority: "recommended",
            }],
          },
        );
      } catch (e) {
        return fail((e as Error).message);
      }
    },
  );

  // list_variants
  mcp.tool(
    "list_variants",
    "List all draft variants for a page, including their slug, traffic allocation percentage, and available locales. " +
    "Returns an empty list if the page has no versioning.yml. Use this to check what variants exist before deciding whether to create a new one or edit an existing draft.",
    {
      contentType: z.string().describe("Content type, e.g. 'program', 'page', 'landing'"),
      slug: z.string().describe("Page slug"),
      site: z.string().optional().describe(SITE_PARAM_DESC),
    },
    async ({ contentType, slug, site }) => {
      const siteResult = resolveSiteContext(site);
      if (!siteResult.ok) return siteFailResult(siteResult.error);
      const { domain, contentPath } = siteResult;
      try {
        assertSafeSegment(contentType, "contentType");
        assertSafeSegment(slug, "slug");
      } catch (e) {
        return { content: [{ type: "text", text: (e as Error).message }], isError: true };
      }

      try {
        const versioningSlug = versioningApiSlug(contentType, slug, contentPath);
        const url = `http://localhost:${MAIN_SERVER_PORT}/api/versioning/${encodeURIComponent(contentType)}/${encodeURIComponent(versioningSlug)}${domain ? `?__site=${encodeURIComponent(domain)}` : ""}`;
        const res = await fetch(url, { headers: internalHeaders(mcpToken) });
        const data = await res.json() as Record<string, unknown>;
        if (!res.ok) {
          return { content: [{ type: "text", text: (data.error as string) || `Server error: ${res.status}` }], isError: true };
        }
        if (!data.hasVersioningFile || !data.versioning) {
          return { content: [{ type: "text", text: JSON.stringify({ contentType, slug, versioningSlug, hasVersioning: false, variants: [] }, null, 2) }] };
        }
        const versioning = data.versioning as Record<string, { variants?: Array<{ slug: string; allocation: number }> }>;
        const variants = Object.entries(versioning).flatMap(([locale, localeData]) =>
          (localeData.variants || []).map(v => ({ locale, slug: v.slug, allocation: v.allocation }))
        );
        return { content: [{ type: "text", text: JSON.stringify({ contentType, slug, hasVersioning: true, variants }, null, 2) }] };
      } catch (e) {
        return { content: [{ type: "text", text: `Failed to list variants: ${(e as Error).message}` }], isError: true };
      }
    }
  );

  // create_variant
  mcp.tool(
    "create_variant",
    "Create a new draft/variant for a page by copying the live locale file (or an existing draft when unpublished) " +
    "to {variantSlug}.{locale}.yml and registering it in versioning.yml at 0% traffic allocation. " +
    "Works on unpublished draft entries (copies from an existing draft). " +
    "Returns the new variant slug. Edit with variant: <variantSlug>. " +
    "For unpublished entries use publish_draft to go live (all locales); for live pages use promote_variant (one locale).",
    {
      contentType: z.string().describe("Content type, e.g. 'program', 'page', 'landing'"),
      slug: z.string().describe("Page slug"),
      variantSlug: z.string().describe("Slug for the new variant, e.g. 'draft-v2' or 'ab-test-headline'. Lowercase letters, numbers, and hyphens only."),
      locale: z.string().default("en").describe("Locale to copy, e.g. 'en' or 'es'"),
      sourceVariant: z.string().optional().describe("When page is unpublished, optional draft slug to copy from (defaults to 'draft' or first available)."),
      site: z.string().optional().describe(SITE_PARAM_DESC),
    },
    async ({ contentType, slug, variantSlug, locale, sourceVariant, site }) => {
      const siteResult = resolveSiteContext(site);
      if (!siteResult.ok) return siteFailResult(siteResult.error);
      const { domain, contentPath } = siteResult;
      try {
        assertSafeSegment(contentType, "contentType");
        assertSafeSegment(slug, "slug");
        assertSafeSegment(variantSlug, "variantSlug");
        assertSafeLocale(locale);
        if (sourceVariant) assertSafeSegment(sourceVariant, "sourceVariant");
      } catch (e) {
        return fail((e as Error).message);
      }

      if (mcpToken) {
        if (!await checkCap(mcpToken, "content_create_variant", contentType)) {
          return denyResponse("content_create_variant", contentType);
        }
      }

      try {
        const versioningSlug = versioningApiSlug(contentType, slug, contentPath);
        const url = `http://localhost:${MAIN_SERVER_PORT}/api/versioning/${encodeURIComponent(contentType)}/${encodeURIComponent(versioningSlug)}${domain ? `?__site=${encodeURIComponent(domain)}` : ""}`;
        const res = await fetch(url, {
          method: "POST",
          headers: internalHeaders(mcpToken),
          body: JSON.stringify({ variantSlug, locale, ...(sourceVariant ? { sourceVariant } : {}) }),
        });
        const data = await res.json() as Record<string, unknown>;
        if (!res.ok) {
          return fail((data.error as string) || `Server error: ${res.status}`);
        }
        return ok(
          {
            variantSlug: data.variantSlug,
            locale: data.locale,
            filePath: data.filePath,
            versioningSlug,
            templateMode: versioningSlug === "single",
            seededFromDraft: data.seededFromDraft === true,
          },
          {
            warnings: [...VARIANT_WARNINGS],
            side_effects: [{
              kind: "variant_isolated",
              summary: versioningSlug === "single"
                ? "Created template draft (shared by all attached entries); live single.*.yml unchanged"
                : data.seededFromDraft
                  ? "Created additional draft from existing draft; still unpublished"
                  : "Created draft only; live locale YAML unchanged",
            }],
            next_actions: [{
              tool: "update_section_field",
              priority: "recommended",
              reason: "Edit the draft with variant set; live bindings/shared-layout will not run until publish/promote + live edits.",
              args_hint: {
                contentType,
                slug: versioningSlug === "single" ? slug : slug,
                locale,
                variant: data.variantSlug ?? variantSlug,
                layout_target: versioningSlug === "single" ? "type_single" : undefined,
              },
            }],
          },
        );
      } catch (e) {
        return fail(`Failed to create variant: ${(e as Error).message}`);
      }
    }
  );

  // publish_draft — all-or-nothing publish for unpublished entries
  mcp.tool(
    "publish_draft",
    "Publish an unpublished draft entry: promotes the given variantSlug to live {locale}.yml for EVERY remaining draft locale that has that file (all-or-nothing). " +
    "After this, the page is public and enters the sitemap. Other drafts become normal variants at 0%. " +
    "Fails if the entry already has a live locale (use promote_variant instead) or if some draft locales lack the variantSlug. " +
    "Also fails when resolved meta.page_title / meta.description are empty, when editor.required fields " +
    "(e.g. blog title + description) are empty, or when a detached locale would go live empty (EMPTY_LOCALE: no sections and no content). " +
    "Confirm with the user before calling — this makes the page live.",
    {
      contentType: z.string().describe("Content type, e.g. 'program', 'page', 'landing'"),
      slug: z.string().describe("Page slug"),
      variantSlug: z.string().default("draft").describe("Draft variant to publish, e.g. 'draft'"),
      site: z.string().optional().describe(SITE_PARAM_DESC),
    },
    async ({ contentType, slug, variantSlug, site }) => {
      const siteResult = resolveSiteContext(site);
      if (!siteResult.ok) return siteFailResult(siteResult.error);
      const { contentPath, domain } = siteResult;
      try {
        assertSafeSegment(contentType, "contentType");
        assertSafeSegment(slug, "slug");
        assertSafeSegment(variantSlug, "variantSlug");
      } catch (e) {
        return fail((e as Error).message);
      }

      if (mcpToken) {
        if (!await checkCap(mcpToken, "content_promote_variant", contentType)) {
          return denyResponse("content_promote_variant", contentType);
        }
      }

      try {
        const versioningSlug = versioningApiSlug(contentType, slug, contentPath);
        const url = `http://localhost:${MAIN_SERVER_PORT}/api/versioning/${encodeURIComponent(contentType)}/${encodeURIComponent(versioningSlug)}/publish${domain ? `?__site=${encodeURIComponent(domain)}` : ""}`;
        const res = await fetch(url, {
          method: "POST",
          headers: internalHeaders(mcpToken),
          body: JSON.stringify({ variantSlug }),
        });
        const data = await res.json() as Record<string, unknown>;
        if (!res.ok) {
          const errMsg = (data.error as string) || `Server error: ${res.status}`;
          const isEmpty = /EMPTY_LOCALE/i.test(errMsg);
          return fail(errMsg, {
            code: isEmpty ? "EMPTY_LOCALE" : undefined,
            contentType,
            slug,
            variantSlug,
            next_actions: isEmpty
              ? [{
                  tool: "get_entry_content",
                  reason: "Edit the draft until it has sections or content, then retry publish_draft",
                  args_hint: { slug, contentType, variant: variantSlug },
                  priority: "required",
                }]
              : [],
          });
        }
        return ok(
          {
            published: true,
            variantSlug,
            locales: data.locales,
            contentType,
            slug,
          },
          {
            warnings: [
              {
                code: "page_now_live",
                message: "Page is live for the listed locales and will appear in the sitemap. Confirm with the user before publishing in the future.",
              },
              {
                code: "published_at_stamp",
                message:
                  "If published_at was missing/empty, server stamped ISO now on _common.yml once (ensurePublishedAtOnce). Non-empty dates are not overwritten. Not tied to YAML status.",
              },
            ],
            side_effects: [{
              kind: "publish_all_locales",
              summary: `Promoted ${variantSlug} to live locale files; remaining drafts are variants at 0%; may stamp published_at on _common.yml`,
            }],
            next_actions: [],
          },
        );
      } catch (e) {
        return fail(`Failed to publish draft: ${(e as Error).message}`);
      }
    }
  );

  // promote_variant
  mcp.tool(
    "promote_variant",
    "Promote a variant to become the live version for ONE locale: overwrites the default locale file with the variant's content, " +
    "removes the variant from versioning.yml, and deletes the variant file. " +
    "For unpublished draft entries (no live locales), use publish_draft instead (all-or-nothing across locales). " +
    "Fails when resolved meta.page_title / meta.description are empty, editor.required fields are empty, " +
    "or the promoted detached locale would be empty (EMPTY_LOCALE: no sections and no content). " +
    "This is a destructive operation — the previous live content will be replaced. Confirm with the user before calling.",
    {
      contentType: z.string().describe("Content type, e.g. 'program', 'page', 'landing'"),
      slug: z.string().describe("Page slug"),
      variantSlug: z.string().describe("Slug of the variant to promote, e.g. 'draft-v2'"),
      locale: z.string().default("en").describe("Locale of the variant to promote, e.g. 'en' or 'es'"),
      site: z.string().optional().describe(SITE_PARAM_DESC),
    },
    async ({ contentType, slug, variantSlug, locale, site }) => {
      const siteResult = resolveSiteContext(site);
      if (!siteResult.ok) return siteFailResult(siteResult.error);
      const { contentPath, domain } = siteResult;
      try {
        assertSafeSegment(contentType, "contentType");
        assertSafeSegment(slug, "slug");
        assertSafeSegment(variantSlug, "variantSlug");
        assertSafeLocale(locale);
      } catch (e) {
        return fail((e as Error).message);
      }

      if (mcpToken) {
        if (!await checkCap(mcpToken, "content_promote_variant", contentType)) {
          return denyResponse("content_promote_variant", contentType);
        }
      }

      const configs = loadContentTypes(contentPath);
      const config = configs[contentType];
      const sharedLayout = config ? isSharedLayoutConfig(config) : false;

      try {
        const versioningSlug = versioningApiSlug(contentType, slug, contentPath);
        const url = `http://localhost:${MAIN_SERVER_PORT}/api/versioning/${encodeURIComponent(contentType)}/${encodeURIComponent(versioningSlug)}/${encodeURIComponent(locale)}/promote/${encodeURIComponent(variantSlug)}${domain ? `?__site=${encodeURIComponent(domain)}` : ""}`;
        const res = await fetch(url, {
          method: "POST",
          headers: internalHeaders(mcpToken),
        });
        const data = await res.json() as Record<string, unknown>;
        if (!res.ok) {
          const errMsg = (data.error as string) || `Server error: ${res.status}`;
          const isEmpty = /EMPTY_LOCALE/i.test(errMsg);
          return fail(errMsg, {
            code: isEmpty ? "EMPTY_LOCALE" : undefined,
            contentType,
            slug,
            locale,
            variantSlug,
            next_actions: isEmpty
              ? [{
                  tool: "get_entry_content",
                  reason: "Edit the draft until it has sections or content, then retry promote_variant",
                  args_hint: { slug, contentType, locale, variant: variantSlug },
                  priority: "required",
                }]
              : [],
          });
        }
        const next_actions: NextAction[] = sharedLayout
          ? [{
              tool: "get_entry_content",
              priority: "recommended",
              reason: "Shared-layout promote does not sync sibling singles — re-read live content and reconcile structure if needed.",
              args_hint: { contentType, slug, locale },
            }]
          : [];
        return ok(
          { message: `Variant '${variantSlug}' promoted to live for ${contentType}/${slug} (${locale})` },
          { warnings: promoteWarnings(sharedLayout), next_actions },
        );
      } catch (e) {
        return fail(`Failed to promote variant: ${(e as Error).message}`);
      }
    }
  );

  // create_entry
  mcp.tool(
    "create_entry",
    "Create a brand-new YAML-driven content entry (any non-DB content type, including single_template types such as blog). " +
    "For normal (non-shared-layout) types this creates an unpublished DRAFT: " +
    "writes _common.yml + draft.{locale}.yml + versioning.yml (0% allocation). " +
    "Edit with variant: 'draft', then call publish_draft. Confirm with the principal before publishing.\n" +
    "Shared-layout / single_template types write exactly ONE live locale immediately (multi-locale create is rejected). " +
    "Put body/fields on the locale (title, description, content, … per field_mapping); sections must be [] — shell comes from single.{locale}.yml. " +
    "Call explain_site topic shared-layout and/or get_content_type_info before creating shared-layout entries. " +
    MULTI_SITE_TOOL_BLURB + "\n\n" +
    "locales map: locale → { meta?, sections?, …field_mapping keys }. Shared-layout: exactly one locale key.\n" +
    "New URL-param/select values not seen on peers require confirm_new_values: true after principal (human or orchestrator) approval.\n\n" +
    "Possible errors: unknown/DB-backed contentType, slug exists, shared-layout multi-locale, missing editor.required fields, sections on shared-layout create, unconfirmed new param values.",
    {
      contentType: z.string().describe("Content type from content-types.yml without database.slug, e.g. 'blog', 'program', 'page', 'landing'."),
      slug: z.string().describe("URL-safe slug for the new entry. Must not already exist for this content type."),
      common: z.record(z.unknown()).describe("Fields written to _common.yml (locale-independent). Include URL params like category when required by url_pattern."),
      locales: z.record(z.record(z.unknown())).describe(
        "Map of locale → locale YAML fields. Include meta, optional sections, and field_mapping keys (title, description, content, …). " +
        "Shared-layout: exactly one locale; sections must be [] or omitted.",
      ),
      confirm_new_values: z.boolean().optional().describe(
        "Set true only after the principal (human or orchestrator/reviewer) approved inventing a new URL-param/select value not in observed peers.",
      ),
      site: z.string().optional().describe(SITE_PARAM_DESC),
    },
    async ({ contentType, slug, common, locales, confirm_new_values, site }) => {
      const siteResult = resolveSiteContext(site);
      if (!siteResult.ok) {
        return siteFailResult(siteResult.error, "create_entry", { contentType, slug, common, locales, confirm_new_values });
      }
      const { contentPath, contentFolder, domain } = siteResult;
      try {
        assertSafeSegment(slug, "slug");
        assertSafeSegment(contentType, "contentType");
      } catch (e) {
        return fail((e as Error).message);
      }

      const localeKeys = Object.keys(locales);
      if (localeKeys.length === 0) {
        return fail("'locales' must contain at least one locale.");
      }
      try {
        for (const loc of localeKeys) assertSafeLocale(loc);
      } catch (e) {
        return fail((e as Error).message);
      }

      const configs = loadContentTypes(contentPath);
      const config = configs[contentType];
      if (!config) {
        const known = Object.keys(configs).filter(k => !isDbBacked(configs[k])).join(", ");
        return fail(`Unknown contentType '${contentType}'. Known non-DB types: ${known}`);
      }
      if (isDbBacked(config)) {
        return fail(
          `Content type '${contentType}' is database-backed (database.slug set) and cannot be created via create_entry. ` +
          `Use get_content_type_info for create_via. Static single_template types without database.slug are allowed.`,
        );
      }

      if (mcpToken) {
        if (!await checkCap(mcpToken, "content_create_entry", contentType)) {
          return denyResponse("content_create_entry", contentType);
        }
      }

      const sharedLayoutCreate = isSharedLayoutConfig(config) || !!config.single_template;
      if (sharedLayoutCreate && localeKeys.length !== 1) {
        return actionRequired(
          {
            success: false,
            action_required: "shared_layout_single_locale_create",
            code: "shared_layout_single_locale_create",
            message:
              "Shared-layout types go live immediately and must be created with exactly one locale. " +
              "Create the first locale now; add translations later via translate_entry (draft → promote).",
            contentType,
            slug,
            locales_provided: localeKeys,
          },
          [
            {
              tool: "create_entry",
              reason: "Retry with exactly one key in locales (e.g. only en or only es)",
              args_hint: { contentType, slug, common, locales: { [localeKeys[0]]: locales[localeKeys[0]] }, site },
              priority: "required",
            },
          ],
        );
      }

      // Normalize locale payloads: sections default [], strip known keys for field merge
      const normalizedLocales: Record<string, {
        meta?: Record<string, unknown>;
        sections: Record<string, unknown>[];
        fields: Record<string, unknown>;
      }> = {};
      for (const [loc, raw] of Object.entries(locales)) {
        const { meta, sections, slug: _s, ...rest } = raw as Record<string, unknown>;
        const sectionArr = Array.isArray(sections) ? sections as Record<string, unknown>[] : [];
        if (sharedLayoutCreate && sectionArr.length > 0) {
          return actionRequired(
            {
              success: false,
              action_required: "shared_layout_sections_must_be_empty",
              code: "shared_layout_sections_must_be_empty",
              message:
                "Shared-layout create must use sections: [] (or omit sections). " +
                "The shell comes from single.{locale}.yml. Put body in locale fields (e.g. content). " +
                "Overlays after create use section tools with layout_target.",
              contentType,
              slug,
              locale: loc,
            },
            [
              {
                tool: "create_entry",
                reason: "Retry with sections: [] and field_mapping keys on the locale object",
                args_hint: {
                  contentType,
                  slug,
                  common,
                  site,
                  locales: {
                    [loc]: { ...rest, ...(meta ? { meta } : {}), sections: [] },
                  },
                },
                priority: "required",
              },
              {
                tool: "get_content_type_info",
                reason: "Inspect field_mapping / body_model for this content type",
                args_hint: { contentType, site },
                priority: "recommended",
              },
            ],
          );
        }
        const missing = missingRequiredFields(config, common as Record<string, unknown>, rest);
        if (sharedLayoutCreate && missing.length > 0) {
          return actionRequired(
            {
              success: false,
              action_required: "missing_required_fields",
              code: "missing_required_fields",
              message:
                `Missing editor.required fields for live shared-layout create: ${missing.join(", ")}. ` +
                "Supply them on the locale object (or common when appropriate).",
              missing,
              contentType,
              slug,
            },
            [
              {
                tool: "get_content_type_info",
                reason: "See editor.required and field_mapping",
                args_hint: { contentType, site },
                priority: "required",
              },
              {
                tool: "create_entry",
                reason: "Retry with required fields populated",
                args_hint: { contentType, slug, common, site, locales },
                priority: "required",
              },
            ],
          );
        }
        normalizedLocales[loc] = {
          meta: meta && typeof meta === "object" ? meta as Record<string, unknown> : undefined,
          sections: sharedLayoutCreate ? [] : sectionArr,
          fields: rest,
        };
      }

      // URL param / select observed gate
      const urlParams = listExtraUrlPatternParams(config.url_pattern);
      const proposed = collectProposedUrlParamValues(
        common as Record<string, unknown>,
        Object.fromEntries(
          Object.entries(normalizedLocales).map(([k, v]) => [k, { ...v.fields, ...(v.meta || {}) }]),
        ),
        urlParams,
      );
      if (!confirm_new_values) {
        for (const [param, value] of Object.entries(proposed)) {
          const observed = observeParamValues(contentPath, contentType, config, param);
          if (observed.length > 0 && !observed.includes(value)) {
            return actionRequired(
              {
                success: false,
                action_required: "confirm_new_url_param_value",
                code: "confirm_new_url_param_value",
                message:
                  `New value '${value}' for '${param}' is not used by any peer entry. ` +
                  `Observed: [${observed.slice(0, 40).join(", ")}${observed.length > 40 ? ", …" : ""}]. ` +
                  "Do not invent values silently. Get explicit approval from the principal " +
                  "(human in the chat or a reviewer/orchestrator agent), then re-call with confirm_new_values: true " +
                  "or pick an observed value.",
                param,
                proposed_value: value,
                observed_values: observed,
                contentType,
                slug,
              },
              [
                {
                  tool: "create_entry",
                  reason: "After principal approval, retry with confirm_new_values: true (or change the value to an observed one)",
                  args_hint: {
                    contentType,
                    slug,
                    common,
                    locales,
                    site,
                    confirm_new_values: true,
                  },
                  priority: "required",
                },
                {
                  tool: "get_content_type_info",
                  reason: "Inspect observed URL-param / select values",
                  args_hint: { contentType, site },
                  priority: "recommended",
                },
              ],
            );
          }
        }
      }

      const ctDir = getDirectory(contentType, config);
      const pageDir = path.join(contentPath, ctDir, slug);
      try { assertWithinBase(pageDir, contentPath); } catch (e) {
        return fail((e as Error).message);
      }
      if (fs.existsSync(pageDir)) {
        return fail(`Entry '${slug}' already exists for contentType '${contentType}'.`);
      }

      const draftFirst = !sharedLayoutCreate;
      const draftVariant = "draft";

      fs.mkdirSync(pageDir, { recursive: true });

      const commonData: Record<string, unknown> = { slug, ...common };
      fs.writeFileSync(path.join(pageDir, "_common.yml"), safeDump(commonData), "utf-8");

      const createdLocales: string[] = [];
      const createdFiles: string[] = ["_common.yml"];
      for (const [loc, localeContent] of Object.entries(normalizedLocales)) {
        const localeData: Record<string, unknown> = {
          slug,
          ...localeContent.fields,
          sections: localeContent.sections,
          ...(localeContent.meta && Object.keys(localeContent.meta).length > 0 ? { meta: localeContent.meta } : {}),
        };
        const fileName = draftFirst ? `${draftVariant}.${loc}.yml` : `${loc}.yml`;
        fs.writeFileSync(path.join(pageDir, fileName), safeDump(localeData), "utf-8");
        createdLocales.push(loc);
        createdFiles.push(fileName);
      }

      if (draftFirst) {
        const versioning: Record<string, { variants: Array<{ slug: string; allocation: number }> }> = {};
        for (const loc of createdLocales) {
          versioning[loc] = { variants: [{ slug: draftVariant, allocation: 0 }] };
        }
        fs.writeFileSync(path.join(pageDir, "versioning.yml"), safeDump(versioning), "utf-8");
        createdFiles.push("versioning.yml");
      }

      const relPaths = createdFiles.map((f) => `${contentFolder}/${ctDir}/${slug}/${f}`);
      const commitMsg = draftFirst
        ? `Create draft entry ${contentType}/${slug}`
        : `Create entry ${contentType}/${slug}`;
      const [commitResults] = await Promise.all([
        Promise.all(relPaths.map(p => callCommitFileApi(p, commitMsg, mcpToken, domain))),
        callRefreshCacheApi(contentType, domain),
      ]);

      const commitShas = commitResults.map(r => r.commitSha).filter(Boolean) as string[];
      const commitWarnings = commitResults.map(r => r.warning).filter(Boolean) as string[];

      const warnings: McpWarning[] = commitWarnings.map(w => ({ code: "github_commit_failed", message: w }));
      const side_effects: McpSideEffect[] = [];
      const next_actions: NextAction[] = [];
      const primaryLocale = createdLocales[0] ?? "en";
      const siteHint = site ? { site } : {};

      if (draftFirst) {
        warnings.push({
          code: "draft_unpublished",
          message: "Entry is an unpublished draft (no live locale files). Not in sitemap; public URL 404s until publish_draft.",
        });
        warnings.push({
          code: "published_at_omitted",
          message:
            "published_at omitted on draft create (missing OK). Stamped once on publish_draft / first promote — not recomputed; cannot clear to empty.",
        });
        side_effects.push({
          kind: "draft_created",
          summary: `Wrote ${draftVariant}.{locale}.yml + versioning.yml; live {locale}.yml not created`,
          paths: relPaths,
        });
        next_actions.push({
          tool: "batch_update_fields",
          priority: "recommended",
          reason: "Edit draft fields with variant set before publishing.",
          args_hint: { contentType, slug, locale: primaryLocale, variant: draftVariant, ...siteHint },
        });
        next_actions.push({
          tool: "publish_draft",
          priority: "optional",
          reason: "When ready, publish all remaining draft locales at once (confirm with the principal first).",
          args_hint: { contentType, slug, variantSlug: draftVariant, ...siteHint },
        });
      } else if (sharedLayoutCreate) {
        warnings.push(CREATE_ENTRY_SHARED_LAYOUT_WARNING);
        warnings.push({
          code: "shared_layout_single_locale_create",
          message:
            `Created live ${primaryLocale}.yml only. Did not seed sibling locales. ` +
            "Add translations later with translate_entry (draft until promote) after content is ready; detach first if still attached.",
        });
        warnings.push({
          code: "published_at_stamped",
          message:
            "Live create stamps published_at=now on _common.yml (shared-layout). Distinct from _updated_at; not tied to YAML status.",
        });
        side_effects.push(sharedTemplateBlastSideEffect(contentType, primaryLocale));
        next_actions.push({
          tool: "get_entry_content",
          priority: "recommended",
          reason: "Re-read merged content (fields + single.{locale}.yml shell). Prefer batch_update_fields for locale fields — not section shell edits.",
          args_hint: { contentType, slug, locale: primaryLocale, ...siteHint },
        });
        next_actions.push({
          tool: "run_entry_diagnostics",
          priority: "optional",
          reason: "Validate the new live entry",
          args_hint: { slugs: [slug], ...siteHint },
        });
      } else {
        warnings.push({
          code: "published_at_stamped",
          message:
            "Live create stamps published_at=now on _common.yml when the type is not draft-first.",
        });
      }

      const title =
        (normalizedLocales[primaryLocale]?.fields?.title as string | undefined) ||
        (typeof common.title === "string" ? common.title : undefined);

      return ok(
        {
          slug,
          contentType,
          directory: `${contentFolder}/${ctDir}/${slug}`,
          locales: createdLocales,
          status: draftFirst ? "draft" : "published",
          ...(draftFirst ? { draftVariant, previewPath: `/private/preview/${contentType}/${slug}?variant=${draftVariant}&locale=${primaryLocale}` } : {}),
          ...(title ? { title } : {}),
          ...(commitShas.length > 0 ? { commitShas } : {}),
        },
        { warnings, next_actions, ...(side_effects.length > 0 ? { side_effects } : {}) },
      );
    }
  );

  // add_section
  mcp.tool(
    "add_section",
    "Add a new section to a page. Inserts at the given index (or appends if omitted). Section must include a 'type' field matching a component type. contentType is optional — omit it and the server will auto-detect it from the slug.\n\n" +
    "IMPORTANT — article / split pages: 2+ article sections on a page ALWAYS continue one piece (no share choice). " +
    "Put the lead article first. show_toc on the first article only controls the shared TOC; later show_toc / meta are non-effects for chrome. " +
    "Reading time (on-page and OG) combines all article bodies and shows on the first only; mobile/top TOC only on the first; desktop side TOC may still appear on later parts. " +
    "toc_group is optional/legacy — not a decision knob. Response may include article_split_always_share / article_lead_* warnings. " +
    "See get_component_variant → article_split_toc_group or explain_site topic 'sections'.\n\n" +
    "IMPORTANT — versioning safety: If the page has active variants (a versioning.yml exists), " +
    "you MUST ask the user before calling this tool: " +
    "'Do you want to edit the live version directly, or create a new draft variant first?' " +
    "To edit the live version directly pass confirm_live_edit: true. " +
    "To edit a variant, call create_variant first and pass the returned slug as the 'variant' parameter here.",
    {
      slug: z.string().describe("Page slug"),
      locale: z.string().default("en").describe("Locale code"),
      section: z.record(z.unknown()).describe("Section object with at minimum a 'type' field"),
      index: z.number().int().optional().describe("Position to insert (0-based). Omit to append."),
      contentType: z.string().optional().describe("Content type hint (e.g. 'page', 'program'). Omit to auto-detect from slug."),
      variant: z.string().optional().describe("Variant slug to write to (e.g. 'draft-v2'). Writes to {variantSlug}.{locale}.yml instead of the live locale file."),
      confirm_live_edit: z.boolean().optional().describe("Set to true to confirm you want to overwrite the live locale file directly when a versioning.yml exists. Required when no 'variant' is supplied and the page has active variants."),
      layout_target: layoutTargetSchema,
      confirm_layout_target: confirmLayoutTargetSchema,
      site: z.string().optional().describe(SITE_PARAM_DESC),
    },
    async ({ contentType, slug, locale, section, index, variant, confirm_live_edit, layout_target, confirm_layout_target, site }) => {
      const siteResult = resolveSiteContext(site);
      if (!siteResult.ok) return siteFailResult(siteResult.error);
      const { contentPath, domain } = siteResult;
      if (!MCP_SERVER_SECRET) {
        return fail("add_section is unavailable: MCP_SERVER_SECRET is not configured. Set MCP_SERVER_SECRET in your environment before using section-editing tools.");
      }
      try {
        assertSafeSegment(slug, "slug");
        assertSafeLocale(locale);
        if (contentType) assertSafeSegment(contentType, "contentType");
        if (variant) assertSafeSegment(variant, "variant");
      } catch (e) {
        return fail((e as Error).message);
      }
      const resolved = resolveContentType(slug, contentType, contentPath, { allowSharedLayout: true });
      if (!resolved) {
        return fail(`Page not found for slug '${slug}'${contentType ? ` (contentType: ${contentType})` : ""}`);
      }

      if (mcpToken) {
        if (!await checkCap(mcpToken, "content_edit_structure", resolved.contentType)) {
          return denyResponse("content_edit_structure", resolved.contentType);
        }
      }

      const liveGate = confirmLiveEditGate({
        tool: "add_section",
        slug,
        contentType: resolved.contentType,
        locale,
        contentPath,
        variant,
        confirm_live_edit,
        extraArgsHint: { section, index, layout_target, confirm_layout_target },
      });
      if (liveGate) return liveGate;

      const layoutGate = resolveLayoutTargetGate({
        tool: "add_section",
        contentType: resolved.contentType,
        config: resolved.config,
        slug,
        locale,
        layout_target: layout_target as LayoutTarget | undefined,
        confirm_layout_target,
        requireConfirmWhenAuto: true,
      });
      if ("gate" in layoutGate) return layoutGate.gate;
      const layoutTarget = layoutGate.target;

      const pathInfo = pathForLayoutTarget({
        contentPath,
        contentType: resolved.contentType,
        config: resolved.config,
        slug,
        locale,
        layoutTarget,
        variant,
      });

      // Snapshot sections before write (for article split hints / auto-stamp).
      let existingSections: Array<Record<string, unknown>> = [];
      if (fs.existsSync(pathInfo.filePath)) {
        const before = safeLoad(fs.readFileSync(pathInfo.filePath, "utf-8")) || {};
        if (Array.isArray(before.sections)) {
          existingSections = before.sections as Array<Record<string, unknown>>;
        }
      }

      let sectionToAdd = section as Record<string, unknown>;
      const stamp = prepareArticleAddStamp({
        existingSections,
        newSection: sectionToAdd,
        insertIndex: index,
      });
      const operations: Array<Record<string, unknown>> = [];
      if (stamp) {
        sectionToAdd = stamp.section;
        operations.push(...stamp.siblingOps);
      }
      const addOp: Record<string, unknown> = {
        action: "add_item",
        path: "sections",
        item: sectionToAdd,
      };
      if (index !== undefined) {
        addOp.index = index;
      }
      operations.push(addOp);

      const apiResult = await callEditSectionsApi(
        {
          contentType: resolved.contentType,
          slug,
          locale,
          variant,
          layoutTarget,
          operations,
        },
        mcpToken,
        domain,
      );
      if ("error" in apiResult) return apiResult.error;

      const warnings: McpWarning[] = [
        ADD_SECTION_NO_BINDING_FANOUT,
        ...variantWarningsIfNeeded(variant),
        ...schemaOrgPageOverrideWarnings(sectionToAdd),
      ];
      let side_effects: McpSideEffect[] | undefined;
      let next_actions: NextAction[] = [];
      if (pathInfo.layer === "type_single") {
        const env = sharedStructuralEnvelope({
          tool: "add_section",
          contentType: resolved.contentType,
          config: resolved.config,
          contentPath,
          sourceLocale: locale,
          relativePath: pathInfo.relativeHint,
          argsHintBase: { section: sectionToAdd, index, confirm_live_edit: true },
          reasonPrefix: "Shared layout section was added.",
        });
        side_effects = env.side_effects;
        next_actions = env.next_actions;
      }

      // Non-effect: page WebSite/Organization does not write schema-org.yml
      const overrideType = String(sectionToAdd.schema_type ?? "");
      if (
        String(sectionToAdd.type ?? "") === "schema_org" &&
        (overrideType === "WebSite" || overrideType === "Organization")
      ) {
        side_effects = [
          ...(side_effects ?? []),
          {
            kind: "schema_org_page_section",
            summary: `Wrote page-local schema_org ${overrideType} to ${pathInfo.relativeHint}; site schema-org.yml unchanged.`,
          },
        ];
      }

      if (stamp) {
        warnings.push({
          code: "article_split_auto_stamped",
          message:
            "Page already had article(s); stamped toc_group and ensured show_toc on the first article. " +
            "Articles always continue one piece — TOC/reading time chrome follows the lead article only.",
        });
        side_effects = [
          ...(side_effects ?? []),
          {
            kind: "article_split_auto_stamp",
            summary:
              `Auto-stamped toc_group on sibling articles and show_toc on the first article in ${pathInfo.relativeHint}.`,
          },
        ];
      }

      const articleHints = hintsAfterAddArticle({
        existingSections,
        newSection: sectionToAdd,
        insertIndex: index,
        slug,
        locale,
      });
      warnings.push(...articleHints.warnings);
      // Stamp already applied — drop redundant update_section_fields next_actions.
      next_actions = [
        ...next_actions,
        ...articleHints.next_actions.filter((a) => a.tool !== "update_section_fields"),
      ];

      return ok(
        {
          message: `Section of type '${sectionToAdd.type as string}' added to ${pathInfo.relativeHint}`,
          ...wrotePayload({
            layer: pathInfo.layer,
            contentType: resolved.contentType,
            path: pathInfo.relativeHint,
            locale,
            slug,
          }),
        },
        { warnings, next_actions, side_effects },
      );
    }
  );

  // remove_section
  mcp.tool(
    "remove_section",
    "Remove a section from a page by its index. contentType is optional — omit it and the server will auto-detect it from the slug.\n\n" +
    "IMPORTANT — versioning safety: If the page has active variants (a versioning.yml exists), " +
    "you MUST ask the user before calling this tool: " +
    "'Do you want to edit the live version directly, or create a new draft variant first?' " +
    "To edit the live version directly pass confirm_live_edit: true. " +
    "To edit a variant, call create_variant first and pass the returned slug as the 'variant' parameter here.",
    {
      slug: z.string().describe("Page slug"),
      locale: z.string().default("en").describe("Locale code"),
      index: z.number().int().describe("0-based index of the section to remove"),
      contentType: z.string().optional().describe("Content type hint (e.g. 'page', 'program'). Omit to auto-detect from slug."),
      variant: z.string().optional().describe("Variant slug to write to (e.g. 'draft-v2'). Writes to {variantSlug}.{locale}.yml instead of the live locale file."),
      confirm_live_edit: z.boolean().optional().describe("Set to true to confirm you want to overwrite the live locale file directly when a versioning.yml exists. Required when no 'variant' is supplied and the page has active variants."),
      layout_target: layoutTargetSchema,
      confirm_layout_target: confirmLayoutTargetSchema,
      site: z.string().optional().describe(SITE_PARAM_DESC),
    },
    async ({ contentType, slug, locale, index, variant, confirm_live_edit, layout_target, confirm_layout_target, site }) => {
      const siteResult = resolveSiteContext(site);
      if (!siteResult.ok) return siteFailResult(siteResult.error);
      const { contentPath, contentFolder, domain } = siteResult;
      try {
        assertSafeSegment(slug, "slug");
        assertSafeLocale(locale);
        if (contentType) assertSafeSegment(contentType, "contentType");
        if (variant) assertSafeSegment(variant, "variant");
      } catch (e) {
        return fail((e as Error).message);
      }
      const resolved = resolveContentType(slug, contentType, contentPath, { allowSharedLayout: true });
      if (!resolved) {
        return fail(`Page not found for slug '${slug}'${contentType ? ` (contentType: ${contentType})` : ""}`);
      }

      if (mcpToken) {
        if (!await checkCap(mcpToken, "content_edit_structure", resolved.contentType)) {
          return denyResponse("content_edit_structure", resolved.contentType);
        }
      }

      const liveGate = confirmLiveEditGate({
        tool: "remove_section",
        slug,
        contentType: resolved.contentType,
        locale,
        contentPath,
        variant,
        confirm_live_edit,
        extraArgsHint: { index, layout_target, confirm_layout_target },
      });
      if (liveGate) return liveGate;

      const layoutGate = resolveLayoutTargetGate({
        tool: "remove_section",
        contentType: resolved.contentType,
        config: resolved.config,
        slug,
        locale,
        layout_target: layout_target as LayoutTarget | undefined,
        confirm_layout_target,
        requireConfirmWhenAuto: true,
      });
      if ("gate" in layoutGate) return layoutGate.gate;
      const layoutTarget = layoutGate.target;

      const pathInfo = pathForLayoutTarget({
        contentPath,
        contentType: resolved.contentType,
        config: resolved.config,
        slug,
        locale,
        layoutTarget,
        variant,
      });
      try { assertWithinBase(pathInfo.filePath, contentPath); } catch (e) {
        return fail((e as Error).message);
      }
      if (!fs.existsSync(pathInfo.filePath)) {
        return fail(`Locale file not found: ${pathInfo.relativeHint}`);
      }

      const localeData = safeLoad(fs.readFileSync(pathInfo.filePath, "utf-8")) || {};
      if (!Array.isArray(localeData.sections)) {
        return fail("Page has no sections array.");
      }
      const sections = localeData.sections as unknown[];
      if (index < 0 || index >= sections.length) {
        return fail(`Index ${index} out of range (0–${sections.length - 1}).`);
      }
      const removed = sections.splice(index, 1)[0] as Record<string, unknown>;
      const intendedContent = safeDump(localeData);

      const relativePath = `${contentFolder}/${pathInfo.relativeHint}`;
      const conflictCheck = await checkRemoteConflict(relativePath, domain);
      if (conflictCheck.conflict) {
        return conflictError({
          relativePath,
          remoteContent: conflictCheck.remoteContent,
          intendedContent,
          intendedChange: { action: "remove_section", index, removedType: removed?.type ?? "unknown" },
        });
      }

      const apiResult = await callEditSectionsApi(
        { contentType: resolved.contentType, slug, locale, variant, layoutTarget, operations: [{ action: "remove_item", path: "sections", index }] },
        mcpToken,
        domain,
      );
      if ("error" in apiResult) return apiResult.error;

      const warnings: McpWarning[] = [REMOVE_SECTION_NO_BINDING_FANOUT, ...variantWarningsIfNeeded(variant)];
      let side_effects: McpSideEffect[] | undefined;
      let next_actions: NextAction[] = [];
      if (pathInfo.layer === "type_single") {
        const env = sharedStructuralEnvelope({
          tool: "remove_section",
          contentType: resolved.contentType,
          config: resolved.config,
          contentPath,
          sourceLocale: locale,
          relativePath: pathInfo.relativeHint,
          argsHintBase: { index, confirm_live_edit: true },
          reasonPrefix: "Shared layout section was removed.",
        });
        side_effects = env.side_effects;
        next_actions = env.next_actions;
      } else {
        next_actions = [{
          tool: "get_section_bindings",
          priority: "recommended",
          reason: "Inspect whether the removed section was bound; siblings keep the section until you remove it there.",
          args_hint: { contentType: resolved.contentType, slug, sectionIndex: index, locale },
        }];
      }

      return ok(
        {
          message: `Removed section at index ${index} (type: ${removed?.type ?? "unknown"}) from ${pathInfo.relativeHint}`,
          ...wrotePayload({
            layer: pathInfo.layer,
            contentType: resolved.contentType,
            path: pathInfo.relativeHint,
            locale,
            slug,
          }),
        },
        { warnings, next_actions, side_effects },
      );
    }
  );

  // reorder_sections
  mcp.tool(
    "reorder_sections",
    "Reorder sections by supplying a new order as an array of current indices. E.g. [2, 0, 1] moves the third section to the front. contentType is optional — omit it and the server will auto-detect it from the slug.\n\n" +
    "IMPORTANT — versioning safety: If the page has active variants (a versioning.yml exists), " +
    "you MUST ask the user before calling this tool: " +
    "'Do you want to edit the live version directly, or create a new draft variant first?' " +
    "To edit the live version directly pass confirm_live_edit: true. " +
    "To edit a variant, call create_variant first and pass the returned slug as the 'variant' parameter here.",
    {
      slug: z.string().describe("Page slug"),
      locale: z.string().default("en").describe("Locale code"),
      order: z.array(z.number().int()).describe("Array of current section indices in desired order — must be a permutation with no repeats"),
      contentType: z.string().optional().describe("Content type hint (e.g. 'page', 'program'). Omit to auto-detect from slug."),
      variant: z.string().optional().describe("Variant slug to write to (e.g. 'draft-v2'). Writes to {variantSlug}.{locale}.yml instead of the live locale file."),
      confirm_live_edit: z.boolean().optional().describe("Set to true to confirm you want to overwrite the live locale file directly when a versioning.yml exists. Required when no 'variant' is supplied and the page has active variants."),
      layout_target: layoutTargetSchema,
      confirm_layout_target: confirmLayoutTargetSchema,
      site: z.string().optional().describe(SITE_PARAM_DESC),
    },
    async ({ contentType, slug, locale, order, variant, confirm_live_edit, layout_target, confirm_layout_target, site }) => {
      const siteResult = resolveSiteContext(site);
      if (!siteResult.ok) return siteFailResult(siteResult.error);
      const { contentPath, contentFolder, domain } = siteResult;
      try {
        assertSafeSegment(slug, "slug");
        assertSafeLocale(locale);
        if (contentType) assertSafeSegment(contentType, "contentType");
        if (variant) assertSafeSegment(variant, "variant");
      } catch (e) {
        return fail((e as Error).message);
      }
      const resolved = resolveContentType(slug, contentType, contentPath, { allowSharedLayout: true });
      if (!resolved) {
        return fail(`Page not found for slug '${slug}'${contentType ? ` (contentType: ${contentType})` : ""}`);
      }

      if (mcpToken) {
        if (!await checkCap(mcpToken, "content_edit_structure", resolved.contentType)) {
          return denyResponse("content_edit_structure", resolved.contentType);
        }
      }

      const liveGate = confirmLiveEditGate({
        tool: "reorder_sections",
        slug,
        contentType: resolved.contentType,
        locale,
        contentPath,
        variant,
        confirm_live_edit,
        extraArgsHint: { order, layout_target, confirm_layout_target },
      });
      if (liveGate) return liveGate;

      const layoutGate = resolveLayoutTargetGate({
        tool: "reorder_sections",
        contentType: resolved.contentType,
        config: resolved.config,
        slug,
        locale,
        layout_target: layout_target as LayoutTarget | undefined,
        confirm_layout_target,
        requireConfirmWhenAuto: true,
      });
      if ("gate" in layoutGate) return layoutGate.gate;
      const layoutTarget = layoutGate.target;

      const pathInfo = pathForLayoutTarget({
        contentPath,
        contentType: resolved.contentType,
        config: resolved.config,
        slug,
        locale,
        layoutTarget,
        variant,
      });
      try { assertWithinBase(pathInfo.filePath, contentPath); } catch (e) {
        return fail((e as Error).message);
      }
      if (!fs.existsSync(pathInfo.filePath)) {
        return fail(`Locale file not found: ${pathInfo.relativeHint}`);
      }

      const localeData = safeLoad(fs.readFileSync(pathInfo.filePath, "utf-8")) || {};
      if (!Array.isArray(localeData.sections)) {
        return fail("Page has no sections array.");
      }
      const sections = localeData.sections as unknown[];
      const n = sections.length;
      const seen = new Set<number>();
      const isPermutation = order.length === n && order.every(i => {
        if (i < 0 || i >= n || seen.has(i)) return false;
        seen.add(i);
        return true;
      });
      if (!isPermutation) {
        return fail(`Order must be a permutation of [0..${n - 1}] with no repeats. Got: [${order.join(", ")}]`);
      }
      const reorderedSections = order.map(i => sections[i]);
      const intendedContent = safeDump({ ...localeData, sections: reorderedSections });

      const relativePath = `${contentFolder}/${pathInfo.relativeHint}`;
      const conflictCheck = await checkRemoteConflict(relativePath, domain);
      if (conflictCheck.conflict) {
        return conflictError({
          relativePath,
          remoteContent: conflictCheck.remoteContent,
          intendedContent,
          intendedChange: { action: "reorder_sections", order },
        });
      }

      const apiResult = await callEditSectionsApi(
        { contentType: resolved.contentType, slug, locale, variant, layoutTarget, operations: [{ action: "replace_all_sections", sections: reorderedSections }] },
        mcpToken,
        domain,
      );
      if ("error" in apiResult) return apiResult.error;

      const warnings: McpWarning[] = [REORDER_NO_BINDING_FANOUT, ...variantWarningsIfNeeded(variant)];
      let side_effects: McpSideEffect[] | undefined;
      let next_actions: NextAction[] = [];
      if (pathInfo.layer === "type_single") {
        const env = sharedStructuralEnvelope({
          tool: "reorder_sections",
          contentType: resolved.contentType,
          config: resolved.config,
          contentPath,
          sourceLocale: locale,
          relativePath: pathInfo.relativeHint,
          argsHintBase: { order, confirm_live_edit: true },
          reasonPrefix: "Shared layout section order changed.",
        });
        side_effects = env.side_effects;
        next_actions = env.next_actions;
      }

      return ok(
        {
          message: `Sections reordered in ${pathInfo.relativeHint}`,
          ...wrotePayload({
            layer: pathInfo.layer,
            contentType: resolved.contentType,
            path: pathInfo.relativeHint,
            locale,
            slug,
          }),
        },
        { warnings, next_actions, side_effects },
      );
    }
  );

  // replace_entry_sections
  mcp.tool(
    "replace_entry_sections",
    "Atomically replace ALL sections in a page's locale file in one call — the high-throughput " +
    "alternative to calling update_section_field N times. " +
    "Optionally also replaces the meta block in the same call. " +
    "The caller supplies the complete new sections array; the server replaces the existing array atomically. " +
    "Accepts the same variant and confirm_live_edit versioning guards as update_section_field. " +
    "contentType is optional — omit it and the server will auto-detect from slug.\n\n" +
    "What the caller must supply: a complete sections array (every section, in order). " +
    "What the server handles: path-sanitisation, conflict detection, atomic write via edit-sections API, " +
    "cache refresh, and Git mark-modified.\n\n" +
    "Possible errors: page/locale not found, path traversal detected, remote conflict " +
    "(returns remoteContent + intendedContent for manual merge), permission denied.\n\n" +
    "IMPORTANT — versioning safety: If the page has active variants (a versioning.yml exists), " +
    "you MUST ask the user before calling this tool: " +
    "'Do you want to edit the live version directly, or create a new draft variant first?' " +
    "To edit the live version directly pass confirm_live_edit: true. " +
    "To edit a variant, call create_variant first and pass the returned slug as the 'variant' parameter here.",
    {
      slug: z.string().describe("Page slug"),
      locale: z.string().default("en").describe("Locale code, e.g. 'en' or 'es'"),
      sections: z.array(z.record(z.unknown())).describe("Complete new sections array. Replaces the entire existing sections array atomically. Every section must include a 'type' field."),
      meta: z.record(z.unknown()).optional().describe("Optional meta fields to update at the same time. Each key is shallow-merged into the existing meta object (e.g. { page_title: '...', description: '...' })."),
      contentType: z.string().optional().describe("Content type hint (e.g. 'page', 'program'). Omit to auto-detect from slug."),
      variant: z.string().optional().describe("Variant slug to write to (e.g. 'draft-v2'). Writes to {variantSlug}.{locale}.yml instead of the live locale file."),
      confirm_live_edit: z.boolean().optional().describe("Set to true to confirm you want to overwrite the live locale file directly when a versioning.yml exists. Required when no 'variant' is supplied and the page has active variants."),
      layout_target: layoutTargetSchema,
      confirm_layout_target: confirmLayoutTargetSchema,
      site: z.string().optional().describe(SITE_PARAM_DESC),
    },
    async ({ slug, locale, sections, meta, contentType, variant, confirm_live_edit, layout_target, confirm_layout_target, site }) => {
      const siteResult = resolveSiteContext(site);
      if (!siteResult.ok) return siteFailResult(siteResult.error);
      const { contentPath, contentFolder, domain } = siteResult;
      try {
        assertSafeSegment(slug, "slug");
        assertSafeLocale(locale);
        if (contentType) assertSafeSegment(contentType, "contentType");
        if (variant) assertSafeSegment(variant, "variant");
      } catch (e) {
        return fail((e as Error).message);
      }

      const resolved = resolveContentType(slug, contentType, contentPath, { allowSharedLayout: true });
      if (!resolved) {
        return fail(`Page not found for slug '${slug}'${contentType ? ` (contentType: ${contentType})` : ""}`);
      }

      if (mcpToken) {
        if (!await checkCap(mcpToken, "content_edit_structure", resolved.contentType)) {
          return denyResponse("content_edit_structure", resolved.contentType);
        }
      }

      const liveGate = confirmLiveEditGate({
        tool: "replace_entry_sections",
        slug,
        contentType: resolved.contentType,
        locale,
        contentPath,
        variant,
        confirm_live_edit,
        extraArgsHint: { sections, meta, layout_target, confirm_layout_target },
      });
      if (liveGate) return liveGate;

      const layoutGate = resolveLayoutTargetGate({
        tool: "replace_entry_sections",
        contentType: resolved.contentType,
        config: resolved.config,
        slug,
        locale,
        layout_target: layout_target as LayoutTarget | undefined,
        confirm_layout_target,
        requireConfirmWhenAuto: true,
      });
      if ("gate" in layoutGate) return layoutGate.gate;
      const layoutTarget = layoutGate.target;

      const pathInfo = pathForLayoutTarget({
        contentPath,
        contentType: resolved.contentType,
        config: resolved.config,
        slug,
        locale,
        layoutTarget,
        variant,
      });
      try { assertWithinBase(pathInfo.filePath, contentPath); } catch (e) {
        return fail((e as Error).message);
      }
      if (!fs.existsSync(pathInfo.filePath)) {
        return fail(`File not found: ${pathInfo.relativeHint}`);
      }

      const relativePath = `${contentFolder}/${pathInfo.relativeHint}`;

      const currentData = safeLoad(fs.readFileSync(pathInfo.filePath, "utf-8")) || {};
      currentData.sections = sections;
      if (meta) {
        const existingMeta = (typeof currentData.meta === "object" && currentData.meta !== null && !Array.isArray(currentData.meta))
          ? currentData.meta as Record<string, unknown>
          : {};
        currentData.meta = { ...existingMeta, ...meta };
      }
      const intendedContent = safeDump(currentData);
      const conflictCheck = await checkRemoteConflict(relativePath, domain);
      if (conflictCheck.conflict) {
        return conflictError({
          relativePath,
          remoteContent: conflictCheck.remoteContent,
          intendedContent,
          intendedChange: { action: "replace_entry_sections", sectionsCount: sections.length, ...(meta ? { meta } : {}) },
        });
      }

      const operations: Record<string, unknown>[] = [{ action: "replace_all_sections", sections }];
      if (meta) {
        for (const [k, v] of Object.entries(meta)) {
          operations.push({ action: "update_field", path: `meta.${k}`, value: v });
        }
      }

      const apiResult = await callEditSectionsApi(
        { contentType: resolved.contentType, slug, locale, variant, layoutTarget, operations },
        mcpToken,
        domain,
      );
      if ("error" in apiResult) return apiResult.error;

      const warnings: McpWarning[] = [REPLACE_NO_BINDING_FANOUT, ...variantWarningsIfNeeded(variant)];
      let side_effects: McpSideEffect[] | undefined;
      let next_actions: NextAction[] = [];
      if (pathInfo.layer === "type_single") {
        const env = sharedStructuralEnvelope({
          tool: "replace_entry_sections",
          contentType: resolved.contentType,
          config: resolved.config,
          contentPath,
          sourceLocale: locale,
          relativePath: pathInfo.relativeHint,
          argsHintBase: { sections, meta, confirm_live_edit: true },
          reasonPrefix: "Shared layout sections were fully replaced.",
        });
        side_effects = env.side_effects;
        next_actions = env.next_actions;
      } else {
        next_actions = [{
          tool: "get_section_bindings",
          priority: "optional",
          reason: "Full replace does not sync bindings — inspect groups if bound section_ids may be stale.",
          args_hint: { contentType: resolved.contentType, slug, sectionIndex: 0, locale },
        }];
      }

      const articleHints = hintsAfterReplaceSections({
        sections: sections as Array<Record<string, unknown>>,
        slug,
        locale,
      });
      warnings.push(...articleHints.warnings);
      next_actions = [...next_actions, ...articleHints.next_actions];

      const parts: string[] = [`sections (${sections.length} item${sections.length !== 1 ? "s" : ""})`];
      if (meta) parts.push(`meta (${Object.keys(meta).length} field${Object.keys(meta).length !== 1 ? "s" : ""})`);
      return ok(
        {
          message: `Replaced ${parts.join(" and ")} in ${pathInfo.relativeHint}`,
          ...wrotePayload({
            layer: pathInfo.layer,
            contentType: resolved.contentType,
            path: pathInfo.relativeHint,
            locale,
            slug,
          }),
        },
        { warnings, next_actions, side_effects },
      );
    }
  );

  // batch_update_fields
  mcp.tool(
    "batch_update_fields",
    "Apply multiple field updates to a single page/locale atomically in one call, reducing N round-trips to 1. " +
    "Accepts an array of { field_path, value } objects targeting any combination of sections and meta paths. " +
    "field_path routing rules:\n" +
    "  • 'sections.*' (e.g. 'sections.0.title') → locale file\n" +
    "  • 'meta.robots', 'meta.priority', 'meta.change_frequency' → _common.yml\n" +
    "  • 'meta.page_title', 'meta.description', 'meta.og_image', 'meta.og_type', " +
    "    'meta.og_url', 'meta.og_locale', 'meta.canonical_url' → locale file\n" +
    "  • Any other 'meta.*' key → locale file\n" +
    "  • Safe top-level fields allowed by content-type editor.type (title, slug, settings, description, content, …) → locale file\n\n" +
    "Live gate: live writes need resolved meta.page_title + meta.description; " +
    "editor.required fields cannot be cleared on live. Drafts exempt.\n\n" +
    MULTI_SITE_TOOL_BLURB + "\n\n" +
    "What the caller must supply: a non-empty updates array with valid field_path strings and values. " +
    "What the server handles: routing, conflict detection per file, atomic write(s), cache refresh, Git mark-modified.\n\n" +
    "Possible errors: invalid/disallowed field_path, page/locale not found, remote conflict " +
    "(returns remoteContent + intendedContent), permission denied.\n\n" +
    "IMPORTANT — versioning safety: If the page has active variants (a versioning.yml exists), " +
    "you MUST ask the principal before calling this tool: " +
    "'Do you want to edit the live version directly, or create a new draft variant first?' " +
    "To edit the live version directly pass confirm_live_edit: true. " +
    "To edit a variant, call create_variant first and pass the returned slug as the 'variant' parameter here.",
    {
      slug: z.string().describe("Page slug"),
      locale: z.string().default("en").describe("Locale code, e.g. 'en' or 'es'"),
      updates: z.array(z.object({
        field_path: z.string().describe("Dot-notation path, e.g. 'sections.0.title', 'meta.description', 'title', 'content'"),
        value: z.unknown().describe("New value for the field"),
      })).min(1).describe("Array of { field_path, value } updates. Minimum 1. Applied atomically to the target file(s)."),
      contentType: z.string().optional().describe("Content type hint (e.g. 'page', 'program', 'blog'). Omit to auto-detect from slug."),
      variant: z.string().optional().describe("Variant slug to write to (e.g. 'draft-v2'). Writes to {variantSlug}.{locale}.yml instead of the live locale file. Does not affect _common.yml routing."),
      confirm_live_edit: z.boolean().optional().describe("Set to true to confirm you want to overwrite the live locale file directly when a versioning.yml exists. Required when no 'variant' is supplied and the page has active variants."),
      layout_target: layoutTargetSchema,
      confirm_layout_target: confirmLayoutTargetSchema,
      site: z.string().optional().describe(SITE_PARAM_DESC),
    },
    async ({ slug, locale, updates, contentType, variant, confirm_live_edit, layout_target, confirm_layout_target, site }) => {
      const siteResult = resolveSiteContext(site);
      if (!siteResult.ok) return siteFailResult(siteResult.error);
      const { contentPath, contentFolder, domain } = siteResult;
      try {
        assertSafeSegment(slug, "slug");
        assertSafeLocale(locale);
        if (contentType) assertSafeSegment(contentType, "contentType");
        if (variant) assertSafeSegment(variant, "variant");
      } catch (e) {
        return fail((e as Error).message);
      }

      const resolved = resolveContentType(slug, contentType, contentPath, { allowSharedLayout: true });
      if (!resolved) {
        return fail(`Page not found for slug '${slug}'${contentType ? ` (contentType: ${contentType})` : ""}`);
      }

      const safeTop = safeTopLevelFieldsForConfig(resolved.config);
      const badPaths = updates.filter(u =>
        !u.field_path.startsWith("sections.") &&
        !u.field_path.startsWith("meta.") &&
        !safeTop.has(u.field_path)
      );
      if (badPaths.length > 0) {
        return fail(`Disallowed field_path(s): ${badPaths.map(u => u.field_path).join(", ")}. Must start with 'sections.', 'meta.', or be one of: ${[...safeTop].join(", ")}.`);
      }

      if (mcpToken) {
        if (!await checkCap(mcpToken, "content_edit_text", resolved.contentType)) {
          return denyResponse("content_edit_text", resolved.contentType);
        }
      }

      const liveGate = confirmLiveEditGate({
        tool: "batch_update_fields",
        slug,
        contentType: resolved.contentType,
        locale,
        contentPath,
        variant,
        confirm_live_edit,
        extraArgsHint: { updates, layout_target, confirm_layout_target },
      });
      if (liveGate) return liveGate;

      const touchesSections = updates.some(u => u.field_path.startsWith("sections."));
      const layoutGate = resolveLayoutTargetGate({
        tool: "batch_update_fields",
        contentType: resolved.contentType,
        config: resolved.config,
        slug,
        locale,
        layout_target: layout_target as LayoutTarget | undefined,
        confirm_layout_target,
        requireConfirmWhenAuto: touchesSections,
      });
      if ("gate" in layoutGate) return layoutGate.gate;
      const layoutTarget = layoutGate.target;

      const pathInfo = pathForLayoutTarget({
        contentPath,
        contentType: resolved.contentType,
        config: resolved.config,
        slug,
        locale,
        layoutTarget,
        variant,
      });
      const localeFilePath = pathInfo.filePath;
      try { assertWithinBase(localeFilePath, contentPath); } catch (e) {
        return fail((e as Error).message);
      }
      const commonFilePath = path.join(contentPath, getDirectory(resolved.contentType, resolved.config), slug, "_common.yml");

      const localeEntries: Array<[string, unknown]> = [];
      const commonEntries: Array<[string, unknown]> = [];
      for (const { field_path, value } of updates) {
        const metaKey = field_path.startsWith("meta.") ? field_path.slice(5).split(".")[0] : null;
        if (metaKey && META_COMMON_FIELDS.has(metaKey)) {
          commonEntries.push([field_path, value]);
        } else {
          localeEntries.push([field_path, value]);
        }
      }

      const localeRelPath = `${contentFolder}/${pathInfo.relativeHint}`;
      const ctDir = getDirectory(resolved.contentType, resolved.config);
      const commonRelPath = `${contentFolder}/${ctDir}/${slug}/_common.yml`;

      if (localeEntries.length > 0 && !fs.existsSync(localeFilePath)) {
        return fail(`File not found: ${pathInfo.relativeHint}`);
      }

      if (localeEntries.length > 0) {
        const conflictErr = await getConflictError(localeFilePath, localeRelPath, localeEntries, { updates: localeEntries.map(([p, v]) => ({ field_path: p, value: v })) }, domain);
        if (conflictErr) return conflictErr;
      }
      if (commonEntries.length > 0) {
        const conflictErr = await getConflictError(commonFilePath, commonRelPath, commonEntries, { updates: commonEntries.map(([p, v]) => ({ field_path: p, value: v })) }, domain);
        if (conflictErr) return conflictErr;
      }

      const results: string[] = [];

      if (localeEntries.length > 0) {
        const ops = localeEntries.map(([p, v]) => ({ action: "update_field", path: p, value: v }));
        const apiResult = await callEditSectionsApi(
          { contentType: resolved.contentType, slug, locale, variant, layoutTarget, operations: ops },
          mcpToken,
          domain,
        );
        if ("error" in apiResult) return apiResult.error;
        results.push(`${localeEntries.length} field${localeEntries.length !== 1 ? "s" : ""} → ${pathInfo.relativeHint}`);
      }

      if (commonEntries.length > 0) {
        const ops = commonEntries.map(([p, v]) => ({ action: "update_field", path: p, value: v }));
        const apiErr = await callEditCommonApi(
          { contentType: resolved.contentType, slug, operations: ops },
          mcpToken,
          domain
        );
        if (apiErr) return apiErr;
        results.push(`${commonEntries.length} field${commonEntries.length !== 1 ? "s" : ""} → _common.yml`);
      }

      const warnings: McpWarning[] = [...variantWarningsIfNeeded(variant)];
      const next_actions: NextAction[] = [];
      if (touchesSections) {
        warnings.push(BATCH_BINDING_WARNING);
        next_actions.push({
          tool: "get_section_bindings",
          priority: "recommended",
          reason: "batch_update_fields does not propagate bindings — inspect membership, then re-apply via update_section_field if needed.",
          args_hint: { contentType: resolved.contentType, slug, sectionIndex: 0, locale },
        });
        next_actions.push({
          tool: "update_section_field",
          priority: "recommended",
          reason: "For bound sections, re-apply field changes with update_section_field so server binding propagate runs.",
          args_hint: { contentType: resolved.contentType, slug, locale, confirm_live_edit: true },
        });
      }

      const total = updates.length;
      return ok(
        {
          message: `Applied ${total} update${total !== 1 ? "s" : ""} to ${resolved.contentType}/${slug}: ${results.join("; ")}`,
          ...wrotePayload({
            layer: pathInfo.layer,
            contentType: resolved.contentType,
            path: pathInfo.relativeHint,
            locale,
            slug,
          }),
        },
        { warnings, next_actions },
      );
    }
  );

  // translate_entry
  mcp.tool(
    "translate_entry",
    "Write translated content for a target locale. Does NOT perform AI translation — supply the translated payload.\n\n" +
    "Shared-layout types (e.g. blog): entry must be detached first; otherwise fails with require_detach.\n" +
    "New target locale (no live file): writes draft.{locale}.yml at 0% traffic (not public). " +
    "Empty live stub: auto-converts to draft then writes the translation into the draft. " +
    "Existing non-empty live locale: overwrites live (must pass empty/SEO/required gates).\n" +
    "Go live with promote_variant (live entry) or publish_draft (all-draft entry). Confirm with the user before promote/publish.",
    {
      slug: z.string().describe("Page slug of the page to translate"),
      contentType: z.string().optional().describe("Content type hint (e.g. 'page', 'program'). Omit to auto-detect from slug."),
      source_locale: z.string().describe("The locale code of the existing source file used for validation, e.g. 'en'"),
      target_locale: z.string().describe("The locale code to write the translated content to, e.g. 'es' or 'fr'"),
      content: z.object({
        meta: z.record(z.unknown()).optional().describe("Translated meta block (page_title, description, og_image, etc.)"),
        sections: z.array(z.record(z.unknown())).describe("Fully translated sections array. Every section must include a 'type' field."),
      }).describe("The complete translated payload. Caller is responsible for providing accurate translations."),
      site: z.string().optional().describe(SITE_PARAM_DESC),
    },
    async ({ slug, contentType, source_locale, target_locale, content, site }) => {
      const siteResult = resolveSiteContext(site);
      if (!siteResult.ok) return siteFailResult(siteResult.error);
      const { contentPath, contentFolder, domain } = siteResult;
      try {
        assertSafeSegment(slug, "slug");
        assertSafeLocale(source_locale);
        assertSafeLocale(target_locale);
        if (contentType) assertSafeSegment(contentType, "contentType");
      } catch (e) {
        return fail((e as Error).message);
      }

      if (source_locale === target_locale) {
        return fail(`source_locale and target_locale must be different (both are '${source_locale}').`);
      }

      const resolved = resolveContentType(slug, contentType, contentPath);
      if (!resolved) {
        return fail(`Page not found for slug '${slug}'${contentType ? ` (contentType: ${contentType})` : ""}`);
      }

      if (mcpToken) {
        if (!await checkCap(mcpToken, "content_edit_text", resolved.contentType)) {
          return denyResponse("content_edit_text", resolved.contentType);
        }
      }

      const { isEntryDetached, isSharedLayoutType } = await import("../../server/shared-layout-entry.js");
      const {
        convertEmptyLiveLocaleToDraft,
        ensureDraftVariantInVersioning,
      } = await import("../../server/convert-empty-locale-to-draft.js");
      const { isEmptyDetachedLocaleEntry } = await import("../../server/empty-locale.js");
      const { assertLiveEntrySeoAndRequiredFields } = await import("../../server/live-entry-seo-gate.js");
      const { contentIndex } = await import("../../server/content-index.js");

      const sharedLayout = isSharedLayoutType(resolved.contentType, contentPath);
      const detached = isEntryDetached(resolved.contentType, slug, contentPath);

      if (sharedLayout && !detached) {
        return actionRequired(
          {
            success: false,
            action_required: "require_detach",
            code: "require_detach",
            message:
              `Shared-layout entry "${slug}" is still attached. Detach via POST /api/content/${resolved.contentType}/${slug}/detach ` +
              "(or DebugBubble → Detach) before translate_entry. Detach only bakes existing live locale files; it does not invent siblings.",
            contentType: resolved.contentType,
            slug,
          },
          [
            {
              tool: "get_entry_content",
              reason: "Confirm attached shared-layout state, then detach in admin/API, then retry translate_entry",
              args_hint: { slug, contentType: resolved.contentType, locale: source_locale },
              priority: "required",
            },
          ],
        );
      }

      const ctDir = getDirectory(resolved.contentType, resolved.config);
      const dir = path.join(contentPath, ctDir, slug);

      const sourceFilePath = path.join(dir, `${source_locale}.yml`);
      try { assertWithinBase(sourceFilePath, contentPath); } catch (e) {
        return fail((e as Error).message);
      }
      if (!fs.existsSync(sourceFilePath)) {
        // Allow source from draft.{source}.yml when live missing
        const draftSource = path.join(dir, `draft.${source_locale}.yml`);
        if (!fs.existsSync(draftSource)) {
          return fail(`Source locale '${source_locale}' not found for page '${slug}'`);
        }
      }

      const liveTargetPath = path.join(dir, `${target_locale}.yml`);
      const draftTargetPath = path.join(dir, `draft.${target_locale}.yml`);
      try { assertWithinBase(liveTargetPath, contentPath); } catch (e) {
        return fail((e as Error).message);
      }

      let writeAsDraft = false;
      let reason = "live_locale_refresh";
      let autoConverted = false;

      if (!fs.existsSync(liveTargetPath)) {
        writeAsDraft = true;
        reason = "new_locale_starts_as_draft";
      } else if (
        isEmptyDetachedLocaleEntry({
          contentType: resolved.contentType,
          slug,
          locale: target_locale,
          contentRoot: contentPath,
          ci: contentIndex,
        })
      ) {
        const converted = convertEmptyLiveLocaleToDraft({
          contentType: resolved.contentType,
          slug,
          locale: target_locale,
          contentRoot: contentPath,
          ci: contentIndex,
          author: "mcp-translate_entry",
        });
        writeAsDraft = true;
        reason = "empty_live_converted_to_draft";
        autoConverted = !!converted;
      }

      const targetFileName = writeAsDraft ? `draft.${target_locale}.yml` : `${target_locale}.yml`;
      const targetFilePath = writeAsDraft ? draftTargetPath : liveTargetPath;
      const targetRelPath = `${contentFolder}/${ctDir}/${slug}/${targetFileName}`;

      const localeData: Record<string, unknown> = { slug, sections: content.sections };
      if (content.meta && Object.keys(content.meta).length > 0) {
        localeData.meta = content.meta;
      }
      const intendedContent = safeDump(localeData);

      if (!writeAsDraft) {
        const gateErr = assertLiveEntrySeoAndRequiredFields({
          contentType: resolved.contentType,
          slug,
          locale: target_locale,
          pageData: localeData,
          contentRoot: contentPath,
          mode: "live_update",
          isDraftWrite: false,
        });
        if (gateErr) {
          return fail(gateErr, { code: "EMPTY_LOCALE_OR_REQUIRED", path: `${ctDir}/${slug}/${targetFileName}` });
        }
      }

      if (fs.existsSync(targetFilePath)) {
        const conflictCheck = await checkRemoteConflict(targetRelPath, domain);
        if (conflictCheck.conflict) {
          return conflictError({
            relativePath: targetRelPath,
            remoteContent: conflictCheck.remoteContent,
            intendedContent,
            intendedChange: { action: "translate_entry", source_locale, target_locale },
          });
        }
      }

      const isNew = !fs.existsSync(targetFilePath);
      fs.writeFileSync(targetFilePath, intendedContent, "utf-8");

      if (writeAsDraft) {
        ensureDraftVariantInVersioning({
          contentType: resolved.contentType,
          slug,
          locale: target_locale,
          contentRoot: contentPath,
          author: "mcp-translate_entry",
          variantSlug: "draft",
        });
      }

      const commitMsg = writeAsDraft
        ? `Draft translate ${resolved.contentType}/${slug} to ${target_locale}`
        : `Translate ${resolved.contentType}/${slug} to ${target_locale}`;
      const [commitResult] = await Promise.all([
        callCommitFileApi(targetRelPath, commitMsg, mcpToken, domain),
        callRefreshCacheApi(resolved.contentType, domain),
      ]);

      const warnings: McpWarning[] = [];
      if (commitResult.warning) {
        warnings.push({ code: "github_commit_failed", message: commitResult.warning });
      }
      if (writeAsDraft) {
        warnings.push({
          code: "translation_not_public",
          message: `${targetFileName} is not in listings/sitemap/hreflang until promote_variant or publish_draft. Did not create live ${target_locale}.yml as a public locale.`,
        });
        warnings.push({
          code: "empty_locale_blocked_on_promote",
          message: "Promote/publish fails if the detached locale would still be empty (no sections and no content).",
        });
      }
      if (autoConverted) {
        warnings.push({
          code: "empty_live_auto_converted",
          message: `Empty live ${target_locale}.yml was moved to draft.${target_locale}.yml before writing the translation.`,
        });
      }

      const next_actions: NextAction[] = writeAsDraft
        ? [
            {
              tool: "get_entry_content",
              reason: "Inspect the draft translation",
              args_hint: { slug, contentType: resolved.contentType, locale: target_locale, variant: "draft" },
              priority: "recommended",
            },
            {
              tool: "run_entry_diagnostics",
              reason: "Validate before going live (async — then poll get_diagnostics_job)",
              args_hint: { slugs: [slug], freshness: "hard" },
              priority: "recommended",
            },
            {
              tool: "promote_variant",
              reason: "Make this locale live when ready (confirm with user). Use publish_draft if the entry has no live locales yet.",
              args_hint: {
                contentType: resolved.contentType,
                slug,
                locale: target_locale,
                variantSlug: "draft",
              },
              priority: "optional",
            },
          ]
        : [];

      return ok(
        {
          message: writeAsDraft
            ? `Draft translation ${isNew ? "created" : "updated"} at ${resolved.contentType}/${slug}/${targetFileName}`
            : `Translated content ${isNew ? "created" : "updated"} at ${resolved.contentType}/${slug}/${targetFileName}`,
          slug,
          contentType: resolved.contentType,
          source_locale,
          target_locale,
          created: isNew,
          live: !writeAsDraft,
          layer: writeAsDraft ? "draft_locale" : "entry_locale",
          reason,
          sectionsCount: content.sections.length,
          metaKeys: content.meta ? Object.keys(content.meta) : [],
          ...(commitResult.commitSha ? { commitSha: commitResult.commitSha } : {}),
          ...wrotePayload({
            layer: writeAsDraft ? "draft_locale" : "entry_locale",
            contentType: resolved.contentType,
            path: `${ctDir}/${slug}/${targetFileName}`,
            locale: target_locale,
            slug,
          }),
        },
        { warnings, next_actions, side_effects: writeAsDraft ? [{
          kind: "wrote_draft_locale",
          summary: `Wrote ${targetFileName} + versioning 0%; did not publish live ${target_locale}.yml`,
        }] : undefined },
      );
    }
  );

  // get_section_bindings
  mcp.tool(
    "get_section_bindings",
    "Read-only: look up the section-binding group for a section by contentType, slug, and sectionIndex. " +
    "Returns { group: null } when the section is not bound, or the enriched binding group with members. " +
    "Use after structural edits or batch_update_fields when you need membership context. " +
    "Does not mutate content — binding content sync happens on live update_section_field / update_section_fields.",
    {
      contentType: z.string().describe("Content type, e.g. 'page' or 'program'"),
      slug: z.string().describe("Page slug"),
      sectionIndex: z.number().int().describe("0-based section index on the page"),
      locale: z.string().default("en").describe("Locale code, e.g. 'en' or 'es'"),
      site: z.string().optional().describe(SITE_PARAM_DESC),
    },
    async ({ contentType, slug, sectionIndex, locale, site }) => {
      const siteResult = resolveSiteContext(site);
      if (!siteResult.ok) return siteFailResult(siteResult.error);
      const { domain } = siteResult;
      try {
        assertSafeSegment(contentType, "contentType");
        assertSafeSegment(slug, "slug");
        assertSafeLocale(locale);
      } catch (e) {
        return fail((e as Error).message);
      }

      try {
        const params = new URLSearchParams({
          contentType,
          slug,
          sectionIndex: String(sectionIndex),
          locale,
        });
        if (domain) params.set("__site", domain);
        const url = `http://localhost:${MAIN_SERVER_PORT}/api/bindings/section?${params}`;
        const res = await fetch(url, { headers: internalHeaders(mcpToken) });
        const data = await res.json() as Record<string, unknown>;
        if (!res.ok) {
          return fail((data.error as string) || `Server error: ${res.status}`);
        }
        return ok(
          { contentType, slug, sectionIndex, locale, ...data },
          { warnings: [], next_actions: [] },
        );
      } catch (e) {
        return fail(`Failed to fetch section bindings: ${(e as Error).message}`);
      }
    }
  );

  // get_content_type_info
  mcp.tool(
    "get_content_type_info",
    "Describe a content type from content-types.yml: db_backed vs single_template, field_mapping, editor, " +
    "url_pattern, extra URL params, observed peer values for those params, create_via, body_model, " +
    "and schema_org_requirements with coverage { present, missing_slugs } when declared. " +
    "For editor.type json fields, read editor.<field>.schema (JSON Schema) before writing values via " +
    "batch_update_fields / update_section_field — schema is required and returned again on validation failure. " +
    "Call this before create_entry when unsure how a type works. " +
    "When coverage shows missing_slugs, call ensure_content_type_schema_org to attach seeded companions. " +
    MULTI_SITE_TOOL_BLURB,
    {
      contentType: z.string().describe("Content type key, e.g. 'blog', 'program', 'page', 'lesson'"),
      site: z.string().optional().describe(SITE_PARAM_DESC),
    },
    async ({ contentType, site }) => {
      const siteResult = resolveSiteContext(site);
      if (!siteResult.ok) return siteFailResult(siteResult.error, "get_content_type_info", { contentType });
      const { contentPath, domain } = siteResult;
      try {
        assertSafeSegment(contentType, "contentType");
      } catch (e) {
        return fail((e as Error).message);
      }
      const configs = loadContentTypes(contentPath);
      const config = configs[contentType];
      if (!config) {
        return fail(`Unknown contentType '${contentType}'. Known: ${Object.keys(configs).join(", ")}`);
      }
      const urlParams = listExtraUrlPatternParams(config.url_pattern);
      const observed: Record<string, string[]> = {};
      for (const param of urlParams) {
        observed[param] = observeParamValues(contentPath, contentType, config, param);
      }
      const editor = getEditorConfig(config);
      const createVia = createViaForConfig(config);
      const next_actions: NextAction[] = [];
      if (createVia === "create_entry") {
        next_actions.push({
          tool: "create_entry",
          reason: "Create a new entry of this type (pass site in multi-site)",
          args_hint: { contentType, site },
          priority: "optional",
        });
      }
      if (isSharedLayoutConfig(config)) {
        next_actions.push({
          tool: "explain_site",
          reason: "Read shared-layout playbook",
          args_hint: { topic: "shared-layout" },
          priority: "recommended",
        });
      }

      const schema_org_requirements = Array.isArray(
        (config as { schema_org_requirements?: Array<{ schema_type: string }> }).schema_org_requirements,
      )
        ? (config as { schema_org_requirements: Array<{ schema_type: string }> }).schema_org_requirements
        : [];

      let schema_org_coverage: Array<Record<string, unknown>> = [];
      if (schema_org_requirements.length > 0) {
        try {
          const q = domain ? `?__site=${encodeURIComponent(domain)}` : "";
          const res = await fetch(
            `http://localhost:${MAIN_SERVER_PORT}/api/content-types/${encodeURIComponent(contentType)}/schema-org-coverage${q}`,
          );
          if (res.ok) {
            const data = (await res.json()) as { coverage?: Array<Record<string, unknown>> };
            schema_org_coverage = Array.isArray(data.coverage) ? data.coverage : [];
          }
        } catch {
          // Fall back to local helper when main server is down
          try {
            const { getSchemaOrgRequirementCoverage } = await import(
              "../../server/schema-org-requirements.js"
            );
            schema_org_coverage = schema_org_requirements.map((r) =>
              getSchemaOrgRequirementCoverage(contentType, r.schema_type, contentPath),
            );
          } catch {
            schema_org_coverage = [];
          }
        }
        const missing = schema_org_coverage.flatMap((c) =>
          Array.isArray(c.missing_slugs) ? (c.missing_slugs as string[]) : [],
        );
        if (missing.length > 0) {
          next_actions.push({
            tool: "ensure_content_type_schema_org",
            reason: "Attach seeded schema_org companions on missing entries",
            args_hint: {
              contentType,
              schema_type: schema_org_requirements[0]?.schema_type,
              site,
            },
            priority: "recommended",
          });
        }
      }

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            contentType,
            directory: getDirectory(contentType, config),
            db_backed: isDbBacked(config),
            single_template: !!config.single_template,
            shared_layout: isSharedLayoutConfig(config),
            url_pattern: config.url_pattern ?? null,
            url_params: urlParams,
            field_mapping: config.field_mapping ?? null,
            editor,
            indexes: config.indexes ?? [],
            observed_values: observed,
            create_via: createVia,
            create_via_note: createVia
              ? "Use create_entry (YAML). Shared-layout: one locale, sections []."
              : "Database-backed — create_entry cannot create rows; use DB/admin path.",
            body_model: bodyModelForConfig(config),
            schema_org_requirements,
            coverage: schema_org_coverage[0]
              ? {
                  schema_type: schema_org_coverage[0].schema_type,
                  present: schema_org_coverage[0].present,
                  total: schema_org_coverage[0].total,
                  missing_slugs: schema_org_coverage[0].missing_slugs,
                }
              : schema_org_requirements.length === 0
                ? null
                : { present: 0, missing_slugs: [], total: 0 },
            coverage_by_schema_type: schema_org_coverage.map((c) => ({
              schema_type: c.schema_type,
              present: c.present,
              total: c.total,
              missing_slugs: c.missing_slugs,
            })),
            next_actions,
          }, null, 2),
        }],
      };
    }
  );

  // ensure_content_type_schema_org
  mcp.tool(
    "ensure_content_type_schema_org",
    "Ensure every entry of a content type has a leading schema_org section for the given schema_type " +
    "(e.g. location → LocalBusiness). Seeds missing entries from legacy catalog or miami-usa/madrid-spain templates. " +
    "Call get_content_type_info first to see coverage. Requires content_edit_structure. " +
    MULTI_SITE_TOOL_BLURB,
    {
      contentType: z.string().describe("Content type key, e.g. 'location'"),
      schema_type: z.string().describe("Required schema.org type, e.g. 'LocalBusiness'"),
      dry_run: z.boolean().optional().describe("When true, report what would be added without writing"),
      slugs: z.array(z.string()).optional().describe("Optional subset of entry slugs; omit for all missing"),
      site: z.string().optional().describe(SITE_PARAM_DESC),
    },
    async ({ contentType, schema_type, dry_run, slugs, site }) => {
      const siteResult = resolveSiteContext(site);
      if (!siteResult.ok) return siteFailResult(siteResult.error, "ensure_content_type_schema_org", {
        contentType,
        schema_type,
      });
      const { domain } = siteResult;
      try {
        assertSafeSegment(contentType, "contentType");
        if (slugs) for (const s of slugs) assertSafeSegment(s, "slug");
      } catch (e) {
        return fail((e as Error).message);
      }
      if (mcpToken && !(await checkCap(mcpToken, "content_edit_structure", contentType))) {
        return denyResponse("content_edit_structure", contentType);
      }

      const q = domain ? `?__site=${encodeURIComponent(domain)}` : "";
      try {
        const res = await fetch(
          `http://localhost:${MAIN_SERVER_PORT}/api/content-types/${encodeURIComponent(contentType)}/schema-org-ensure${q}`,
          {
            method: "POST",
            headers: { ...internalHeaders(mcpToken), "Content-Type": "application/json" },
            body: JSON.stringify({
              schema_type,
              dry_run: !!dry_run,
              slugs: slugs && slugs.length > 0 ? slugs : undefined,
            }),
          },
        );
        const data = (await res.json()) as Record<string, unknown>;
        if (!res.ok) {
          return fail(String(data.error ?? data.message ?? `ensure failed (${res.status})`), data);
        }

        const results = Array.isArray(data.results) ? (data.results as Array<Record<string, unknown>>) : [];
        const writtenPaths = results.flatMap((r) =>
          Array.isArray(r.files) ? (r.files as string[]) : [],
        );
        const warnings: McpWarning[] = [
          {
            code: "no_binding_topology_fanout",
            message:
              "Ensured schema_org sections are written only to the listed entry locale YAML paths. No section-binding topology fan-out.",
          },
          {
            code: "no_schema_org_yml_write",
            message: "Site schema-org.yml is not modified by this tool.",
          },
        ];
        if (dry_run) {
          warnings.push({
            code: "dry_run",
            message: "dry_run was true — no files were written.",
          });
        }

        return ok(
          {
            message: `Ensured schema_org ${schema_type} on content type '${contentType}' (added=${data.added ?? 0}, already_present=${data.already_present ?? 0}, errors=${data.errors ?? 0})`,
            contentType,
            schema_type,
            added: data.added ?? 0,
            already_present: data.already_present ?? 0,
            errors: data.errors ?? 0,
            results,
          },
          {
            warnings,
            side_effects: writtenPaths.length
              ? [
                  {
                    kind: "schema_org_ensure",
                    summary: `Wrote leading schema_org ${schema_type} on ${writtenPaths.length} file(s): ${writtenPaths.slice(0, 8).join(", ")}${writtenPaths.length > 8 ? "…" : ""}`,
                  },
                ]
              : [],
            next_actions: [
              {
                tool: "get_content_type_info",
                reason: "Re-check schema_org_requirements coverage after ensure",
                args_hint: { contentType, site },
                priority: "recommended",
              },
            ],
          },
        );
      } catch (e) {
        return fail(`Failed to ensure schema_org: ${(e as Error).message}`);
      }
    }
  );

  // list_entry_seo
  mcp.tool(
    "list_entry_seo",
    "Return SEO-relevant fields (meta, title, schema, url) for content entries. " +
    "Works for YAML and DB-backed types via the main server seo-entries API. " +
    "Sections/body content are never returned. " +
    "IMPORTANT: Omitting slugs does NOT dump the full type — returns a minimal sample (default 5; limit 1–20). " +
    "Pass slugs for full meta on those entries. Prefer get_entry_seo for one slug; get_content_type_info for type contract. " +
    MULTI_SITE_TOOL_BLURB,
    {
      contentType: z.string().optional().describe("Restrict to one content type, e.g. 'blog' or 'program'"),
      locale: z.string().optional().describe("Restrict to one locale, e.g. 'en' or 'es'"),
      slugs: z.array(z.string()).optional().describe("Specific slugs — required for full meta payloads"),
      limit: z.number().int().min(1).max(20).optional().describe("Sample size when slugs omitted (default 5, max 20). Does not unlock full meta."),
      site: z.string().optional().describe(SITE_PARAM_DESC),
    },
    async ({ contentType, locale, slugs, limit, site }) => {
      const siteResult = resolveSiteContext(site);
      if (!siteResult.ok) {
        return siteFailResult(siteResult.error, "list_entry_seo", { contentType, locale, slugs, limit });
      }
      const { contentPath, domain } = siteResult;
      try {
        const configs = loadContentTypes(contentPath);
        const results: Array<Record<string, unknown>> = [];

        const typesToQuery = contentType
          ? (configs[contentType] ? [contentType] : [])
          : Object.keys(configs);

        await Promise.all(typesToQuery.map(async (ct) => {
          try {
            const params = new URLSearchParams();
            if (locale) params.set("locale", locale);
            if (domain) params.set("__site", domain);
            const url = `http://localhost:${MAIN_SERVER_PORT}/api/content-types/${encodeURIComponent(ct)}/seo-entries?${params}`;
            const res = await fetch(url);
            if (!res.ok) {
              results.push({ contentType: ct, error: `seo-entries returned ${res.status}` });
              return;
            }
            const body = await res.json() as {
              source: string;
              cache_missing?: boolean;
              cache_age_hours: number | null;
              entries: Array<{
                slug: unknown; contentType: string; locale: string;
                url: string | null; title: unknown;
                meta: Record<string, unknown>; schema: unknown;
              }>;
            };
            if (body.cache_missing) {
              results.push({ contentType: ct, cache_missing: true });
              return;
            }
            for (const entry of body.entries) {
              if (slugs && !slugs.includes(String(entry.slug))) continue;
              results.push({
                ...entry,
                ...(body.source === "db" ? { cache_age_hours: body.cache_age_hours } : {}),
              });
            }
          } catch (err) {
            results.push({ contentType: ct, error: `Failed to reach seo-entries: ${err}` });
          }
        }));

        results.sort((a, b) => {
          const ct = String(a.contentType ?? "").localeCompare(String(b.contentType ?? ""));
          if (ct !== 0) return ct;
          const sl = String(a.slug ?? "").localeCompare(String(b.slug ?? ""));
          if (sl !== 0) return sl;
          return String(a.locale ?? "").localeCompare(String(b.locale ?? ""));
        });

        const wantsFull = Array.isArray(slugs) && slugs.length > 0;
        if (wantsFull) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({ truncated: false, count: results.length, entries: results }, null, 2),
            }],
          };
        }

        const sampleSize = limit ?? 5;
        const approx = results.length;
        const sample = results.slice(0, sampleSize).map((e) => ({
          slug: e.slug,
          contentType: e.contentType,
          locale: e.locale,
          title: e.title ?? null,
          url: e.url ?? null,
        }));
        const siteHint = site ? { site } : {};
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              truncated: true,
              approx_count: approx,
              returned: sample.length,
              fields: "minimal",
              message:
                "Unfiltered list_entry_seo returns a minimal sample only. Pass slugs for full meta; " +
                "use get_entry_seo for one entry; get_content_type_info for the type contract.",
              entries: sample,
              warnings: [{
                code: "list_seo_unfiltered_sample",
                message: `Full meta omitted. Did not return all ${approx} matching entries.`,
              }],
              next_actions: [
                {
                  tool: "get_content_type_info",
                  priority: "recommended",
                  reason: "Inspect field_mapping / shared-layout flags instead of dumping SEO",
                  args_hint: { contentType: contentType || "blog", ...siteHint },
                },
                {
                  tool: "list_entries",
                  priority: "recommended",
                  reason: "Find peers with search, then list_entry_seo with those slugs",
                  args_hint: { contentType, locale, search: "", ...siteHint },
                },
                {
                  tool: "get_entry_seo",
                  priority: "optional",
                  reason: "Full SEO for one known slug",
                  args_hint: { slug: sample[0]?.slug, locale: locale || "en", ...siteHint },
                },
              ],
            }, null, 2),
          }],
        };
      } catch (err) {
        return { content: [{ type: "text", text: String(err) }], isError: true };
      }
    }
  );
}
