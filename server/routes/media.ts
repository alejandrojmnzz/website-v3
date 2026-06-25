import type { Express, Request, Response } from "express";
import { triggerWorkerRunNow } from "./_worker-state";
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
import { child } from "../logger";
const log = child({ module: "routes/media" });


export function registerMediaRoutes(app: Express): void {
  app.get("/api/image-registry/stats", (req, res) => {
    const tag = req.query.tag as string | undefined;
    const registry = mediaGallery.getRegistry();
    if (!registry) {
      res.status(500).json({ error: "Failed to load image registry" });
      return;
    }
    let cached = 0;
    let failed = 0;
    for (const entry of Object.values(registry.images)) {
      if (!entry.source_url) continue;
      if (tag && !(entry.tags ?? []).includes(tag)) continue;
      if (entry.failed_at) {
        failed++;
      } else {
        cached++;
      }
    }
    res.json({ cached, failed });
  });

  app.get("/api/image-registry/failed", (req, res) => {
    const tag = req.query.tag as string | undefined;
    const entries = getFailedEntries(tag);
    res.json({ entries });
  });

  app.post("/api/image-registry/retry-failed", (req, res) => {
    const { tag } = req.body as { tag?: string };
    const count = retryFailedImages(tag);
    if (count > 0) mediaGallery.persistRegistry();
    res.json({ retried: count });
  });

  app.post("/api/image-registry/enqueue-external", (req, res) => {
    const { url, tag } = req.body as { url?: string; tag?: string };
    if (!url || !/^https?:\/\//.test(url)) {
      res.status(400).json({ error: "A valid http/https url is required" });
      return;
    }
    const dbName = tag || "manual";
    const id = enqueueExternalImage(url, dbName);
    if (id) {
      mediaGallery.persistRegistry();
    }
    res.json({ queued: !!id, id: id ?? null });
  });

  app.get("/api/image-registry", (_req, res) => {
    const registry = mediaGallery.getRegistry();
    if (!registry) {
      res.status(500).json({ error: "Failed to load image registry" });
      return;
    }
    res.json(registry);
  });

  app.get("/api/image-registry/family-usage", (req, res) => {
    const raw = req.query.ids;
    const ids: string[] = Array.isArray(raw)
      ? (raw as string[]).filter(Boolean)
      : typeof raw === "string" && raw
        ? [raw]
        : [];
    if (!ids.length) {
      res.json([]);
      return;
    }
    try {
      const results = mediaGallery.getFamilyUsage(ids);
      const enriched = results.map(r => ({
        ...r,
        hasBinding: r.sectionId
          ? !!bindingManager.findGroupForSection(r.contentType, r.slug, r.sectionId, r.locale)
          : r.sectionIndex >= 0
            ? !!bindingManager.findGroupForSectionByIndex(r.contentType, r.slug, r.sectionIndex, r.locale)
            : false,
      }));
      res.json(enriched);
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to get family usage" });
    }
  });

  app.post("/api/image-registry/clear-ref-cache", (_req, res) => {
    mediaGallery.clearImageRefCache();
    res.json({ ok: true });
  });

  app.post("/api/image-registry/bulk-replace-usage", (req, res) => {
    const { fileReplacements } = req.body as {
      fileReplacements?: Array<{ filePath: string; fromId: string; fromSrc: string; toId: string; toSrc: string }>;
    };
    if (!Array.isArray(fileReplacements) || fileReplacements.length === 0) {
      res.status(400).json({ error: "Missing or empty 'fileReplacements' array" });
      return;
    }
    try {
      const result = mediaGallery.bulkReplaceUsage(fileReplacements);
      mediaGallery.clearImageRefCache();
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Bulk replace failed" });
    }
  });

  app.delete("/api/image-registry/:id", async (req, res) => {
    try {
      const result = await mediaGallery.unregister(req.params.id);
      if (!result.success) {
        const status = result.usedIn ? 409 : 404;
        res.status(status).json({
          error: result.usedIn ? "Image is in use" : result.error,
          message: result.error,
          ...(result.usedIn ? { usedIn: result.usedIn } : {}),
        });
        return;
      }
      res.json({
        success: true,
        message: `Deleted "${req.params.id}" from registry`,
        ...(result.cleanupErrors ? { cleanupErrors: result.cleanupErrors } : {}),
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Delete failed" });
    }
  });

  app.post("/api/image-registry/bulk-delete", async (req, res) => {
    try {
      const { ids } = req.body as { ids?: string[] };
      if (!ids || !Array.isArray(ids) || ids.length === 0) {
        res.status(400).json({ error: "Missing or empty 'ids' array" });
        return;
      }
      const { results, deletedCount } = await mediaGallery.bulkUnregister(ids);
      res.json({ results, deletedCount, totalRequested: ids.length });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Bulk delete failed" });
    }
  });

  app.get("/api/media/status", (_req, res) => {
    try {
      res.json(media.getStatus());
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Image Registry Scanner Endpoints (delegated to MediaGallery singleton)
  app.post("/api/image-registry/scan", async (_req, res) => {
    try {
      const result = await mediaGallery.scan();
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Scan failed" });
    }
  });

  app.post("/api/image-registry/apply", async (req, res) => {
    try {
      const action = req.query.action as string | undefined;
      const scanResult = await mediaGallery.scan();
      const filtered = {
        ...scanResult,
        newImages: action === "update" ? [] : scanResult.newImages,
        updatedImages: action === "add" ? [] : scanResult.updatedImages,
      };
      if (
        filtered.newImages.length === 0 &&
        filtered.updatedImages.length === 0
      ) {
        res.json({ message: "Nothing to apply", added: 0, updated: 0 });
        return;
      }
      const applied = mediaGallery.applyChanges(filtered);
      const yamlMsg =
        applied.yamlFilesUpdated.length > 0
          ? `. Updated paths in ${applied.yamlFilesUpdated.length} YAML file(s)`
          : "";
      res.json({
        message: `Applied ${applied.added} new, ${applied.updated} updated${yamlMsg}`,
        ...applied,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Apply failed" });
    }
  });

  app.post("/api/image-registry/deduplicate", async (req, res) => {
    try {
      const scanResult = await mediaGallery.scan();
      if (scanResult.duplicates.length === 0) {
        res.json({
          message: "No duplicates found",
          removedCount: 0,
          results: [],
        });
        return;
      }
      const result = mediaGallery.removeDuplicates(scanResult.duplicates);
      const yamlMsg =
        result.yamlFilesUpdated.length > 0
          ? `. Updated references in ${result.yamlFilesUpdated.length} YAML file(s)`
          : "";
      res.json({
        message: `Removed ${result.removedCount} duplicate(s)${yamlMsg}`,
        ...result,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Deduplication failed" });
    }
  });

  app.get("/api/image-registry/redundant", (_req, res) => {
    try {
      const images = mediaGallery.findRedundantImages();
      res.json({ count: images.length, images });
    } catch (error: any) {
      res
        .status(500)
        .json({ error: error.message || "Failed to find redundant images" });
    }
  });

  app.post("/api/image-registry/redundant/resolve", async (req, res) => {
    try {
      const { action, ids } = req.body as { action?: string; ids?: string[] };
      if (action !== "delete-local" && action !== "delete-cloud") {
        res
          .status(400)
          .json({
            error: "Invalid action. Must be 'delete-local' or 'delete-cloud'",
          });
        return;
      }
      const result = await mediaGallery.resolveRedundancy(action, ids);
      res.json(result);
    } catch (error: any) {
      res
        .status(500)
        .json({ error: error.message || "Failed to resolve redundancy" });
    }
  });

  app.post("/api/image-registry/migrate", async (req, res) => {
    try {
      const { from, to, dryRun, prefix } = req.body as {
        from?: string;
        to?: string;
        dryRun?: boolean;
        prefix?: string;
      };
      if (!from || !to) {
        res
          .status(400)
          .json({ error: "Missing 'from' and/or 'to' provider name" });
        return;
      }
      const results = await mediaGallery.migrate(from, to, { dryRun, prefix });
      const migrated = results.filter((r) => r.status === "migrated").length;
      res.json({
        message: dryRun
          ? `Dry run: ${results.length} image(s) would be migrated from ${from} to ${to}`
          : `Migrated ${migrated} of ${results.length} image(s) from ${from} to ${to}`,
        results,
        totalProcessed: results.length,
        migratedCount: migrated,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Migration failed" });
    }
  });

  app.post("/api/image-registry/scripts/remove-unused", async (req, res) => {
    try {
      const { dryRun } = req.body as { dryRun?: boolean };
      const { removeUnusedImages } = await import("../../scripts/admin/remove-unused-images");
      const result = await removeUnusedImages({ dryRun: dryRun ?? false });
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Remove unused images failed" });
    }
  });

  app.post("/api/image-registry/scripts/remove-unused/stream", async (req, res) => {
    const BATCH_SIZE = 20;

    try {
      const registry = mediaGallery.getRegistry();
      if (!registry) {
        res.status(500).json({ error: "Failed to load image registry" });
        return;
      }

      const { imageIds } = mediaGallery.collectImageReferences();
      const srcToId = buildRegistrySrcToIdMap(registry.images);
      const resolvedReferencedIds = new Set<string>();
      imageIds.forEach((ref) => {
        const resolved = resolveRegistryReference(ref, registry.images, srcToId);
        if (resolved !== null) resolvedReferencedIds.add(resolved);
      });

      const allImageIds = Object.keys(registry.images);
      const unusedItems: Array<{ id: string; src: string }> = [];
      let externalSkipped = 0;
      for (const [id, entry] of Object.entries(registry.images)) {
        if (entry.source_url || entry.source_item) {
          externalSkipped++;
          continue;
        }
        if (entry.protected) {
          continue;
        }
        const srcsetUrls = Array.isArray(entry.srcset) ? entry.srcset.map((s) => s.url) : [];
        const usage = mediaGallery.getUsage(id, entry.src, srcsetUrls);
        const isUsed = usage.length > 0 || resolvedReferencedIds.has(id);
        if (!isUsed) {
          unusedItems.push({ id, src: entry.src });
        }
      }

      const total = unusedItems.length;

      if (total === 0) {
        res.json({ done: true, processed: 0, total: 0, summary: { removed: 0, skipped: 0, failed: 0 } });
        return;
      }

      res.writeHead(200, {
        "Content-Type": "application/x-ndjson",
        "Transfer-Encoding": "chunked",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      });

      let processed = 0;
      let removed = 0;
      let skipped = 0;
      let failed = 0;
      let cleanupWarnings = 0;

      try {
        for (let i = 0; i < total; i += BATCH_SIZE) {
          const batchItems = unusedItems.slice(i, i + BATCH_SIZE);
          const batchResults: Array<{ id: string; src: string; status: string; reason?: string }> = [];

          for (const item of batchItems) {
            try {
              const result = await mediaGallery.unregister(item.id);
              if (result.success) {
                if (result.cleanupErrors && result.cleanupErrors.length > 0) {
                  batchResults.push({
                    id: item.id,
                    src: item.src,
                    status: "removed-with-cleanup-errors",
                    reason: result.cleanupErrors.join("; "),
                  });
                  cleanupWarnings++;
                } else {
                  batchResults.push({ id: item.id, src: item.src, status: "removed" });
                }
                removed++;
              } else {
                batchResults.push({ id: item.id, src: item.src, status: "skipped", reason: result.error || "unknown" });
                skipped++;
              }
            } catch (err: any) {
              batchResults.push({ id: item.id, src: item.src, status: "error", reason: err.message || "unknown" });
              failed++;
            }
          }

          processed += batchItems.length;
          const event = { total, processed, batch: batchResults };
          res.write(JSON.stringify(event) + "\n");
        }

        const doneEvent = {
          done: true,
          processed,
          total,
          summary: {
            removed,
            skipped,
            failed,
            cleanupWarnings,
            externalSkipped,
          },
        };
        res.write(JSON.stringify(doneEvent) + "\n");
        res.end();
      } catch (fatalErr: any) {
        const fatalEvent = { fatalError: true, message: fatalErr.message || "Unknown error", processed, total };
        res.write(JSON.stringify(fatalEvent) + "\n");
        res.end();
      }
    } catch (error: any) {
      if (!res.headersSent) {
        res.status(500).json({ error: error.message || "Remove unused images failed" });
      }
    }
  });

  const mediaUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 100 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      const allowedImages = [
        ".png",
        ".jpg",
        ".jpeg",
        ".webp",
        ".svg",
        ".avif",
        ".gif",
      ];
      const allowedVideos = [".mp4", ".webm", ".mov", ".ogg", ".m4v"];
      const ext = path.extname(file.originalname).toLowerCase();
      if ([...allowedImages, ...allowedVideos].includes(ext)) {
        cb(null, true);
      } else {
        cb(new Error(`Unsupported file type: ${ext}`));
      }
    },
  });

  app.post(
    "/api/image-registry/upload",
    mediaUpload.single("file"),
    async (req, res) => {
      try {
        const file = (req as any).file;
        if (!file) {
          res.status(400).json({ error: "No file provided" });
          return;
        }
        const alt = (req.body?.alt as string) || undefined;
        const tags = req.body?.tags ? JSON.parse(req.body.tags) : undefined;
        const result = await mediaGallery.uploadAndRegister(
          file.originalname,
          file.buffer,
          file.mimetype,
          { alt, tags },
        );
        res.json(result);
      } catch (error: any) {
        res.status(500).json({ error: error.message || "Upload failed" });
      }
    },
  );

  // ============================================
  // Crop/Resize Endpoint
  // ============================================

  app.post("/api/media/crop-resize", async (req, res) => {
    if (process.env.DEBUG_CROP_RESIZE) {
      log.info("[CropResize] Handler reached — body keys:", Object.keys(req.body || {}));
    }
    try {
      const bodySchema = z.object({
        imageId: z.string().min(1),
        crop: z.object({
          x: z.number().min(0).max(1),
          y: z.number().min(0).max(1),
          width: z.number().min(0).max(1),
          height: z.number().min(0).max(1),
        }),
        targetWidth: z.number().int().positive().max(8000),
        targetHeight: z.number().int().positive().max(8000),
        quality: z.number().int().min(50).max(100).default(85),
      });

      const parsed = bodySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
        return;
      }

      const { imageId, crop, targetWidth, targetHeight, quality } = parsed.data;

      const registry = mediaGallery.getRegistry();
      if (!registry) {
        res.status(500).json({ error: "Failed to load image registry" });
        return;
      }

      const entry = registry.images[imageId];
      if (!entry) {
        res.status(404).json({ error: `Image "${imageId}" not found in registry` });
        return;
      }

      const src = entry.src;
      const ext = (() => {
        try { return path.extname(new URL(src).pathname).toLowerCase(); }
        catch { return path.extname(src).toLowerCase(); }
      })();

      if (ext === ".svg") {
        res.status(422).json({ error: "SVG images cannot be raster-processed. Please select a different format." });
        return;
      }
      if (ext === ".gif") {
        res.status(422).json({ error: "Animated GIF images cannot be crop-processed. Please select a different format." });
        return;
      }

      const { downloadImage } = await import("../image-optimizer");
      const buffer = await downloadImage(src);
      if (!buffer) {
        res.status(422).json({ error: "Could not read source image. Make sure the file exists." });
        return;
      }

      const sharp = (await import("sharp")).default;
      const metadata = await sharp(buffer).metadata();
      const imgW = metadata.width || 0;
      const imgH = metadata.height || 0;

      if (!imgW || !imgH) {
        res.status(422).json({ error: "Could not determine image dimensions." });
        return;
      }

      const cropLeft = Math.round(crop.x * imgW);
      const cropTop = Math.round(crop.y * imgH);
      const cropWidth = Math.round(crop.width * imgW);
      const cropHeight = Math.round(crop.height * imgH);

      const safeLeft = Math.max(0, Math.min(cropLeft, imgW - 1));
      const safeTop = Math.max(0, Math.min(cropTop, imgH - 1));
      const safeWidth = Math.max(1, Math.min(cropWidth, imgW - safeLeft));
      const safeHeight = Math.max(1, Math.min(cropHeight, imgH - safeTop));

      const processedBuffer = await sharp(buffer)
        .extract({ left: safeLeft, top: safeTop, width: safeWidth, height: safeHeight })
        .resize({ width: targetWidth, height: targetHeight, fit: "fill" })
        .webp({ quality })
        .toBuffer();

      const rootId = entry.parentId ?? imageId;

      const parentTags = entry.tags || [];

      const registryPresets = registry.presets as Record<string, { quality?: number }>;
      const parentPresets = (entry.preset || []) as string[];
      const presetDefaultQuality = parentPresets.length > 0
        ? Math.max(...parentPresets.map((p) => registryPresets[p]?.quality ?? 85))
        : 85;
      const qualityToSave = quality !== presetDefaultQuality ? quality : undefined;
      const qualitySuffix = qualityToSave !== undefined ? `-q${quality}` : "";
      const baseId = `${rootId}-${targetWidth}x${targetHeight}${qualitySuffix}`;

      const existingEntry = registry.images[baseId];
      if (existingEntry) {
        return res.json({ id: baseId, src: existingEntry.src, width: targetWidth, height: targetHeight });
      }

      const uniqueId = baseId;
      const derivedFilename = `${uniqueId}.webp`;
      const defaultProvider = media.getDefaultProvider();
      let newSrc: string;

      if (defaultProvider.name === "local") {
        const contentRoot: string = (res.locals.site as any)?.contentRoot ?? path.join(process.cwd(), process.env.CONTENT_FOLDER || "default-site-content");
        const contentRootName = path.basename(contentRoot);
        const imagesDir = path.join(contentRoot, "images");
        if (!fs.existsSync(imagesDir)) {
          fs.mkdirSync(imagesDir, { recursive: true });
        }
        const destPath = path.join(imagesDir, derivedFilename);
        fs.writeFileSync(destPath, processedBuffer);
        newSrc = `/${contentRootName}/images/${derivedFilename}`;
      } else {
        newSrc = await defaultProvider.upload(derivedFilename, processedBuffer, "image/webp");
      }

      mediaGallery.register(uniqueId, {
        src: newSrc,
        alt: entry.alt,
        tags: parentTags,
        width: targetWidth,
        height: targetHeight,
        format: "webp",
        parentId: rootId,
        quality_override: qualityToSave,
      });

      log.info(`[CropResize] Created "${uniqueId}" (${targetWidth}x${targetHeight}) from "${rootId}"`);

      (async () => {
        try {
          const { processImageFromSrc } = await import("../image-optimizer");
          const registry2 = mediaGallery.getRegistry();
          if (!registry2) return;
          const newEntry = registry2.images[uniqueId];
          if (!newEntry) return;
          const tagDefs = registry2.tagDefinitions as Record<string, { presets?: string[] }> | undefined;
          const result = await processImageFromSrc(uniqueId, newEntry, registry2.presets as Record<string, import("../image-optimizer").Preset>, false, newEntry.quality_override, tagDefs);
          if (result) {
            newEntry.preset = result.preset;
            newEntry.widths_generated = result.widths_generated;
            newEntry.srcset = result.srcset;
            mediaGallery.persistRegistry();
            log.info(`[CropResize] Optimization complete for "${uniqueId}"`);
          }
        } catch (err) {
          log.error({ err: err }, `[CropResize] Background optimization failed for "${uniqueId}":`);
        }
      })();

      res.json({ id: uniqueId, src: newSrc, width: targetWidth, height: targetHeight });
    } catch (error: any) {
      log.error({ err: error }, "[CropResize] Error:");
      res.status(500).json({ error: error.message || "Crop/resize failed" });
    }
  });

  app.post("/api/image-registry/optimize-batch", async (req, res) => {
    try {
      const { ids } = req.body as { ids?: string[] };
      const registry = mediaGallery.getRegistry();
      if (!registry) {
        res.status(500).json({ error: "Failed to load image registry" });
        return;
      }

      const rasterExtensions = new Set([".png", ".jpg", ".jpeg", ".webp", ".avif"]);

      const getExt = (src: string): string => {
        try { return path.extname(new URL(src).pathname).toLowerCase(); }
        catch { return path.extname(src).toLowerCase(); }
      };

      let targetIds: string[];
      if (ids && Array.isArray(ids) && ids.length > 0) {
        targetIds = ids.filter(id => {
          const entry = registry.images[id];
          if (!entry) return false;
          return rasterExtensions.has(getExt(entry.src));
        });
      } else {
        targetIds = Object.entries(registry.images)
          .filter(([_id, entry]) => {
            if (!entry.src) return false;
            const ext = getExt(entry.src);
            if (!rasterExtensions.has(ext)) return false;
            const hasSrcset = Array.isArray(entry.srcset) && entry.srcset.length > 0;
            return !hasSrcset;
          })
          .map(([id]) => id);
      }

      if (targetIds.length === 0) {
        res.json({ queued: 0, message: "No images need optimization" });
        return;
      }

      for (const id of targetIds) {
        enqueueOptimization(id);
      }
      mediaGallery.persistRegistry();

      resetOptimizeSession(targetIds.length);
      triggerWorkerRunNow();

      log.info(`[OptimizeBatch] Enqueued ${targetIds.length} image(s) for background optimization`);
      res.json({ queued: targetIds.length, message: `Queued ${targetIds.length} image(s) for background optimization` });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Batch optimize failed" });
    }
  });

  app.get("/api/image-registry/optimize-status", (_req, res) => {
    const session = getOptimizeSession();
    const allState = getAllQueueState();

    const remainingEntries = getPendingOptimizations(10000);
    const remaining = remainingEntries.length;

    const failedEntries: Array<{ id: string; error: string }> = [];
    for (const [id, entry] of Object.entries(allState)) {
      if (entry.failed_at) {
        failedEntries.push({ id, error: entry.error ?? "Unknown error" });
        if (failedEntries.length >= 20) break;
      }
    }

    const active = remaining > 0 || (session.initial > 0 && session.processed < session.initial);

    res.json({
      active,
      initial: session.initial,
      processed: session.processed,
      failed: failedEntries.length,
      remaining,
      failedEntries,
    });
  });

  app.post("/api/media/classify/:imageId", async (req, res) => {
    try {
      const { imageId } = req.params;
      const { context, persist } = req.body as {
        context?: { tagFilter?: string };
        persist?: boolean;
      };

      if (context && typeof context !== "object") {
        res.status(400).json({ error: "context must be an object" });
        return;
      }
      if (context?.tagFilter && typeof context.tagFilter !== "string") {
        res.status(400).json({ error: "context.tagFilter must be a string" });
        return;
      }
      if (context?.tagFilter && context.tagFilter.length > 100) {
        res.status(400).json({ error: "context.tagFilter is too long" });
        return;
      }

      const { classifyAndApply } = await import("../image-auto-tagger");
      const shouldPersist = persist !== false;
      const result = await classifyAndApply(imageId, context, shouldPersist);
      res.json(result);
    } catch (error: any) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("not found")) {
        res.status(404).json({ error: message });
      } else {
        log.error({ err: error }, "[Classify] Error:");
        res.status(500).json({ error: "Classification failed", message });
      }
    }
  });


}
