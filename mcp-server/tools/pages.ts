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
} from "../lib/content.js";
import { assertSafeSegment, assertSafeLocale, assertWithinBase } from "../lib/sanitize.js";
import { checkCap, denyResponse } from "../lib/auth.js";
import { getTokenUsername } from "../lib/oauth.js";
import { promoteWarnings, VARIANT_WARNINGS, type McpTextResult, type McpWarning, type NextAction, type McpSideEffect } from "../lib/respond.js";
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
  CREATE_PAGE_SHARED_LAYOUT_WARNING,
} from "../lib/shared-layout.js";
import { hintsAfterAddArticle, hintsAfterReplaceSections } from "../lib/article-hints.js";

const MAIN_SERVER_PORT = process.env.PORT || "5000";
// Internal credential for loopback calls to capability-gated main-server endpoints.
// Must match the value used in server/routes/_helpers.ts trusted-internal bypass.
export const MCP_SERVER_SECRET = process.env.MCP_SERVER_SECRET || process.env.MCP_API_KEY || "";

const SITE_PARAM_DESC = 'Domain of the target site from sites.yml, e.g. "4geeks.com" (required when multiple sites are configured; optional when only one site exists)';

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
      return { error: fail((data.error as string) || `Server error: ${res.status}`) };
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
  // list_pages
  mcp.tool(
    "list_pages",
    "List YAML-driven content pages. Returns slug, contentType, locales, title, and urls (a per-locale map of resolved paths, e.g. { en: '/en/career-programs/ai-engineering' }) for each page. " +
    "IMPORTANT: Database-backed content types (those configured with a database in content-types.yml) are NOT included in these results — they are stored in the database, not as YAML files. " +
    "If you search for a known slug (e.g. 'python-http-requests') and get an empty result, it likely means that entry belongs to a db-backed content type rather than not existing at all. " +
    "There is currently no MCP tool to query db-backed entries directly. " +
    "Optional filters (all combinable, AND logic): " +
    "contentType — restrict to one type (e.g. 'program', 'landing', 'page'); " +
    "locale — only pages that have this locale available (e.g. 'en'); " +
    "slugs — restrict to a specific list of slugs; " +
    "search — case-insensitive substring match against slug and title. " +
    "With no filters the full list is returned.",
    {
      contentType: z.string().optional().describe("Restrict to one content type, e.g. 'program' or 'landing'"),
      locale: z.string().optional().describe("Only return pages that have this locale available, e.g. 'en' or 'es'"),
      slugs: z.array(z.string()).optional().describe("Restrict to a specific list of slugs"),
      search: z.string().optional().describe("Case-insensitive substring match against slug and title"),
      site: z.string().optional().describe(SITE_PARAM_DESC),
    },
    async ({ contentType, locale, slugs, search, site }) => {
      const siteResult = resolveSiteContext(site);
      if (!siteResult.ok) return { content: [{ type: "text", text: siteResult.error }], isError: true };
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

  // ── Shared resolution helper used by get_page_content and get_page_seo ──────

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

  // get_page_content
  mcp.tool(
    "get_page_content",
    "Get the merged content of a page (sections, title, and all other top-level YAML keys) without the meta/SEO block. " +
    "Also returns locales (all available locale codes for this page), urls (per-locale resolved paths), and " +
    "validation_issues (all cached validation issues for this page across all categories — each with code, message, severity, and category). " +
    "validation_issues is always present (empty array if no issues are cached). " +
    "Merges _common.yml with the locale file. contentType is optional — omit it and the server will auto-detect it from the slug. " +
    "Use get_page_seo to fetch only the SEO/meta fields. " +
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
      if (!siteResult.ok) return { content: [{ type: "text", text: siteResult.error }], isError: true };
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

  // get_page_seo
  mcp.tool(
    "get_page_seo",
    "Get only the SEO/meta block of a page plus the identifying envelope (contentType, slug, locale, locales, urls). " +
    "Also returns validation_issues containing only cached SEO-category issues (from the meta, seo-depth, and seo-intent validators). " +
    "validation_issues is always present (empty array if no SEO issues are cached). " +
    "Use this instead of get_page_content when you only need meta tags, Open Graph data, or other SEO fields. " +
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
      if (!siteResult.ok) return { content: [{ type: "text", text: siteResult.error }], isError: true };
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
        return { content: [{ type: "text", text: JSON.stringify({ contentType: resolved.contentType, slug, locale, variant, meta: result.data.meta, validation_issues: [] }, null, 2) }] };
      }

      const payload = resolvePagePayload(slug, locale, contentType, contentPath);
      if ("isError" in payload) return payload;

      // Inject cached SEO-only validation issues for this page's URL
      const pageUrl = payload.urls?.[locale];
      const validation_issues = pageUrl ? getCachedValidationIssues(pageUrl, ["seo"], contentPath) : [];

      const seoPayload = {
        contentType: payload.contentType,
        slug: payload.slug,
        locale: payload.locale,
        locales: payload.locales,
        ...(payload.urls ? { urls: payload.urls } : {}),
        meta: payload.data.meta,
        validation_issues,
      };

      return { content: [{ type: "text", text: JSON.stringify(seoPayload, null, 2) }] };
    }
  );

  // run_page_diagnostics
  mcp.tool(
    "run_page_diagnostics",
    "Trigger a fresh validation run for one or more pages and return a map of slug → validation_issues[]. " +
    "Each issue has code, message, severity ('error' or 'warning'), and category. " +
    "Use this after editing a page to confirm it is clean, or to get up-to-date diagnostics for specific pages. " +
    "Parameters: " +
    "'slugs' (optional array) — restrict to specific page slugs. If omitted or empty, all known YAML-backed pages are validated. " +
    "'categories' (optional array, e.g. ['seo']) — filter results to specific categories. If omitted, all categories are returned. " +
    "Note: running diagnostics on all pages may take some time. Prefer providing 'slugs' when you only need a few pages. " +
    "This tool updates the validation cache so subsequent get_page_content / get_page_seo calls also reflect the fresh results.",
    {
      slugs: z.array(z.string()).optional().describe("Page slugs to validate, e.g. ['home', 'full-stack-developer']. Omit or pass [] to validate all YAML-backed pages."),
      categories: z.array(z.string()).optional().describe("Filter results to specific categories, e.g. ['seo']. Omit to return all categories."),
      site: z.string().optional().describe(SITE_PARAM_DESC),
    },
    async ({ slugs, categories, site }) => {
      const siteResult = resolveSiteContext(site);
      if (!siteResult.ok) return { content: [{ type: "text", text: siteResult.error }], isError: true };
      const { contentPath, domain } = siteResult;
      // Resolve target pages
      let pages = scanPages(contentPath);
      if (slugs && slugs.length > 0) {
        const slugSet = new Set(slugs);
        pages = pages.filter(p => slugSet.has(p.slug));
        if (pages.length === 0) {
          return {
            content: [{ type: "text", text: JSON.stringify({ error: `No YAML-backed pages found for slugs: ${slugs.join(", ")}` }, null, 2) }],
            isError: true,
          };
        }
      }

      const resultMap: Record<string, MappedValidationIssue[]> = {};
      const catSet = categories && categories.length > 0 ? new Set(categories) : null;

      for (const page of pages) {
        const slugIssues: MappedValidationIssue[] = [];

        // Run diagnostics for each locale URL of this page
        for (const locale of page.locales) {
          const url = page.urls?.[locale];
          if (!url) continue;

          try {
            const runPageUrl = `http://localhost:${MAIN_SERVER_PORT}/api/validation/run-page${domain ? `?__site=${encodeURIComponent(domain)}` : ""}`;
            const res = await fetch(
              runPageUrl,
              {
                method: "POST",
                headers: internalHeaders(),
                body: JSON.stringify({ url }),
              }
            );
            if (!res.ok) continue;

            const data = await res.json() as {
              validators: Array<{
                name: string;
                category?: string;
                errors: Array<{ code: string; message: string; file?: string; suggestion?: string }>;
                warnings: Array<{ code: string; message: string; file?: string; suggestion?: string }>;
              }>;
            };

            for (const v of data.validators) {
              const cat = v.category ?? "other";
              for (const e of v.errors) {
                slugIssues.push({
                  code: e.code,
                  message: e.message,
                  severity: "error",
                  category: cat,
                  ...(e.file ? { file: e.file } : {}),
                  ...(e.suggestion ? { suggestion: e.suggestion } : {}),
                });
              }
              for (const w of v.warnings) {
                slugIssues.push({
                  code: w.code,
                  message: w.message,
                  severity: "warning",
                  category: cat,
                  ...(w.file ? { file: w.file } : {}),
                  ...(w.suggestion ? { suggestion: w.suggestion } : {}),
                });
              }
            }
          } catch {
            // Non-fatal: skip this locale if the request fails
          }
        }

        // Apply optional category filter
        resultMap[page.slug] = catSet
          ? slugIssues.filter(i => catSet.has(i.category))
          : slugIssues;
      }

      return { content: [{ type: "text", text: JSON.stringify(resultMap, null, 2) }] };
    }
  );

  // ── Shared helpers for the new split tools ──────────────────────────────────

  const SAFE_TOP_LEVEL_FIELDS = new Set(["title", "slug"]);

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
    "Use this for all content/section edits — field_path must start with 'sections.' or be one of the safe " +
    "top-level fields ('title', 'slug'). " +
    "Do NOT use this for SEO/meta fields — use update_meta_field instead. " +
    "contentType is optional — omit it and the server will auto-detect from slug.\n\n" +
    "IMPORTANT — versioning safety: If the page has active variants (a versioning.yml exists), " +
    "you MUST ask the user before calling this tool: " +
    "'Do you want to edit the live version directly, or create a new draft variant first?' " +
    "To edit the live version directly pass confirm_live_edit: true. " +
    "To edit a variant, call create_variant first and pass the returned slug as the 'variant' parameter here.",
    {
      slug: z.string().describe("Page slug"),
      locale: z.string().default("en").describe("Locale code, e.g. 'en' or 'es'"),
      field_path: z.string().describe(
        "Dot-notation path targeting section content. Must start with 'sections.' (e.g. 'sections.0.title') " +
        "or be a safe top-level field: 'title' or 'slug'. " +
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
      if (!siteResult.ok) return fail(siteResult.error);
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
      if (!fieldPath.startsWith("sections.") && !SAFE_TOP_LEVEL_FIELDS.has(fieldPath)) {
        return fail(`field_path '${fieldPath}' is not allowed. Must start with 'sections.' or be one of: ${[...SAFE_TOP_LEVEL_FIELDS].join(", ")}.`);
      }

      const resolved = resolveContentType(slug, contentType, contentPath, { allowSharedLayout: true });
      if (!resolved) {
        return fail(`Page not found for slug '${slug}'${contentType ? ` (contentType: ${contentType})` : ""}`);
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
          warnings: variantWarningsIfNeeded(variant),
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
      if (!siteResult.ok) return fail(siteResult.error);
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
      const badPaths = Object.keys(fields).filter(fp => !fp.startsWith("sections.") && !SAFE_TOP_LEVEL_FIELDS.has(fp));
      if (badPaths.length > 0) {
        return fail(`Disallowed field_path(s): ${badPaths.join(", ")}. Must start with 'sections.' or be one of: ${[...SAFE_TOP_LEVEL_FIELDS].join(", ")}.`);
      }

      const resolved = resolveContentType(slug, contentType, contentPath, { allowSharedLayout: true });
      if (!resolved) {
        return fail(`Page not found for slug '${slug}'${contentType ? ` (contentType: ${contentType})` : ""}`);
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
          warnings: variantWarningsIfNeeded(variant),
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
      if (!siteResult.ok) return fail(siteResult.error);
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

      const resolved = resolveContentType(slug, contentType, contentPath);
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
        const fileName = isCommon ? "_common.yml" : (variant ? `${variant}.${locale}.yml` : `${locale}.yml`);
        const filePath = path.join(dir, fileName);
        try { assertWithinBase(filePath, contentPath); } catch (e) {
          return fail((e as Error).message);
        }
        if (!isCommon && !fs.existsSync(filePath)) {
          return fail(`File not found: ${resolved.contentType}/${slug}/${fileName}`);
        }
        const relativePath = `${contentFolder}/${ctDir}/${slug}/${fileName}`;
        const conflictErrF = await getConflictError(filePath, relativePath, [[`meta.${field}`, value]], { field, value }, domain);
        if (conflictErrF) return conflictErrF;
        const metaOp = { action: "update_field", path: `meta.${field}`, value };
        if (isCommon) {
          const apiErrF = await callEditCommonApi({ contentType: resolved.contentType, slug, operations: [metaOp] }, mcpToken, domain);
          if (apiErrF) return apiErrF;
        } else {
          const apiResultF = await callEditSectionsApi({ contentType: resolved.contentType, slug, locale, variant, operations: [metaOp] }, mcpToken, domain);
          if ("error" in apiResultF) return apiResultF.error;
        }
        results.push(`meta.${field} → ${fileName}`);
      }

      if (custom_fields && target) {
        const fileName = target === "common" ? "_common.yml" : (variant ? `${variant}.${locale}.yml` : `${locale}.yml`);
        const filePath = path.join(dir, fileName);
        try { assertWithinBase(filePath, contentPath); } catch (e) {
          return fail((e as Error).message);
        }
        if (target === "locale" && !fs.existsSync(filePath)) {
          return fail(`File not found: ${resolved.contentType}/${slug}/${fileName}`);
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
          const apiResultC = await callEditSectionsApi({ contentType: resolved.contentType, slug, locale, variant, operations: ops }, mcpToken, domain);
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
      if (!siteResult.ok) return fail(siteResult.error);
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

      const resolved = resolveContentType(slug, contentType, contentPath);
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
          const fileName = variant ? `${variant}.${locale}.yml` : `${locale}.yml`;
          const filePath = path.join(dir, fileName);
          try { assertWithinBase(filePath, contentPath); } catch (e) {
            return fail((e as Error).message);
          }
          if (!fs.existsSync(filePath)) {
            return fail(`File not found: ${resolved.contentType}/${slug}/${fileName}`);
          }
          const relativePath = `${contentFolder}/${ctDir}/${slug}/${fileName}`;
          const conflictErrLE = await getConflictError(filePath, relativePath, localeEntries, { fields: Object.fromEntries(localeEntries) }, domain);
          if (conflictErrLE) return conflictErrLE;
          const apiResultLE = await callEditSectionsApi(
            { contentType: resolved.contentType, slug, locale, variant, operations: localeEntries.map(([p, v]) => ({ action: "update_field", path: p, value: v })) },
            mcpToken,
            domain
          );
          if ("error" in apiResultLE) return apiResultLE.error;
          results.push(`${localeEntries.map(([k]) => k).join(", ")} → ${fileName}`);
        }
      }

      if (custom_fields && target) {
        const fileName = target === "common" ? "_common.yml" : (variant ? `${variant}.${locale}.yml` : `${locale}.yml`);
        const filePath = path.join(dir, fileName);
        try { assertWithinBase(filePath, contentPath); } catch (e) {
          return fail((e as Error).message);
        }
        if (target === "locale" && !fs.existsSync(filePath)) {
          return fail(`File not found: ${resolved.contentType}/${slug}/${fileName}`);
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
          const apiResultMF = await callEditSectionsApi({ contentType: resolved.contentType, slug, locale, variant, operations: opsMF }, mcpToken, domain);
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
      if (!siteResult.ok) return { content: [{ type: "text", text: siteResult.error }], isError: true };
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
    "Create a new draft variant for a page by copying the current live locale file to {variantSlug}.{locale}.yml " +
    "and registering it in versioning.yml at 0% traffic allocation. " +
    "Returns the new variant slug. After creating a variant, use update_section_field/update_section_fields/update_meta_field/update_meta_fields " +
    "with variant: <variantSlug> to edit the draft without touching the live page.",
    {
      contentType: z.string().describe("Content type, e.g. 'program', 'page', 'landing'"),
      slug: z.string().describe("Page slug"),
      variantSlug: z.string().describe("Slug for the new variant, e.g. 'draft-v2' or 'ab-test-headline'. Lowercase letters, numbers, and hyphens only."),
      locale: z.string().default("en").describe("Locale to copy, e.g. 'en' or 'es'"),
      site: z.string().optional().describe(SITE_PARAM_DESC),
    },
    async ({ contentType, slug, variantSlug, locale, site }) => {
      const siteResult = resolveSiteContext(site);
      if (!siteResult.ok) return fail(siteResult.error);
      const { domain, contentPath } = siteResult;
      try {
        assertSafeSegment(contentType, "contentType");
        assertSafeSegment(slug, "slug");
        assertSafeSegment(variantSlug, "variantSlug");
        assertSafeLocale(locale);
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
          body: JSON.stringify({ variantSlug, locale }),
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
          },
          {
            warnings: [...VARIANT_WARNINGS],
            side_effects: [{
              kind: "variant_isolated",
              summary: versioningSlug === "single"
                ? "Created template draft (shared by all attached entries); live single.*.yml unchanged"
                : "Created draft only; live locale YAML unchanged",
            }],
            next_actions: [{
              tool: "update_section_field",
              priority: "recommended",
              reason: "Edit the draft with variant set; live bindings/shared-layout will not run until promote + live edits.",
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

  // promote_variant
  mcp.tool(
    "promote_variant",
    "Promote a draft variant to become the live version: overwrites the default locale file with the variant's content, " +
    "removes the variant from versioning.yml, and deletes the variant file. " +
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
      if (!siteResult.ok) return fail(siteResult.error);
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
          return fail((data.error as string) || `Server error: ${res.status}`);
        }
        const next_actions: NextAction[] = sharedLayout
          ? [{
              tool: "get_page_content",
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

  // create_page
  mcp.tool(
    "create_page",
    "Create a brand-new YAML-driven page in a single call. " +
    "Writes _common.yml (slug + any locale-independent data) and one or more locale files in one operation. " +
    "Validates that the slug does not already exist and that the content type is valid and not DB-backed. " +
    "Refreshes the cache and marks all written files for Git auto-commit.\n\n" +
    "What the caller must supply:\n" +
    "  • contentType — a non-DB-backed content type from content-types.yml\n" +
    "  • slug — URL-safe identifier that must not already exist\n" +
    "  • common — object written verbatim to _common.yml (locale-independent fields, e.g. title, layout, bc_slug)\n" +
    "  • locales — map of locale code → { meta?, sections } for every locale to seed\n\n" +
    "What the server handles: content-type + slug validation, directory creation, writing _common.yml " +
    "and all locale files, cache refresh, and Git mark-modified for each file.\n\n" +
    "Possible errors: unknown/DB-backed contentType, slug already exists, path traversal detected, " +
    "invalid locale code, permission denied.",
    {
      contentType: z.string().describe("Content type, e.g. 'program', 'page', 'landing', 'location'. Must match a non-DB-backed entry in content-types.yml."),
      slug: z.string().describe("URL-safe slug for the new page, e.g. 'machine-learning-bootcamp'. Must not already exist for this content type."),
      common: z.record(z.unknown()).describe("Fields written verbatim to _common.yml (locale-independent data). Typically includes: title, layout, and any content-type-specific fields like bc_slug or job_role. E.g. { title: 'ML Bootcamp', layout: 'LandingLayout' }"),
      locales: z.record(z.object({
        meta: z.record(z.unknown()).optional().describe("Meta/SEO fields for this locale, e.g. { page_title: '...', description: '...', robots: 'index, follow' }"),
        sections: z.array(z.record(z.unknown())).describe("Sections array for this locale. May be empty ([]) for a blank page."),
      })).describe("Map of locale code → { meta?, sections }. Must include at least one locale. E.g. { en: { meta: { page_title: 'ML Bootcamp | 4Geeks', description: '...', robots: 'index, follow' }, sections: [] } }"),
      site: z.string().optional().describe(SITE_PARAM_DESC),
    },
    async ({ contentType, slug, common, locales, site }) => {
      const siteResult = resolveSiteContext(site);
      if (!siteResult.ok) return fail(siteResult.error);
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
        return fail(`Content type '${contentType}' is database-backed and cannot be created via this tool.`);
      }

      if (mcpToken) {
        if (!await checkCap(mcpToken, "content_create_entry", contentType)) {
          return denyResponse("content_create_entry", contentType);
        }
      }

      const ctDir = getDirectory(contentType, config);
      const pageDir = path.join(contentPath, ctDir, slug);
      try { assertWithinBase(pageDir, contentPath); } catch (e) {
        return fail((e as Error).message);
      }
      if (fs.existsSync(pageDir)) {
        return fail(`Page '${slug}' already exists for contentType '${contentType}'.`);
      }

      for (const loc of localeKeys) {
        const lp = path.join(pageDir, `${loc}.yml`);
        try { assertWithinBase(lp, contentPath); } catch (e) {
          return fail((e as Error).message);
        }
      }

      fs.mkdirSync(pageDir, { recursive: true });

      const commonData: Record<string, unknown> = { slug, ...common };
      fs.writeFileSync(path.join(pageDir, "_common.yml"), safeDump(commonData), "utf-8");

      const createdLocales: string[] = [];
      for (const [loc, localeContent] of Object.entries(locales)) {
        const localeData: Record<string, unknown> = {
          slug,
          sections: localeContent.sections,
          ...(localeContent.meta && Object.keys(localeContent.meta).length > 0 ? { meta: localeContent.meta } : {}),
        };
        fs.writeFileSync(path.join(pageDir, `${loc}.yml`), safeDump(localeData), "utf-8");
        createdLocales.push(loc);
      }

      const commonRelPath = `${contentFolder}/${ctDir}/${slug}/_common.yml`;
      const localeRelPaths = createdLocales.map(loc => `${contentFolder}/${ctDir}/${slug}/${loc}.yml`);
      const allPaths = [commonRelPath, ...localeRelPaths];
      const commitMsg = `Create page ${contentType}/${slug}`;
      const [commitResults] = await Promise.all([
        Promise.all(allPaths.map(p => callCommitFileApi(p, commitMsg, mcpToken, domain))),
        callRefreshCacheApi(contentType, domain),
      ]);

      const commitShas = commitResults.map(r => r.commitSha).filter(Boolean) as string[];
      const commitWarnings = commitResults.map(r => r.warning).filter(Boolean) as string[];

      const urlPattern = config.url_pattern;
      let urls: Record<string, string> | undefined;
      if (urlPattern) {
        const resolvedUrls: Record<string, string> = {};
        for (const loc of createdLocales) {
          if (urlPattern["default"]) {
            resolvedUrls[loc] = urlPattern["default"].replace(":slug", slug);
          } else if (urlPattern[loc]) {
            resolvedUrls[loc] = urlPattern[loc].replace(":slug", slug);
          }
        }
        if (Object.keys(resolvedUrls).length > 0) urls = resolvedUrls;
      }

      const warnings: McpWarning[] = commitWarnings.map(w => ({ code: "github_commit_failed", message: w }));
      const side_effects: McpSideEffect[] = [];
      const next_actions: NextAction[] = [];
      if (isSharedLayoutConfig(config) || config.single_template) {
        warnings.push(CREATE_PAGE_SHARED_LAYOUT_WARNING);
        const primaryLocale = createdLocales[0] ?? "en";
        side_effects.push(sharedTemplateBlastSideEffect(contentType, primaryLocale));
        next_actions.push({
          tool: "get_page_content",
          priority: "recommended",
          reason: "Shared-layout entry inherits structure from single.{locale}.yml — re-read merged content before editing sections.",
          args_hint: { contentType, slug, locale: primaryLocale },
        });
      }

      return ok(
        {
          slug,
          contentType,
          directory: `${contentFolder}/${ctDir}/${slug}`,
          locales: createdLocales,
          ...(common.title ? { title: common.title } : {}),
          ...(urls ? { urls } : {}),
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
    "IMPORTANT — article / TOC: Before adding a second (or later) article on a page, ask the user whether articles should share one table of contents. " +
    "If yes, set the same toc_group on every article (e.g. group_123456789), with show_toc: true on every member so each piece shows the same merged TOC. " +
    "Call get_component_schema/get_component_variant for article, or explain_site topic 'sections'. " +
    "If you add an article without grouping while others already exist, the response may include warning article_toc_group_suggested.\n\n" +
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
      if (!siteResult.ok) return fail(siteResult.error);
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

      // Snapshot sections before write (for article toc_group hints).
      let existingSections: Array<Record<string, unknown>> = [];
      if (fs.existsSync(pathInfo.filePath)) {
        const before = safeLoad(fs.readFileSync(pathInfo.filePath, "utf-8")) || {};
        if (Array.isArray(before.sections)) {
          existingSections = before.sections as Array<Record<string, unknown>>;
        }
      }

      const operation: Record<string, unknown> = {
        action: "add_item",
        path: "sections",
        item: section,
      };
      if (index !== undefined) {
        operation.index = index;
      }

      const apiResult = await callEditSectionsApi(
        {
          contentType: resolved.contentType,
          slug,
          locale,
          variant,
          layoutTarget,
          operations: [operation],
        },
        mcpToken,
        domain,
      );
      if ("error" in apiResult) return apiResult.error;

      const warnings: McpWarning[] = [ADD_SECTION_NO_BINDING_FANOUT, ...variantWarningsIfNeeded(variant)];
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
          argsHintBase: { section, index, confirm_live_edit: true },
          reasonPrefix: "Shared layout section was added.",
        });
        side_effects = env.side_effects;
        next_actions = env.next_actions;
      }

      const articleHints = hintsAfterAddArticle({
        existingSections,
        newSection: section as Record<string, unknown>,
        insertIndex: index,
        slug,
        locale,
      });
      warnings.push(...articleHints.warnings);
      next_actions = [...next_actions, ...articleHints.next_actions];

      return ok(
        {
          message: `Section of type '${section.type as string}' added to ${pathInfo.relativeHint}`,
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
      if (!siteResult.ok) return fail(siteResult.error);
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
      if (!siteResult.ok) return fail(siteResult.error);
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

  // replace_page_sections
  mcp.tool(
    "replace_page_sections",
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
      if (!siteResult.ok) return fail(siteResult.error);
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
        tool: "replace_page_sections",
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
        tool: "replace_page_sections",
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
          intendedChange: { action: "replace_page_sections", sectionsCount: sections.length, ...(meta ? { meta } : {}) },
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
          tool: "replace_page_sections",
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
    "  • Safe top-level fields: 'title', 'slug' → locale file\n\n" +
    "What the caller must supply: a non-empty updates array with valid field_path strings and values. " +
    "What the server handles: routing, conflict detection per file, atomic write(s), cache refresh, Git mark-modified.\n\n" +
    "Possible errors: invalid/disallowed field_path, page/locale not found, remote conflict " +
    "(returns remoteContent + intendedContent), permission denied.\n\n" +
    "IMPORTANT — versioning safety: If the page has active variants (a versioning.yml exists), " +
    "you MUST ask the user before calling this tool: " +
    "'Do you want to edit the live version directly, or create a new draft variant first?' " +
    "To edit the live version directly pass confirm_live_edit: true. " +
    "To edit a variant, call create_variant first and pass the returned slug as the 'variant' parameter here.",
    {
      slug: z.string().describe("Page slug"),
      locale: z.string().default("en").describe("Locale code, e.g. 'en' or 'es'"),
      updates: z.array(z.object({
        field_path: z.string().describe("Dot-notation path, e.g. 'sections.0.title', 'meta.description', 'title'"),
        value: z.unknown().describe("New value for the field"),
      })).min(1).describe("Array of { field_path, value } updates. Minimum 1. Applied atomically to the target file(s)."),
      contentType: z.string().optional().describe("Content type hint (e.g. 'page', 'program'). Omit to auto-detect from slug."),
      variant: z.string().optional().describe("Variant slug to write to (e.g. 'draft-v2'). Writes to {variantSlug}.{locale}.yml instead of the live locale file. Does not affect _common.yml routing."),
      confirm_live_edit: z.boolean().optional().describe("Set to true to confirm you want to overwrite the live locale file directly when a versioning.yml exists. Required when no 'variant' is supplied and the page has active variants."),
      layout_target: layoutTargetSchema,
      confirm_layout_target: confirmLayoutTargetSchema,
      site: z.string().optional().describe(SITE_PARAM_DESC),
    },
    async ({ slug, locale, updates, contentType, variant, confirm_live_edit, layout_target, confirm_layout_target, site }) => {
      const siteResult = resolveSiteContext(site);
      if (!siteResult.ok) return fail(siteResult.error);
      const { contentPath, contentFolder, domain } = siteResult;
      try {
        assertSafeSegment(slug, "slug");
        assertSafeLocale(locale);
        if (contentType) assertSafeSegment(contentType, "contentType");
        if (variant) assertSafeSegment(variant, "variant");
      } catch (e) {
        return fail((e as Error).message);
      }

      const badPaths = updates.filter(u =>
        !u.field_path.startsWith("sections.") &&
        !u.field_path.startsWith("meta.") &&
        !SAFE_TOP_LEVEL_FIELDS.has(u.field_path)
      );
      if (badPaths.length > 0) {
        return fail(`Disallowed field_path(s): ${badPaths.map(u => u.field_path).join(", ")}. Must start with 'sections.', 'meta.', or be one of: ${[...SAFE_TOP_LEVEL_FIELDS].join(", ")}.`);
      }

      const resolved = resolveContentType(slug, contentType, contentPath, { allowSharedLayout: true });
      if (!resolved) {
        return fail(`Page not found for slug '${slug}'${contentType ? ` (contentType: ${contentType})` : ""}`);
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

  // translate_page
  mcp.tool(
    "translate_page",
    "Write (or overwrite) a target-locale YAML file for an existing page with a fully-translated payload. " +
    "Does NOT perform AI translation — the caller must supply the translated content. " +
    "Use this to create a new locale or refresh an existing translation in one call rather than N field updates.\n\n" +
    "What the caller must supply: source_locale (used only for existence validation), target_locale, " +
    "and a content object with at minimum a 'sections' array. " +
    "A 'meta' block is recommended (page_title, description, etc.).\n\n" +
    "What the server handles: validates the slug and source locale exist, path-sanitisation, " +
    "conflict detection if the target locale file already exists, writes the target locale file " +
    "(creates if missing, overwrites if present), cache refresh, and Git mark-modified.\n\n" +
    "Possible errors: slug not found, source locale not found, path traversal detected, " +
    "remote conflict on existing target locale (returns remoteContent + intendedContent for manual merge), " +
    "permission denied.",
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
      if (!siteResult.ok) return fail(siteResult.error);
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

      const ctDir = getDirectory(resolved.contentType, resolved.config);
      const dir = path.join(contentPath, ctDir, slug);

      const sourceFilePath = path.join(dir, `${source_locale}.yml`);
      try { assertWithinBase(sourceFilePath, contentPath); } catch (e) {
        return fail((e as Error).message);
      }
      if (!fs.existsSync(sourceFilePath)) {
        return fail(`Source locale '${source_locale}' not found for page '${slug}' (expected: ${resolved.contentType}/${slug}/${source_locale}.yml)`);
      }

      const targetFileName = `${target_locale}.yml`;
      const targetFilePath = path.join(dir, targetFileName);
      try { assertWithinBase(targetFilePath, contentPath); } catch (e) {
        return fail((e as Error).message);
      }

      const targetRelPath = `${contentFolder}/${ctDir}/${slug}/${targetFileName}`;

      const localeData: Record<string, unknown> = { slug, sections: content.sections };
      if (content.meta && Object.keys(content.meta).length > 0) {
        localeData.meta = content.meta;
      }
      const intendedContent = safeDump(localeData);

      if (fs.existsSync(targetFilePath)) {
        const conflictCheck = await checkRemoteConflict(targetRelPath, domain);
        if (conflictCheck.conflict) {
          return conflictError({
            relativePath: targetRelPath,
            remoteContent: conflictCheck.remoteContent,
            intendedContent,
            intendedChange: { action: "translate_page", source_locale, target_locale },
          });
        }
      }

      const isNew = !fs.existsSync(targetFilePath);
      fs.writeFileSync(targetFilePath, intendedContent, "utf-8");

      const commitMsg = `Translate ${resolved.contentType}/${slug} to ${target_locale}`;
      const [commitResult] = await Promise.all([
        callCommitFileApi(targetRelPath, commitMsg, mcpToken, domain),
        callRefreshCacheApi(resolved.contentType, domain),
      ]);

      const warnings: McpWarning[] = [];
      if (commitResult.warning) {
        warnings.push({ code: "github_commit_failed", message: commitResult.warning });
      }

      return ok(
        {
          message: `Translated content ${isNew ? "created" : "updated"} at ${resolved.contentType}/${slug}/${targetFileName}`,
          slug,
          contentType: resolved.contentType,
          source_locale,
          target_locale,
          created: isNew,
          sectionsCount: content.sections.length,
          metaKeys: content.meta ? Object.keys(content.meta) : [],
          ...(commitResult.commitSha ? { commitSha: commitResult.commitSha } : {}),
          ...wrotePayload({
            layer: "entry_locale",
            contentType: resolved.contentType,
            path: `${ctDir}/${slug}/${targetFileName}`,
            locale: target_locale,
            slug,
          }),
        },
        { warnings, next_actions: [] },
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
      if (!siteResult.ok) return fail(siteResult.error);
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

  // list_seo
  mcp.tool(
    "list_seo",
    "Return SEO-relevant fields (meta, title, schema, url) for all pages — both YAML-driven (pages, programs, landings, etc.) and DB-backed (blog, etc.). " +
    "For DB-backed types, template variables like {{ single.title }} are fully resolved against each entry's data via the main server. " +
    "Sections and full content are never returned. " +
    "Optional filters: contentType (e.g. 'blog'), locale (e.g. 'en'), slugs (specific list).",
    {
      contentType: z.string().optional().describe("Restrict to one content type, e.g. 'blog' or 'program'"),
      locale: z.string().optional().describe("Restrict to one locale, e.g. 'en' or 'es'"),
      slugs: z.array(z.string()).optional().describe("Restrict to specific slugs"),
      site: z.string().optional().describe(SITE_PARAM_DESC),
    },
    async ({ contentType, locale, slugs, site }) => {
      const siteResult = resolveSiteContext(site);
      if (!siteResult.ok) return { content: [{ type: "text", text: siteResult.error }], isError: true };
      const { contentPath, domain } = siteResult;
      try {
        const configs = loadContentTypes(contentPath);
        const results: unknown[] = [];

        // Route all content types through the main server's seo-entries endpoint,
        // which handles both YAML (global variable resolution) and DB-backed
        // (single.* template resolution + overrides) in one place.
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

        // Sort: contentType → slug → locale
        (results as Array<Record<string, unknown>>).sort((a, b) => {
          const ct = String(a.contentType ?? "").localeCompare(String(b.contentType ?? ""));
          if (ct !== 0) return ct;
          const sl = String(a.slug ?? "").localeCompare(String(b.slug ?? ""));
          if (sl !== 0) return sl;
          return String(a.locale ?? "").localeCompare(String(b.locale ?? ""));
        });

        return { content: [{ type: "text", text: JSON.stringify({ count: results.length, entries: results }, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: String(err) }], isError: true };
      }
    }
  );
}
