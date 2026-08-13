import type { Express, Request, Response } from "express";
import { getDefaultContentRoot, getDefaultContentFolder } from "../site-config";
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
  getDebugSitemapUrls,
  invalidateSitemapEntry,
  invalidateSitemapEntriesByContentKey,
  refreshSitemapEntry,
  refreshSitemapEntriesForContentKey,
  type ActiveSiteCtx,
  toActiveSiteCtx,
} from "../sitemap";
import type { SiteContext } from "../site-manager";
import { markFileAsModified } from "../sync-state";
import { deepMerge } from "../utils/deepMerge";
import { regenerateSectionIds } from "../utils/regenerateSectionIds";
import { databaseManager, type DatabaseManager } from "../database";
import {
  redirectMiddleware,
  getRedirects,
  clearRedirectCache,
  testRedirect,
} from "../redirects";
import {
  getSchema,
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
import { resolveAllTemplateVars } from "../resolve-template-vars";
import {
  normalizeLocale,
  getSupportedLocales,
  getDefaultLocale,
  getLocaleEntries,
  updateLocaleSettings,
  getHomePage,
  getOptimizationSettings,
  updateOptimizationSettings,
  getRobotsSettings,
  buildRobotsTxtContent,
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
  resolvePageRobots,
} from "../ssr-schema";
import { collectSectionSchemasDetailed } from "../schema-components";
import {
  getSchemaOrgType,
  hasSchemaOrgContributors,
  isSchemaOrgSection,
} from "@shared/schema-org-sections";
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
  DEFAULT_DRAFT_VARIANT,
  findSourceDraftVariant,
  getEntryContentDir,
  hasLiveLocaleFile,
  listVariantSlugsForLocale,
} from "../draft-entry";


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
const log = child({ module: "routes/seo" });

/** Returns the per-site ContentIndex for this request, falling back to the global singleton in single-site mode. */
function getCI(res: Response): typeof contentIndex {
  return (res.locals.site as any)?.contentIndex ?? contentIndex;
}
function getContentRoot(res: Response): string {
  return (res.locals.site as any)?.contentRoot ?? getDefaultContentRoot();
}
function getContentRootName(res: Response): string {
  return (res.locals.site as any)?.contentRootName ?? (getDefaultContentFolder());
}
function getDB(res: Response): DatabaseManager {
  return (res.locals.site as SiteContext | undefined)?.database ?? databaseManager;
}
function getSiteSitemapCtx(res: Response): ActiveSiteCtx | undefined {
  const site = res.locals.site as SiteContext | undefined;
  if (!site?.contentIndex || !site?.contentRootName || !site?.database) return undefined;
  return toActiveSiteCtx(site);
}

function metaRecord(data: Record<string, unknown> | null | undefined): Record<string, unknown> {
  const meta = data?.meta;
  if (meta && typeof meta === "object" && !Array.isArray(meta)) {
    return { ...(meta as Record<string, unknown>) };
  }
  return {};
}

type SeoContextOption =
  | { type: "live" }
  | { type: "variant"; variant: string };

function listSeoContextsForLocale(
  contentType: string,
  slug: string,
  locale: string,
  contentRoot: string,
): { contexts: SeoContextOption[]; default: SeoContextOption | null } {
  const dir = getEntryContentDir(contentType, slug, contentRoot);
  const contexts: SeoContextOption[] = [];
  if (hasLiveLocaleFile(dir, locale)) {
    contexts.push({ type: "live" });
  }
  for (const variant of listVariantSlugsForLocale(dir, locale)) {
    contexts.push({ type: "variant", variant });
  }
  let defaultCtx: SeoContextOption | null = null;
  if (contexts.some((c) => c.type === "live")) {
    defaultCtx = { type: "live" };
  } else if (contexts.some((c) => c.type === "variant" && c.variant === DEFAULT_DRAFT_VARIANT)) {
    defaultCtx = { type: "variant", variant: DEFAULT_DRAFT_VARIANT };
  } else if (contexts.length > 0) {
    defaultCtx = contexts[0];
  }
  return { contexts, default: defaultCtx };
}

