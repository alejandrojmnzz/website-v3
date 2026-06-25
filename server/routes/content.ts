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
import { deepMerge } from "../utils/deepMerge";
import { regenerateSectionIds } from "../utils/regenerateSectionIds";
import { databaseManager } from "../database";
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
import { runScan as runComponentInsightsScan, readInsightsFile, suggestNext as suggestNextComponent } from "../component-insights";
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
  deleteContentType,
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
const log = child({ module: "routes/content" });

/** Returns the per-site ContentIndex for this request, falling back to the global singleton in single-site mode. */
function getCI(res: Response): typeof contentIndex {
  return (res.locals.site as any)?.contentIndex ?? contentIndex;
}
function getContentRoot(res: Response): string {
  return (res.locals.site as any)?.contentRoot ?? path.join(process.cwd(), process.env.CONTENT_FOLDER || "default-site-content");
}
function getContentRootName(res: Response): string {
  const cr = getContentRoot(res);
  return path.isAbsolute(cr) ? path.relative(process.cwd(), cr) : cr;
}

export function registerContentRoutes(app: Express): void {
  app.get("/api/career-programs", (req, res) => {
    const locale = normalizeLocale(req.query.locale as string);
    const _location = req.query.location as string | undefined;
    const programs = listCareerPrograms(locale, getCI(res));
    res.json(programs);
  });

  app.get("/api/career-programs/:slug", async (req, res) => {
    const { slug } = req.params;
    const locale = normalizeLocale(req.query.locale as string);
    const forceVariant = req.query.force_variant as string | undefined;
    const forceVersion = req.query.force_version
      ? parseInt(req.query.force_version as string, 10)
      : undefined;

    let program: CareerProgram | null = null;

    // If force_variant is provided, load that variant directly (for preview)
    if (forceVariant) {
      const versioningManager = getVersioningManager();
      const forcedContent = versioningManager.getVariantContent("program", slug, forceVariant, locale);
      if (forcedContent) {
        program = forcedContent as unknown as CareerProgram;
      }
    }

    // Normal versioning flow if not forcing a variant
    if (!program) {
      const assigned = resolveVariantAssignment(req, res, "program", slug, locale);
      if (assigned) {
        program = assigned as unknown as CareerProgram;
      }
    }

    // Fall back to default content
    if (!program) {
      program = loadCareerProgram(slug, locale, getCI(res));
    }

    if (!program) {
      res.status(404).json({ error: "Career program not found" });
      return;
    }

    const programData = program as unknown as Record<string, unknown>;
    if (Array.isArray(programData.sections)) {
      programData.sections = await resolveDynamicEntries(programData.sections, locale) as any;
    }
    const programRaw = getCI(res).loadMergedContent("program", slug, locale);
    const layout = resolveLayout("program", programRaw.data || {});
    const singleEntry = buildSingleEntryFromContent("program", programData);
    injectCanonicalIfMissing(programData, "program", locale);
    const { layout: _stripLayout, ...rest } = programData;
    res.json({
      ...rest,
      ...(singleEntry ? { singleEntry } : {}),
      layout,
    });
  });

  // Landing pages API
  app.get("/api/landings", (_req, res) => {
    const landings = listLandingPages(getCI(res));
    res.json(landings);
  });

  app.get("/api/landings/:slug", async (req, res) => {
    const { slug } = req.params;
    const forceVariant = req.query.force_variant as string | undefined;
    const forceVersion = req.query.force_version
      ? parseInt(req.query.force_version as string, 10)
      : undefined;

    // Resolve the folder slug first — the URL slug may be locale-specific
    // (e.g. "4geeks-vs-otros-landing" → folder "4geeks-vs-others-landing")
    const baseSlug = getCI(res).resolveBaseSlug(slug, "landing");

    // Get locale from query param, _common.yml, or default — then verify it exists
    const queryLocale = req.query.locale as string | undefined;
    const supported = getSupportedLocales();
    const validQueryLocale = queryLocale && supported.includes(queryLocale) ? queryLocale : undefined;
    const commonData = getCI(res).loadCommonData("landing", baseSlug);
    let locale = validQueryLocale || (commonData?.locale as string) || getDefaultLocale();
    const availableLocales = getCI(res).getAvailableLocalesOrVariants("landing" as ContentType, baseSlug);
    if (availableLocales.length > 0 && !availableLocales.includes(locale)) {
      locale = availableLocales[0];
    }
    // If the URL slug is locale-specific (e.g. the ES slug of a bilingual page),
    // detect which locale it belongs to and override the default locale detection
    if (!validQueryLocale) {
      const detectedLocale = getCI(res).resolveLocaleFromUrlSlug(slug, "landing");
      if (detectedLocale && availableLocales.includes(detectedLocale)) {
        locale = detectedLocale;
      }
    }

    let landing: LandingPage | null = null;

    // If force_variant is provided, load that variant directly (for preview)
    if (forceVariant) {
      const versioningManager = getVersioningManager();
      const forcedContent = versioningManager.getVariantContent("landing", baseSlug, forceVariant, locale);
      if (forcedContent) {
        landing = forcedContent as LandingPage;
      }
    }

    // Normal versioning flow if not forcing a variant
    if (!landing) {
      const assigned = resolveVariantAssignment(req, res, "landing", baseSlug, locale);
      if (assigned) {
        landing = assigned as LandingPage;
      }
    }

    // Fall back to default content
    if (!landing) {
      landing = loadLandingPage(slug, locale, getCI(res));
    }

    if (!landing) {
      res.status(404).json({ error: "Landing page not found" });
      return;
    }

    const landingLocations =
      (commonData?.locations as string[] | undefined) || undefined;
    const landingData = landing as unknown as Record<string, unknown>;

    if (landing.sections && Array.isArray(landing.sections)) {
      (landing as any).sections = await resolveDynamicEntries(landing.sections as any, locale);
      applyComponentImageSizes((landing as any).sections as unknown[]);
    }

    const rawMerged = getCI(res).loadMergedContent("landing", slug, locale);
    const layout = resolveLayout("landing", rawMerged.data || commonData || {});
    const singleEntry = buildSingleEntryFromContent("landing", landingData);
    injectCanonicalIfMissing(landingData, "landing", locale);
    const { layout: _stripLayout, ...restLanding } = landingData;
    res.json({
      ...restLanding,
      ...(singleEntry ? { singleEntry } : {}),
      locale,
      landing_locations: landingLocations,
      layout,
    });
  });

  // Locations API
  app.get("/api/locations", (req, res) => {
    const locale = normalizeLocale(req.query.locale as string);
    const region = req.query.region as string | undefined;
    let locations = listLocationPages(locale, getCI(res));

    if (region) {
      locations = locations.filter((loc) => loc.region === region);
    }

    res.json(locations);
  });

  app.get("/api/locations/:slug", async (req, res) => {
    const { slug } = req.params;
    const locale = normalizeLocale(req.query.locale as string);
    const forceVariant = req.query.force_variant as string | undefined;

    let location = null;

    if (forceVariant) {
      const versioningManager = getVersioningManager();
      const forcedContent = versioningManager.getVariantContent("location", slug, forceVariant, locale);
      if (forcedContent) {
        location = forcedContent as ReturnType<typeof loadLocationPage>;
      }
    }

    if (!location) {
      const assigned = resolveVariantAssignment(req, res, "location", slug, locale);
      if (assigned) {
        location = assigned as ReturnType<typeof loadLocationPage>;
      }
    }

    if (!location) {
      location = loadLocationPage(slug, locale, getCI(res));
    }

    if (!location) {
      res.status(404).json({ error: "Location not found" });
      return;
    }

    const locationData = location as unknown as Record<string, unknown>;
    if (locationData.sections && Array.isArray(locationData.sections)) {
      applyComponentSectionDefaults(locationData.sections);
      locationData.sections = await resolveDynamicEntries(locationData.sections as any, locale) as any;
      applyComponentImageSizes(locationData.sections);
    }
    const locationRaw = getCI(res).loadMergedContent("location", slug, locale);
    const layout = resolveLayout("location", locationRaw.data || {});
    const singleEntry = buildSingleEntryFromContent("location", locationData);
    injectCanonicalIfMissing(locationData, "location", locale);
    const { layout: _stripLayout, ...restLocation } = locationData;
    res.json({
      ...restLocation,
      ...(singleEntry ? { singleEntry } : {}),
      layout,
    });
  });

  // Template Pages API
  app.get("/api/pages", (req, res) => {
    const locale = normalizeLocale(req.query.locale as string);
    const pages = listTemplatePages(locale, getCI(res));
    res.json(pages);
  });

  // Special handler for career-programs listing page (custom page type)
  app.get("/api/pages/career-programs", (req, res) => {
    const locale = normalizeLocale(req.query.locale as string);

    const page = loadCareerProgramsListing(locale, getCI(res));

    if (!page) {
      res.status(404).json({ error: "Career programs listing page not found" });
      return;
    }

    const cpPageData = page as unknown as Record<string, unknown>;
    const cpRaw = getCI(res).loadMergedContent("page", "career-programs", locale);
    const cpLayout = resolveLayout("page", cpRaw.data || {});
    injectCanonicalIfMissing(cpPageData, "page", locale);
    const { layout: _cpStripLayout, ...cpRest } = cpPageData;
    res.json({ ...cpRest, layout: cpLayout });
  });

  // Special handler for apply page (includes programs and locations from _common.yml)
  app.get("/api/pages/apply", (req, res) => {
    const locale = normalizeLocale(req.query.locale as string);
    const forceVariant = req.query.force_variant as string | undefined;

    let page = null;

    if (forceVariant) {
      const versioningManager = getVersioningManager();
      const forcedContent = versioningManager.getVariantContent("page", "apply", forceVariant, locale);
      if (forcedContent) {
        page = forcedContent as ReturnType<typeof loadTemplatePage>;
      }
    }

    if (!page) {
      const assigned = resolveVariantAssignment(req, res, "page", "apply", locale);
      if (assigned) {
        page = assigned as ReturnType<typeof loadTemplatePage>;
      }
    }

    if (!page) {
      page = loadTemplatePage("apply", locale, getCI(res));
    }

    if (!page) {
      res.status(404).json({ error: "Apply page not found" });
      return;
    }

    const commonData = getCI(res).loadCommonData("page", "apply");
    const applyRaw = getCI(res).loadMergedContent("page", "apply", locale);
    const layout = resolveLayout("page", applyRaw.data || {});
    const applyData = page as unknown as Record<string, unknown>;
    injectCanonicalIfMissing(applyData, "page", locale);
    const { layout: _stripLayout, ...restApply } = applyData;

    res.json({
      ...restApply,
      programs: commonData?.programs || [],
      locations: commonData?.locations || [],
      layout,
    });
  });

  // Apply form submission endpoint
  app.get("/api/pages/:slug", async (req, res) => {
    const { slug } = req.params;
    const locale = normalizeLocale(req.query.locale as string);
    const forceVariant = req.query.force_variant as string | undefined;

    let page = null;

    if (forceVariant) {
      const versioningManager = getVersioningManager();
      const forcedContent = versioningManager.getVariantContent("page", slug, forceVariant, locale);
      if (forcedContent) {
        page = forcedContent as ReturnType<typeof loadTemplatePage>;
      }
    }

    if (!page) {
      const assigned = resolveVariantAssignment(req, res, "page", slug, locale);
      if (assigned) {
        page = assigned as ReturnType<typeof loadTemplatePage>;
      }
    }

    if (!page) {
      page = loadTemplatePage(slug, locale, getCI(res));
    }

    if (!page) {
      res.status(404).json({ error: "Template page not found" });
      return;
    }

    if (page.sections && Array.isArray(page.sections)) {
      page.sections = (await resolveDynamicEntries(
        page.sections,
        locale,
      )) as any;
      applyComponentSectionDefaults(page.sections);
      applyComponentImageSizes(page.sections);
    }

    const pageData = page as unknown as Record<string, unknown>;
    const pageRaw = getCI(res).loadMergedContent("page", slug, locale);
    const layout = resolveLayout("page", pageRaw.data || {});
    const singleEntry = buildSingleEntryFromContent("page", pageData);
    if (singleEntry) {
      pageData.singleEntry = singleEntry;
    }
    injectCanonicalIfMissing(pageData, "page", locale);
    const { layout: _stripLayout, ...restPage } = pageData;
    res.json({ ...restPage, layout });
  });

  app.get("/api/content-pages/:contentType/:slug", async (req, res) => {
    const { contentType, slug } = req.params;
    const locale = normalizeLocale(req.query.locale as string);
    const forceVariant = req.query.force_variant as string | undefined;

    if (!isValidType(contentType)) {
      res.status(404).json({ error: `Unknown content type: ${contentType}` });
      return;
    }

    if (hasDatabaseSingle(contentType)) {
      const page = await loadDatabaseSinglePage(contentType, slug, locale, getContentRoot(res));
      if (page) {
        if (page.sections && Array.isArray(page.sections)) {
          page.sections = (await resolveDynamicEntries(page.sections, locale)) as any;
          applyComponentImageSizes(page.sections as unknown[]);
        }
        const dbPageData = page as unknown as Record<string, unknown>;
        const dbSingleEntry = (dbPageData.singleEntry as Record<string, unknown>) || {};
        if (Object.keys(dbSingleEntry).length > 0) {
          const dbResolved = resolveSingleVars(dbPageData, dbSingleEntry) as Record<string, unknown>;
          Object.assign(dbPageData, dbResolved);
        }
        const dbRaw = getCI(res).loadMergedContent(contentType, slug, locale);
        const dbLayout = resolveLayout(contentType, dbRaw.data || {});
        injectCanonicalIfMissing(dbPageData, contentType, locale);
        const { layout: _dbStripLayout, ...dbRest } = dbPageData;
        res.json({ ...dbRest, layout: dbLayout });
        return;
      }
      // Slug not found in DB — fall through to static content loading below
    }

    // Variant resolution for YAML-backed content types
    let variantPage: Record<string, unknown> | null = null;

    if (forceVariant) {
      const versioningManager = getVersioningManager();
      const forcedContent = versioningManager.getVariantContent(contentType, slug, forceVariant, locale);
      if (forcedContent) {
        variantPage = forcedContent as Record<string, unknown>;
      }
    }

    if (!variantPage) {
      const assigned = resolveVariantAssignment(req, res, contentType, slug, locale);
      if (assigned) {
        variantPage = assigned as Record<string, unknown>;
      }
    }

    if (variantPage) {
      const variantSections = variantPage.sections;
      if (variantSections && Array.isArray(variantSections)) {
        (variantPage as any).sections = (await resolveDynamicEntries(variantSections, locale)) as any;
        applyComponentImageSizes((variantPage as any).sections as unknown[]);
      }
      const variantRaw = getCI(res).loadMergedContent(contentType, slug, locale);
      const variantLayout = resolveLayout(contentType, variantRaw.data || {});
      const variantSingleEntry = buildSingleEntryFromContent(contentType, variantPage);
      if (variantSingleEntry) {
        variantPage.singleEntry = variantSingleEntry;
        const resolved = resolveSingleVars(variantPage, variantSingleEntry) as Record<string, unknown>;
        Object.assign(variantPage, resolved);
      }
      injectCanonicalIfMissing(variantPage, contentType, locale);
      const { layout: _variantStripLayout, ...variantRest } = variantPage;
      res.json({ ...variantRest, layout: variantLayout });
      return;
    }

    const result = getCI(res).loadContent({
      contentType,
      slug,
      localeOrVariant: locale,
    });

    if (!result.success) {
      res.status(404).json({ error: `${contentType} entry not found` });
      return;
    }

    const page = result.data;

    if (page.sections && Array.isArray(page.sections)) {
      page.sections = (await resolveDynamicEntries(page.sections, locale)) as any;
      applyComponentImageSizes(page.sections as unknown[]);
    }

    const genericPageData = page as unknown as Record<string, unknown>;
    const genericRaw = getCI(res).loadMergedContent(contentType, slug, locale);
    const genericLayout = resolveLayout(contentType, genericRaw.data || {});
    const singleEntry = buildSingleEntryFromContent(contentType, genericPageData);
    if (singleEntry) {
      genericPageData.singleEntry = singleEntry;
      const resolved = resolveSingleVars(genericPageData, singleEntry) as Record<string, unknown>;
      Object.assign(genericPageData, resolved);
    }
    injectCanonicalIfMissing(genericPageData, contentType, locale);
    const { layout: _genericStripLayout, ...genericRest } = genericPageData;
    res.json({ ...genericRest, layout: genericLayout });
  });
  app.get("/api/blog/posts", async (req, res) => {
    try {
      const locale = req.query.locale as string | undefined;
      const category = req.query.category as string | undefined;
      const page = req.query.page
        ? parseInt(req.query.page as string, 10)
        : undefined;
      const limit = Math.min(
        parseInt(req.query.limit as string, 10) || 12,
        100,
      );
      const posts = await databaseManager.fetchMappedItems("blog");
      const localeKey = getLocaleKey("blog") || "lang";
      let filtered = locale
        ? posts.filter((p) => (p as any)[localeKey] === normalizeLocale(locale))
        : posts;

      if (category) {
        filtered = filtered.filter((p: any) => {
          return (p.category?.slug || "") === category;
        });
      }

      const categories = Array.from(
        new Set(
          (locale
            ? posts.filter(
                (p) => (p as any)[localeKey] === normalizeLocale(locale),
              )
            : posts
          )
            .map((p: any) => p.category?.slug || "")
            .filter(Boolean),
        ),
      ).sort();

      const total = filtered.length;
      const stripped = filtered.map((p: any) => {
        const { content, readme, ...rest } = p;
        return rest;
      });

      if (page && page > 0) {
        const totalPages = Math.ceil(total / limit);
        const start = (page - 1) * limit;
        const paginated = stripped.slice(start, start + limit);
        res.json({
          count: paginated.length,
          total,
          page,
          totalPages,
          hasNext: page < totalPages,
          hasPrev: page > 1,
          categories,
          results: paginated,
        });
      } else {
        res.json({
          count: total,
          total,
          categories,
          results: stripped,
        });
      }
    } catch (error) {
      log.error({ err: error }, "[Blog] Error fetching posts:");
      res.status(500).json({ error: "Failed to fetch blog posts" });
    }
  });

  app.get("/api/blog/posts/:slug", async (req, res) => {
    try {
      const { slug } = req.params;
      const locale = req.query.locale as string | undefined;
      const posts = await databaseManager.fetchMappedItems("blog");
      const localeKey = getLocaleKey("blog") || "lang";
      const normalizedLocale = locale ? normalizeLocale(locale) : undefined;
      const post = normalizedLocale
        ? posts.find(
            (p) =>
              p.slug === slug && (p as any)[localeKey] === normalizedLocale,
          ) || posts.find((p) => p.slug === slug)
        : posts.find((p) => p.slug === slug);

      if (!post) {
        res.status(404).json({ error: "Blog post not found" });
        return;
      }

      let content = (post as any).content || "";
      if (!content && (post as any).readme_url) {
        content = await fetchMarkdownContent((post as any).readme_url);
      }

      const blogLayout = resolveLayout("blog", post as unknown as Record<string, unknown>);
      res.json({ ...post, content, layout: blogLayout });
    } catch (error) {
      log.error({ err: error }, "[Blog] Error fetching post:");
      res.status(500).json({ error: "Failed to fetch blog post" });
    }
  });

  app.get("/api/blog/cache-status", (_req, res) => {
    const dbName = getDatabaseName("blog");
    if (!dbName) {
      res.json({ exists: false, age_hours: null, post_count: null });
      return;
    }
    const info = databaseManager.getCacheInfo(dbName);
    res.json({
      exists: !!info,
      age_hours: info
        ? Math.round(
            ((Date.now() - new Date(info.fetched_at).getTime()) /
              (60 * 60 * 1000)) *
              10,
          ) / 10
        : null,
      post_count: info?.item_count ?? null,
    });
  });

  app.delete("/api/blog/cache/:slug", async (req, res) => {
    try {
      const { slug } = req.params;
      const posts = await databaseManager.fetchMappedItems("blog");
      const post = posts.find((p) => p.slug === slug);
      if ((post as any)?.readme_url) {
        clearMarkdownCacheByUrl((post as any).readme_url);
      }
      clearMarkdownCache(slug);
      res.json({ success: true, message: `Cache cleared for "${slug}"` });
    } catch (error) {
      log.error({ err: error }, "[Blog] Error clearing post cache:");
      res.status(500).json({ error: "Failed to clear post cache" });
    }
  });

  app.post("/api/debug/clear-blog-cache", async (_req, res) => {
    const dbName = getDatabaseName("blog");
    if (dbName && databaseManager.exists(dbName)) {
      await databaseManager.fetchItems(dbName, true).catch(() => {});
    }
    clearMarkdownCache();
    res.json({
      success: true,
      message: "Blog cache cleared (database will re-fetch on next request)",
    });
  });

  app.get("/api/blog/config", (_req, res) => {
    try {
      const config = getContentTypeConfig("blog");
      res.json(config || {});
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.put("/api/blog/config", (req, res) => {
    try {
      const body = req.body;
      if (!body || typeof body !== "object") {
        res.status(400).json({ error: "Request body must be a JSON object" });
        return;
      }
      const update: Partial<import("../content-types").ContentTypeEntry> = {};
      if (body.url_pattern !== undefined) update.url_pattern = body.url_pattern;
      if (body.database !== undefined) update.database = body.database;
      updateContentTypeConfig("blog", update, getContentRoot(res));
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // ── Generic Content Type API Routes ──

  app.get("/api/content-types", (_req, res) => {
    try {
      const configs = getAllConfigs();
      const result: Record<string, unknown>[] = [];
      for (const [type, config] of Object.entries(configs)) {
        result.push({
          name: type,
          label: getLabel(type),
          directory: config.directory,
          has_database: !!config.database?.slug,
          database_slug: config.database?.slug || null,
          has_field_mapping: !!(
            config.field_mapping &&
            Object.keys(config.field_mapping).filter(
              (k) => !k.startsWith("_"),
            ).length > 0
          ),
          unique_fields: config.unique_fields ?? ["slug"],
          field_mapping_keys: Object.keys(config.field_mapping ?? {}).filter(
            (k) => !k.startsWith("_"),
          ),
          url_pattern: config.url_pattern,
          locale_key: config.field_mapping?._locale || null,
          static_entry_count: getCI(res).findByType(type).length,
          layout: getLayout(type),
        });
      }
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.post("/api/content-types", (req, res) => {
    try {
      const { name, directory, url_pattern } = req.body;
      if (!name || typeof name !== "string") {
        res.status(400).json({ error: "Name is required" });
        return;
      }
      if (!/^[a-z][a-z0-9_-]*$/.test(name)) {
        res
          .status(400)
          .json({
            error:
              "Name must be lowercase alphanumeric (hyphens and underscores allowed)",
          });
        return;
      }
      if (!url_pattern) {
        res.status(400).json({ error: "URL pattern is required" });
        return;
      }

      const normalizedPattern = normalizeUrlPattern(url_pattern);

      const patternValues = Object.values(normalizedPattern) as string[];
      for (const p of patternValues) {
        if (!p.includes(":slug")) {
          res.status(400).json({ error: "URL pattern must include :slug" });
          return;
        }
        if (!p.startsWith("/")) {
          res.status(400).json({ error: "URL pattern must start with /" });
          return;
        }
      }
      const dir = directory || name;

      addContentType(name, {
        directory: dir,
        url_pattern: normalizedPattern,
      }, getContentRoot(res));

      getCI(res).refresh();
      clearSitemapCache();

      res.json({
        success: true,
        name,
        directory: dir,
        url_pattern: normalizedPattern,
      });
    } catch (err) {
      res.status(400).json({ error: String(err) });
    }
  });

  app.delete("/api/content-types/:type", (req, res) => {
    try {
      const { type } = req.params;
      const dryRun = req.query.dry_run === "true";

      const config = getContentTypeConfig(type);
      if (!config) {
        res.status(404).json({ error: `Content type "${type}" not found` });
        return;
      }

      const staticEntries = getCI(res).findByType(type);
      const staticCount = staticEntries.length;
      const hasDatabase = !!config.database?.slug;

      if (dryRun) {
        const affectedUrls: string[] = [];
        for (const entry of staticEntries) {
          const locales = entry.locales.length > 0 ? entry.locales : Object.keys(config.url_pattern).filter(k => k !== "default");
          for (const locale of locales) {
            const url = getCI(res).buildUrl(type, locale, entry.slug);
            if (url && !affectedUrls.includes(url)) {
              affectedUrls.push(url);
            }
          }
        }

        res.json({
          dry_run: true,
          type,
          directory: config.directory,
          static_entry_count: staticCount,
          has_database: hasDatabase,
          database_slug: config.database?.slug || null,
          affected_urls: affectedUrls,
          message: `Deleting "${type}" will remove its definition from content-types.yml. The ${staticCount} content file(s) in ${getContentRootName(res)}/${config.directory}/ will NOT be deleted but will no longer be served.`,
        });
        return;
      }

      deleteContentType(type, getContentRoot(res));
      getCI(res).refresh();
      clearSitemapCache();
      res.json({ success: true, deleted: type });
    } catch (err) {
      res.status(400).json({ error: String(err) });
    }
  });

  app.get("/api/content-types/:type/config", (req, res) => {
    try {
      const { type } = req.params;
      const config = getContentTypeConfig(type);
      if (!config) {
        res.status(404).json({ error: `Content type "${type}" not found` });
        return;
      }
      res.json({
        name: type,
        label: getLabel(type),
        directory: config.directory,
        field_mapping: config.field_mapping || null,
        indexes: config.indexes || null,
        database: config.database || null,
        url_pattern: config.url_pattern,
        static_entry_count: getCI(res).findByType(type).length,
      });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.get("/api/content-types/:type/validate-field", (req, res) => {
    try {
      const { type } = req.params;
      const source = req.query.source as string;
      if (!source) {
        res.status(400).json({ error: "source query parameter is required" });
        return;
      }
      const config = getContentTypeConfig(type);
      if (!config) {
        res.status(404).json({ error: `Content type "${type}" not found` });
        return;
      }
      const result = validateFieldSource(type, source);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.post("/api/content-types/:type/validate-mappings", (req, res) => {
    try {
      const { type } = req.params;
      const config = getContentTypeConfig(type);
      if (!config) {
        res.status(404).json({ error: `Content type "${type}" not found` });
        return;
      }
      const { field_mapping } = req.body || {};
      if (!field_mapping || typeof field_mapping !== "object") {
        res.status(400).json({ error: "field_mapping object is required in body" });
        return;
      }
      const result = validateFieldMapping(type, field_mapping);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.put("/api/content-types/:type/config", (req, res) => {
    try {
      const { type } = req.params;
      const config = getContentTypeConfig(type);
      if (!config) {
        res.status(404).json({ error: `Content type "${type}" not found` });
        return;
      }
      const body = req.body;
      if (!body || typeof body !== "object") {
        res.status(400).json({ error: "Request body must be a JSON object" });
        return;
      }

      if (body.field_mapping && !config.database?.slug) {
        const validation = validateFieldMapping(type, body.field_mapping);
        if (!validation.allValid) {
          const invalidFields = Object.entries(validation.results)
            .filter(([, r]) => !r.valid)
            .map(([k]) => k);
          res.status(400).json({
            error: `Some field mappings reference properties not found in all entries: ${invalidFields.join(", ")}`,
            validation: validation.results,
          });
          return;
        }
      }

      const update: Partial<import("../content-types").ContentTypeEntry> = {};
      if (body.url_pattern !== undefined) update.url_pattern = body.url_pattern;
      if (body.field_mapping !== undefined) update.field_mapping = body.field_mapping;
      if (body.indexes !== undefined) update.indexes = body.indexes;
      if (body.unique_fields !== undefined) update.unique_fields = body.unique_fields;
      if (body.database !== undefined) update.database = body.database;
      updateContentTypeConfig(type, update, getContentRoot(res));
      getCI(res).invalidateCommonFields(type);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.get("/api/content-types/:type/available-properties", (req, res) => {
    try {
      const { type } = req.params;
      const config = getContentTypeConfig(type);
      if (!config) {
        res.status(404).json({ error: `Content type "${type}" not found` });
        return;
      }
      const result = getCI(res).getCommonFields(type);
      const excludeMapped = req.query.exclude_mapped === "true";
      if (excludeMapped && config.field_mapping) {
        const mappedSources = new Set(
          Object.values(config.field_mapping).map((v) =>
            typeof v === "string" ? (v.startsWith("function:") ? null : v) : (v as { source: string }).source
          ).filter(Boolean)
        );
        return res.json({
          common: result.common.filter((k) => !mappedSources.has(k)),
          partial: result.partial.filter((p) => !mappedSources.has(p.key)),
        });
      }
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.get("/api/content-types/:type/single-field-values", (req, res) => {
    try {
      const { type } = req.params;
      const field = req.query.field as string;
      const locale = (req.query.locale as string) || "en";
      if (!field) {
        res.status(400).json({ error: "field query parameter is required" });
        return;
      }
      const config = getContentTypeConfig(type);
      if (!config) {
        res.status(404).json({ error: `Content type "${type}" not found` });
        return;
      }
      const mapping = getFieldMapping(type);
      const source = mapping?.[field];
      if (!source || typeof source !== "string") {
        res.status(404).json({ error: `Field "${field}" not found in field_mapping` });
        return;
      }

      const slugs = getCI(res).listContentSlugs(type as ContentType);
      const entries: Array<{ slug: string; value: unknown; url: string | null }> = [];
      for (const slug of slugs) {
        const locales = getCI(res).getAvailableLocalesOrVariants(type as ContentType, slug);
        const entryLocale = locales.includes(locale) ? locale : locales[0];
        if (!entryLocale) continue;
        const { data } = getCI(res).loadMergedContent(type, slug, entryLocale);
        if (!data) continue;
        const value = extractByDotPath(data, source);
        let url: string | null = null;
        try {
          url = resolveContentTypeUrl(type, data as Record<string, unknown>, entryLocale);
        } catch {}
        entries.push({ slug, value: value ?? null, url });
      }
      res.json({ field, source, entries });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.get("/api/content-types/:type/single-template-sections", (req, res) => {
    try {
      const { type } = req.params;
      const locale = ((req.query.locale as string) || "en").replace(/[^a-z-]/g, "");
      if (!isValidType(type)) {
        res.status(404).json({ error: `Unknown content type: ${type}` });
        return;
      }
      if (!hasDatabaseSingle(type)) {
        res.status(400).json({ error: `Content type "${type}" does not use a single template` });
        return;
      }
      const merged = mergeSingleTemplate(type, locale, undefined, undefined, getContentRoot(res));
      if (!merged) {
        res.status(404).json({ error: "Single template not found" });
        return;
      }
      if (!Array.isArray(merged.sections)) {
        res.status(404).json({ error: "No sections array in single template" });
        return;
      }
      const sectionYamls = (merged.sections as unknown[]).map((s) =>
        safeYamlDump(s, { lineWidth: -1, noRefs: true }),
      );
      res.json({ sections: sectionYamls });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.get("/api/content-types/:type/entry-fields", (req, res) => {
    try {
      const { type } = req.params;
      const slugParam = req.query.slug as string | undefined;
      const localeParam = req.query.locale as string | undefined;

      const config = getContentTypeConfig(type);
      if (!config) {
        res.status(404).json({ error: `Content type "${type}" not found` });
        return;
      }

      const fieldMapping = config.field_mapping ?? {};
      const fieldKeys = Object.keys(fieldMapping).filter((k) => !k.startsWith("_"));

      const slugs = getCI(res).listContentSlugs(type as ContentType);
      if (slugs.length === 0) {
        res.json({ slug: null, title: null, fields: {}, computed: [] });
        return;
      }

      const targetSlug = slugParam && slugs.includes(slugParam) ? slugParam : slugs[0];
      const availableLocales = getCI(res).getAvailableLocalesOrVariants(type as ContentType, targetSlug);
      const entryLocale = localeParam && availableLocales.includes(localeParam) ? localeParam : availableLocales[0];
      if (!entryLocale) {
        res.json({ slug: null, title: null, fields: {}, computed: [] });
        return;
      }

      const { data } = getCI(res).loadMergedContent(type, targetSlug, entryLocale);
      if (!data) {
        res.json({ slug: null, title: null, fields: {}, computed: [] });
        return;
      }

      const fields: Record<string, string | boolean | number | null> = {};
      const computed: string[] = [];

      for (const key of fieldKeys) {
        const rawMapping = fieldMapping[key];
        const mappingValue =
          typeof rawMapping === "string"
            ? rawMapping
            : typeof rawMapping === "object" && rawMapping !== null
            ? (rawMapping as { source: string }).source
            : null;

        if (typeof mappingValue === "string" && mappingValue.startsWith("function:")) {
          computed.push(key);
          const fallback = extractByDotPath(data, key);
          fields[key] = fallback != null ? String(fallback) : null;
        } else if (typeof mappingValue === "string") {
          const value = extractByDotPath(data, mappingValue);
          if (value == null) {
            fields[key] = null;
          } else if (typeof value === "boolean" || typeof value === "number") {
            fields[key] = value;
          } else {
            fields[key] = String(value);
          }
        } else {
          fields[key] = null;
        }
      }

      const nullFields = Object.entries(fields)
        .filter(([k, v]) => v === null && !computed.includes(k))
        .map(([k]) => k);
      if (nullFields.length > 0) {
        for (const otherSlug of slugs) {
          if (nullFields.length === 0) break;
          if (otherSlug === targetSlug) continue;
          const otherLocales = getCI(res).getAvailableLocalesOrVariants(type as ContentType, otherSlug);
          if (!otherLocales.length) continue;
          const otherResult = getCI(res).loadMergedContent(type, otherSlug, otherLocales[0]);
          if (!otherResult?.data) continue;
          for (let i = nullFields.length - 1; i >= 0; i--) {
            const fk = nullFields[i];
            const mp = fieldMapping[fk];
            const mv = typeof mp === "string" ? mp : typeof mp === "object" && mp !== null ? (mp as { source: string }).source : null;
            if (typeof mv !== "string" || mv.startsWith("function:")) continue;
            const v = extractByDotPath(otherResult.data, mv);
            if (v != null) {
              if (typeof v === "boolean" || typeof v === "number") {
                fields[fk] = v;
              } else {
                fields[fk] = String(v);
              }
              nullFields.splice(i, 1);
            }
          }
        }
      }

      const titleRaw = extractByDotPath(data, "title");
      const title = titleRaw != null ? String(titleRaw) : null;

      res.json({ slug: targetSlug, title, fields, computed });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.get("/api/content-type/:name/single-defaults", (req, res) => {
    try {
      const { name } = req.params;
      const folder = getFolder(name);
      if (!folder) {
        res.status(404).json({ error: `Content type "${name}" not found` });
        return;
      }
      const filePath = path.join(getContentRoot(res), folder, "_common.single.yml");
      if (!fs.existsSync(filePath)) {
        res.json({ defaults: {} });
        return;
      }
      const raw = fs.readFileSync(filePath, "utf-8");
      const parsed = getCI(res).safeYamlLoad(raw) || {};
      res.json({ defaults: parsed });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.put("/api/content-type/:name/single-defaults", (req, res) => {
    try {
      const { name } = req.params;
      const folder = getFolder(name);
      if (!folder) {
        res.status(404).json({ error: `Content type "${name}" not found` });
        return;
      }
      const body = req.body;
      if (!body || typeof body !== "object") {
        res.status(400).json({ error: "Request body must be a JSON object" });
        return;
      }
      const filePath = path.join(getContentRoot(res), folder, "_common.single.yml");
      let existing: Record<string, unknown> = {};
      if (fs.existsSync(filePath)) {
        const raw = fs.readFileSync(filePath, "utf-8");
        existing = getCI(res).safeYamlLoad(raw) || {};
      }
      const merged = deepMerge(existing, body);
      const { escaped, map } = escapeObjectVars(merged);
      const dumped = yaml.dump(escaped, { lineWidth: 120, noRefs: true });
      const yamlStr = unescapeYamlDump(dumped, map);
      fs.writeFileSync(filePath, yamlStr, "utf-8");
      const author = (req.body as Record<string, unknown>).author as string | undefined;
      markFileAsModified(filePath, author || "api");
      invalidateContentCaches(name, getCI(res));
      res.json({ success: true, defaults: merged });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.get("/api/content-types/:type/items", async (req, res) => {
    try {
      const { type } = req.params;
      const config = getContentTypeConfig(type);
      if (!config?.database?.slug) {
        res
          .status(400)
          .json({ error: `Content type "${type}" has no database configured` });
        return;
      }
      const dbName = config.database.slug;
      if (!databaseManager.exists(dbName)) {
        res.status(404).json({ error: `Database "${dbName}" not found` });
        return;
      }

      const locale = req.query.locale as string | undefined;

      const result = await databaseManager.fetchItems(dbName);
      let items = result.items as Record<string, unknown>[];

      const mapping = config.field_mapping;
      const regularMapping: Record<string, string> = {};
      const rawFieldRefs: Record<string, string> = {};
      if (mapping) {
        for (const [key, value] of Object.entries(mapping)) {
          if (key.startsWith("_")) continue;
          const sourcePath = typeof value === "object" ? value.source : value;
          if (sourcePath.startsWith("raw.")) {
            rawFieldRefs[key] = sourcePath.slice(4);
          } else if (sourcePath.startsWith("db.")) {
            regularMapping[key] = sourcePath.slice(3);
          } else {
            regularMapping[key] = sourcePath;
          }
        }
      }

      let rawItems: Record<string, unknown>[] | null = null;
      if (Object.keys(rawFieldRefs).length > 0) {
        rawItems = databaseManager.getRawItems(dbName);
      }

      const localeFieldKey = getLocaleKey(type);
      const localeDefault = getLocaleDefault(type);

      if (
        Object.keys(regularMapping).length > 0 ||
        Object.keys(rawFieldRefs).length > 0
      ) {
        items = items.map((item, idx) => {
          const mapped: Record<string, unknown> = { ...item };
          const itemSlug = String(item.slug ?? item.id ?? idx);
          for (const [targetField, sourcePath] of Object.entries(
            regularMapping,
          )) {
            const value = resolveFieldValue(sourcePath, item, targetField, {
              contentType: type,
              slug: itemSlug,
              fieldPath: targetField,
            });
            if (value !== undefined) mapped[targetField] = value;
          }
          if (rawItems && rawItems[idx]) {
            for (const [targetField, sourcePath] of Object.entries(
              rawFieldRefs,
            )) {
              const value = resolveFieldValue(
                sourcePath,
                rawItems[idx],
                targetField,
                { contentType: type, slug: itemSlug, fieldPath: targetField },
              );
              if (value !== undefined) mapped[targetField] = value;
            }
          }
          return mapped;
        });
      }

      const localeSource = getLocaleSource(type);
      if (localeFieldKey) {
        items = items.map((item) => {
          const locVal = String(item[localeFieldKey] || "");
          const normalized = localeSource
            ? applyTransformIfNeeded(localeSource, locVal)
            : locVal;
          return { ...item, [localeFieldKey]: normalized || localeDefault };
        });
      }

      if (locale && localeFieldKey) {
        const normalizedLocale = normalizeLocale(locale);
        items = items.filter((item) => {
          const val = String(item[localeFieldKey] || localeDefault);
          return val === normalizedLocale;
        });
      }

      const indexes = getIndexes(type);
      for (const idx of indexes) {
        const filterVal = req.query[idx] as string | undefined;
        if (filterVal !== undefined && filterVal !== "") {
          items = items.filter((item) => {
            const val = String(item[idx] || "").toLowerCase();
            return val === filterVal.toLowerCase();
          });
        }
      }

      const stripped = items.map((item) => {
        const { content, readme, ...rest } = item as Record<string, unknown>;
        return rest;
      });

      let facets = result.facets;
      if (!facets) {
        const dbConfig = databaseManager.get(dbName);
        if (dbConfig.editor) {
          const computed: Record<string, string[]> = {};
          for (const [field, hint] of Object.entries(dbConfig.editor)) {
            if (hint.type === "tags" || hint.type === "select") {
              const valueSet = new Set<string>();
              for (const item of result.items) {
                const v = item[field];
                if (Array.isArray(v)) {
                  for (const el of v) { if (el != null && el !== "") valueSet.add(String(el)); }
                } else if (v != null && v !== "") {
                  valueSet.add(String(v));
                }
              }
              if (valueSet.size > 0) {
                computed[field] = [...valueSet].sort((a, b) => a.localeCompare(b));
              }
            }
          }
          if (Object.keys(computed).length > 0) facets = computed;
        }
      }
      res.json({ count: stripped.length, results: stripped, ...(facets ? { facets } : {}) });
    } catch (err) {
      log.error(
        `[ContentTypes] Error fetching items for ${req.params.type}:`,
        err,
      );
      res.status(500).json({ error: String(err) });
    }
  });

  app.get("/api/content-types/:type/static-entries", (req, res) => {
    try {
      const { type } = req.params;
      const entries = getCI(res).findByType(type);
      const versioningManager = getVersioningManager();
      const results = entries.map((entry) => {
        const urls = getCI(res).getLocaleUrls(entry.slug, type);
        const versionCounts = versioningManager.getVersionCounts(type, entry.slug);
        return {
          slug: entry.slug,
          title: entry.title || entry.slug,
          locales: entry.locales.filter(
            (l) => !l.startsWith("_") && !l.includes("."),
          ),
          urls,
          versionCounts,
        };
      });
      res.json({ count: results.length, results });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.get("/api/content-types/:type/cache-status", (req, res) => {
    try {
      const { type } = req.params;
      const config = getContentTypeConfig(type);
      if (!config?.database?.slug) {
        res.json({ exists: false, age_hours: null, post_count: null });
        return;
      }
      const dbName = config.database.slug;
      const cachePath = path.join(process.cwd(), ".cache", `db-${dbName}.json`);
      if (!fs.existsSync(cachePath)) {
        res.json({ exists: false, age_hours: null, post_count: null });
        return;
      }
      try {
        const raw = fs.readFileSync(cachePath, "utf-8");
        const cached = JSON.parse(raw) as {
          fetched_at: string;
          items: unknown[];
        };
        const ageMs = Date.now() - new Date(cached.fetched_at).getTime();
        const ageHours = Math.round((ageMs / (60 * 60 * 1000)) * 10) / 10;
        res.json({
          exists: true,
          age_hours: ageHours,
          post_count: cached.items.length,
        });
      } catch {
        res.json({ exists: false, age_hours: null, post_count: null });
      }
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.get("/api/content-types/:type/seo-entries", async (req, res) => {
    try {
      const { type } = req.params;
      const localeFilter = req.query.locale as string | undefined;
      const config = getContentTypeConfig(type);
      if (!config) {
        res.status(404).json({ error: `Content type "${type}" not found` });
        return;
      }
      const urlPattern = config.url_pattern as Record<string, string> | undefined;

      // ── DB-backed ────────────────────────────────────────────────────────────
      if (config.database?.slug) {
        const dbName = config.database.slug;
        if (!databaseManager.exists(dbName)) {
          res.status(404).json({ error: `Database "${dbName}" not found` });
          return;
        }
        // Return cache_missing rather than erroring when no cache file exists
        const cacheFilePath = path.join(process.cwd(), ".cache", `db-${dbName}.json`);
        if (!fs.existsSync(cacheFilePath)) {
          res.json({ contentType: type, source: "db", cache_missing: true, count: 0, entries: [] });
          return;
        }
        const items = await databaseManager.fetchMappedItems(type);
        const localeKey = getLocaleKey(type) || "lang";
        const cacheInfo = databaseManager.getCacheInfo(dbName);
        const cacheAgeHours = cacheInfo?.fetched_at
          ? Math.round((Date.now() - new Date(cacheInfo.fetched_at).getTime()) / (60 * 60 * 1000) * 10) / 10
          : null;

        const uniqueLocales = [...new Set(items.map(item => String(item[localeKey] || "en")))];
        const templates: Record<string, Record<string, unknown> | null> = {};
        for (const locale of uniqueLocales) {
          templates[locale] = mergeSingleTemplate(type, locale, undefined, undefined, getContentRoot(res));
        }

        const entries = items
          .filter(item => !localeFilter || String(item[localeKey] || "en") === localeFilter)
          .map(item => {
            const locale = String(item[localeKey] || "en");
            const template = templates[locale];
            const rawMeta = resolveSingleVars(template?.meta ?? {}, item) as Record<string, unknown>;
            const resolvedMeta: Record<string, unknown> = {};
            for (const [k, v] of Object.entries(rawMeta)) {
              resolvedMeta[k] = (typeof v === "string" && /\{\{.*?\}\}/.test(v)) ? null : v;
            }
            let url: string | null = null;
            if (urlPattern && typeof item.slug === "string") {
              const tpl = urlPattern[locale] || urlPattern["default"] || null;
              if (tpl) {
                url = tpl.replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, (_match, key: string) => {
                  if (key === "slug") return item.slug as string;
                  const val = item[key];
                  if (val === undefined || val === null || val === "") return "";
                  if (typeof val === "object" && "slug" in (val as Record<string, unknown>)) {
                    return String((val as Record<string, unknown>).slug) || "";
                  }
                  return String(val);
                });
              }
            }
            return {
              slug: item.slug ?? null,
              contentType: type,
              locale,
              url,
              title: item.title ?? null,
              meta: resolvedMeta,
              schema: template?.schema ?? null,
            };
          });

        res.json({ contentType: type, source: "db", cache_age_hours: cacheAgeHours, count: entries.length, entries });
        return;
      }

      // ── YAML-backed ──────────────────────────────────────────────────────────
      const dir = getDirectory(type);
      const contentDir = path.join(getContentRoot(res), dir);
      if (!fs.existsSync(contentDir)) {
        res.status(404).json({ error: `Content directory not found: ${getContentRootName(res)}/${dir}` });
        return;
      }

      const entries: unknown[] = [];
      const slugDirs = fs.readdirSync(contentDir, { withFileTypes: true }).filter(d => d.isDirectory());

      for (const slugDir of slugDirs) {
        const slug = slugDir.name;
        const slugPath = path.join(contentDir, slug);
        try {
          const files = fs.readdirSync(slugPath).filter(f => f.endsWith(".yml") || f.endsWith(".yaml"));

          const localeFiles = files
            .map(f => f.replace(/\.(yml|yaml)$/, ""))
            .filter(n => /^[a-z]{2}(-[a-z]{2})?$/.test(n));

          if (localeFiles.length === 0) continue;

          let commonData: Record<string, unknown> = {};
          const commonPath = path.join(slugPath, "_common.yml");
          if (fs.existsSync(commonPath)) {
            try {
              commonData = getCI(res).safeYamlLoad(fs.readFileSync(commonPath, "utf-8")) || {};
            } catch { /* ignore broken _common.yml */ }
          }

          for (const locale of localeFiles) {
            if (localeFilter && locale !== localeFilter) continue;
            const localePath = path.join(slugPath, `${locale}.yml`);
            if (!fs.existsSync(localePath)) continue;

            try {
              const localeData = getCI(res).safeYamlLoad(fs.readFileSync(localePath, "utf-8")) || {};
              const merged = deepMerge(commonData, localeData) as Record<string, unknown>;

              const rawMeta = (merged.meta as Record<string, unknown>) ?? {};
              const { data: resolvedMeta } = variableManager.resolveDeep(rawMeta, { locale });

              let url: string | null = null;
              if (urlPattern) {
                const tpl = urlPattern[locale] || urlPattern["default"] || null;
                if (tpl) url = tpl.replace(":slug", slug);
              }

              entries.push({
                slug,
                contentType: type,
                locale,
                url,
                title: typeof merged.title === "string" ? merged.title : null,
                meta: resolvedMeta,
                schema: (merged.schema as Record<string, unknown>) ?? null,
              });
            } catch (fileErr) {
              entries.push({ slug, contentType: type, locale, url: null, title: null, meta: {}, schema: null, parse_error: String(fileErr) });
            }
          }
        } catch (slugErr) {
          entries.push({ slug, contentType: type, locale: null, url: null, title: null, meta: {}, schema: null, parse_error: String(slugErr) });
        }
      }

      res.json({ contentType: type, source: "yaml", cache_age_hours: null, count: entries.length, entries });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.post("/api/content-types/:type/clear-cache", async (req, res) => {
    try {
      const { type } = req.params;
      const config = getContentTypeConfig(type);
      if (!config?.database?.slug) {
        res
          .status(400)
          .json({ error: `Content type "${type}" has no database configured` });
        return;
      }
      const dbName = config.database.slug;
      if (databaseManager.exists(dbName)) {
        await databaseManager.fetchItems(dbName, true);
      }
      clearMarkdownCache();
      res.json({
        success: true,
        message: `Cache cleared for "${type}" (database: ${dbName})`,
      });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.delete("/api/content-types/:type/cache/:slug", async (req, res) => {
    try {
      const { type, slug } = req.params;
      const config = getContentTypeConfig(type);
      if (!config?.database?.slug) {
        res
          .status(400)
          .json({ error: `Content type "${type}" has no database configured` });
        return;
      }
      clearMarkdownCache(slug);
      res.json({ success: true, message: `Cache cleared for "${slug}"` });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.get("/api/content-types/:type/db-overrides/:slug", (req, res) => {
    try {
      const { type, slug } = req.params;
      const config = getContentTypeConfig(type);
      if (!config?.database?.slug) {
        res.status(400).json({ error: `Content type "${type}" has no database configured` });
        return;
      }
      const dbName = config.database.slug;
      if (!databaseManager.exists(dbName)) {
        res.status(404).json({ error: `Database "${dbName}" not found` });
        return;
      }
      const rawOverrides = databaseManager.getDbOverridesForEntry(dbName, slug);
      if (!rawOverrides) {
        res.json({ overrides: {}, originals: {} });
        return;
      }
      // Build a reverse map: dbPath -> templateKey using the field mapping
      const fm = getFieldMapping(type);
      const reverseMap: Record<string, string> = {};
      if (fm) {
        for (const [templateKey, dbPath] of Object.entries(fm)) {
          if (typeof dbPath === "string" && !dbPath.startsWith("function:") && !templateKey.startsWith("_")) {
            reverseMap[dbPath] = templateKey;
          }
        }
      }
      // Return overrides keyed by template key (falling back to DB key if no reverse mapping)
      const overrides: Record<string, unknown> = {};
      for (const [dbKey, value] of Object.entries(rawOverrides)) {
        const templateKey = reverseMap[dbKey] ?? dbKey;
        overrides[templateKey] = value;
      }
      // Return originals: the raw (pre-override) field values for each overridden key.
      // The fm (content-types registry field mapping) maps templateKey → dbConfigFieldName,
      // which is the key that exists in the DB-config-mapped item from getOriginalMappedItem.
      const lookupKey = getLookupKey(type) || "slug";
      const originalItem = databaseManager.getOriginalMappedItem(dbName, slug, lookupKey);
      const originals: Record<string, unknown> = {};
      if (originalItem) {
        for (const templateKey of Object.keys(overrides)) {
          // fm[templateKey] gives the DB config field name (e.g. "preview_image" for "image")
          const dbConfigField = fm?.[templateKey] ?? templateKey;
          const raw = originalItem[dbConfigField] ?? originalItem[templateKey];
          if (raw !== undefined && raw !== null) originals[templateKey] = raw;
        }
      }
      res.json({ overrides, originals });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.get("/api/db-overrides", async (_req, res) => {
    try {
      const allConfigs = getAllConfigs();
      const IMAGE_EXT_RE = /\.(jpe?g|png|webp|gif|svg|avif|tiff?|bmp|ico)(\?[^)]*)?$/i;
      const result: Array<{ contentType: string; dbName: string; slug: string; fields: Record<string, unknown> }> = [];
      for (const [contentType, config] of Object.entries(allConfigs)) {
        const dbName = config.database?.slug;
        if (!dbName) continue;
        const overrides = databaseManager.listOverrides(dbName);
        for (const { slug, fields } of overrides) {
          const imageFields: Record<string, unknown> = {};
          for (const [key, value] of Object.entries(fields)) {
            if (typeof value === "string" && IMAGE_EXT_RE.test(value)) {
              imageFields[key] = value;
            }
          }
          if (Object.keys(imageFields).length > 0) {
            result.push({ contentType, dbName, slug, fields: imageFields });
          }
        }
      }
      res.json({ overrides: result });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.delete("/api/content-types/:type/db-overrides/:slug", async (req, res) => {
    try {
      const { type, slug } = req.params;
      const rawFieldKey = req.query.field as string | undefined;
      const rawAuthor = (req.body as Record<string, unknown> | undefined)?.author;
      const authorName = rawAuthor && typeof rawAuthor === "string" ? rawAuthor : undefined;
      const config = getContentTypeConfig(type);
      if (!config?.database?.slug) {
        res.status(400).json({ error: `Content type "${type}" has no database configured` });
        return;
      }
      const dbName = config.database.slug;
      if (!databaseManager.exists(dbName)) {
        res.status(404).json({ error: `Database "${dbName}" not found` });
        return;
      }
      let fieldKey = rawFieldKey;
      if (rawFieldKey) {
        const fm = getFieldMapping(type);
        const mappedPath = fm ? fm[rawFieldKey] : undefined;
        if (mappedPath && typeof mappedPath === "string" && !mappedPath.startsWith("function:")) {
          fieldKey = mappedPath;
        }
      }
      const cleared = databaseManager.clearDbOverride(dbName, slug, fieldKey, authorName);
      res.json({
        success: true,
        cleared,
        message: cleared
          ? rawFieldKey
            ? `Override for field "${rawFieldKey}" on "${slug}" cleared`
            : `All overrides for "${slug}" cleared`
          : `No override found for "${slug}"${rawFieldKey ? ` field "${rawFieldKey}"` : ""}`,
      });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.post("/api/content-types/:type/entries/:slug/migrate-legacy", async (req, res) => {
    try {
      const { type, slug } = req.params;
      const config = getContentTypeConfig(type);
      if (!config) {
        res.status(400).json({ error: `Unknown content type "${type}"` });
        return;
      }
      const dir = path.join(getContentRoot(res), config.directory, slug);
      const promotedPath = path.join(dir, "promoted.yml");
      if (!fs.existsSync(promotedPath)) {
        res.status(400).json({ error: "Not a legacy entry — promoted.yml not found" });
        return;
      }
      const commonPath = path.join(dir, "_common.yml");
      let locale = "en";
      if (fs.existsSync(commonPath)) {
        const commonData = safeYamlLoad(fs.readFileSync(commonPath, "utf-8")) as Record<string, unknown> | null;
        if (commonData?.locale && typeof commonData.locale === "string") {
          locale = commonData.locale.trim().replace(/^["']|["']$/g, "");
        }
      }
      const destPath = path.join(dir, `${locale}.yml`);
      if (fs.existsSync(destPath)) {
        res.status(409).json({ error: `Already migrated — ${locale}.yml already exists` });
        return;
      }
      fs.renameSync(promotedPath, destPath);
      getCI(res).refresh();
      clearSitemapCache();
      invalidateContentCaches(type, getCI(res));
      res.json({ success: true, locale, newFile: `${locale}.yml` });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.post("/api/content-types/:type/ai/analyze-fields", async (req, res) => {
    try {
      const { sample_posts } = req.body || {};
      if (
        !sample_posts ||
        !Array.isArray(sample_posts) ||
        sample_posts.length === 0
      ) {
        res.status(400).json({ error: "sample_posts array is required" });
        return;
      }

      const { getLLMService } = await import("../ai/LLMService");
      const llm = getLLMService();

      const samples = sample_posts.slice(0, 3);
      const truncated = JSON.stringify(samples, null, 2).slice(0, 8000);
      const contentTypeName = req.params.type;

      const systemPrompt = `You are a data analyst. Given sample data objects from an API, identify which fields map to standard content properties. Only map fields that actually exist in the data.

Respond with valid JSON only, no markdown.`;

      const userPrompt = `Analyze these sample "${contentTypeName}" objects and map their fields to standard properties:

${truncated}

Return JSON with this exact structure:
{
  "field_mapping": {
    "title": "<source field name or dot.path>",
    "slug": "<source field name or dot.path>",
    "description": "<source field name or dot.path or null>",
    "image": "<source field name or dot.path or null>",
    "author": "<source field name or dot.path or null>",
    "published_at": "<source field name or dot.path or null>",
    "updated_at": "<source field name or dot.path or null>",
    "status": "<source field name or dot.path or null>",
    "category": "<source field name or dot.path or null>",
    "tags": "<source field name or dot.path or null>",
    "lang": "<source field name or dot.path or null>",
    "content": "<source field name or dot.path to body/markdown/html content or null>",
    "content_url": "<source field name or dot.path to markdown/content URL or null>"
  },
  "available_fields": ["<all top-level and notable nested fields found>"],
  "notes": "<any observations about the data structure>"
}

Important: Only include mappings where you are confident the field exists. Use dot notation for nested fields (e.g. "author.name", "category.slug").`;

      const result = await llm.complete(userPrompt, {
        systemPrompt,
        temperature: 0.1,
        maxTokens: 1500,
      });

      let parsed;
      try {
        const cleaned = result
          .replace(/```json?\n?/g, "")
          .replace(/```\n?/g, "")
          .trim();
        parsed = JSON.parse(cleaned);
      } catch {
        parsed = { raw: result, error: "Failed to parse AI response" };
      }

      res.json(parsed);
    } catch (err) {
      log.error({ err: err }, "AI analyze-fields error:");
      res.status(500).json({ error: String(err) });
    }
  });

  // ── End Generic Content Type API Routes ──

  app.post("/api/blog/ai/analyze-response", async (req, res) => {
    try {
      const { sample_payload } = req.body || {};
      if (!sample_payload) {
        res.status(400).json({ error: "sample_payload is required" });
        return;
      }

      const { getLLMService } = await import("../ai/LLMService");
      const llm = getLLMService();

      const truncated = JSON.stringify(sample_payload).slice(0, 8000);

      const systemPrompt = `You are an API response analyst. Given a JSON API response, determine:
1. The dot-notation path to the array of items (posts/articles). If the response IS a direct array, use empty string "".
2. Whether pagination is present, and if so what type (offset-based, cursor-based, page-based, or none).
3. The pagination metadata fields and how to use them.

Respond with valid JSON only, no markdown.`;

      const userPrompt = `Analyze this API response and determine the data extraction path and pagination strategy:

${truncated}

Return JSON with this exact structure:
{
  "results_path": "<dot.path to array or empty string if direct array>",
  "array_length": <number of items found>,
  "pagination": {
    "type": "none" | "offset" | "cursor" | "page",
    "has_more_field": "<field name or null>",
    "total_field": "<field name indicating total count or null>",
    "next_field": "<field with next page URL or cursor or null>",
    "strategy_description": "<human-readable description of how to paginate>"
  },
  "sample_item_keys": ["<list of top-level keys from first item>"]
}`;

      const result = await llm.complete(userPrompt, {
        systemPrompt,
        temperature: 0.1,
        maxTokens: 1000,
      });

      let parsed;
      try {
        const cleaned = result
          .replace(/```json?\n?/g, "")
          .replace(/```\n?/g, "")
          .trim();
        parsed = JSON.parse(cleaned);
      } catch {
        parsed = { raw: result, error: "Failed to parse AI response" };
      }

      res.json(parsed);
    } catch (err) {
      log.error({ err: err }, "AI analyze-response error:");
      res.status(500).json({ error: String(err) });
    }
  });

  app.post("/api/blog/ai/analyze-fields", async (req, res) => {
    try {
      const { sample_posts } = req.body || {};
      if (
        !sample_posts ||
        !Array.isArray(sample_posts) ||
        sample_posts.length === 0
      ) {
        res.status(400).json({ error: "sample_posts array is required" });
        return;
      }

      const { getLLMService } = await import("../ai/LLMService");
      const llm = getLLMService();

      const samples = sample_posts.slice(0, 3);
      const truncated = JSON.stringify(samples, null, 2).slice(0, 8000);

      const systemPrompt = `You are a blog post data analyst. Given sample blog post objects from an API, identify which fields map to standard blog post properties. Only map fields that actually exist in the data.

Respond with valid JSON only, no markdown.`;

      const userPrompt = `Analyze these sample blog post objects and map their fields to standard properties:

${truncated}

Return JSON with this exact structure:
{
  "field_mapping": {
    "title": "<source field name or dot.path>",
    "slug": "<source field name or dot.path>",
    "description": "<source field name or dot.path or null>",
    "image": "<source field name or dot.path or null>",
    "author": "<source field name or dot.path or null>",
    "published_at": "<source field name or dot.path or null>",
    "updated_at": "<source field name or dot.path or null>",
    "status": "<source field name or dot.path or null>",
    "category": "<source field name or dot.path or null>",
    "tags": "<source field name or dot.path or null>",
    "lang": "<source field name or dot.path or null>",
    "content": "<source field name or dot.path to body/markdown/html content or null>",
    "content_url": "<source field name or dot.path to markdown/content URL or null>"
  },
  "available_fields": ["<all top-level and notable nested fields found>"],
  "notes": "<any observations about the data structure>"
}

Important: Only include mappings where you are confident the field exists. Use dot notation for nested fields (e.g. "author.name", "category.slug").`;

      const result = await llm.complete(userPrompt, {
        systemPrompt,
        temperature: 0.1,
        maxTokens: 1500,
      });

      let parsed;
      try {
        const cleaned = result
          .replace(/```json?\n?/g, "")
          .replace(/```\n?/g, "")
          .trim();
        parsed = JSON.parse(cleaned);
      } catch {
        parsed = { raw: result, error: "Failed to parse AI response" };
      }

      res.json(parsed);
    } catch (err) {
      log.error({ err: err }, "AI analyze-fields error:");
      res.status(500).json({ error: String(err) });
    }
  });

  app.get("/api/blog/llm-config", async (_req, res) => {
    try {
      const { getLLMConfig } = await import("../ai/LLMService");
      const config = getLLMConfig();
      res.json({
        model: config.model,
        temperature: config.temperature,
        max_tokens: config.max_tokens,
        provider: {
          api_key_env: config.provider?.api_key_env || "",
          base_url_env: config.provider?.base_url_env || "",
        },
      });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.put("/api/blog/llm-config", async (req, res) => {
    try {
      const body = req.body;
      if (!body) {
        res.status(400).json({ error: "Body is required" });
        return;
      }

      const configPath = path.join(getContentRoot(res), "llm.yml");
      const newConfig: Record<string, unknown> = {
        provider: {
          api_key_env:
            body.provider?.api_key_env || "AI_INTEGRATIONS_OPENAI_API_KEY",
          base_url_env:
            body.provider?.base_url_env || "AI_INTEGRATIONS_OPENAI_BASE_URL",
        },
        model: body.model || "gpt-4o-mini",
        temperature: body.temperature ?? 0.3,
        max_tokens: body.max_tokens || 4000,
      };

      const yamlStr = yaml.dump(newConfig, { lineWidth: -1 });
      fs.writeFileSync(configPath, yamlStr, "utf-8");

      const { reloadLLMConfig } = await import("../ai/LLMService");
      reloadLLMConfig();

      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.get("/api/testimonials/:locale", (req, res) => {
    const { locale } = req.params;
    const normalizedLocale = normalizeLocale(locale);

    const testimonialsPath = path.join(
      getContentRoot(res),
      "testimonials",
      `${normalizedLocale}.yml`,
    );

    if (!fs.existsSync(testimonialsPath)) {
      res.status(404).json({ error: "Testimonials not found for locale" });
      return;
    }

    try {
      const content = fs.readFileSync(testimonialsPath, "utf8");
      const data = safeYamlLoad(content) as unknown[];
      res.json({ testimonials: data || [] });
    } catch (error) {
      log.error({ err: error }, "Error loading testimonials:");
      res.status(500).json({ error: "Failed to load testimonials" });
    }
  });

}
