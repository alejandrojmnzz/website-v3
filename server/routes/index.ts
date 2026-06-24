import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { storage } from "../storage";
import { child as loggerChild } from "../logger";
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

// =============================================================================
// ROUTE FILE MAP — where to add new API endpoints
// =============================================================================
// When adding a new route, put it in the file whose domain matches the prefix:
//
//   geo.ts          /api/geo, /api/ip
//   auth.ts         /api/auth, /api/debug-token
//   forms.ts        /api/leads, /api/form-options
//   settings.ts     /api/settings, /api/content-types, /api/menus, /api/faqs
//   content.ts      /api/content, /api/landings, /api/locations, /api/pages,
//                   /api/career-programs, /api/content-pages, /api/preview
//   databases.ts    /api/databases, /api/db
//   sections.ts     /api/sections, /api/content-pages (section-level edits)
//   seo.ts          /api/sitemap, /api/redirects, /api/schema, /api/seo
//   admin.ts        /api/admin, /api/users, /api/roles, /api/sync-log
//   components.ts   /api/component-registry
//   versioning.ts   /api/versioning
//   github.ts       /api/github, /api/debug/github
//   media.ts        /api/media, /api/image-registry, /api/image-optimizer
//   ai.ts           /api/ai, /api/chat, /api/brand-context
//   validation.ts   /api/validation, /api/diagnostics, /api/debug
//   ecommerce.ts    /api/ecommerce
//   webhooks.ts     /api/webhooks
//
// Each file exports a single registerXxxRoutes(app: Express): void function.
// Add your function call to the register block in registerRoutes() below.
// =============================================================================

import { registerGeoRoutes } from "./geo";
import { registerAuthRoutes } from "./auth";
import { registerFormsRoutes } from "./forms";
import { registerSettingsRoutes } from "./settings";
import { registerContentRoutes } from "./content";
import { registerDatabasesRoutes } from "./databases";
import { registerSectionsRoutes } from "./sections";
import { registerSeoRoutes } from "./seo";
import { registerAdminRoutes } from "./admin";
import { registerComponentsRoutes } from "./components";
import { registerVersioningRoutes } from "./versioning";
import { registerGithubRoutes } from "./github";
import { registerMediaRoutes } from "./media";
import { registerAiRoutes } from "./ai";
import { registerValidationRoutes } from "./validation";
import { registerEcommerceRoutes } from "./ecommerce";
import { registerWebhooksRoutes } from "./webhooks";
import { registerOverlaysRoutes } from "./overlays";
import { setWorkerRunNow } from "./_worker-state";

const routesLogger = loggerChild({ module: "routes" });

