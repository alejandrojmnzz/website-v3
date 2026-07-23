import type { Express, Request, Response } from "express";
import { getDefaultContentRoot } from "../site-config";
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

/** Returns the per-site ContentIndex for this request, falling back to the global singleton in single-site mode. */
function getCI(res: Response): typeof contentIndex {
  return (res.locals.site as any)?.contentIndex ?? contentIndex;
}
function getContentRoot(res: Response): string {
  return (res.locals.site as any)?.contentRoot ?? getDefaultContentRoot();
}
function getContentRootName(res: Response): string {
  const cr = getContentRoot(res);
  return path.isAbsolute(cr) ? path.relative(process.cwd(), cr) : cr;
}

export function registerVersioningRoutes(app: Express): void {
  app.get("/api/debug/versioning", (req, res) => {
    const versioningManager = (res.locals.site as any)?.versioningManager ?? getVersioningManager();
    const stats = versioningManager.getStats();
    res.json({
      stats,
      totalVariants: Object.keys(stats).length,
    });
  });

  app.post("/api/debug/clear-versioning-cache", async (req, res) => {
    const auth = await requireCapability(req, res, "content_allocate_traffic");
    if (!auth.authorized) return;
    const versioningManager = (res.locals.site as any)?.versioningManager ?? getVersioningManager();
    versioningManager.clearCache();
    res.json({ success: true, message: "Versioning cache cleared" });
  });
  app.get("/api/variants/:contentType/:slug", (req, res) => {
    const { contentType, slug } = req.params;

    if (!isValidType(contentType)) {
      res
        .status(400)
        .json({ error: "Invalid content type", validTypes: getAllFolders() });
      return;
    }

    const versioningManager = (res.locals.site as any)?.versioningManager ?? getVersioningManager();
    const result = versioningManager.getAvailableVariants(contentType, slug);

    if (!result) {
      res.status(404).json({ error: "Content folder not found" });
      return;
    }

    res.json(result);
  });

  // Get versioning data for a specific content type and slug
  app.get("/api/versioning/:contentType/:contentSlug", (req, res) => {
    const { contentType, contentSlug } = req.params;

    if (!isValidType(contentType)) {
      res.status(400).json({
        error: "Invalid content type",
        validTypes: getAllFolders(),
      });
      return;
    }

    const availableLocales = getLocaleEntries().map((l: { code: string }) => l.code);

    // DB-single: versioning.yml lives at the content-type folder level (no slug subfolder)
    if (hasDatabaseSingle(contentType, getContentRoot(res))) {
      const folder = getFolder(contentType as ContentType);
      const filePath = path.join(getContentRoot(res), folder, "versioning.yml");
      if (!fs.existsSync(filePath)) {
        res.json({ versioning: null, hasVersioningFile: false, filePath, availableLocales, isDatabaseSingle: true });
        return;
      }
      try {
        const raw = safeYamlLoad(fs.readFileSync(filePath, "utf-8"));
        res.json({ versioning: raw || null, hasVersioningFile: true, filePath, availableLocales, isDatabaseSingle: true });
      } catch {
        res.status(500).json({ error: "Failed to read versioning.yml" });
      }
      return;
    }

    const versioningManager = (res.locals.site as any)?.versioningManager ?? getVersioningManager();
    const versioning = versioningManager.getVersioningForContent(contentType, contentSlug);
    const filePath = path.join(
      getContentRoot(res),
      getFolder(contentType as ContentType) || contentType,
      contentSlug,
      "versioning.yml",
    );

    if (!versioning) {
      res.json({
        versioning: null,
        hasVersioningFile: false,
        filePath,
        availableLocales,
      });
      return;
    }

    res.json({
      versioning,
      hasVersioningFile: true,
      filePath,
      availableLocales,
    });
  });

  // Update versioning allocations for a locale
  app.patch(
    "/api/versioning/:contentType/:contentSlug/:locale",
    async (req, res) => {
      const { contentType, contentSlug, locale } = req.params;

      if (!isValidType(contentType)) {
        res
          .status(400)
          .json({ error: "Invalid content type", validTypes: getAllFolders() });
        return;
      }

      const auth = await requireCapability(req, res, "content_allocate_traffic", contentType);
      if (!auth.authorized) return;

      const parseResult = versioningUpdateSchema.safeParse(req.body);
      if (!parseResult.success) {
        res.status(400).json({
          error: "Invalid update data",
          details: parseResult.error.issues.map((i) => ({
            path: i.path.join("."),
            message: i.message,
          })),
        });
        return;
      }

      const versioningManager = (res.locals.site as any)?.versioningManager ?? getVersioningManager();
      try {
        const existing = versioningManager.getVersioningForContent(contentType, contentSlug) || {};
        const updated = { ...existing, [locale]: { variants: parseResult.data.variants } };
        // updateVersioning writes the file and calls markFileAsModified, which queues
        // versioning.yml for auto-commit — the same path taken by create/promote/delete routes.
        versioningManager.updateVersioning(contentType, contentSlug, updated);
        res.json({ success: true, contentType, contentSlug, locale });
      } catch (error) {
        res.status(400).json({
          error:
            error instanceof Error
              ? error.message
              : "Failed to update versioning",
        });
      }
    },
  );

  // Create a new content variant (copies locale file + registers in versioning.yml at 0% allocation)
  app.post("/api/versioning/:contentType/:contentSlug", async (req, res) => {
    const { contentType, contentSlug } = req.params;

    if (!isValidType(contentType)) {
      res.status(400).json({ error: "Invalid content type", validTypes: getAllFolders() });
      return;
    }

    const auth = await requireCapability(req, res, "content_create_variant", contentType);
    if (!auth.authorized) return;

    const { variantSlug, locale } = req.body as { variantSlug?: string; locale?: string };

    if (!variantSlug || !locale) {
      res.status(400).json({ error: "variantSlug and locale are required" });
      return;
    }

    if (!/^[a-z0-9-]+$/.test(variantSlug)) {
      res.status(400).json({ error: "variantSlug must be lowercase letters, numbers, and hyphens only" });
      return;
    }

    const folder = getFolder(contentType as ContentType);

    // DB-single: copy single.{locale}.yml → single-{variantSlug}.{locale}.yml at content-type folder level
    if (hasDatabaseSingle(contentType, getContentRoot(res))) {
      const contentTypeDir = path.join(getContentRoot(res), folder);
      const variantFile = path.join(contentTypeDir, `single-${variantSlug}.${locale}.yml`);
      if (fs.existsSync(variantFile)) {
        res.status(409).json({ error: `Variant single-${variantSlug}.${locale}.yml already exists` });
        return;
      }
      let sourceFile = path.join(contentTypeDir, `single.${locale}.yml`);
      if (!fs.existsSync(sourceFile)) sourceFile = path.join(contentTypeDir, "single.en.yml");
      if (!fs.existsSync(sourceFile)) {
        res.status(404).json({ error: `single.${locale}.yml not found for content type ${contentType}` });
        return;
      }
      try {
        fs.writeFileSync(variantFile, fs.readFileSync(sourceFile, "utf-8"), "utf-8");
        markFileAsModified(`${folder}/single-${variantSlug}.${locale}.yml`, "api", undefined, getContentRoot(res));

        const versioningFilePath = path.join(contentTypeDir, "versioning.yml");
        const existing: Record<string, any> = fs.existsSync(versioningFilePath)
          ? ((safeYamlLoad(fs.readFileSync(versioningFilePath, "utf-8")) as any) || {})
          : {};
        if (!existing[locale]) existing[locale] = { variants: [] };
        if (!existing[locale].variants.some((v: any) => v.slug === variantSlug)) {
          existing[locale].variants.push({ slug: variantSlug });
        }
        fs.writeFileSync(versioningFilePath, safeYamlDump(existing), "utf-8");
        markFileAsModified(`${folder}/versioning.yml`, "api", undefined, getContentRoot(res));

        res.json({
          success: true,
          variantSlug,
          locale,
          isDatabaseSingle: true,
          previewSlug: contentSlug,
          filePath: `${getContentRootName(res)}/${folder}/single-${variantSlug}.${locale}.yml`,
        });
      } catch (error) {
        res.status(500).json({ error: String(error) });
      }
      return;
    }

    const contentDir = path.join(getContentRoot(res), folder, contentSlug);

    if (!fs.existsSync(contentDir)) {
      res.status(404).json({ error: "Content folder not found" });
      return;
    }

    const variantFilePath = path.join(contentDir, `${variantSlug}.${locale}.yml`);
    if (fs.existsSync(variantFilePath)) {
      res.status(409).json({ error: `Variant ${variantSlug}.${locale}.yml already exists` });
      return;
    }

    const sourceFilePath = path.join(contentDir, `${locale}.yml`);
    if (!fs.existsSync(sourceFilePath)) {
      res.status(404).json({ error: `Source file ${locale}.yml not found for this entry` });
      return;
    }

    try {
      const sourceContent = fs.readFileSync(sourceFilePath, "utf-8");
      fs.writeFileSync(variantFilePath, sourceContent, "utf-8");
      markFileAsModified(`${folder}/${contentSlug}/${variantSlug}.${locale}.yml`, "api", undefined, getContentRoot(res));

      const versioningManager = (res.locals.site as any)?.versioningManager ?? getVersioningManager();
      const existing = versioningManager.getVersioningForContent(contentType, contentSlug) || {};
      const localeData = existing[locale]
        ? { variants: [...(existing[locale].variants || [])] }
        : { variants: [] };

      if (!localeData.variants.some((v) => v.slug === variantSlug)) {
        localeData.variants.push({ slug: variantSlug, allocation: 0 });
      }

      versioningManager.updateVersioning(contentType, contentSlug, { ...existing, [locale]: localeData });

      res.json({
        success: true,
        variantSlug,
        locale,
        filePath: `${getContentRootName(res)}/${folder}/${contentSlug}/${variantSlug}.${locale}.yml`,
      });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // Promote a variant: overwrite the default locale file, remove from versioning.yml, delete variant file
  app.post("/api/versioning/:contentType/:contentSlug/:locale/promote/:variantSlug", async (req, res) => {
    const { contentType, contentSlug, locale, variantSlug } = req.params;

    if (!isValidType(contentType)) {
      res.status(400).json({ error: "Invalid content type", validTypes: getAllFolders() });
      return;
    }

    const auth = await requireCapability(req, res, "content_promote_variant", contentType);
    if (!auth.authorized) return;

    if (!/^[a-z0-9-]+$/.test(variantSlug)) {
      res.status(400).json({ error: "variantSlug must be lowercase letters, numbers, and hyphens only" });
      return;
    }

    if (!/^[a-z]{2}(-[A-Z]{2})?$/.test(locale)) {
      res.status(400).json({ error: "locale must be a valid language code (e.g. en, es, pt-BR)" });
      return;
    }

    const folder = getFolder(contentType as ContentType);

    // DB-single: variant is single-{variantSlug}.{locale}.yml at the content-type folder level.
    // scope = "template" → overwrite single.{locale}.yml (affects all items)
    // scope = "item"     → write per-entry override to {contentType}/{itemSlug}/{locale}.yml
    if (hasDatabaseSingle(contentType, getContentRoot(res))) {
      const scope = (req.body as any)?.scope as "item" | "template" | undefined;
      if (!scope || (scope !== "item" && scope !== "template")) {
        res.status(400).json({ error: "scope must be 'item' or 'template' for database single content types" });
        return;
      }

      const contentTypeDir = path.resolve(getContentRoot(res), folder);
      const variantFilePath = path.resolve(contentTypeDir, `single-${variantSlug}.${locale}.yml`);

      if (!variantFilePath.startsWith(contentTypeDir + path.sep)) {
        res.status(400).json({ error: "Invalid file path" });
        return;
      }
      if (!fs.existsSync(variantFilePath)) {
        res.status(404).json({ error: `Variant file single-${variantSlug}.${locale}.yml not found` });
        return;
      }

      try {
        const variantContent = fs.readFileSync(variantFilePath, "utf-8");

        if (scope === "template") {
          // Overwrite the shared template for all items
          const templateFilePath = path.resolve(contentTypeDir, `single.${locale}.yml`);
          fs.writeFileSync(templateFilePath, variantContent, "utf-8");
          markFileAsModified(`${folder}/single.${locale}.yml`, "api", undefined, getContentRoot(res));
        } else {
          // Create/overwrite a per-entry override for this specific DB item slug
          const entryDir = path.resolve(contentTypeDir, contentSlug);
          if (!fs.existsSync(entryDir)) fs.mkdirSync(entryDir, { recursive: true });
          const entryFilePath = path.resolve(entryDir, `${locale}.yml`);
          fs.writeFileSync(entryFilePath, variantContent, "utf-8");
          markFileAsModified(`${folder}/${contentSlug}/${locale}.yml`, "api", undefined, getContentRoot(res));
        }

        // Remove variant from content-type-level versioning.yml
        const versioningFilePath = path.resolve(contentTypeDir, "versioning.yml");
        if (fs.existsSync(versioningFilePath)) {
          const existing: Record<string, any> = (safeYamlLoad(fs.readFileSync(versioningFilePath, "utf-8")) as any) || {};
          if (existing[locale]) {
            existing[locale].variants = (existing[locale].variants || []).filter((v: any) => v.slug !== variantSlug);
          }
          fs.writeFileSync(versioningFilePath, safeYamlDump(existing), "utf-8");
          markFileAsModified(`${folder}/versioning.yml`, "api", undefined, getContentRoot(res));
        }

        fs.unlinkSync(variantFilePath);
        markFileAsModified(`${folder}/single-${variantSlug}.${locale}.yml`, "api", undefined, getContentRoot(res));

        getCI(res).invalidateCommonFields(contentType);
        clearSsrSchemaCache();
        res.json({ success: true, scope });
      } catch (error) {
        res.status(500).json({ error: String(error) });
      }
      return;
    }

    const contentDir = path.resolve(getContentRoot(res), folder, contentSlug);

    if (!fs.existsSync(contentDir)) {
      res.status(404).json({ error: "Content folder not found" });
      return;
    }

    const variantFilePath = path.resolve(contentDir, `${variantSlug}.${locale}.yml`);
    const defaultFilePath = path.resolve(contentDir, `${locale}.yml`);

    // Path containment: both resolved paths must stay within contentDir
    if (!variantFilePath.startsWith(contentDir + path.sep) || !defaultFilePath.startsWith(contentDir + path.sep)) {
      res.status(400).json({ error: "Invalid file path" });
      return;
    }

    if (!fs.existsSync(variantFilePath)) {
      res.status(404).json({ error: `Variant file ${variantSlug}.${locale}.yml not found` });
      return;
    }

    try {
      const variantContent = fs.readFileSync(variantFilePath, "utf-8");
      fs.writeFileSync(defaultFilePath, variantContent, "utf-8");

      const versioningManager = (res.locals.site as any)?.versioningManager ?? getVersioningManager();
      const existing = versioningManager.getVersioningForContent(contentType, contentSlug) || {};
      const localeData = existing[locale];
      if (localeData) {
        const updatedVariants = (localeData.variants || []).filter((v) => v.slug !== variantSlug);
        versioningManager.updateVersioning(contentType, contentSlug, {
          ...existing,
          [locale]: { variants: updatedVariants },
        });
      }

      fs.unlinkSync(variantFilePath);

      getCI(res).invalidateCommonFields(contentType);
      clearSsrSchemaCache();
      const folder2 = getFolder(contentType as ContentType);
      markFileAsModified(`${folder2}/${contentSlug}/${locale}.yml`, "api", undefined, getContentRoot(res));
      markFileAsModified(`${folder2}/${contentSlug}/${variantSlug}.${locale}.yml`, "api", undefined, getContentRoot(res));

      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // Delete a variant: remove its YML file and strip its entry from versioning.yml
  app.delete("/api/versioning/:contentType/:contentSlug/:locale/:variantSlug", async (req, res) => {
    const { contentType, contentSlug, locale, variantSlug } = req.params;

    if (!isValidType(contentType)) {
      res.status(400).json({ error: "Invalid content type", validTypes: getAllFolders() });
      return;
    }

    const auth = await requireCapability(req, res, "content_delete_variant", contentType);
    if (!auth.authorized) return;

    if (!/^[a-z0-9-]+$/.test(variantSlug)) {
      res.status(400).json({ error: "variantSlug must be lowercase letters, numbers, and hyphens only" });
      return;
    }

    if (!/^[a-z]{2}(-[A-Z]{2})?$/.test(locale)) {
      res.status(400).json({ error: "locale must be a valid language code (e.g. en, es, pt-BR)" });
      return;
    }

    const folder = getFolder(contentType as ContentType);
    const availableLocales = getLocaleEntries().map((l: { code: string }) => l.code);

    // DB-single: variant file is at content-type folder level (single-{variantSlug}.{locale}.yml)
    if (hasDatabaseSingle(contentType, getContentRoot(res))) {
      const contentTypeDir = path.resolve(getContentRoot(res), folder);
      const variantFilePath = path.resolve(contentTypeDir, `single-${variantSlug}.${locale}.yml`);

      if (!variantFilePath.startsWith(contentTypeDir + path.sep)) {
        res.status(400).json({ error: "Invalid file path" });
        return;
      }
      if (!fs.existsSync(variantFilePath)) {
        res.status(404).json({ error: `Variant file single-${variantSlug}.${locale}.yml not found` });
        return;
      }

      try {
        fs.unlinkSync(variantFilePath);
        markFileAsModified(`${folder}/single-${variantSlug}.${locale}.yml`, "api", undefined, getContentRoot(res));

        const versioningFilePath = path.resolve(contentTypeDir, "versioning.yml");
        let updated: Record<string, any> = {};
        if (fs.existsSync(versioningFilePath)) {
          updated = (safeYamlLoad(fs.readFileSync(versioningFilePath, "utf-8")) as any) || {};
          if (updated[locale]) {
            updated[locale].variants = (updated[locale].variants || []).filter((v: any) => v.slug !== variantSlug);
          }
          fs.writeFileSync(versioningFilePath, safeYamlDump(updated), "utf-8");
          markFileAsModified(`${folder}/versioning.yml`, "api", undefined, getContentRoot(res));
        }

        getCI(res).invalidateCommonFields(contentType);
        clearSsrSchemaCache();
        res.json({ hasVersioningFile: Object.keys(updated).some(k => (updated[k]?.variants?.length ?? 0) > 0), versioning: updated, availableLocales, isDatabaseSingle: true });
      } catch (error) {
        res.status(500).json({ error: String(error) });
      }
      return;
    }

    const contentDir = path.resolve(getContentRoot(res), folder, contentSlug);

    if (!fs.existsSync(contentDir)) {
      res.status(404).json({ error: "Content folder not found" });
      return;
    }

    const variantFilePath = path.resolve(contentDir, `${variantSlug}.${locale}.yml`);

    // Path containment: resolved path must stay within contentDir
    if (!variantFilePath.startsWith(contentDir + path.sep)) {
      res.status(400).json({ error: "Invalid file path" });
      return;
    }

    if (!fs.existsSync(variantFilePath)) {
      res.status(404).json({ error: `Variant file ${variantSlug}.${locale}.yml not found` });
      return;
    }

    try {
      fs.unlinkSync(variantFilePath);
      markFileAsModified(`${folder}/${contentSlug}/${variantSlug}.${locale}.yml`, "api", undefined, getContentRoot(res));

      const versioningManager = (res.locals.site as any)?.versioningManager ?? getVersioningManager();
      const existing = versioningManager.getVersioningForContent(contentType, contentSlug) || {};
      const localeData = existing[locale];
      if (localeData) {
        const updatedVariants = (localeData.variants || []).filter((v) => v.slug !== variantSlug);
        versioningManager.updateVersioning(contentType, contentSlug, {
          ...existing,
          [locale]: { variants: updatedVariants },
        });
      }

      getCI(res).invalidateCommonFields(contentType);
      clearSsrSchemaCache();

      const updated = versioningManager.getVersioningForContent(contentType, contentSlug) || {};
      const updatedLocales = getCI(res).getAvailableLocalesOrVariants(contentType as ContentType, contentSlug);
      res.json({
        hasVersioningFile: true,
        versioning: updated,
        availableLocales: updatedLocales,
      });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

}
