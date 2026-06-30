import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { storage } from "../storage";
import { geoGet, geoSet } from "../geo-cache";
import { getQueueStats, enqueueOptimization, getPendingOptimizations, getFailedEntries, retryFailedImages, resetOptimizeSession, getOptimizeSession, enqueueExternalImage } from "../image-registry";
import { getAllQueueState } from "../image-queue-state";


import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";
import { execSync as _execSync, execFile } from "child_process";
import {
  versioningUpdateSchema,
  type CareerProgram,
  type LandingPage,
  type LocationPage,
  type TemplatePage,
} from "@shared/schema";
import {
  getSitemap,
  clearSitemapCache,
  getSitemapCacheStatus,
  getSitemapUrls,
  invalidateSitemapEntry,
  invalidateSitemapEntriesByContentKey,
  refreshSitemapEntry,
  refreshSitemapEntriesForContentKey,
} from "../sitemap";
import { markFileAsModified } from "../sync-state";
import { resetSiteConfigs } from "../site-config";
import { resetSiteContextMap } from "../site-manager";
import { deepMerge } from "../utils/deepMerge";
import { regenerateSectionIds } from "../utils/regenerateSectionIds";
import { databaseManager, DatabaseManager } from "../database";

function getDB(res: import("express").Response): DatabaseManager {
  return (res.locals.site as import("../site-manager").SiteContext)?.database ?? databaseManager;
}
import {
  redirectMiddleware,
  getRedirects,
  clearRedirectCache,
  testRedirect,
} from "../redirects";
import {
  getSchema,
  getMergedSchemas,
  getAvailableSchemaKeys,
  clearSchemaCache,
  getOrganizationTwitterHandle,
  getOrganizationSameAsUrl,
  getWebsiteDefaultSocialImage,
  updateWebsiteDefaultSocialImage,
  updateOrganizationTwitterHandle,
  updateOrganizationSameAsUrl,
} from "../schema-org";
import {
  getRegistryOverview,
  getComponentInfo,
  listVersions,
  loadSchema,
  loadExamples,
  createNewVersion,
  getExampleFilePath,
  saveExample,
  createExample,
  loadAllFieldEditors,
  applyComponentSectionDefaults,
  applyComponentImageSizes,
  getVariantByExample,
  getVariantExamples,
  deleteExample,
  deleteVariant,
} from "../component-registry";
import {
  editContent,
  editCommonContent,
  getContentForEdit,
  createContentEntry,
  deleteContentEntry,
  renameContentSlug,
} from "../content-editor";
import { bindingManager } from "../bindings";
import {
  escapeTemplateVars,
  escapeObjectVars,
  unescapeObjectVars,
  unescapeYamlDump,
} from "@shared/templateVars";
import {
  getVersioningManager,
  readUserId,
  getVersioningCookie,
  setVersioningCookie,
  buildUserContext,
} from "../versioning";
import { mediaGallery } from "../media-gallery";
import { media } from "../media";
import multer from "multer";
import { contentIndex, type ContentType } from "../content-index";
import { runScan as runComponentInsightsScan, readInsightsFile, suggestNext as suggestNextComponent, getComponentUsageData } from "../component-insights";
import { validateFieldSource, validateFieldMapping, extractByDotPath } from "../../scripts/validation/shared/fieldMappingValidator";
import {
  getFolder,
  getType,
  isValidType,
  getAllTypes,
  getAllFolders,
  getAllConfigs,
  getDatabaseName,
  getFieldMapping,
  getLookupKey,
  getLocaleKey,
  getLocaleDefault,
  getIndexes,
  hasDatabaseSingle,
  getContentTypeConfig,
  updateContentTypeConfig,
  addContentType,
  getDatabaseConfig,
  getLabel,
  normalizeUrlPattern,
  getLocaleSource,
  resolveContentTypeUrl,
  getLayout,
  resolveLayout,
  listAvailableMenus,
  getDirectory,
} from "../content-types";
import { resolveFieldValue, applyTransformIfNeeded } from "../transform";
import { resolveSingleVars } from "../single-resolver";
import {
  normalizeLocale,
  getSupportedLocales,
  getDefaultLocale,
  getLocaleEntries,
  updateLocaleSettings,
  getHomePage,
  getOptimizationSettings,
  updateOptimizationSettings,
} from "../settings";
import { variableManager } from "../variable-manager";
import { getValidationService } from "../../scripts/validation/service";
import { getCanonicalUrl, normalizeUrl } from "../../scripts/validation/shared/canonicalUrls";
import {
  isNonLocalFilesystemSrc,
  buildRegistrySrcToIdMap,
  resolveRegistryReference,
} from "../../scripts/validation/shared/imageRegistrySrc";
import type { ProgressEvent } from "../../scripts/validation/fixers/types";
import { gcs } from "../gcs";
import { z } from "zod";
import {
  generateSsrSchemaHtml,
  generateDatabaseSsrHtml,
  generateListingSsrHtml,
  clearSsrSchemaCache,
  loadRawYaml,
  resolveFaqItems,
  buildFaqPageSchema,
  resolvePageRobots,
  type FaqSection,
} from "../ssr-schema";
import {
  fetchMarkdownContent,
  clearMarkdownCache,
  clearMarkdownCacheByUrl,
} from "../markdown";
import { resolveDynamicEntries } from "../dynamic-entries";
import { loadDatabaseSinglePage, mergeSingleTemplate } from "../database-single-loader";
import { getBaseUrl } from "../hreflang";
import * as userManager from "../user-manager";
import * as userStore from "../user-store";
import type { CapabilityName } from "../user-store";


import {

  BREATHECODE_HOST,
  extractToken,
  requireCapability,
  safeYamlLoad,
  safeYamlDump,
  resolveVariantAssignment,
  invalidateContentCaches,
  createValidationFixRun,
  appendValidationRunLog,
  applyFixerProgress,
  resolveFixerPipeline,
  validationRuns,
  validationRunOrder,
  MAX_VALIDATION_RUNS,
  MAX_RUN_LOG_ENTRIES,
  careerProgramsListingSchema,
  loadCareerProgramsListing,
  applyMetaFallback,
  injectCanonicalIfMissing,
  loadCareerProgram,
  listCareerPrograms,
  loadLandingPage,
  listLandingPages,
  loadLocationPage,
  listLocationPages,
  loadTemplatePage,
  buildSingleEntryFromContent,
  listTemplatePages,
  detectLanguageFromRequest,
  ValidationFixRunState,
  ValidationFixRunLogEntry,
  FixerItemStatus,
} from "./_helpers";
import { child } from "../logger";
import { sqlite } from "../db";
const log = child({ module: "routes/admin" });

/** Returns the per-site ContentIndex for this request, falling back to the global singleton in single-site mode. */
function getCI(res: Response): typeof contentIndex {
  return (res.locals.site as any)?.contentIndex ?? contentIndex;
}

function getContentRoot(res: Response): string {
  return (res.locals.site as any)?.contentRoot ?? path.join(process.cwd(), process.env.CONTENT_FOLDER || "default-site-content");
}

function getContentRootName(res: Response): string {
  return (res.locals.site as any)?.contentRootName ?? (process.env.CONTENT_FOLDER || "default-site-content");
}

/** Return the per-site ConversationStore for the current request, falling back to the default singleton. */
async function getConversationStore(res: Response) {
  const site = (res.locals.site as import("../site-manager").SiteContext | undefined);
  if (site?.conversationStore) return site.conversationStore;
  const { conversationStore } = await import("../ai/ConversationStore");
  return conversationStore;
}

/** Load llm.yml from the per-site content root for this request. Falls back gracefully when not present. */
function loadSiteLLMConfig(res: Response): Record<string, unknown> {
  try {
    const llmPath = path.join(getContentRoot(res), "llm.yml");
    if (fs.existsSync(llmPath)) {
      const raw = yaml.load(fs.readFileSync(llmPath, "utf-8"));
      if (raw && typeof raw === "object") return raw as Record<string, unknown>;
    }
  } catch { /* ignore */ }
  return {};
}

