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
import { canonicalSectionId } from "../utils/sectionIdentity";
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
import {
  isEntryDetached,
  isSharedLayoutType,
  versioningContentSlug,
  isTemplateVersioningSlug,
} from "../shared-layout-entry";
import {
  buildMirroredLocaleSingle,
  listSiblingSinglePaths,
} from "../shared-layout-sync";
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


/** Reject entry-slug versioning writes when the entry is still attached to a shared template. */
function resolveWritableVersioningSlug(
  contentType: string,
  contentSlug: string,
  contentRoot: string,
): { ok: true; slug: string; templateMode: boolean } | { ok: false; error: string; status: number } {
  if (isTemplateVersioningSlug(contentSlug)) {
    if (!isSharedLayoutType(contentType, contentRoot)) {
      return { ok: false, status: 400, error: "Template versioning (slug \"single\") is only valid for shared-layout content types" };
    }
    return { ok: true, slug: contentSlug, templateMode: true };
  }
  if (isSharedLayoutType(contentType, contentRoot) && !isEntryDetached(contentType, contentSlug, contentRoot)) {
    return {
      ok: false,
      status: 400,
      error: "Attached shared-layout entries use template versioning. Use content slug \"single\" (or detach the entry for Page Versions).",
    };
  }
  return { ok: true, slug: contentSlug, templateMode: false };
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

    const root = getContentRoot(res);
    const shared = isSharedLayoutType(contentType, root);
    const entrySlug = isTemplateVersioningSlug(contentSlug) ? null : contentSlug;
    const detached = entrySlug ? isEntryDetached(contentType, entrySlug, root) : false;
    // When client passes an entry slug for an attached shared-layout page, read template versioning
    const resolvedSlug =
      entrySlug && shared
        ? versioningContentSlug(contentType, entrySlug, root)
        : contentSlug;
    const availableLocales = getLocaleEntries().map((l: { code: string }) => l.code);

    const versioningManager = (res.locals.site as any)?.versioningManager ?? getVersioningManager();
    const versioning = versioningManager.getVersioningForContent(contentType, resolvedSlug);
    const filePath = versioningManager.getVersioningFilePath(contentType, resolvedSlug);

    if (!versioning) {
      res.json({
        versioning: null,
        hasVersioningFile: false,
        filePath,
        availableLocales,
        detached,
        isSharedLayout: shared,
        versioningSlug: resolvedSlug,
      });
      return;
    }

    res.json({
      versioning,
      hasVersioningFile: true,
      filePath,
      availableLocales,
      detached,
      isSharedLayout: shared,
      versioningSlug: resolvedSlug,
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

      const resolved = resolveWritableVersioningSlug(contentType, contentSlug, getContentRoot(res));
      if (!resolved.ok) {
        res.status(resolved.status).json({ error: resolved.error });
        return;
      }

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
        // Allocating traffic requires the locale variant file to exist
        const contentDir = versioningManager.getVersioningContentDir(contentType, resolved.slug);
        for (const v of parseResult.data.variants) {
          if (v.allocation > 0) {
            const vp = versioningManager.getVariantFilePath(contentType, resolved.slug, v.slug, locale);
            if (!fs.existsSync(vp)) {
              res.status(400).json({
                error: `Cannot allocate traffic: missing variant file ${path.basename(vp)}`,
              });
              return;
            }
          }
        }

        const existing = versioningManager.getVersioningForContent(contentType, resolved.slug) || {};
        const updated = { ...existing, [locale]: { variants: parseResult.data.variants } };
        versioningManager.updateVersioning(contentType, resolved.slug, updated);
        invalidateContentCaches(contentType, getCI(res));
        // Warm live + traffic-receiving variants on next anonymous render (invalidate is enough to force MISS).
        res.json({ success: true, contentType, contentSlug: resolved.slug, locale });
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

    const resolved = resolveWritableVersioningSlug(contentType, contentSlug, getContentRoot(res));
    if (!resolved.ok) {
      res.status(resolved.status).json({ error: resolved.error });
      return;
    }

    const { variantSlug, locale } = req.body as { variantSlug?: string; locale?: string };

    if (!variantSlug || !locale) {
      res.status(400).json({ error: "variantSlug and locale are required" });
      return;
    }

    if (!/^[a-z0-9-]+$/.test(variantSlug)) {
      res.status(400).json({ error: "variantSlug must be lowercase letters, numbers, and hyphens only" });
      return;
    }

    const versioningManager = (res.locals.site as any)?.versioningManager ?? getVersioningManager();
    const contentDir = versioningManager.getVersioningContentDir(contentType, resolved.slug);
    const root = getContentRoot(res);
    const folder = getFolder(contentType as ContentType);

    if (!fs.existsSync(contentDir)) {
      res.status(404).json({ error: "Content folder not found" });
      return;
    }

    const variantFilePath = versioningManager.getVariantFilePath(contentType, resolved.slug, variantSlug, locale);
    if (fs.existsSync(variantFilePath)) {
      res.status(409).json({
        error: resolved.templateMode
          ? `Variant single.${variantSlug}.${locale}.yml already exists`
          : `Variant ${variantSlug}.${locale}.yml already exists`,
      });
      return;
    }

    const sourceFilePath = resolved.templateMode
      ? path.join(contentDir, `single.${locale}.yml`)
      : path.join(contentDir, `${locale}.yml`);
    if (!fs.existsSync(sourceFilePath)) {
      res.status(404).json({
        error: resolved.templateMode
          ? `Source file single.${locale}.yml not found`
          : `Source file ${locale}.yml not found for this entry`,
      });
      return;
    }

    try {
      const sourceContent = fs.readFileSync(sourceFilePath, "utf-8");
      fs.writeFileSync(variantFilePath, sourceContent, "utf-8");
      const relPrimary = resolved.templateMode
        ? `${folder}/single.${variantSlug}.${locale}.yml`
        : `${folder}/${resolved.slug}/${variantSlug}.${locale}.yml`;
      markFileAsModified(relPrimary, auth.author || "api", undefined, root);

      // Template mode: fan out sibling-locale variant files with _label pending translation
      const createdSiblings: string[] = [];
      if (resolved.templateMode) {
        const sourceData = (getCI(res).safeYamlLoad(sourceContent) as Record<string, unknown>) || {};
        const requesterId = auth.author || undefined;
        for (const sibling of listSiblingSinglePaths(contentDir, locale)) {
          const siblingVariantPath = path.join(contentDir, `single.${variantSlug}.${sibling.locale}.yml`);
          if (fs.existsSync(siblingVariantPath)) continue;
          const mirrored = buildMirroredLocaleSingle(sourceData, requesterId);
          // Preserve layout from sibling live single when present
          try {
            const siblingLive = getCI(res).safeYamlLoad(fs.readFileSync(sibling.filePath, "utf-8")) as Record<string, unknown> | null;
            if (siblingLive?.layout) mirrored.layout = siblingLive.layout;
          } catch { /* ignore */ }
          const { escapeObjectVars, unescapeYamlDump } = await import("@shared/templateVars");
          const { escaped, map } = escapeObjectVars(mirrored);
          const dumped = yaml.dump(escaped, { lineWidth: -1, noRefs: true, quotingType: '"', forceQuotes: false });
          fs.writeFileSync(siblingVariantPath, unescapeYamlDump(dumped, map), "utf-8");
          markFileAsModified(`${folder}/single.${variantSlug}.${sibling.locale}.yml`, auth.author || "api", undefined, root);
          createdSiblings.push(sibling.locale);
        }
      }

      const existing = versioningManager.getVersioningForContent(contentType, resolved.slug) || {};
      const localeData = existing[locale]
        ? { variants: [...(existing[locale].variants || [])] }
        : { variants: [] };

      if (!localeData.variants.some((v) => v.slug === variantSlug)) {
        localeData.variants.push({ slug: variantSlug, allocation: 0 });
      }

      versioningManager.updateVersioning(contentType, resolved.slug, { ...existing, [locale]: localeData });

      res.json({
        success: true,
        variantSlug,
        locale,
        templateMode: resolved.templateMode,
        siblingLocales: createdSiblings,
        filePath: `${getContentRootName(res)}/${relPrimary}`,
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

    const resolved = resolveWritableVersioningSlug(contentType, contentSlug, getContentRoot(res));
    if (!resolved.ok) {
      res.status(resolved.status).json({ error: resolved.error });
      return;
    }

    if (!/^[a-z0-9-]+$/.test(variantSlug)) {
      res.status(400).json({ error: "variantSlug must be lowercase letters, numbers, and hyphens only" });
      return;
    }

    if (!/^[a-z]{2}(-[A-Z]{2})?$/.test(locale)) {
      res.status(400).json({ error: "locale must be a valid language code (e.g. en, es, pt-BR)" });
      return;
    }

    const versioningManager = (res.locals.site as any)?.versioningManager ?? getVersioningManager();
    const contentDir = path.resolve(versioningManager.getVersioningContentDir(contentType, resolved.slug));
    const root = getContentRoot(res);
    const folder = getFolder(contentType as ContentType);

    if (!fs.existsSync(contentDir)) {
      res.status(404).json({ error: "Content folder not found" });
      return;
    }

    const variantFilePath = path.resolve(versioningManager.getVariantFilePath(contentType, resolved.slug, variantSlug, locale));
    const defaultFilePath = path.resolve(
      contentDir,
      resolved.templateMode ? `single.${locale}.yml` : `${locale}.yml`,
    );

    if (!variantFilePath.startsWith(contentDir + path.sep) || !defaultFilePath.startsWith(contentDir + path.sep)) {
      res.status(400).json({ error: "Invalid file path" });
      return;
    }

    if (!fs.existsSync(variantFilePath)) {
      res.status(404).json({
        error: resolved.templateMode
          ? `Variant file single.${variantSlug}.${locale}.yml not found`
          : `Variant file ${variantSlug}.${locale}.yml not found`,
      });
      return;
    }

    try {
      const variantContent = fs.readFileSync(variantFilePath, "utf-8");
      fs.writeFileSync(defaultFilePath, variantContent, "utf-8");

      const existing = versioningManager.getVersioningForContent(contentType, resolved.slug) || {};
      const localeData = existing[locale];
      if (localeData) {
        const updatedVariants = (localeData.variants || []).filter((v) => v.slug !== variantSlug);
        versioningManager.updateVersioning(contentType, resolved.slug, {
          ...existing,
          [locale]: { variants: updatedVariants },
        });
      }

      fs.unlinkSync(variantFilePath);

      getCI(res).invalidateCommonFields(contentType);
      clearSsrSchemaCache();
      invalidateContentCaches(contentType, getCI(res));

      if (resolved.templateMode) {
        markFileAsModified(`${folder}/single.${locale}.yml`, auth.author || "api", undefined, root);
        markFileAsModified(`${folder}/single.${variantSlug}.${locale}.yml`, auth.author || "api", undefined, root);
      } else {
        markFileAsModified(`${folder}/${resolved.slug}/${locale}.yml`, auth.author || "api", undefined, root);
        markFileAsModified(`${folder}/${resolved.slug}/${variantSlug}.${locale}.yml`, auth.author || "api", undefined, root);
      }

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

    const resolved = resolveWritableVersioningSlug(contentType, contentSlug, getContentRoot(res));
    if (!resolved.ok) {
      res.status(resolved.status).json({ error: resolved.error });
      return;
    }

    if (!/^[a-z0-9-]+$/.test(variantSlug)) {
      res.status(400).json({ error: "variantSlug must be lowercase letters, numbers, and hyphens only" });
      return;
    }

    if (!/^[a-z]{2}(-[A-Z]{2})?$/.test(locale)) {
      res.status(400).json({ error: "locale must be a valid language code (e.g. en, es, pt-BR)" });
      return;
    }

    const versioningManager = (res.locals.site as any)?.versioningManager ?? getVersioningManager();
    const contentDir = path.resolve(versioningManager.getVersioningContentDir(contentType, resolved.slug));
    const root = getContentRoot(res);
    const folder = getFolder(contentType as ContentType);

    if (!fs.existsSync(contentDir)) {
      res.status(404).json({ error: "Content folder not found" });
      return;
    }

    const variantFilePath = path.resolve(versioningManager.getVariantFilePath(contentType, resolved.slug, variantSlug, locale));

    if (!variantFilePath.startsWith(contentDir + path.sep)) {
      res.status(400).json({ error: "Invalid file path" });
      return;
    }

    if (!fs.existsSync(variantFilePath)) {
      res.status(404).json({
        error: resolved.templateMode
          ? `Variant file single.${variantSlug}.${locale}.yml not found`
          : `Variant file ${variantSlug}.${locale}.yml not found`,
      });
      return;
    }

    try {
      fs.unlinkSync(variantFilePath);
      if (resolved.templateMode) {
        markFileAsModified(`${folder}/single.${variantSlug}.${locale}.yml`, auth.author || "api", undefined, root);
      } else {
        markFileAsModified(`${folder}/${resolved.slug}/${variantSlug}.${locale}.yml`, auth.author || "api", undefined, root);
      }

      const existing = versioningManager.getVersioningForContent(contentType, resolved.slug) || {};
      const localeData = existing[locale];
      if (localeData) {
        const updatedVariants = (localeData.variants || []).filter((v) => v.slug !== variantSlug);
        versioningManager.updateVersioning(contentType, resolved.slug, {
          ...existing,
          [locale]: { variants: updatedVariants },
        });
      }

      getCI(res).invalidateCommonFields(contentType);
      clearSsrSchemaCache();
      invalidateContentCaches(contentType, getCI(res));

      const updated = versioningManager.getVersioningForContent(contentType, resolved.slug) || {};
      const availableLocales = resolved.templateMode
        ? getLocaleEntries().map((l: { code: string }) => l.code)
        : getCI(res).getAvailableLocalesOrVariants(contentType as ContentType, resolved.slug);
      res.json({
        hasVersioningFile: true,
        versioning: updated,
        availableLocales,
      });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

}