export function registerSeoRoutes(app: Express): void {
  // Dynamic robots.txt — uses SITE_URL at request time so staging and production
  // always point to the correct sitemap domain. Registered before static-file
  // middleware so this route takes precedence over public/robots.txt.
  app.get("/robots.txt", (req, res) => {
    function getRobotsBaseUrl(): string {
      if (process.env.SITE_URL) return process.env.SITE_URL.replace(/\/$/, "");
      if (process.env.REPLIT_DEV_DOMAIN) return `https://${process.env.REPLIT_DEV_DOMAIN}`;
      return "http://localhost:5000";
    }
    const baseUrl = getRobotsBaseUrl();
    const robots = getRobotsSettings(getContentRoot(res));
    const content = buildRobotsTxtContent(robots, baseUrl);
    res.set("Content-Type", "text/plain");
    res.set("Cache-Control", "public, max-age=3600");
    res.send(content);
  });

  // Dynamic sitemap with caching
  app.get("/sitemap.xml", (req, res) => {
    const siteCtx = getSiteSitemapCtx(res);
    const xml = getSitemap(siteCtx);
    res.set("Content-Type", "application/xml");
    res.set("Cache-Control", "public, max-age=3600"); // Browser cache for 1 hour
    res.send(xml);
  });

  // Get Breathecode host configuration (for debug tools)
  app.get("/api/debug/breathecode-host", (req, res) => {
    const defaultHost = "https://breathecode.herokuapp.com";
    res.json({
      host: BREATHECODE_HOST,
      isDefault: BREATHECODE_HOST === defaultHost,
    });
  });

  // Sitemap cache status (for debug tools)
  app.get("/api/debug/sitemap-cache-status", (req, res) => {
    const siteCtx = getSiteSitemapCtx(res);
    const status = getSitemapCacheStatus();
    if (siteCtx) {
      const urls = getSitemapUrls(siteCtx);
      res.json({ ...status, entryCount: urls.length });
    } else {
      res.json(status);
    }
  });

  // Sitemap URLs as JSON (for debug tools) — includes excluded + drafts
  app.get("/api/debug/sitemap-urls", (req, res) => {
    const urls = getDebugSitemapUrls(getSiteSitemapCtx(res));
    res.json(urls);
  });

  // Public sitemap URLs endpoint for menu editor
  app.get("/api/sitemap-urls", (req, res) => {
    const locale = req.query.locale as string | undefined;
    const urls = getSitemapUrls(getSiteSitemapCtx(res));

    if (locale) {
      const langPrefixes = ["/en/", "/es/", "/fr/", "/de/", "/pt/", "/it/"];
      const filteredUrls = urls.filter((entry) => {
        const path = entry.loc.replace(/^https?:\/\/[^/]+/, "");
        const matchesLocale = path.startsWith(`/${locale}/`);
        const isNeutral = !langPrefixes.some((prefix) =>
          path.startsWith(prefix),
        );
        return matchesLocale || isNeutral;
      });
      res.json(filteredUrls);
    } else {
      res.json(urls);
    }
  });

  // Returns sections for a given page path — used by LinkPicker's Section/Modal tabs
  // when a contextPath is set (e.g. in per-page CTA override rows)
  app.get("/api/page-sections", async (req, res) => {
    try {
      const pagePath = req.query.path as string;

      if (!pagePath) {
        res.status(400).json({ error: "Missing path query parameter", sections: [] });
        return;
      }

      const normalizedPath = normalizeUrl(pagePath);
      const resolved = getCI(res).resolveUrl(normalizedPath);

      let effectiveLocale = (req.query.locale as string) || "en";
      if (resolved && !req.query.locale && resolved.patternLocale) {
        effectiveLocale =
          resolved.patternLocale === "default" ? "en" : resolved.patternLocale;
      }

      let rawData: Record<string, unknown> | null = null;

      if (resolved && !resolved.fromDatabase) {
        const merged = getCI(res).loadMergedContent(
          resolved.contentType,
          resolved.slug,
          effectiveLocale,
        );
        if (merged.data) {
          rawData = merged.data;
        }
      }

      if (!rawData) {
        const service = getValidationService();
        let context = service.getContext();
        if (!context) {
          context = await service.buildContext();
        }

        const matchingFiles = (context.contentFiles as any[]).filter(
          (f: any) => normalizeUrl(getCanonicalUrl(f)) === normalizedPath,
        );

        const file =
          matchingFiles.find((f: any) => f.locale === effectiveLocale) ||
          matchingFiles.find((f: any) => f.locale !== "_common") ||
          matchingFiles[0] ||
          null;

        if (!file) {
          res.json({ sections: [] });
          return;
        }

        rawData = {};
        try {
          const commonPath = path.join(path.dirname(file.filePath), "_common.yml");
          if (fs.existsSync(commonPath)) {
            const commonData =
              (safeYamlLoad(fs.readFileSync(commonPath, "utf-8")) as Record<string, unknown>) || {};
            rawData = { ...commonData };
          }
          if (fs.existsSync(file.filePath)) {
            const localeData =
              (safeYamlLoad(fs.readFileSync(file.filePath, "utf-8")) as Record<string, unknown>) || {};
            rawData = { ...rawData, ...localeData };
          }
        } catch {}
      }

      const includeYaml = req.query.includeYaml === "true";
      const rawSections = (rawData.sections as any[]) || [];
      const sections = rawSections
        .filter((s: any) => s?.type)
        .map((s: any, index: number) => {
          const base: Record<string, unknown> = {
            type: s.type as string,
            section_id: (s.section_id as string) || null,
            label:
              (s.title as string) ||
              (s.heading as string) ||
              `${s.type} (section ${index + 1})`,
          };
          if (includeYaml) {
            base.yamlContent = safeYamlDump([s], { lineWidth: -1 });
          }
          return base;
        });

      res.json({ sections });
    } catch (e) {
      res.status(500).json({ error: String(e), sections: [] });
    }
  });

  // ============================================================================
  // Blog API routes
  // ============================================================================
  app.get("/api/seo/overview", (req, res) => {
    try {
      const entries = getCI(res).listAll();
      const seoEntries = getCI(res).getAllSeoEntries();

      const intentDistribution: Record<string, Record<string, number>> = {};
      const clusterMap = new Map<string, string[]>();
      const orphanPages: { slug: string; contentType: string; intent: string; filePath: string }[] = [];
      const featureCoverage: Record<string, number> = {};
      const faqCoverage: { slug: string; contentType: string; locale: string; faqCount: number }[] = [];
      const schemaCoverage: Record<string, number> = {};

      let totalPages = 0;
      let withPillar = 0;
      let withIntent = 0;
      let withFocusFeatures = 0;
      let withFaq = 0;
      let withSchema = 0;

      const highPriorityTypes = new Set([getFolder("program"), getFolder("landing")]);

      for (const entry of entries) {
        const ct = entry.contentType;
        for (const locale of entry.locales) {
          if (locale.startsWith("_") || locale.includes(".")) continue;
          totalPages++;

          const merged = getCI(res).loadMergedContent(ct, entry.slug, locale);
          if (!merged.data) continue;
          const data = merged.data as Record<string, unknown>;

          const seo = data.seo as Record<string, unknown> | undefined;
          const sections = data.sections as { type?: string }[] | undefined;

          const intent = (seo?.intent as string) || "unknown";
          const pillar = typeof seo?.pillar === "string" && seo.pillar ? seo.pillar : undefined;
          const focusFeatures = Array.isArray(seo?.focus_features)
            ? (seo!.focus_features as string[]).filter((f) => typeof f === "string")
            : [];

          if (!intentDistribution[ct]) intentDistribution[ct] = {};
          intentDistribution[ct][intent] = (intentDistribution[ct][intent] || 0) + 1;

          if (seo?.intent) withIntent++;

          if (pillar) {
            withPillar++;
            const cluster = clusterMap.get(pillar) || [];
            if (!cluster.includes(entry.slug)) cluster.push(entry.slug);
            clusterMap.set(pillar, cluster);
          } else if (highPriorityTypes.has(ct)) {
            orphanPages.push({
              slug: entry.slug,
              contentType: ct,
              intent,
              filePath: merged.filePath,
            });
          }

          if (focusFeatures.length > 0) {
            withFocusFeatures++;
            for (const f of focusFeatures) {
              featureCoverage[f] = (featureCoverage[f] || 0) + 1;
            }
          }

          if (Array.isArray(sections)) {
            const faqSections = sections.filter((s) => s?.type === "faq");
            if (faqSections.length > 0) {
              withFaq++;
              faqCoverage.push({
                slug: entry.slug,
                contentType: ct,
                locale,
                faqCount: faqSections.length,
              });
            }

            if (hasSchemaOrgContributors(sections)) {
              withSchema++;
              for (const sec of sections) {
                if (!sec || typeof sec !== "object") continue;
                const t = String((sec as { type?: string }).type ?? "");
                if (isSchemaOrgSection(sec)) {
                  const st = getSchemaOrgType(sec as Record<string, unknown>) || "schema_org";
                  schemaCoverage[st] = (schemaCoverage[st] || 0) + 1;
                } else if (t === "faq") {
                  schemaCoverage["FAQPage"] = (schemaCoverage["FAQPage"] || 0) + 1;
                } else if (t === "article") {
                  schemaCoverage["Article"] = (schemaCoverage["Article"] || 0) + 1;
                } else if (t === "breadcrumb") {
                  schemaCoverage["BreadcrumbList"] =
                    (schemaCoverage["BreadcrumbList"] || 0) + 1;
                }
              }
            }
          }
        }
      }

      const clusters = Array.from(clusterMap.entries()).map(([pillarUrl, clusterSlugs]) => ({
        pillarUrl,
        clusterSlugs,
        clusterCount: clusterSlugs.length,
      }));

      const uniqueOrphans = orphanPages.filter(
        (o, i, arr) => arr.findIndex((x) => x.slug === o.slug && x.contentType === o.contentType) === i,
      );

      res.json({
        intentDistribution,
        clusters,
        orphanPages: uniqueOrphans,
        featureCoverage,
        faqCoverage,
        schemaCoverage,
        totals: {
          totalPages,
          withPillar,
          withIntent,
          withFocusFeatures,
          withFaq,
          withSchema,
        },
      });
    } catch (err) {
      res.status(500).json({ error: "Failed to build SEO overview", message: String(err) });
    }
  });

  app.get("/api/seo-preview/:contentType/:slug/contexts", (req, res) => {
    try {
      const { contentType, slug } = req.params;
      const locale = normalizeLocale(
        (req.query.locale as string) || getDefaultLocale(),
      );

      if (!isValidType(contentType)) {
        res.status(400).json({
          error: `Invalid content type. Must be one of: ${getAllFolders().join(", ")}`,
        });
        return;
      }

      // DB-backed / shared-layout singles: live-only (C1)
      if (hasDatabaseSingle(contentType, getContentRoot(res))) {
        res.json({
          contexts: [{ type: "live" }] satisfies SeoContextOption[],
          default: { type: "live" } satisfies SeoContextOption,
        });
        return;
      }

      const listed = listSeoContextsForLocale(
        contentType,
        slug,
        locale,
        getContentRoot(res),
      );
      res.json(listed);
    } catch (error) {
      log.error({ err: error }, "[SEO Preview] contexts error:");
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get("/api/seo-preview/:contentType/:slug", async (req, res) => {
    try {
      const { contentType, slug } = req.params;
      const locale = normalizeLocale(
        (req.query.locale as string) || getDefaultLocale(),
      );
      const queryVariantRaw = req.query.variant;
      const queryVariant =
        typeof queryVariantRaw === "string" &&
        queryVariantRaw &&
        queryVariantRaw !== "default"
          ? queryVariantRaw
          : undefined;

      if (!isValidType(contentType)) {
        res.status(400).json({
          error: `Invalid content type. Must be one of: ${getAllFolders().join(", ")}`,
        });
        return;
      }

      if (hasDatabaseSingle(contentType, getContentRoot(res))) {
        const page = await loadDatabaseSinglePage(contentType, slug, locale, getContentRoot(res), getDB(res));
        if (!page) {
          res.status(404).json({ error: "Content not found" });
          return;
        }

        const singleEntry = (page.singleEntry as Record<string, unknown>) || {};
        const resolvedPage = resolveAllTemplateVars(page, {
          singleEntry,
          contentRoot: getContentRoot(res),
          context: { locale },
          skipSiteVars: false,
        }) as typeof page;

        const meta = (resolvedPage.meta as Record<string, unknown>) || {};
        const dbSections = resolvedPage.sections as Array<Record<string, unknown>> | undefined;
        let faqSchema: Record<string, unknown> | null = null;
        let schemaOrg: Record<string, unknown>[] = [];
        let schemaOrgDocuments: Array<{
          schema: Record<string, unknown>;
          source: string;
        }> = [];

        if (Array.isArray(dbSections)) {
          const withDynamic = (await resolveDynamicEntries(dbSections, locale, {
            contentRoot: getContentRoot(res),
            contentIndex: getCI(res),
            singleEntry,
          })) as Array<Record<string, unknown>>;
          const collected = collectSectionSchemasDetailed(withDynamic, {
            locale,
            contentRoot: getContentRoot(res),
            baseUrl: getBaseUrl(),
            contentType,
            pageUrl: typeof meta.canonical_url === "string" ? meta.canonical_url : undefined,
            title: typeof meta.page_title === "string" ? meta.page_title : undefined,
            description: typeof meta.description === "string" ? meta.description : undefined,
            image: typeof meta.og_image === "string" ? meta.og_image : undefined,
          });
          schemaOrg = collected.documents;
          schemaOrgDocuments = collected.preview;
          faqSchema =
            collected.preview.find((p) => p.source === "faq")?.schema ??
            collected.documents.find((s) => s["@type"] === "FAQPage") ??
            null;
        }

        const schema = resolvedPage.schema as
          | {
              include?: string[];
              overrides?: Record<string, Record<string, unknown>>;
            }
          | undefined;

        res.json({
          meta,
          liveMeta: meta,
          metaOverrides: [],
          context: "live" as const,
          faqSchema,
          schemaOrg,
          schemaOrgDocuments,
          schemaInclude: (schema?.include as string[]) || [],
          schemaOverrides:
            (schema?.overrides as Record<string, Record<string, unknown>>) || {},
          title: (resolvedPage.title as string) || "",
          slug: (resolvedPage.slug as string) || slug,
        });
        return;
      }

      const ci = getCI(res);
      const contentRoot = getContentRoot(res);
      const contentDir = getEntryContentDir(contentType, slug, contentRoot);
      const commonData = (ci.loadCommonData(contentType as ContentType, slug) ||
        {}) as Record<string, unknown>;
      const commonMeta = metaRecord(commonData);

      const liveFile = ci.loadLocaleData(contentType, slug, locale);
      const hasLive = !!liveFile.data && !liveFile.error;
      const liveOwnMeta = hasLive ? metaRecord(liveFile.data) : {};
      const liveMeta = deepMerge(commonMeta, liveOwnMeta);

      let resolvedVariant = queryVariant;
      // Variant-only entries: auto-pick when caller omitted variant
      if (!resolvedVariant && !hasLive) {
        resolvedVariant =
          findSourceDraftVariant(contentDir, locale) ?? undefined;
      }

      const contextIsVariant = !!resolvedVariant;
      let pageData: Record<string, unknown> | null = null;
      let variantOwnMeta: Record<string, unknown> = {};
      let metaOverrides: string[] = [];
      let displayMeta: Record<string, unknown> = liveMeta;

      if (contextIsVariant && resolvedVariant) {
        const variantFile = ci.loadLocaleData(
          contentType,
          slug,
          locale,
          resolvedVariant,
        );
        if (!variantFile.data) {
          res.status(404).json({ error: "Content not found" });
          return;
        }
        variantOwnMeta = metaRecord(variantFile.data);
        metaOverrides = Object.keys(variantOwnMeta);
        displayMeta = deepMerge(liveMeta, variantOwnMeta);
        pageData = deepMerge(
          deepMerge(commonData, hasLive ? liveFile.data! : {}),
          variantFile.data,
        );
      } else if (hasLive) {
        pageData = deepMerge(commonData, liveFile.data!);
        displayMeta = liveMeta;
      } else {
        res.status(404).json({ error: "Content not found" });
        return;
      }

      const schema = pageData.schema as
        | {
            include?: string[];
            overrides?: Record<string, Record<string, unknown>>;
          }
        | undefined;

      // Sections from the active context file (variant or live)
      const mergedContent = ci.loadMergedContent(
        contentType,
        slug,
        locale,
        contextIsVariant ? resolvedVariant : undefined,
      );
      let sectionsSource = mergedContent.data ?? pageData;
      if (mergedContent.data && mergedContent.isSharedTemplate) {
        sectionsSource = resolveAllTemplateVars(sectionsSource, {
          singleEntry: sectionsSource as Record<string, unknown>,
          contentRoot,
          context: { locale },
          skipSiteVars: false,
        }) as Record<string, unknown>;
      }
      const sections = sectionsSource.sections as
        | Array<Record<string, unknown>>
        | undefined;

      let faqSchema: Record<string, unknown> | null = null;
      let schemaOrg: Record<string, unknown>[] = [];
      let schemaOrgDocuments: Array<{
        schema: Record<string, unknown>;
        source: string;
      }> = [];

      if (Array.isArray(sections)) {
        const singleEntry: Record<string, unknown> = {
          ...(sectionsSource as Record<string, unknown>),
          slug,
          _slug: slug,
        };
        const withDynamic = (await resolveDynamicEntries(sections, locale, {
          contentRoot,
          contentIndex: ci,
          singleEntry,
        })) as Array<Record<string, unknown>>;
        const collected = collectSectionSchemasDetailed(withDynamic, {
          locale,
          contentRoot,
          baseUrl: getBaseUrl(),
          contentType,
          locationSlug: getType(contentType) === "location" ? slug : undefined,
          programSlug: getType(contentType) === "program" ? slug : undefined,
          pageUrl:
            typeof displayMeta.canonical_url === "string"
              ? displayMeta.canonical_url
              : undefined,
          title:
            typeof displayMeta.page_title === "string"
              ? displayMeta.page_title
              : undefined,
          description:
            typeof displayMeta.description === "string"
              ? displayMeta.description
              : undefined,
          image:
            typeof displayMeta.og_image === "string"
              ? displayMeta.og_image
              : undefined,
        });
        schemaOrg = collected.documents;
        schemaOrgDocuments = collected.preview;
        faqSchema =
          collected.preview.find((p) => p.source === "faq")?.schema ??
          collected.documents.find((s) => s["@type"] === "FAQPage") ??
          null;
      }

      const schemaInclude = (schema?.include as string[]) || [];
      const schemaOverrides =
        (schema?.overrides as Record<string, Record<string, unknown>>) || {};

      const responseData: Record<string, unknown> = {
        meta: displayMeta,
        liveMeta,
        metaOverrides,
        context: contextIsVariant ? "variant" : "live",
        ...(contextIsVariant && resolvedVariant
          ? { variant: resolvedVariant }
          : {}),
        faqSchema,
        schemaOrg,
        schemaOrgDocuments,
        schemaInclude,
        schemaOverrides,
        title: (pageData.title as string) || "",
        slug: (pageData.slug as string) || slug,
      };

      if (getType(contentType) === "landing") {
        responseData.locations = (commonData?.locations as string[]) || [];
        responseData.availableLocations = listLocationPages(locale, ci).map(
          (loc) => ({
            slug: loc.slug,
            name: loc.name,
            city: loc.city,
            country: loc.country,
          }),
        );
      }

      res.json(responseData);
    } catch (error) {
      log.error({ err: error }, "[SEO Preview] Error:");
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.post("/api/content/update-locations", async (req, res) => {
    try {
      const auth = await requireCapability(req, res, "content_edit_structure", req.body.contentType || req.body.type || undefined);
      if (!auth.authorized) return;

      const { contentType, slug, locations, author } = req.body;
      if (!contentType || !slug || !Array.isArray(locations)) {
        res.status(400).json({
          error:
            "Missing required fields: contentType, slug, locations (array)",
        });
        return;
      }
      if (getType(contentType) !== "landing") {
        res
          .status(400)
          .json({ error: "Locations can only be updated for landings" });
        return;
      }

      const authorName =
        author && typeof author === "string" ? author : undefined;

      const result = editCommonContent({
        contentType,
        slug,
        operations: [
          {
            action: "update_field",
            path: "locations",
            value: locations.length > 0 ? locations : null,
          },
        ],
        author: authorName,
        ci: getCI(res),
        contentRootName: getContentRootName(res),
      });

      if (!result.success) {
        res.status(400).json({ error: result.error });
        return;
      }

      const landingDir = getCI(res).getContentFolderPath(contentType, slug);
      const variantFiles = fs
        .readdirSync(landingDir)
        .filter((f) => f.endsWith(".yml") && f !== "_common.yml");
      const strippedVariants: string[] = [];
      for (const variantFile of variantFiles) {
        const variantPath = path.join(landingDir, variantFile);
        try {
          const variantContent = fs.readFileSync(variantPath, "utf-8");
          const variantData = safeYamlLoad(variantContent) as Record<
            string,
            unknown
          >;
          if (variantData && "locations" in variantData) {
            delete variantData.locations;
            const variantYaml = safeYamlDump(variantData, {
              lineWidth: -1,
              noRefs: true,
              quotingType: '"',
              forceQuotes: false,
            });
            fs.writeFileSync(variantPath, variantYaml, "utf-8");
            markFileAsModified(variantPath, authorName);
            strippedVariants.push(variantFile);
          }
        } catch (e) {
          log.warn(
            `[Update Locations] Could not process variant ${variantFile}:`,
            e,
          );
        }
      }
      if (strippedVariants.length > 0) {
        log.info(
          `[Update Locations] Removed locations from variants: ${strippedVariants.join(", ")}`,
        );
      }

      getCI(res).refresh();
      invalidateContentCaches(contentType);

      res.json({
        success: true,
        locations: locations.length > 0 ? locations : [],
        strippedVariants,
      });
    } catch (error) {
      log.error({ err: error }, "[Update Locations] Error:");
      res.status(500).json({ error: "Internal server error" });
    }
  });

}