export function registerAdminRoutes(app: Express): void {
  // GCS bucket status — migrationRequired flag + bucket name
  app.get("/api/admin/gcs-status", (_req, res) => {
    const { gcs } = require("../gcs") as typeof import("../gcs");
    res.json({
      migrationRequired: gcs.migrationRequired,
      bucketName: gcs.getBucketName() || null,
      available: gcs.available,
    });
  });

  // Clear sitemap cache (requires token validation)
  app.post("/api/debug/clear-sitemap-cache", async (req, res) => {
    try {
      const auth = await requireCapability(req, res, "seo_edit");
      if (!auth.authorized) return;

      const result = clearSitemapCache();
      res.json(result);
    } catch (error) {
      log.error({ err: error }, "Error clearing sitemap cache:");
      res.status(500).json({ error: "Failed to clear cache" });
    }
  });

  // Clear page-level cache for a specific URL
  app.post("/api/debug/clear-page-cache", async (req, res) => {
    try {
      const authHeader = req.headers.authorization;
      const token = authHeader?.replace("Token ", "");
      const isDevelopment = process.env.NODE_ENV !== "production";

      if (!isDevelopment && !token) {
        res.status(401).json({ error: "Authorization required" });
        return;
      }

      if (!isDevelopment && token) {
        const response = await fetch(
          `${BREATHECODE_HOST}/v1/auth/user/me/capability/webmaster`,
          {
            method: "GET",
            headers: {
              Authorization: `Token ${token}`,
              Academy: "4",
            },
          },
        );
        if (response.status !== 200) {
          res.status(403).json({ error: "Invalid or unauthorized token" });
          return;
        }
      }

      const { url } = req.body as { url?: string };
      if (!url) {
        res.status(400).json({ error: "Missing 'url' in request body" });
        return;
      }

      let urlPath: string;
      try {
        urlPath = new URL(url).pathname;
      } catch {
        urlPath = url;
      }

      // Use content index URL parsing for reliable type+slug resolution
      let resolved = getCI(res).parseContentUrl(urlPath);

      // Fall back to home page for root/locale-only paths like /, /en, /es
      if (!resolved) {
        const LOCALE_ONLY = new Set(["/", "/en", "/es", "/en/", "/es/"]);
        const isLocaleOnly = LOCALE_ONLY.has(urlPath) || /^\/[a-z]{2}\/?$/.test(urlPath);
        if (isLocaleOnly) {
          const homePage = getHomePage();
          if (homePage?.type && homePage?.slug) {
            resolved = { contentType: homePage.type, slug: homePage.slug, locale: "en" };
          }
        }
      }

      if (resolved) {
        invalidateContentCaches(resolved.contentType);
        if (resolved.slug) {
          clearMarkdownCache(resolved.slug);
        }
      }

      res.json({ success: true, message: `Cache refreshed for ${urlPath}` });
    } catch (error) {
      log.error({ err: error }, "Error clearing page cache:");
      res.status(500).json({ error: "Failed to clear page cache" });
    }
  });

  // Get active redirects (for debug tools)
  app.get("/api/debug/redirects", (req, res) => {
    const ci = getCI(res);
    const isSiteSpecific = ci.contentRoot !== contentIndex.contentRoot;
    if (isSiteSpecific) {
      const siteEntries = ci.getRedirects();
      const redirects = siteEntries.map(e => ({
        from: e.from,
        to: e.to,
        type: e.type || "redirect",
        status: e.status || 301,
        source: e.source || ci.contentRoot,
        priority: e.priority,
      }));
      res.json({ count: redirects.length, redirects });
    } else {
      const redirects = getRedirects();
      res.json({ count: redirects.length, redirects });
    }
  });

  app.get("/api/locale-urls", (req, res) => {
    try {
      const url = req.query.url as string;
      if (!url) {
        res.status(400).json({ error: "Missing 'url' query parameter" });
        return;
      }

      const parsed = getCI(res).parseContentUrl(url);
      if (!parsed) {
        res
          .status(400)
          .json({ error: "Could not determine content type from URL" });
        return;
      }

      const baseSlug = getCI(res).resolveBaseSlug(
        parsed.slug,
        parsed.contentType,
      );
      const urls = getCI(res).getLocaleUrls(baseSlug, parsed.contentType);
      res.json({ urls, contentType: parsed.contentType, slug: baseSlug });
    } catch (err) {
      log.error({ err: err }, "[API] Failed to resolve locale URLs:");
      res.status(500).json({ error: "Failed to resolve locale URLs" });
    }
  });

  app.get("/api/debug/redirects/locale-urls", (req, res) => {
    try {
      const url = req.query.url as string;
      if (!url) {
        res.status(400).json({ error: "Missing 'url' query parameter" });
        return;
      }

      const parsed = getCI(res).parseContentUrl(url);
      if (!parsed) {
        res
          .status(400)
          .json({ error: "Could not determine content type from URL" });
        return;
      }

      const baseSlug = getCI(res).resolveBaseSlug(
        parsed.slug,
        parsed.contentType,
      );
      const urls = getCI(res).getLocaleUrls(baseSlug, parsed.contentType);
      res.json({ urls, contentType: parsed.contentType, slug: baseSlug });
    } catch (err) {
      log.error({ err: err }, "[Debug] Failed to resolve locale URLs:");
      res.status(500).json({ error: "Failed to resolve locale URLs" });
    }
  });

  // Add a new redirect (for debug tools)
  app.post("/api/debug/redirects", (req, res) => {
    try {
      const {
        from,
        to,
        allLanguages,
        status: redirectStatus,
        isCustomDestination,
        priority: redirectPriority,
        author,
      } = req.body;
      const authorName = author && typeof author === "string" ? author : undefined;
      const statusCode =
        redirectStatus && [301, 302].includes(redirectStatus)
          ? redirectStatus
          : 301;
      const priority = redirectPriority === "fallback" ? "fallback" : "before";

      if (!from || !to) {
        res
          .status(400)
          .json({ error: "Both 'from' and 'to' fields are required" });
        return;
      }

      let normalizedFrom = (from as string).startsWith("/")
        ? (from as string)
        : `/${from}`;
      normalizedFrom = normalizedFrom.toLowerCase();
      if (normalizedFrom.length > 1 && normalizedFrom.endsWith("/")) {
        normalizedFrom = normalizedFrom.slice(0, -1);
      }

      const destUrl = to as string;

      if (isCustomDestination) {
        const customFilePath = path.join(
          getContentRoot(res),
          "custom-redirects.yml",
        );

        let parsed: {
          redirects: Array<{
            from: string;
            to: string;
            status?: number;
            priority?: string;
          }>;
        } = { redirects: [] };
        if (fs.existsSync(customFilePath)) {
          const raw = fs.readFileSync(customFilePath, "utf-8");
          const loaded = safeYamlLoad(raw) as { redirects?: unknown[] } | null;
          if (loaded && Array.isArray(loaded.redirects)) {
            parsed.redirects = loaded.redirects as Array<{
              from: string;
              to: string;
              status?: number;
              priority?: string;
            }>;
          }
        }

        if (
          parsed.redirects.some((r) => r.from?.toLowerCase() === normalizedFrom)
        ) {
          res.status(409).json({
            error: `Redirect "${normalizedFrom}" already exists in custom-redirects.yml`,
          });
          return;
        }

        const newEntry: {
          from: string;
          to: string;
          status?: number;
          priority?: string;
        } = { from: normalizedFrom, to: destUrl };
        if (statusCode !== 301) {
          newEntry.status = statusCode;
        }
        if (priority === "fallback") {
          newEntry.priority = "fallback";
        }
        parsed.redirects.push(newEntry);

        const yamlContent = safeYamlDump(parsed, {
          lineWidth: -1,
          noRefs: true,
        });
        fs.writeFileSync(customFilePath, yamlContent, "utf-8");
        markFileAsModified(customFilePath, authorName);

        getCI(res).scan();
        clearRedirectCache();

        res.json({
          success: true,
          message: `Custom redirect added: ${normalizedFrom} -> ${destUrl}`,
          file: `${getContentRootName(res)}/custom-redirects.yml`,
        });
        return;
      }

      // Parse destination URL to find the content entry
      const parsed = getCI(res).parseContentUrl(destUrl);
      if (!parsed) {
        res.status(400).json({
          error: "Could not determine content type from destination URL",
        });
        return;
      }

      const { contentType, locale } = parsed;
      const resolvedSlug = getCI(res).resolveBaseSlug(
        parsed.slug,
        contentType,
      );
      const entries = getCI(res).findBySlug(resolvedSlug, { contentType });
      if (entries.length === 0) {
        res.status(404).json({
          error: `No content found for slug "${parsed.slug}" in ${contentType}`,
        });
        return;
      }

      const entry = entries[0];
      const basePath = path.join(process.cwd(), entry.directory);

      let targetFile: string;
      if (allLanguages) {
        targetFile = "_common.yml";
      } else {
        targetFile = `${locale}.yml`;
      }

      const filePath = path.join(basePath, targetFile);

      let yamlData: Record<string, unknown> = {};
      if (fs.existsSync(filePath)) {
        const raw = fs.readFileSync(filePath, "utf-8");
        yamlData = (safeYamlLoad(raw) as Record<string, unknown>) || {};
      }

      if (!yamlData.meta || typeof yamlData.meta !== "object") {
        yamlData.meta = {};
      }
      const meta = yamlData.meta as Record<string, unknown>;
      if (!Array.isArray(meta.redirects)) {
        meta.redirects = [];
      }
      const redirects = meta.redirects as unknown[];

      const existingPath = (r: unknown) => {
        if (typeof r === "string") return r.toLowerCase();
        if (typeof r === "object" && r !== null && "path" in r)
          return (r as { path: string }).path.toLowerCase();
        return "";
      };

      if (redirects.some((r) => existingPath(r) === normalizedFrom)) {
        res.status(409).json({
          error: `Redirect "${normalizedFrom}" already exists in ${targetFile}`,
        });
        return;
      }

      if (statusCode !== 301) {
        redirects.push({ path: normalizedFrom, status: statusCode });
      } else {
        redirects.push(normalizedFrom);
      }

      const yamlContent = safeYamlDump(yamlData, {
        lineWidth: -1,
        noRefs: true,
      });
      fs.writeFileSync(filePath, yamlContent, "utf-8");
      markFileAsModified(filePath, authorName);

      getCI(res).scan();
      clearRedirectCache();

      res.json({
        success: true,
        message: `Redirect added: ${normalizedFrom} -> ${destUrl}`,
        file: `${entry.directory}/${targetFile}`,
      });
    } catch (err) {
      log.error({ err: err }, "[Debug] Failed to add redirect:");
      res.status(500).json({ error: "Failed to add redirect" });
    }
  });

  // Delete a redirect (for debug tools)
  app.delete("/api/debug/redirects", (req, res) => {
    try {
      const { from, source, author } = req.body;
      const authorName = author && typeof author === "string" ? author : undefined;

      if (!from || !source) {
        res
          .status(400)
          .json({ error: "Both 'from' and 'source' fields are required" });
        return;
      }

      let normalizedFrom = (from as string).startsWith("/")
        ? (from as string)
        : `/${from}`;
      normalizedFrom = normalizedFrom.toLowerCase();
      if (normalizedFrom.length > 1 && normalizedFrom.endsWith("/")) {
        normalizedFrom = normalizedFrom.slice(0, -1);
      }

      const sourceFile = source as string;

      const resolvedSource = path.resolve(process.cwd(), sourceFile);
      const marketingDir = path.resolve(getContentRoot(res));
      if (
        !resolvedSource.startsWith(marketingDir + path.sep) &&
        resolvedSource !== marketingDir
      ) {
        res.status(400).json({ error: "Invalid source file path" });
        return;
      }
      if (!sourceFile.endsWith(".yml") && !sourceFile.endsWith(".yaml")) {
        res.status(400).json({ error: "Invalid source file type" });
        return;
      }

      if (sourceFile === `${path.basename(getContentRoot(res))}/custom-redirects.yml`) {
        const customFilePath = path.join(
          getContentRoot(res),
          "custom-redirects.yml",
        );

        if (!fs.existsSync(customFilePath)) {
          res.status(404).json({ error: "Custom redirects file not found" });
          return;
        }

        const raw = fs.readFileSync(customFilePath, "utf-8");
        const loaded = safeYamlLoad(raw) as {
          redirects?: Array<{ from: string; to: string; status?: number }>;
        } | null;

        if (!loaded || !Array.isArray(loaded.redirects)) {
          res
            .status(404)
            .json({ error: "No redirects found in custom redirects file" });
          return;
        }

        const originalLength = loaded.redirects.length;
        loaded.redirects = loaded.redirects.filter((r) => {
          let rFrom = r.from?.startsWith("/") ? r.from : `/${r.from}`;
          rFrom = rFrom.toLowerCase();
          if (rFrom.length > 1 && rFrom.endsWith("/"))
            rFrom = rFrom.slice(0, -1);
          return rFrom !== normalizedFrom;
        });

        if (loaded.redirects.length === originalLength) {
          res.status(404).json({
            error: `Redirect "${normalizedFrom}" not found in custom-redirects.yml`,
          });
          return;
        }

        const yamlContent = safeYamlDump(loaded, {
          lineWidth: -1,
          noRefs: true,
        });
        fs.writeFileSync(customFilePath, yamlContent, "utf-8");
        markFileAsModified(customFilePath, authorName);

        getCI(res).scan();
        clearRedirectCache();

        res.json({
          success: true,
          message: `Custom redirect "${normalizedFrom}" deleted`,
        });
        return;
      }

      const filePath = path.join(process.cwd(), sourceFile);

      if (!fs.existsSync(filePath)) {
        res
          .status(404)
          .json({ error: `Source file "${sourceFile}" not found` });
        return;
      }

      const raw = fs.readFileSync(filePath, "utf-8");
      const parsed = (safeYamlLoad(raw) as Record<string, unknown>) || {};

      const meta = parsed.meta as Record<string, unknown> | undefined;
      if (!meta || !Array.isArray(meta.redirects)) {
        res
          .status(404)
          .json({ error: `No redirects found in "${sourceFile}"` });
        return;
      }

      const redirects = meta.redirects as unknown[];
      const originalLength = redirects.length;

      const getRedirectPath = (r: unknown): string => {
        if (typeof r === "string") {
          let p = r.startsWith("/") ? r : `/${r}`;
          p = p.toLowerCase();
          if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
          return p;
        }
        if (typeof r === "object" && r !== null && "path" in r) {
          let p = (r as { path: string }).path;
          p = p.startsWith("/") ? p : `/${p}`;
          p = p.toLowerCase();
          if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
          return p;
        }
        return "";
      };

      meta.redirects = redirects.filter(
        (r) => getRedirectPath(r) !== normalizedFrom,
      );

      if ((meta.redirects as unknown[]).length === originalLength) {
        res.status(404).json({
          error: `Redirect "${normalizedFrom}" not found in "${sourceFile}"`,
        });
        return;
      }

      const yamlContent = safeYamlDump(parsed, { lineWidth: -1, noRefs: true });
      fs.writeFileSync(filePath, yamlContent, "utf-8");
      markFileAsModified(filePath, authorName);

      getCI(res).scan();
      clearRedirectCache();

      res.json({
        success: true,
        message: `Redirect "${normalizedFrom}" deleted from "${sourceFile}"`,
      });
    } catch (err) {
      log.error({ err: err }, "[Debug] Failed to delete redirect:");
      res.status(500).json({ error: "Failed to delete redirect" });
    }
  });

  app.patch("/api/debug/redirects/reorder", (req, res) => {
    try {
      const { redirects, author } = req.body;
      const authorName = author && typeof author === "string" ? author : undefined;

      if (!Array.isArray(redirects)) {
        res.status(400).json({
          error: "'redirects' must be an array of {from, to, status?} entries",
        });
        return;
      }

      for (const entry of redirects) {
        if (!entry || typeof entry !== "object" || !entry.from || !entry.to) {
          res
            .status(400)
            .json({ error: "Each redirect must have 'from' and 'to' fields" });
          return;
        }
      }

      const customFilePath = path.join(
        getContentRoot(res),
        "custom-redirects.yml",
      );

      const newEntries = redirects.map(
        (r: {
          from: string;
          to: string;
          status?: number;
          priority?: string;
        }) => {
          const entry: {
            from: string;
            to: string;
            status?: number;
            priority?: string;
          } = { from: r.from, to: r.to };
          if (r.status && r.status !== 301) entry.status = r.status;
          if (r.priority === "fallback") entry.priority = "fallback";
          return entry;
        },
      );

      const yamlContent = safeYamlDump(
        { redirects: newEntries },
        { lineWidth: -1, noRefs: true },
      );
      fs.writeFileSync(customFilePath, yamlContent, "utf-8");
      markFileAsModified(customFilePath, authorName);

      getCI(res).scan();
      clearRedirectCache();

      res.json({
        success: true,
        message: `Custom redirects reordered (${newEntries.length} entries)`,
      });
    } catch (err) {
      log.error({ err: err }, "[Debug] Failed to reorder redirects:");
      res.status(500).json({ error: "Failed to reorder redirects" });
    }
  });

  app.get("/api/debug/redirects/test", async (req, res) => {
    const url = req.query.url as string;
    if (!url) {
      res.status(400).json({ error: "Missing 'url' query parameter" });
      return;
    }
    const locale = (req.query.locale as string) || getDefaultLocale();
    const result = testRedirect(url, locale);

    if (result.match && result.resolvedTo) {
      const resolved = getCI(res).resolveUrl(result.resolvedTo);
      if (!resolved) {
        result.destinationExists = false;
      } else if (resolved.fromDatabase) {
        try {
          const items = await getDB(res).fetchMappedItems(
            resolved.contentType,
          );
          const exists = items.some(
            (item) => String(item.slug) === resolved.slug,
          );
          result.destinationExists = exists;
        } catch {
          result.destinationExists = false;
        }
      } else {
        result.destinationExists = true;
      }
    }

    res.json(result);
  });

  app.patch("/api/debug/redirects/priority", (req, res) => {
    try {
      const { from, priority, author } = req.body;
      const authorName = author && typeof author === "string" ? author : undefined;

      if (!from || typeof from !== "string") {
        res.status(400).json({ error: "'from' is required" });
        return;
      }

      if (priority !== "before" && priority !== "fallback") {
        res
          .status(400)
          .json({ error: "'priority' must be 'before' or 'fallback'" });
        return;
      }

      const customFilePath = path.join(
        getContentRoot(res),
        "custom-redirects.yml",
      );

      if (!fs.existsSync(customFilePath)) {
        res.status(404).json({ error: "custom-redirects.yml not found" });
        return;
      }

      const raw = fs.readFileSync(customFilePath, "utf-8");
      const parsed = yaml.load(raw) as { redirects?: any[] } | null;
      const entries = parsed?.redirects || [];

      const entry = entries.find((r: any) => r.from === from);
      if (!entry) {
        res
          .status(404)
          .json({ error: "Redirect not found in custom-redirects.yml" });
        return;
      }

      if (priority === "fallback") {
        entry.priority = "fallback";
      } else {
        delete entry.priority;
      }

      const yamlContent = safeYamlDump(
        { redirects: entries },
        { lineWidth: -1, noRefs: true },
      );
      fs.writeFileSync(customFilePath, yamlContent, "utf-8");
      markFileAsModified(customFilePath, authorName);

      getCI(res).scan();
      clearRedirectCache();

      res.json({
        success: true,
        priority: priority === "fallback" ? "fallback" : "before",
      });
    } catch (err) {
      log.error({ err: err }, "[Debug] Failed to update redirect priority:");
      res.status(500).json({ error: "Failed to update redirect priority" });
    }
  });

  // Clear redirect cache (for debug tools)
  app.post("/api/debug/clear-redirect-cache", (req, res) => {
    clearRedirectCache();
    res.json({ success: true, message: "Redirect cache cleared" });
  });

  app.get("/api/admin/brand-settings", async (req, res) => {
    const auth = await requireCapability(req, res, "seo_edit");
    if (!auth.authorized) return;
    try {
      const schemaPath = path.join(getContentRoot(res), "schema-org.yml");
      let sameAs: string[] = [];
      if (fs.existsSync(schemaPath)) {
        try {
          const raw = fs.readFileSync(schemaPath, "utf-8");
          const parsed = yaml.load(raw) as Record<string, unknown>;
          const org = parsed?.organization as Record<string, unknown> | undefined;
          if (Array.isArray(org?.same_as)) sameAs = org.same_as as string[];
        } catch {}
      }

      const knownDomains = ["twitter.com/", "x.com/", "linkedin.com/", "facebook.com/", "youtube.com/", "instagram.com/", "github.com/"];
      const unknownSameAs = sameAs.filter(
        (u) => typeof u === "string" && !knownDomains.some((d) => u.includes(d))
      );

      const cr = getContentRoot(res);
      res.json({
        default_social_image: getWebsiteDefaultSocialImage(cr) ?? "",
        twitter_handle: getOrganizationTwitterHandle(cr) ?? "",
        linkedin: getOrganizationSameAsUrl("linkedin", cr) ?? "",
        facebook: getOrganizationSameAsUrl("facebook", cr) ?? "",
        youtube: getOrganizationSameAsUrl("youtube", cr) ?? "",
        instagram: getOrganizationSameAsUrl("instagram", cr) ?? "",
        github: getOrganizationSameAsUrl("github", cr) ?? "",
        unknown_same_as: unknownSameAs,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || String(err) });
    }
  });

  app.put("/api/admin/brand-settings", async (req, res) => {
    const auth = await requireCapability(req, res, "seo_edit");
    if (!auth.authorized) return;
    try {
      const { default_social_image, twitter_handle, linkedin, facebook, youtube, instagram, github } = req.body;

      if (default_social_image !== undefined) {
        if (typeof default_social_image !== "string") {
          res.status(400).json({ error: "default_social_image must be a string" });
          return;
        }
        updateWebsiteDefaultSocialImage(default_social_image.trim());
      }

      if (twitter_handle !== undefined) {
        if (typeof twitter_handle !== "string") {
          res.status(400).json({ error: "twitter_handle must be a string" });
          return;
        }
        updateOrganizationTwitterHandle(twitter_handle.trim());
      }

      const SOCIAL_DOMAINS: Record<string, string> = {
        linkedin: "linkedin.com",
        facebook: "facebook.com",
        youtube: "youtube.com",
        instagram: "instagram.com",
        github: "github.com",
      };

      for (const [platform, value] of [
        ["linkedin", linkedin],
        ["facebook", facebook],
        ["youtube", youtube],
        ["instagram", instagram],
        ["github", github],
      ] as [string, unknown][]) {
        if (value !== undefined) {
          if (typeof value !== "string") {
            res.status(400).json({ error: `${platform} must be a string` });
            return;
          }
          const trimmed = value.trim();
          if (trimmed) {
            let parsed: URL;
            try {
              parsed = new URL(trimmed);
            } catch {
              res.status(400).json({ error: `${platform}: not a valid URL` });
              return;
            }
            if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
              res.status(400).json({ error: `${platform}: URL must start with https://` });
              return;
            }
            const expectedDomain = SOCIAL_DOMAINS[platform];
            if (expectedDomain && !parsed.hostname.endsWith(expectedDomain)) {
              res.status(400).json({ error: `${platform}: URL does not appear to belong to ${expectedDomain}` });
              return;
            }
          }
          updateOrganizationSameAsUrl(platform, trimmed);
        }
      }

      clearSsrSchemaCache();
      const cr2 = getContentRoot(res);
      res.json({
        success: true,
        default_social_image: getWebsiteDefaultSocialImage(cr2) ?? "",
        twitter_handle: getOrganizationTwitterHandle(cr2) ?? "",
        linkedin: getOrganizationSameAsUrl("linkedin", cr2) ?? "",
        facebook: getOrganizationSameAsUrl("facebook", cr2) ?? "",
        youtube: getOrganizationSameAsUrl("youtube", cr2) ?? "",
        instagram: getOrganizationSameAsUrl("instagram", cr2) ?? "",
        github: getOrganizationSameAsUrl("github", cr2) ?? "",
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || String(err) });
    }
  });

  // Lighthouse / PageSpeed Insights API
  // ============================================

  app.get("/api/admin/lighthouse/config", (_req, res) => {
    res.json({
      hasSiteUrl: !!process.env.SITE_URL,
      hasApiKey: !!process.env.GOOGLE_PSI_API_KEY,
      gcsAvailable: gcs.available,
    });
  });

  app.get("/api/admin/lighthouse/pages", async (_req, res) => {
    const siteBaseUrl = process.env.SITE_URL?.replace(/\/$/, "");
    if (!siteBaseUrl) {
      res.status(400).json({ error: "SITE_URL is not set" });
      return;
    }
    try {
      const service = getValidationService();
      let context = service.getContext();
      if (!context) {
        context = await service.buildContext();
      }
      const seen = new Set<string>();
      const pages: { slug: string; url: string; title: string; priority: number; type: string }[] = [];
      for (const file of context.contentFiles) {
        if (file.locale !== "en") continue;
        const canonicalPath = getCanonicalUrl(file);
        if (canonicalPath.startsWith("/private")) continue;
        const fullUrl = file.meta?.canonical_url
          ? file.meta.canonical_url
          : `${siteBaseUrl}${canonicalPath}`;
        if (seen.has(fullUrl)) continue;
        seen.add(fullUrl);
        pages.push({
          slug: file.slug,
          url: fullUrl,
          title: file.title || file.slug,
          priority: file.meta?.priority ?? 0.5,
          type: file.type,
        });
      }
      pages.sort((a, b) => b.priority - a.priority);
      res.json(pages);
    } catch (err) {
      log.error({ err: err }, "[Lighthouse] pages error:");
      res.status(500).json({ error: "Failed to load pages" });
    }
  });

  app.get("/api/admin/lighthouse/reports", async (_req, res) => {
    try {
      if (!gcs.available) {
        res.json({ runs: [], latestRun: null });
        return;
      }
      const keys: string[] = await gcs.list("reports/lighthouse/");
      const dateSet = new Set<string>();
      for (const key of keys) {
        const m = key.match(/^reports\/lighthouse\/(\d{4}-\d{2}-\d{2})\//);
        if (m) dateSet.add(m[1]);
      }
      const dates = Array.from(dateSet).sort().reverse().slice(0, 5);
      const runs: { date: string; pageCount: number; avgPerformanceScore: number; worstPage: { slug: string; score: number } | null }[] = [];
      for (const date of dates) {
        try {
          const buf: Buffer | null = await gcs.download(`reports/lighthouse/${date}/_summary.json`);
          if (!buf) continue;
          const pages = JSON.parse(buf.toString()) as { slug: string; performanceScore: number }[];
          if (!Array.isArray(pages) || pages.length === 0) continue;
          const avgPerformanceScore = Math.round(
            pages.reduce((s, p) => s + p.performanceScore, 0) / pages.length
          );
          const worstPage = pages[0] ? { slug: pages[0].slug, score: pages[0].performanceScore } : null;
          runs.push({ date, pageCount: pages.length, avgPerformanceScore, worstPage });
        } catch {
          /* skip bad runs */
        }
      }
      res.json({ runs, latestRun: runs[0]?.date ?? null });
    } catch (err) {
      log.error({ err: err }, "[Lighthouse] reports error:");
      res.json({ runs: [], latestRun: null });
    }
  });

  app.get("/api/admin/lighthouse/reports/:date", async (req, res) => {
    try {
      const { date } = req.params;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        res.status(400).json({ error: "Invalid date format" });
        return;
      }
      if (!gcs.available) {
        res.status(404).json({ error: "GCS not available" });
        return;
      }
      const buf: Buffer | null = await gcs.download(`reports/lighthouse/${date}/_summary.json`);
      if (!buf) {
        res.status(404).json({ error: "Report not found" });
        return;
      }
      const pages = JSON.parse(buf.toString());
      res.json(pages);
    } catch (err) {
      log.error({ err: err }, "[Lighthouse] report date error:");
      res.status(500).json({ error: "Failed to load report" });
    }
  });

  app.post("/api/admin/lighthouse/run", async (req, res) => {
    req.setTimeout(180_000);
    try {
      const siteBaseUrl = process.env.SITE_URL?.replace(/\/$/, "");
      if (!siteBaseUrl) {
        res.status(400).json({ error: "SITE_URL is not set" });
        return;
      }
      const apiKey = process.env.GOOGLE_PSI_API_KEY;

      const rawUrls = req.body?.urls;
      if (rawUrls !== undefined && rawUrls !== null) {
        if (!Array.isArray(rawUrls) || rawUrls.some((u: unknown) => typeof u !== "string")) {
          res.status(400).json({ error: "urls must be an array of strings" });
          return;
        }
      }
      let urlList: string[] = Array.isArray(rawUrls) ? (rawUrls as string[]) : [];
      if (!gcs.available) {
        res.status(503).json({ error: "GCS is not configured — reports cannot be persisted" });
        return;
      }

      if (!urlList.length) {
        const service = getValidationService();
        let context = service.getContext();
        if (!context) context = await service.buildContext();
        const seen = new Set<string>();
        for (const file of context.contentFiles) {
          if (file.locale !== "en") continue;
          const canonicalPath = getCanonicalUrl(file);
          if (canonicalPath.startsWith("/private")) continue;
          const fullUrl = file.meta?.canonical_url
            ? file.meta.canonical_url
            : `${siteBaseUrl}${canonicalPath}`;
          if (seen.has(fullUrl)) continue;
          seen.add(fullUrl);
          urlList.push(fullUrl);
        }
      }

      const { auditUrl, buildPageReport, safeReportFilename } = await import(
        "../scripts/validation/validators/lighthouse"
      );
      type PageReport = Awaited<ReturnType<typeof buildPageReport>>;

      const d = new Date();
      const dateDir = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
      const gcsPrefix = `reports/lighthouse/${dateDir}`;

      function sleep(ms: number): Promise<void> {
        return new Promise((r) => setTimeout(r, ms));
      }

      const pages: PageReport[] = [];

      for (let i = 0; i < urlList.length; i++) {
        const url = urlList[i];
        if (i > 0) await sleep(500);

        try {
          const slug = url.replace(siteBaseUrl, "").replace(/^\//, "").replace(/\//g, "--") || "home";
          const data = await auditUrl(url, apiKey);
          const report = buildPageReport(url, slug, data);

          const filename = safeReportFilename(slug, url);
          await gcs.upload(
            `${gcsPrefix}/${filename}`,
            Buffer.from(JSON.stringify(report, null, 2)),
            "application/json",
            { cacheControl: "no-store" }
          );
          pages.push(report);
        } catch {
          /* non-fatal — skip this page */
        }
      }

      const sorted = [...pages].sort((a, b) => a.performanceScore - b.performanceScore);
      await gcs.upload(
        `${gcsPrefix}/_summary.json`,
        Buffer.from(JSON.stringify(sorted, null, 2)),
        "application/json",
        { cacheControl: "no-store" }
      );

      const avgPerformanceScore = pages.length
        ? Math.round(pages.reduce((s, p) => s + p.performanceScore, 0) / pages.length)
        : 0;

      res.json({ date: dateDir, pageCount: pages.length, avgPerformanceScore });
    } catch (err) {
      log.error({ err: err }, "[Lighthouse] run error:");
      res.status(500).json({ error: "Audit failed", message: String(err) });
    }
  });


  app.get("/api/admin/ai/tool-definitions", async (req, res) => {
    try {
      const auth = await requireAdminAuth(req, res);
      if (!auth.authorized) return;

      const { TOOL_DEFINITIONS } = await import("../ai/tools/index");
      const definitions = TOOL_DEFINITIONS.map(t => ({
        name: t.function.name,
        description: t.function.description,
        parameters: t.function.parameters,
      }));
      res.json({ tools: definitions });
    } catch (err) {
      log.error({ err: err }, "[AI Tool Definitions] Error:");
      res.status(500).json({ error: "Failed to load tool definitions" });
    }
  });

  app.get("/api/admin/ai/question-tags", async (req, res) => {
    try {
      const auth = await requireAdminAuth(req, res);
      if (!auth.authorized) return;

      const llmConfig = loadSiteLLMConfig(res);
      res.json({ question_tags: llmConfig.question_tags || [] });
    } catch (err) {
      log.error({ err: err }, "[AI Question Tags] Error:");
      res.status(500).json({ error: "Failed to load question tags" });
    }
  });

  // ============================================
  // AI Admin Routes (webmaster capability required)
  // ============================================
  app.get("/api/admin/ai/knowledge", async (req, res) => {
    try {
      const auth = await requireAdminAuth(req, res);
      if (!auth.authorized) return;

      const conversationStore = await getConversationStore(res);
      const knowledge = await conversationStore.getAllKnowledge();

      const llmConfig = loadSiteLLMConfig(res);

      const modelDefault = typeof llmConfig.model === "object" ? (llmConfig.model as Record<string, string>)?.default || "" : (llmConfig.model as string) || "";
      const modelChat = typeof llmConfig.model === "object" ? llmConfig.model?.chat || "" : "";

      res.json({
        system_prompt: knowledge.system_prompt || null,
        prompt_role: knowledge.prompt_role || llmConfig.prompt_role || "",
        prompt_personality: knowledge.prompt_personality || llmConfig.prompt_personality || "",
        prompt_instructions: knowledge.prompt_instructions || llmConfig.prompt_instructions || "",
        prompt_fallback: knowledge.prompt_fallback || llmConfig.prompt_fallback || "",
        custom_knowledge: knowledge.custom_knowledge || [],
        pinned_qa: knowledge.pinned_qa || [],
        agent_tools: llmConfig.agent_tools || [],
        chat_bubble: llmConfig.chat_bubble || {},
        question_tags: llmConfig.question_tags || [],
        empty_conversation_grace_minutes: llmConfig.empty_conversation_grace_minutes ?? 15,
        model_default: modelDefault,
        model_chat: modelChat,
      });
    } catch (err) {
      log.error({ err: err }, "[AI Knowledge GET] Error:");
      res.status(500).json({ error: "Failed to load knowledge" });
    }
  });

  app.post("/api/admin/ai/knowledge", async (req, res) => {
    try {
      const auth = await requireAdminAuth(req, res);
      if (!auth.authorized) return;

      const conversationStore = await getConversationStore(res);
      const { key, value, updated_by } = req.body || {};

      if (!key || value === undefined) {
        return res.status(400).json({ error: "key and value are required" });
      }

      await conversationStore.setKnowledge(key, value, updated_by);
      res.json({ success: true });
    } catch (err) {
      log.error({ err: err }, "[AI Knowledge POST] Error:");
      res.status(500).json({ error: "Failed to save knowledge" });
    }
  });

  app.patch("/api/admin/ai/knowledge", async (req, res) => {
    try {
      const auth = await requireAdminAuth(req, res);
      if (!auth.authorized) return;

      const conversationStore = await getConversationStore(res);
      const updates = req.body || {};

      for (const [key, value] of Object.entries(updates)) {
        if (key === "updated_by" || key === "empty_conversation_grace_minutes" || key === "model_default" || key === "model_chat") continue;
        await conversationStore.setKnowledge(key, value, updates.updated_by);
      }

      if (updates.empty_conversation_grace_minutes !== undefined) {
        const raw = Number(updates.empty_conversation_grace_minutes);
        if (!Number.isFinite(raw) || !Number.isInteger(raw) || raw < 1) {
          return res.status(400).json({ error: "empty_conversation_grace_minutes must be a positive integer" });
        }
        updates.empty_conversation_grace_minutes = raw;
      }

      const hasLlmUpdates = updates.agent_tools || updates.chat_bubble || updates.empty_conversation_grace_minutes !== undefined || updates.model_default !== undefined || updates.model_chat !== undefined;
      if (hasLlmUpdates) {
        const llmPath = path.join(getContentRoot(res), "llm.yml");
        if (fs.existsSync(llmPath)) {
          const llmConfig = loadSiteLLMConfig(res);
          const mutableConfig: Record<string, unknown> = { ...llmConfig };
          if (updates.agent_tools) mutableConfig.agent_tools = updates.agent_tools;
          if (updates.chat_bubble) mutableConfig.chat_bubble = updates.chat_bubble;
          if (updates.empty_conversation_grace_minutes !== undefined) mutableConfig.empty_conversation_grace_minutes = updates.empty_conversation_grace_minutes;
          if (updates.model_default !== undefined || updates.model_chat !== undefined) {
            const existing = typeof mutableConfig.model === "object" && mutableConfig.model !== null
              ? mutableConfig.model as Record<string, string>
              : { default: typeof mutableConfig.model === "string" ? mutableConfig.model : "" };
            const modelObj: Record<string, string> = { ...existing };
            if (updates.model_default !== undefined) modelObj.default = updates.model_default;
            if (updates.model_chat !== undefined) modelObj.chat = updates.model_chat;
            if (!modelObj.chat) delete modelObj.chat;
            mutableConfig.model = modelObj;
          }
          fs.writeFileSync(llmPath, yaml.dump(mutableConfig, { lineWidth: -1 }), "utf-8");
        }

        const { getAgentService } = await import("../ai/AgentService");
        getAgentService().reload();
      }

      res.json({ success: true });
    } catch (err) {
      log.error({ err: err }, "[AI Knowledge PATCH] Error:");
      res.status(500).json({ error: "Failed to update knowledge" });
    }
  });

  app.get("/api/admin/ai/conversations", async (req, res) => {
    try {
      const auth = await requireAdminAuth(req, res);
      if (!auth.authorized) return;

      const conversationStore = await getConversationStore(res);
      const filters = {
        page: Number(req.query.page) || 1,
        limit: Number(req.query.limit) || 20,
        dateFrom: req.query.dateFrom as string | undefined,
        dateTo: req.query.dateTo as string | undefined,
        pageUrl: req.query.pageUrl as string | undefined,
        featureTag: req.query.featureTag as string | undefined,
        questionTag: req.query.questionTag as string | undefined,
        rating: req.query.rating as string | undefined,
      };

      const result = await conversationStore.listConversations(filters);
      res.json(result);
    } catch (err) {
      log.error({ err: err }, "[AI Conversations GET] Error:");
      res.status(500).json({ error: "Failed to load conversations" });
    }
  });

  app.patch("/api/admin/ai/conversations/:id/messages/:msgId", async (req, res) => {
    try {
      const auth = await requireAdminAuth(req, res);
      if (!auth.authorized) return;

      let raterName = "admin";
      if (auth.token) {
        try {
          const meResponse = await fetch(
            `${BREATHECODE_HOST}/v1/auth/user/me`,
            { method: "GET", headers: { Authorization: `Token ${auth.token}` } }
          );
          if (meResponse.ok) {
            const meData = await meResponse.json() as Record<string, string>;
            raterName = meData.first_name || meData.email || "admin";
          }
        } catch {}
      }

      const conversationStore = await getConversationStore(res);
      const { rating, override_content } = req.body || {};

      let msg = null;
      if (rating) {
        msg = await conversationStore.rateMessage(req.params.msgId, rating, raterName);
      }
      if (override_content !== undefined) {
        msg = await conversationStore.overrideMessage(req.params.msgId, override_content, raterName);
      }

      if (!msg) {
        return res.status(404).json({ error: "Message not found" });
      }

      res.json(msg);
    } catch (err) {
      log.error({ err: err }, "[AI Message PATCH] Error:");
      res.status(500).json({ error: "Failed to update message" });
    }
  });

  app.post("/api/admin/ai/conversations/cluster", async (req, res) => {
    try {
      const auth = await requireAdminAuth(req, res);
      if (!auth.authorized) return;

      const { getAgentService } = await import("../ai/AgentService");
      const conversationStore = await getConversationStore(res);

      const recentMessages = await conversationStore.getRecentUserMessages(200);

      const llmConfig = loadSiteLLMConfig(res);
      const tags = llmConfig.question_tags || [];

      const agent = getAgentService();
      const clusters = await agent.clusterQuestions(recentMessages, tags);

      res.json({ clusters, total_questions: recentMessages.length });
    } catch (err) {
      log.error({ err: err }, "[AI Cluster] Error:");
      res.status(500).json({ error: "Failed to cluster questions" });
    }
  });

  app.post("/api/admin/ai/knowledge/preview", async (req, res) => {
    try {
      const auth = await requireAdminAuth(req, res);
      if (!auth.authorized) return;

      const { getAgentService } = await import("../ai/AgentService");
      const { contentCompiler } = await import("../ai/ContentCompiler");

      const { question, url, content_type, content_slug, locale } = req.body || {};

      if (!question) {
        return res.status(400).json({ error: "question is required" });
      }

      let derivedContentType = content_type || null;
      let derivedContentSlug = content_slug || null;
      let derivedLocale = locale || "en";

      if (url && !content_type && !content_slug) {
        const programEnMatch = (url as string).match(/\/en\/career-programs\/([^/?#]+)/);
        const programEsMatch = (url as string).match(/\/es\/programas-de-carrera\/([^/?#]+)/);
        const locationEnMatch = (url as string).match(/\/en\/location\/([^/?#]+)/);
        const locationEsMatch = (url as string).match(/\/es\/ubicacion\/([^/?#]+)/);
        const localeMatch = (url as string).match(/\/(en|es)\//);

        if (programEnMatch) { derivedContentType = "program"; derivedContentSlug = programEnMatch[1]; derivedLocale = "en"; }
        else if (programEsMatch) { derivedContentType = "program"; derivedContentSlug = programEsMatch[1]; derivedLocale = "es"; }
        else if (locationEnMatch) { derivedContentType = "location"; derivedContentSlug = locationEnMatch[1]; derivedLocale = "en"; }
        else if (locationEsMatch) { derivedContentType = "location"; derivedContentSlug = locationEsMatch[1]; derivedLocale = "es"; }
        else if (localeMatch) { derivedLocale = localeMatch[1]; }
      }

      const compiled = contentCompiler.compile(derivedContentType, derivedContentSlug, derivedLocale);

      const agent = getAgentService();
      const response = await agent.processMessage(
        "preview-" + Date.now(),
        question,
        derivedContentType,
        derivedContentSlug,
        derivedLocale
      );

      res.json({
        context: compiled,
        response: response.content,
        question_tag: response.questionTag,
      });
    } catch (err) {
      log.error({ err: err }, "[AI Preview] Error:");
      res.status(500).json({ error: "Failed to generate preview" });
    }
  });

  // ============================================================
  // Component Co-occurrence & Ordering Insights
  // ============================================================
  app.post("/api/private/component-insights/rebuild", (_req, res) => {
    try {
      const data = runComponentInsightsScan();
      res.json(data);
    } catch (err) {
      log.error({ err: err }, "[ComponentInsights] Rebuild failed:");
      res.status(500).json({ error: "Rebuild failed", details: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get("/api/private/component-insights", (_req, res) => {
    try {
      const data = readInsightsFile();
      if (!data) {
        return res.status(404).json({ error: "Insights not yet generated. POST /api/private/component-insights/rebuild to generate." });
      }
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: "Failed to read insights", details: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get("/api/private/component-insights/suggest", (req, res) => {
    try {
      const after = typeof req.query.after === "string" ? req.query.after : "";
      const intent = typeof req.query.intent === "string" && req.query.intent !== "__global__" ? req.query.intent : undefined;
      const rankBy = req.query.rankBy === "pmi" ? "pmi" : "frequency";

      if (!after) {
        // No preceding section — derive starting suggestions from topSequences
        const data = readInsightsFile();
        if (!data) return res.json([]);

        const FALLBACK_MIN = 3;
        const cluster =
          intent && data.byIntent[intent] && data.byIntent[intent].pageCount >= FALLBACK_MIN
            ? data.byIntent[intent]
            : data.global;

        const startCountMap = new Map<string, number>();
        for (const seq of cluster.topSequences) {
          if (seq.sequence.length > 0) {
            const first = seq.sequence[0];
            startCountMap.set(first, (startCountMap.get(first) ?? 0) + seq.count);
          }
        }

        const total = Array.from(startCountMap.values()).reduce((s, v) => s + v, 0) || 1;
        const results = Array.from(startCountMap.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 8)
          .map(([type, count]) => ({
            from: "__start__",
            to: type,
            count,
            frequency: Math.round((count / total) * 1000) / 1000,
            pmi: 0,
            distance: 1,
          }));

        return res.json(results);
      }

      const suggestions = suggestNextComponent(after, intent, rankBy);
      res.json(suggestions);
    } catch (err) {
      res.status(500).json({ error: "Failed to get suggestions", details: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get("/api/private/component-insights/component/:type", (req, res) => {
    try {
      const componentType = req.params.type;
      const intent = typeof req.query.intent === "string" && req.query.intent ? req.query.intent : undefined;
      const contentType = typeof req.query.contentType === "string" && req.query.contentType ? req.query.contentType : undefined;

      if (!intent && !contentType) {
        const data = readInsightsFile() ?? runComponentInsightsScan();
        const configs = getAllConfigs();
        const availableContentTypes = Object.entries(configs)
          .filter(([, cfg]) => !(cfg as Record<string, unknown>).database)
          .map(([ct]) => ct);
        return res.status(400).json({
          error: "Either 'intent' or 'contentType' query param is required for scoped results.",
          availableIntents: data.meta.intents,
          availableContentTypes,
        });
      }

      const result = getComponentUsageData(componentType, { intent, contentType });
      res.json(result);
    } catch (err) {
      log.error({ err: err }, "[ComponentInsights] Component usage failed:");
      res.status(500).json({ error: "Failed to get component usage", details: err instanceof Error ? err.message : String(err) });
    }
  });

  app.use(async (req, res, next) => {
    const url = req.originalUrl || req.url;
    if (
      url.startsWith("/api/") ||
      url.startsWith("/attached_assets/") ||
      (() => { try { const { getSiteContextMap } = require("../site-manager") as typeof import("../site-manager"); return [...getSiteContextMap().values()].some(s => url.startsWith(`/${s.contentRootName}/`)); } catch { return url.startsWith(`/${process.env.CONTENT_FOLDER || "default-site-content"}/`); } })() ||
      /\.\w+$/.test(url)
    ) {
      return next();
    }

    let schemaHtml = "";

    const cleanUrl = url.split("?")[0].split("#")[0];
    const resolved = getCI(res).resolveUrl(cleanUrl);
    const isDatabaseRoute = resolved && resolved.fromDatabase;
    const listingResolved = !isDatabaseRoute
      ? getCI(res).resolveListingUrl(cleanUrl)
      : null;
    const isListingRoute = !!listingResolved;

    let robotsDirective = "index, follow";

    // Detect blog post URLs even when content-index can't resolve them (e.g. object-type category field)
    const blogUrlMatch = !isDatabaseRoute
      ? cleanUrl.match(/^\/(en|es)\/blog\/[^/]+\/([^/?#]+)$/)
      : null;

    if (isDatabaseRoute && resolved) {
      try {
        const posts = await getDB(res).fetchMappedItems(
          resolved.contentType,
        );
        const localeKey = getLocaleKey(resolved.contentType) || "lang";
        const locale =
          resolved.patternLocale && resolved.patternLocale !== "default"
            ? resolved.patternLocale
            : getDefaultLocale();
        const post =
          posts.find(
            (p) => p.slug === resolved.slug && (p as any)[localeKey] === locale,
          ) || posts.find((p) => p.slug === resolved.slug);
        if (post) {
          schemaHtml = generateDatabaseSsrHtml(
            resolved.contentType,
            post,
            locale,
            getCI(res),
            getContentRoot(res),
          );
          if (typeof (post as any).robots === "string") {
            robotsDirective = (post as any).robots;
          }
        }
      } catch (err) {
        log.error("[SSR-DB] Error generating schema for", url, err);
      }
    } else if (isListingRoute && listingResolved) {
      schemaHtml = generateListingSsrHtml(
        listingResolved.contentType,
        listingResolved.locale,
        getContentRoot(res),
      );
    } else if (blogUrlMatch) {
      try {
        const locale = blogUrlMatch[1];
        const slug = blogUrlMatch[2];
        const posts = await getDB(res).fetchMappedItems("blog");
        const localeKey = getLocaleKey("blog") || "lang";
        const post =
          posts.find((p) => p.slug === slug && (p as any)[localeKey] === locale) ||
          posts.find((p) => p.slug === slug);
        if (post) {
          schemaHtml = generateDatabaseSsrHtml("blog", post, locale, getCI(res), getContentRoot(res));
          if (typeof (post as any).robots === "string") {
            robotsDirective = (post as any).robots;
          }
        }
      } catch (err) {
        log.error("[SSR-Blog] Error generating schema for", url, err);
      }
    } else {
      schemaHtml = generateSsrSchemaHtml(url, getCI(res), getContentRoot(res));
      robotsDirective = resolvePageRobots(url, getCI(res), getContentRoot(res));
    }

    res.setHeader("X-Robots-Tag", robotsDirective);

    const isBlogRoute = isDatabaseRoute || isListingRoute || !!blogUrlMatch;
    if (!schemaHtml && !isBlogRoute) {
      return next();
    }

    if (schemaHtml) {
      req.ssrSchemaHtml = schemaHtml;
    }

    if (isBlogRoute) {
      const originalEnd = res.end.bind(res);
      res.end = function (chunk?: any, ...args: any[]) {
        const contentType = res.getHeader("content-type");
        if (
          contentType &&
          typeof contentType === "string" &&
          contentType.includes("text/html") &&
          res.statusCode === 404
        ) {
          res.statusCode = 200;
        }
        return originalEnd(chunk, ...args);
      } as typeof res.end;
    }

    next();
  });


  // ─── Admin: Roles & Users API ─────────────────────────────────────────────
  async function requireAdminAuth(
    req: Request,
    res: Response
  ): Promise<{ authorized: boolean; token?: string }> {
    const result = await requireCapability(req, res, "users_manage");
    return { authorized: result.authorized, token: result.token ?? undefined };
  }

  // ─── Admin: Roles API ────────────────────────────────────────────────────────

  app.get("/api/admin/roles", async (req, res) => {
    const auth = await requireCapability(req, res, "users_manage");
    if (!auth.authorized) return;
    res.json(userStore.getAllRoles());
  });

  function validateRoleCapabilities(capabilities: unknown): { ok: boolean; error?: string; valid?: import("../user-store").CapabilityGrant[] } {
    if (!Array.isArray(capabilities)) {
      return { ok: false, error: "capabilities must be an array" };
    }
    const knownContentTypes = getCI(res).getContentTypes();
    const valid: import("../user-store").CapabilityGrant[] = [];
    for (const cap of capabilities) {
      if (!cap || typeof cap.name !== "string") {
        return { ok: false, error: "Each capability must have a 'name' string field" };
      }
      if (!userStore.ALL_CAPABILITIES.includes(cap.name as import("../user-store").CapabilityName)) {
        return { ok: false, error: `Unknown capability: ${cap.name}` };
      }
      // Validate contentTypes if provided (must be "*", undefined, or an array of known content type IDs)
      const ct = cap.contentTypes;
      if (ct !== undefined && ct !== "*") {
        if (!Array.isArray(ct)) {
          return { ok: false, error: `contentTypes for '${cap.name}' must be "*" or an array of content type IDs` };
        }
        if (knownContentTypes.length > 0) {
          const unknownTypes = ct.filter((t: unknown) => typeof t === "string" && !knownContentTypes.includes(t));
          if (unknownTypes.length > 0) {
            return { ok: false, error: `Unknown content type(s) in '${cap.name}': ${unknownTypes.join(", ")}` };
          }
        }
      }
      valid.push({ name: cap.name as import("../user-store").CapabilityName, contentTypes: ct ?? undefined });
    }
    return { ok: true, valid };
  }

  app.post("/api/admin/roles", async (req, res) => {
    const auth = await requireCapability(req, res, "users_manage");
    if (!auth.authorized) return;
    const { id, label, description, capabilities } = req.body;
    if (!id || !label || !Array.isArray(capabilities)) {
      res.status(400).json({ error: "Missing required fields: id, label, capabilities" });
      return;
    }
    if (!/^[a-z][a-z0-9_-]*$/.test(id)) {
      res.status(400).json({ error: "Role id must be lowercase letters, numbers, hyphens, or underscores" });
      return;
    }
    const capCheck = validateRoleCapabilities(capabilities);
    if (!capCheck.ok) {
      res.status(400).json({ error: capCheck.error });
      return;
    }
    userStore.setRole(id, { label, description: description || undefined, capabilities: capCheck.valid! });
    res.json({ ok: true });
  });

  app.put("/api/admin/roles/:roleId", async (req, res) => {
    const auth = await requireCapability(req, res, "users_manage");
    if (!auth.authorized) return;
    const { roleId } = req.params;
    const { label, description, capabilities } = req.body;
    if (!label || !Array.isArray(capabilities)) {
      res.status(400).json({ error: "Missing required fields: label, capabilities" });
      return;
    }
    const capCheck = validateRoleCapabilities(capabilities);
    if (!capCheck.ok) {
      res.status(400).json({ error: capCheck.error });
      return;
    }
    // create-or-update semantics: PUT creates if not exists, updates if exists
    userStore.setRole(roleId, { label, description: description || undefined, capabilities: capCheck.valid! });
    res.json({ ok: true });
  });

  app.delete("/api/admin/roles/:roleId", async (req, res) => {
    const auth = await requireCapability(req, res, "users_manage");
    if (!auth.authorized) return;
    const result = userStore.deleteRole(req.params.roleId);
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }
    res.json({ ok: true });
  });

  // ─── Admin: Users API ────────────────────────────────────────────────────────

  app.get("/api/admin/users", async (req, res) => {
    const auth = await requireCapability(req, res, "users_manage");
    if (!auth.authorized) return;
    res.json(userStore.getAllUsers());
  });

  app.put("/api/admin/users/:username/roles", async (req, res) => {
    const auth = await requireCapability(req, res, "users_manage");
    if (!auth.authorized) return;
    const { username } = req.params;
    const { roles } = req.body;
    if (!Array.isArray(roles)) {
      res.status(400).json({ error: "roles must be an array of role ids" });
      return;
    }
    const allRoles = userStore.getAllRoles();
    const invalid = roles.filter((r: string) => !allRoles[r]);
    if (invalid.length > 0) {
      res.status(400).json({ error: `Unknown role(s): ${invalid.join(", ")}` });
      return;
    }
    userStore.assignRoles(username, roles);
    res.json({ ok: true });
  });

  app.patch("/api/admin/users/:username", async (req, res) => {
    const auth = await requireCapability(req, res, "users_manage");
    if (!auth.authorized) return;
    const { username } = req.params;
    const { username: newUsername } = req.body;
    if (!newUsername || typeof newUsername !== "string" || !newUsername.trim()) {
      res.status(400).json({ error: "username is required" });
      return;
    }
    const trimmed = newUsername.trim();
    if (trimmed === username) {
      res.status(400).json({ error: "New username is the same as the current username" });
      return;
    }
    if (auth.username && auth.username === username) {
      res.status(403).json({ error: "You cannot rename your own account" });
      return;
    }
    const result = userStore.renameUser(username, trimmed);
    if (!result.ok) {
      res.status(409).json({ error: result.error });
      return;
    }
    res.json({ ok: true });
  });

  app.delete("/api/admin/users/:username", async (req, res) => {
    const auth = await requireCapability(req, res, "users_manage");
    if (!auth.authorized) return;
    const result = userStore.deleteUser(req.params.username);
    if (!result.ok) {
      res.status(404).json({ error: result.error });
      return;
    }
    res.json({ ok: true });
  });

  app.get("/api/admin/pending-users", async (req, res) => {
    const auth = await requireCapability(req, res, "users_manage");
    if (!auth.authorized) return;
    res.json(userStore.getPendingUsers());
  });

  app.post("/api/admin/pending-users", async (req, res) => {
    const auth = await requireCapability(req, res, "users_manage");
    if (!auth.authorized) return;
    const { email, role } = req.body;
    if (!email || !role) {
      res.status(400).json({ error: "email and role are required" });
      return;
    }
    const result = userStore.addPendingUser(email, role);
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }
    res.json({ ok: true });
  });

  app.delete("/api/admin/pending-users/:email", async (req, res) => {
    const auth = await requireCapability(req, res, "users_manage");
    if (!auth.authorized) return;
    const email = decodeURIComponent(req.params.email);
    const result = userStore.removePendingUser(email);
    if (!result.ok) {
      res.status(404).json({ error: result.error });
      return;
    }
    res.json({ ok: true });
  });

  app.post("/api/admin/pending-users/:email/assign", async (req, res) => {
    const auth = await requireCapability(req, res, "users_manage");
    if (!auth.authorized) return;
    const email = decodeURIComponent(req.params.email);
    const { username } = req.body;
    if (!username) {
      res.status(400).json({ error: "username is required" });
      return;
    }
    const result = userStore.assignPendingToUser(email, username);
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }
    res.json({ ok: true });
  });

  app.get("/api/mcp/tools", async (_req, res) => {
    try {
      const mcpPort = process.env.MCP_PORT || "3001";
      const response = await fetch(`http://localhost:${mcpPort}/tools`);
      if (!response.ok) {
        res.status(502).json({ tools: [], error: "MCP server unavailable" });
        return;
      }
      const data = await response.json();
      res.json(data);
    } catch {
      res.status(502).json({ tools: [], error: "MCP server unavailable" });
    }
  });

  // Error & Warning Log dashboard endpoint
  app.get("/api/admin/error-log", async (req, res) => {
    const auth = await requireCapability(req, res, "webmaster");
    if (!auth.authorized) return;

    const levelParam = (req.query.level as string | undefined);
    const validLevel = levelParam === "error" || levelParam === "warn" ? levelParam : null;

    const cutoff = Date.now() - 48 * 60 * 60 * 1000;

    try {
      const levelFilter = validLevel ? " AND level = ?" : "";
      const args = validLevel ? [cutoff, validLevel] : [cutoff];

      const totals = sqlite.prepare(
        `SELECT
           SUM(CASE WHEN level = 'error' THEN 1 ELSE 0 END) AS totalErrors,
           SUM(CASE WHEN level = 'warn' THEN 1 ELSE 0 END) AS totalWarnings
         FROM error_log WHERE ts >= ?`
      ).get(cutoff) as { totalErrors: number; totalWarnings: number };

      const byModule = sqlite.prepare(
        `SELECT module,
                SUM(CASE WHEN level = 'error' THEN 1 ELSE 0 END) AS errors,
                SUM(CASE WHEN level = 'warn' THEN 1 ELSE 0 END) AS warnings
         FROM error_log
         WHERE ts >= ?${levelFilter}
         GROUP BY module
         ORDER BY (errors + warnings) DESC
         LIMIT 50`
      ).all(...args) as Array<{ module: string; errors: number; warnings: number }>;

      const topIssueRow = sqlite.prepare(
        `SELECT err_name, COUNT(*) AS cnt
         FROM error_log
         WHERE ts >= ? AND err_name IS NOT NULL${levelFilter}
         GROUP BY err_name
         ORDER BY cnt DESC
         LIMIT 1`
      ).get(...args) as { err_name: string; cnt: number } | undefined;

      const recent = sqlite.prepare(
        `SELECT id, ts, level, module, message, err_name
         FROM error_log
         WHERE ts >= ?${levelFilter}
         ORDER BY ts DESC
         LIMIT 100`
      ).all(...args) as Array<{
        id: number;
        ts: number;
        level: string;
        module: string;
        message: string;
        err_name: string | null;
      }>;

      res.json({
        totalErrors: totals?.totalErrors ?? 0,
        totalWarnings: totals?.totalWarnings ?? 0,
        byModule,
        topIssue: topIssueRow?.err_name ?? null,
        recent,
      });
    } catch (err) {
      log.error({ err }, "Failed to query error_log:");
      res.status(500).json({ error: "Failed to query error log" });
    }
  });

  // ============================================================
  // Site Manager — create new site scaffold
  // ============================================================
  app.post("/api/admin/sites/create", async (req, res) => {
    try {
      const auth = await requireCapability(req, res, "webmaster");
      if (!auth.authorized) return;

      const { name, domain, githubRepoUrl, includeSampleContent } = req.body as {
        name?: string;
        domain?: string;
        githubRepoUrl?: string;
        includeSampleContent?: boolean;
      };

      if (!name || typeof name !== "string") {
        return res.status(400).json({ error: "Missing required field: name" });
      }
      if (!domain || typeof domain !== "string") {
        return res.status(400).json({ error: "Missing required field: domain" });
      }

      // Validate name: only lowercase alphanumeric + hyphens, no path traversal
      if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) {
        return res.status(400).json({ error: "Folder name must be lowercase alphanumeric with hyphens only (e.g. my-site)" });
      }
      if (name.length > 64) {
        return res.status(400).json({ error: "Folder name too long (max 64 chars)" });
      }

      const folderName = `site_${name}`;
      const folderPath = path.join(process.cwd(), folderName);

      if (fs.existsSync(folderPath)) {
        return res.status(409).json({ error: `Folder "${folderName}" already exists` });
      }

      // Create directory structure
      fs.mkdirSync(folderPath, { recursive: true });
      fs.mkdirSync(path.join(folderPath, "images"), { recursive: true });
      fs.mkdirSync(path.join(folderPath, "menus"), { recursive: true });
      fs.mkdirSync(path.join(folderPath, "pages"), { recursive: true });

      // Write .gitkeep for images dir
      fs.writeFileSync(path.join(folderPath, "images", ".gitkeep"), "");

      // settings.yml
      const settingsYml = `# Site settings for ${folderName}\ni18n:\n  defaultLocale: en\n  locales:\n    - en\n`;
      fs.writeFileSync(path.join(folderPath, "settings.yml"), settingsYml);

      // content-types.yml
      const contentTypesYml = `# Content types for ${folderName}\npages:\n  label: Pages\n  folder: pages\n  url_pattern:\n    en: "/en/:slug"\n`;
      fs.writeFileSync(path.join(folderPath, "content-types.yml"), contentTypesYml);

      // image-registry.json
      fs.writeFileSync(path.join(folderPath, "image-registry.json"), JSON.stringify({ images: [], presets: [] }, null, 2));

      // custom-redirects.yml
      fs.writeFileSync(path.join(folderPath, "custom-redirects.yml"), "redirects: []\n");

      // menus/main-navbar.yml
      fs.writeFileSync(
        path.join(folderPath, "menus", "main-navbar.yml"),
        `logo:\n  text: "${name}"\n  url: /en\nlinks:\n  - label: Home\n    url: /en\n  - label: About\n    url: /en/about\n`,
      );

      // menus/main-footer.yml
      fs.writeFileSync(
        path.join(folderPath, "menus", "main-footer.yml"),
        `copyright: "© ${new Date().getFullYear()} ${name}. All rights reserved."\n`,
      );

      // pages/home.en.yml
      fs.writeFileSync(
        path.join(folderPath, "pages", "home.en.yml"),
        `meta:\n  title: "Welcome to ${name}"\n  description: "Home page for ${name}"\nsections:\n  - type: hero_single_column\n    title: "Welcome to ${name}"\n    subtitle: "Your new site is ready. Start editing this page to get started."\n    button_label: Get Started\n    button_url: /en/about\n`,
      );

      // Sample content (optional)
      if (includeSampleContent) {
        // pages/about.en.yml
        fs.writeFileSync(
          path.join(folderPath, "pages", "about.en.yml"),
          `meta:\n  title: "About - ${name}"\n  description: "Learn more about ${name}"\nsections:\n  - type: two_column_text\n    title: "About Us"\n    left_body: |\n      We are a team passionate about building great products.\n      This is the about page for ${name}.\n    right_body: |\n      Feel free to edit this page with your own content.\n      Replace images, update the text, and make it yours.\n`,
        );

        // blog/ directory
        fs.mkdirSync(path.join(folderPath, "blog"), { recursive: true });

        // blog/_common.single.yml
        fs.writeFileSync(
          path.join(folderPath, "blog", "_common.single.yml"),
          `sections:\n  - type: hero_single_column\n    title: "{{ single.title }}"\n    subtitle: "{{ single.excerpt }}"\n  - type: markdown_body\n    body: "{{ single.body }}"\n`,
        );

        // blog/sample-post.en.yml
        fs.writeFileSync(
          path.join(folderPath, "blog", "sample-post.en.yml"),
          `title: "Sample Blog Post"\nexcerpt: "This is a sample blog post to get you started."\nbody: |\n  ## Hello World\n\n  This is a sample blog post for **${name}**. You can edit or delete this file\n  and create your own posts in this folder.\n`,
        );
      }

      // Append to sites.yml
      const sitesYmlPath = path.join(process.cwd(), "sites.yml");
      let sitesContent = "";
      if (fs.existsSync(sitesYmlPath)) {
        sitesContent = fs.readFileSync(sitesYmlPath, "utf-8");
        if (!sitesContent.endsWith("\n")) sitesContent += "\n";
      }
      const newEntry = `${domain}:\n  content_folder: ${folderName}\n${githubRepoUrl ? `  github_repo_url: ${githubRepoUrl}\n` : ""}`;
      sitesContent += newEntry;
      fs.writeFileSync(sitesYmlPath, sitesContent);
      resetSiteConfigs();
      resetSiteContextMap();

      log.info(`[SiteManager] Created new site scaffold: ${folderName} for domain ${domain}`);

      res.json({ folderName, created: true });
    } catch (err) {
      log.error({ err }, "[SiteManager] Failed to create site:");
      res.status(500).json({ error: err instanceof Error ? err.message : "Failed to create site" });
    }
  });

}