export async function registerRoutes(app: Express): Promise<Server> {
  media.initFromEnv();


  const { loadSyncLog, logSync, getInstanceId } = await import("../sync-log");
  const { loadSyncStateFromBucket } = await import("../sync-state");

  await loadSyncLog();
  const { getReplitCheckpoint, refreshGithubCommit } = await import(
    "../sync-log"
  );
  logSync(
    "RESTART",
    `Server started (instance=${getInstanceId()}, checkpoint=${getReplitCheckpoint()}, env=${process.env.NODE_ENV || "development"}, pid=${process.pid})`,
  );
  refreshGithubCommit();

  // Attach user ID from the X-User-Id header (sent by the client on
  // every request) to req so that all downstream routes can access it without
  // individually reading the cookie. Registered before any route handlers so
  // every route has access. The cookie-based path in cookie-utils.ts remains
  // as the authoritative fallback for versioning routes.
  app.use((req, _res, next) => {
    const headerValue = req.headers["x-user-id"];
    const raw = Array.isArray(headerValue) ? headerValue[0] : headerValue;
    if (raw && raw.trim()) {
      (req as Request & { userId?: string }).userId = raw.trim();
    }
    next();
  });

  app.get("/apply", (req, res) => {
    const lang = detectLanguageFromRequest(req);
    const target = lang === "es" ? "/es/aplica" : "/en/apply";
    const qs = Object.keys(req.query).length
      ? "?" +
        new URLSearchParams(req.query as Record<string, string>).toString()
      : "";
    res.redirect(302, target + qs);
  });

  // Apply redirect middleware for 301 redirects from YAML content
  app.use(redirectMiddleware);


  registerGeoRoutes(app);
  registerAuthRoutes(app);
  registerFormsRoutes(app);
  registerSettingsRoutes(app);
  registerContentRoutes(app);
  registerDatabasesRoutes(app);
  registerSectionsRoutes(app);
  registerSeoRoutes(app);
  registerAdminRoutes(app);
  registerComponentsRoutes(app);
  registerVersioningRoutes(app);
  registerGithubRoutes(app);
  registerMediaRoutes(app);
  registerAiRoutes(app);
  registerValidationRoutes(app);
  registerEcommerceRoutes(app);
  registerWebhooksRoutes(app);
  registerOverlaysRoutes(app);

  const httpServer = createServer(app);

  // Start the background image queue worker
  import("../image-queue-worker").then(({ start, runNow }) => {
    setWorkerRunNow(runNow);
    start();
  }).catch((err) => {
    routesLogger.error({ err, worker: "ImageQueueWorker" }, "failed to start image queue worker");
  });

  return httpServer;
}

export async function startBackgroundSync(): Promise<void> {
  const { logSync } = await import("../sync-log");
  const { loadSyncStateFromBucket } = await import("../sync-state");

  routesLogger.info("reconciling sync state in background (non-blocking)...");
  loadSyncStateFromBucket()
    .then(async () => {
      const {
        reconcileSyncStateOnStartup,
        autoPullNonConflicting,
        ensureWebhook,
      } = await import("../github");
      await reconcileSyncStateOnStartup();
      const isAutoPullEnabled =
        process.env.GITHUB_SYNC_ENABLED === "true" &&
        process.env.GITHUB_AUTO_PULL_ENABLED === "true";
      if (isAutoPullEnabled) {
        const result = await autoPullNonConflicting();
        if (result.pulled.length > 0) {
          logSync(
            "AUTO-PULL",
            `Startup: pulled ${result.pulled.length} incoming files: ${result.pulled.map((f) => f.replace("marketing-content/", "")).join(", ")}`,
          );
        }
        if (result.conflicted.length > 0) {
          logSync(
            "CONFLICT",
            `Startup: ${result.conflicted.length} files have local conflicts, awaiting manual resolution`,
          );
        }
        if (result.errors.length > 0) {
          logSync(
            "ERROR",
            `Startup: ${result.errors.length} file(s) failed to pull — retrying in 10s: ${result.errors.join("; ")}`,
          );
          setTimeout(async () => {
            try {
              const retry = await autoPullNonConflicting();
              if (retry.pulled.length > 0) {
                logSync(
                  "AUTO-PULL",
                  `Retry: pulled ${retry.pulled.length} file(s): ${retry.pulled.map((f) => f.replace("marketing-content/", "")).join(", ")}`,
                );
              }
              if (retry.errors.length > 0) {
                logSync(
                  "ERROR",
                  `Retry: ${retry.errors.length} file(s) still failed: ${retry.errors.join("; ")}`,
                );
              }
            } catch (e) {
              logSync(
                "ERROR",
                `Retry failed: ${e instanceof Error ? e.message : String(e)}`,
              );
            }
          }, 10000);
        }
      } else {
        logSync(
          "AUTO-PULL",
          "Skipped startup pull — GITHUB_AUTO_PULL_ENABLED not set to 'true'",
        );
      }
      await ensureWebhook();
    })
    .catch((err) => {
      logSync(
        "ERROR",
        `Failed to load/reconcile on startup: ${err instanceof Error ? err.message : String(err)}`,
      );
      routesLogger.error({ err, worker: "SyncState" }, "failed to load/reconcile on startup");
    });
}
