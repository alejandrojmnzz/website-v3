import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { getSiteContextMap } from "../site-manager";
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
const log = child({ module: "routes/github" });


export function registerGithubRoutes(app: Express): void {
  // GitHub sync status endpoint
  app.get("/api/github/sync-status", async (req, res) => {
    try {
      const { getGitHubSyncStatus } = await import("../github");
      const status = await getGitHubSyncStatus();
      res.json(status);
    } catch (error) {
      log.error({ err: error }, "Error checking GitHub sync status:");
      res.status(500).json({ error: "Failed to check sync status" });
    }
  });

  // GitHub webhook endpoint - receives push events for auto-pull
  app.post("/api/github/webhook", async (req, res) => {
    try {
      const { logSync } = await import("../sync-log");
      const signature = req.headers["x-hub-signature-256"] as string;
      if (!signature) {
        logSync("WEBHOOK", "Rejected: missing signature header");
        res.status(401).json({ error: "Missing signature" });
        return;
      }

      const { getWebhookInfo } = await import("../sync-state");
      const { verifyWebhookSignature } = await import("../github");
      const rawBody = (req as any).rawBody;
      const payload = rawBody
        ? rawBody.toString("utf-8")
        : JSON.stringify(req.body);

      // Resolve the correct per-site webhook secret by matching the push repo URL
      // against registered site configs.  Falls back to the default (no contentRoot)
      // state for single-site deployments.
      let webhookInfo = (() => {
        try {
          const parsedRaw = rawBody ? JSON.parse(rawBody.toString("utf-8")) : req.body;
          const incomingRepo = (
            parsedRaw?.repository?.html_url ||
            parsedRaw?.repository?.clone_url ||
            ""
          ).replace(/\.git$/, "").toLowerCase();
          if (incomingRepo) {
            for (const ctx of Array.from(getSiteContextMap().values())) {
              const siteRepo = (ctx.config.githubRepoUrl || "").replace(/\.git$/, "").toLowerCase();
              if (siteRepo && siteRepo === incomingRepo) {
                const perSiteInfo = getWebhookInfo(ctx.contentRootName);
                if (perSiteInfo) return perSiteInfo;
              }
            }
          }
        } catch { /* fall through */ }
        return getWebhookInfo();
      })();

      if (!webhookInfo) {
        logSync("WEBHOOK", "Rejected: no webhook configured in sync state");
        res.status(500).json({ error: "No webhook configured" });
        return;
      }

      if (
        !verifyWebhookSignature(payload, signature, webhookInfo.webhookSecret)
      ) {
        logSync("WEBHOOK", "Rejected: invalid HMAC signature");
        res.status(401).json({ error: "Invalid signature" });
        return;
      }

      const event = req.headers["x-github-event"] as string;

      if (event === "ping") {
        logSync("WEBHOOK", "Received ping event — webhook is active");
        res.json({ ok: true, message: "pong" });
        return;
      }

      if (event !== "push") {
        logSync("WEBHOOK", `Ignored event: ${event}`);
        res.json({ ok: true, message: `Ignored event: ${event}` });
        return;
      }

      const pushPayload = req.body;
      const commitSha = pushPayload.after;
      const pusher = pushPayload.pusher?.name || "unknown";

      const { getAutoCommitStatus } = await import("../auto-commit");
      const { lastCommitSha } = getAutoCommitStatus();
      if (
        lastCommitSha &&
        commitSha &&
        (commitSha === lastCommitSha ||
          commitSha.startsWith(lastCommitSha) ||
          lastCommitSha.startsWith(commitSha))
      ) {
        logSync(
          "WEBHOOK",
          `Push ${commitSha?.slice(0, 7)} by ${pusher}: skipping auto-pull — commit was pushed by this instance`,
          pusher,
        );
        res.json({ ok: true, message: "Self-push, skipping auto-pull" });
        return;
      }

      const commits = pushPayload.commits || [];

      // Extract the real CMS author from commit messages — format: "[Auto-sync] Author Name updated file.yml"
      // All commits share the same GitHub token so pusher.name is always the same technical user.
      const autoSyncAuthorRe = /^\[Auto-sync\] (.+?) updated /;
      const realAuthor = (() => {
        const messages = [
          pushPayload.head_commit?.message,
          ...commits.map((c: { message?: string }) => c.message),
        ].filter(Boolean) as string[];
        for (const msg of messages) {
          const m = msg.match(autoSyncAuthorRe);
          if (m) return m[1];
        }
        return null;
      })();
      const person = realAuthor ?? pusher;

      const changedFiles = new Set<string>();
      for (const commit of commits) {
        for (const f of commit.added || []) changedFiles.add(f);
        for (const f of commit.modified || []) changedFiles.add(f);
        for (const f of commit.removed || []) changedFiles.add(f);
      }

      // Match this push to a site by comparing the payload's repo URL against
      // registered sites' githubRepoUrl.  Falls back to the global GITHUB_REPO_URL
      // env var (single-site mode or un-matched multi-site push).
      const pushRepoUrl = (
        pushPayload.repository?.html_url ||
        pushPayload.repository?.clone_url ||
        ""
      ).replace(/\.git$/, "").toLowerCase();

      let contentFolderPrefix = process.env.CONTENT_FOLDER || "default-site-content";
      if (pushRepoUrl) {
        for (const ctx of Array.from(getSiteContextMap().values())) {
          const siteRepo = (ctx.config.githubRepoUrl || "").replace(/\.git$/, "").toLowerCase();
          if (siteRepo && siteRepo === pushRepoUrl) {
            contentFolderPrefix = ctx.contentRootName;
            break;
          }
        }
      }

      const marketingFiles = Array.from(changedFiles).filter((f) =>
        f.startsWith(`${contentFolderPrefix}/`),
      );

      if (marketingFiles.length === 0) {
        logSync(
          "WEBHOOK",
          `Push ${commitSha?.slice(0, 7)} by ${person}: no ${contentFolderPrefix} files changed`,
          person,
        );
        res.json({ ok: true, message: `No ${contentFolderPrefix} files changed` });
        return;
      }

      logSync(
        "WEBHOOK",
        `Push ${commitSha?.slice(0, 7)} by ${person}: ${marketingFiles.length} ${contentFolderPrefix} files changed`,
        person,
      );

      const isAutoPullEnabled =
        process.env.GITHUB_SYNC_ENABLED === "true" &&
        process.env.GITHUB_AUTO_PULL_ENABLED === "true";
      if (!isAutoPullEnabled) {
        logSync(
          "AUTO-PULL",
          `Skipped webhook pull — GITHUB_AUTO_PULL_ENABLED not set to 'true'`,
        );
        res.json({ ok: true, message: "Auto-pull disabled" });
        return;
      }

      const { autoPullNonConflicting } = await import("../github");
      const pullOpts = {
        contentRoot: contentFolderPrefix,
        repoUrl: pushRepoUrl || undefined,
      };
      const result = await autoPullNonConflicting(marketingFiles, commitSha, pullOpts);

      if (result.pulled.length > 0) {
        logSync(
          "AUTO-PULL",
          `Webhook: pulled ${result.pulled.length} files from ${commitSha?.slice(0, 7)}: ${result.pulled.map((f) => f.replace(`${contentFolderPrefix}/`, "")).join(", ")}`,
        );
      }
      if (result.conflicted.length > 0) {
        logSync(
          "CONFLICT",
          `Webhook: ${result.conflicted.length} files have local edits: ${result.conflicted.map((f) => f.replace(`${contentFolderPrefix}/`, "")).join(", ")}`,
        );
      }
      if (result.errors.length > 0) {
        logSync("ERROR", `Webhook pull errors: ${result.errors.join("; ")}`);
      }

      res.json({
        ok: true,
        pulled: result.pulled.length,
        conflicted: result.conflicted.length,
        errors: result.errors.length,
      });
    } catch (error) {
      const { logSync } = await import("../sync-log");
      logSync(
        "ERROR",
        `Webhook handler error: ${error instanceof Error ? error.message : String(error)}`,
      );
      log.error({ err: error }, "[Webhook] Error handling webhook:");
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Get the full sync log text
  app.get("/api/github/sync-log", async (_req, res) => {
    try {
      const { getSyncLogEntries } = await import("../sync-log");
      const entries = getSyncLogEntries();
      res.json({ entries });
      return;
    } catch (error) {
      res.status(500).json({ error: "Error reading sync log" });
    }
  });

  app.get("/api/github/sync-log-text", async (_req, res) => {
    try {
      const { getSyncLogText } = await import("../sync-log");
      const text = getSyncLogText();
      res.type("text/plain").send(text);
    } catch (error) {
      res.status(500).send("Error reading sync log");
    }
  });

  app.delete("/api/github/sync-log", async (req, res) => {
    try {
      const mode = req.query.mode as string | undefined;
      if (mode === "2days") {
        const { clearSyncLogOlderThan } = await import("../sync-log");
        await clearSyncLogOlderThan(Date.now() - 2 * 24 * 60 * 60 * 1000);
      } else {
        const { clearSyncLog } = await import("../sync-log");
        await clearSyncLog();
      }
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Error clearing sync log" });
    }
  });

  app.get("/api/git/file-history", (req, res) => {
    try {
      const exec = _execSync;
      const filePath = req.query.file as string;
      const limit = Math.min(parseInt(String(req.query.limit || "20"), 10) || 20, 50);
      if (!filePath || typeof filePath !== "string") {
        res.status(400).json({ error: "file query param required" });
        return;
      }
      if (/[;&|`$<>]/.test(filePath)) {
        res.status(400).json({ error: "Invalid file path" });
        return;
      }
      let raw: string;
      try {
        raw = exec(
          `git log --follow --pretty=format:"%H|%aI|%an|%s" -n ${limit} -- "${filePath}"`,
          { encoding: "utf-8", cwd: process.cwd() }
        ) as string;
      } catch {
        res.json({ entries: [] });
        return;
      }
      const entries = raw
        .split("\n")
        .filter(l => l.trim())
        .map(line => {
          const idx1 = line.indexOf("|");
          const idx2 = line.indexOf("|", idx1 + 1);
          const idx3 = line.indexOf("|", idx2 + 1);
          return {
            sha: line.slice(0, idx1),
            date: line.slice(idx1 + 1, idx2),
            author: line.slice(idx2 + 1, idx3),
            subject: line.slice(idx3 + 1),
          };
        });
      res.json({ entries });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.get("/api/git/file-at", (req, res) => {
    try {
      const exec = _execSync;
      const filePath = req.query.file as string;
      const sha = req.query.sha as string;
      if (!filePath || !sha) {
        res.status(400).json({ error: "file and sha query params required" });
        return;
      }
      if (!/^[a-f0-9]{7,40}$/.test(sha)) {
        res.status(400).json({ error: "Invalid SHA format" });
        return;
      }
      if (/[;&|`$<>]/.test(filePath)) {
        res.status(400).json({ error: "Invalid file path" });
        return;
      }
      let content: string;
      try {
        content = exec(`git show "${sha}:${filePath}"`, {
          encoding: "utf-8",
          cwd: process.cwd(),
        }) as string;
      } catch {
        res.status(404).json({ error: "File not found at that revision" });
        return;
      }
      res.type("text/plain").send(content);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.get("/api/git/folder-history", (req, res) => {
    try {
      const exec = _execSync;
      const folder = req.query.folder as string;
      const limit = Math.min(parseInt(String(req.query.limit || "30"), 10) || 30, 50);
      if (!folder || typeof folder !== "string") {
        res.status(400).json({ error: "folder query param required" });
        return;
      }
      if (/[;&|`$<>]/.test(folder)) {
        res.status(400).json({ error: "Invalid folder path" });
        return;
      }
      let raw: string;
      try {
        raw = exec(
          `git log --pretty=format:"%H|%aI|%an|%s" -n ${limit} -- "${folder}"`,
          { encoding: "utf-8", cwd: process.cwd() }
        ) as string;
      } catch {
        res.json({ entries: [], repoUrl: null });
        return;
      }
      const entries = raw
        .split("\n")
        .filter(l => l.trim())
        .map(line => {
          const idx1 = line.indexOf("|");
          const idx2 = line.indexOf("|", idx1 + 1);
          const idx3 = line.indexOf("|", idx2 + 1);
          return {
            sha: line.slice(0, idx1),
            date: line.slice(idx1 + 1, idx2),
            author: line.slice(idx2 + 1, idx3),
            subject: line.slice(idx3 + 1),
          };
        });
      const repoUrl = (process.env.GITHUB_REPO_URL || "").replace(/\.git$/, "") || null;
      res.json({ entries, repoUrl });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.post("/api/git/restore-folder", async (req, res) => {
    try {
      const exec = _execSync;
      const { folder, sha } = req.body;
      if (!folder || !sha) {
        res.status(400).json({ error: "folder and sha are required" });
        return;
      }
      if (!/^[a-f0-9]{7,40}$/.test(sha)) {
        res.status(400).json({ error: "Invalid SHA format" });
        return;
      }
      if (/[;&|`$<>]/.test(folder)) {
        res.status(400).json({ error: "Invalid folder path" });
        return;
      }
      const fs = await import("fs");
      const path = await import("path");

      // List files that existed in the folder at the given SHA
      let lsOutput: string;
      try {
        lsOutput = exec(
          `git ls-tree -r --name-only "${sha}" -- "${folder}"`,
          { encoding: "utf-8", cwd: process.cwd() }
        ) as string;
      } catch {
        res.status(400).json({ error: "Could not list files at that commit" });
        return;
      }
      const filesAtSha = lsOutput.split("\n").filter(l => l.trim());
      if (filesAtSha.length === 0) {
        res.status(400).json({ error: "No files found in folder at that commit" });
        return;
      }

      // Collect current files in the folder
      const getAllFiles = (dir: string, base: string): string[] => {
        const items: string[] = [];
        if (!fs.default.existsSync(dir)) return items;
        for (const entry of fs.default.readdirSync(dir)) {
          const full = path.default.join(dir, entry);
          const rel = path.default.join(base, entry).replace(/\\/g, "/");
          if (fs.default.statSync(full).isDirectory()) {
            items.push(...getAllFiles(full, rel));
          } else {
            items.push(rel);
          }
        }
        return items;
      };
      const currentFiles = getAllFiles(
        path.default.join(process.cwd(), folder),
        folder
      );

      // Write each file from the historical SHA
      for (const filePath of filesAtSha) {
        const content = exec(
          `git show "${sha}:${filePath}"`,
          { encoding: "buffer", cwd: process.cwd() }
        ) as Buffer;
        const absPath = path.default.join(process.cwd(), filePath);
        fs.default.mkdirSync(path.default.dirname(absPath), { recursive: true });
        fs.default.writeFileSync(absPath, content);
      }

      // Remove files that exist locally but were not present at that SHA
      const filesAtShaSet = new Set(filesAtSha);
      for (const currentFile of currentFiles) {
        if (!filesAtShaSet.has(currentFile)) {
          try { fs.default.unlinkSync(path.default.join(process.cwd(), currentFile)); } catch {}
        }
      }

      // Commit the restore
      const { commitAndPush } = await import("../github");
      const result = await commitAndPush(
        `Restore: ${folder} to ${sha.slice(0, 7)}`,
        { force: false }
      );
      if (!result.success) {
        res.status(500).json({ error: result.error || "Commit failed" });
        return;
      }
      res.json({ success: true, commitHash: result.commitHash });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // Get structured sync info (webhook status, instance, recent log entries)
  app.get("/api/github/sync-info", async (_req, res) => {
    try {
      const {
        getRecentEntries,
        getInstanceId,
        getReplitCheckpoint,
        getGithubCommit,
      } = await import("../sync-log");
      const { getWebhookInfo } = await import("../sync-state");
      const webhookInfo = getWebhookInfo();

      const repoUrl = (process.env.GITHUB_REPO_URL || "").replace(/\.git$/, "");
      res.json({
        instanceId: getInstanceId(),
        replitCheckpoint: getReplitCheckpoint(),
        githubCommit: getGithubCommit(),
        repoUrl: repoUrl || null,
        env: process.env.NODE_ENV || "development",
        pid: process.pid,
        webhook: webhookInfo
          ? {
              active: true,
              id: webhookInfo.webhookId,
              url: webhookInfo.webhookUrl,
              createdAt: webhookInfo.createdAt,
            }
          : { active: false },
        recentLog: getRecentEntries(20),
      });
    } catch (error) {
      res.status(500).json({ error: "Error reading sync info" });
    }
  });

  app.post("/api/github/webhook/setup", async (_req, res) => {
    try {
      const { ensureWebhook } = await import("../github");
      await ensureWebhook();
      const { getWebhookInfo } = await import("../sync-state");
      const info = getWebhookInfo();
      if (info) {
        res.json({
          success: true,
          message: `Webhook #${info.webhookId} is active at ${info.webhookUrl}`,
        });
      } else {
        res
          .status(500)
          .json({
            success: false,
            message:
              "Webhook setup ran but no webhook was registered. Check that your GitHub token has the admin:repo_hook scope.",
          });
      }
    } catch (error: any) {
      res
        .status(500)
        .json({
          success: false,
          message: error.message || "Webhook setup failed",
        });
    }
  });

  app.delete("/api/github/webhook/duplicates", async (_req, res) => {
    try {
      const { getWebhookInfo } = await import("../sync-state");
      const info = getWebhookInfo();
      if (!info) {
        return res
          .status(400)
          .json({
            success: false,
            message: "No active webhook registered — nothing to clean up.",
          });
      }
      const { cleanupDuplicateWebhooks, getGitHubConfig } = await import(
        "../github"
      );
      const config = getGitHubConfig();
      if (!config) {
        return res
          .status(400)
          .json({ success: false, message: "GitHub not configured." });
      }
      const deleted = await cleanupDuplicateWebhooks(
        config,
        info.webhookId,
        info.webhookUrl,
      );
      res.json({ success: true, deleted: deleted.length, ids: deleted });
    } catch (error: any) {
      res
        .status(500)
        .json({ success: false, message: error.message || "Cleanup failed" });
    }
  });

  // Get all sync changes (local and incoming)
  app.get("/api/github/pending-changes", async (req, res) => {
    try {
      const { getAllSyncChanges } = await import("../github");
      const changes = await getAllSyncChanges();
      res.json({ changes, count: changes.length });
    } catch (error) {
      log.error({ err: error }, "Error getting sync changes:");
      res.status(500).json({ error: "Failed to get sync changes" });
    }
  });

  // Commit and push pending changes to GitHub
  app.post("/api/github/commit", async (req, res) => {
    try {
      const { message, force, author, files, queue } = req.body;
      if (
        !message ||
        typeof message !== "string" ||
        message.trim().length === 0
      ) {
        res.status(400).json({ error: "Commit message is required" });
        return;
      }

      const authorName =
        author && typeof author === "string" && author.trim()
          ? author.trim()
          : undefined;

      // Queue mode: route through markFileAsModified → auto-commit queue.
      // Used by MCP commits so they respect sequencing, attribution, and conflict handling.
      if (queue === true) {
        const { markFileAsModified, detectPendingChanges } = await import(
          "../sync-state"
        );
        const { logSync } = await import("../sync-log");
        const { isAutoCommitEnabled } = await import("../auto-commit");

        if (!isAutoCommitEnabled()) {
          // Auto-commit disabled — fall through to direct commit below
          const finalMsg = authorName
            ? `[Author: ${authorName}] ${message.trim()}`
            : message.trim();
          const { commitAndPush } = await import("../github");
          const site = res.locals.site as any;
          const result = await commitAndPush(finalMsg, {
            force: !!force,
            files: Array.isArray(files) ? files : undefined,
            repoUrl: site?.config?.githubRepoUrl,
            contentRoot: site?.contentRootName,
          });
          if (result.success) {
            res.json({ success: true, commitHash: result.commitHash });
          } else {
            res.status(400).json({ success: false, error: result.error });
          }
          return;
        }

        // Determine which files to queue
        let filesToQueue: string[];
        if (Array.isArray(files) && files.length > 0) {
          filesToQueue = files as string[];
        } else {
          const pending = detectPendingChanges();
          filesToQueue = pending.map((c) => c.file);
        }

        if (filesToQueue.length === 0) {
          res
            .status(400)
            .json({ error: "No pending changes found to queue" });
          return;
        }

        const effectiveAuthor = authorName || "MCP";
        for (const filePath of filesToQueue) {
          markFileAsModified(filePath, effectiveAuthor);
          const shortPath = filePath.split('/').slice(1).join('/') || filePath;
          logSync("EDIT", `MCP queued edit: ${shortPath}`, effectiveAuthor);
        }

        res
          .status(202)
          .json({ queued: true, files: filesToQueue, author: effectiveAuthor });
        return;
      }

      // Direct-commit mode (existing path — used by DebugBubble / manual CMS commits)
      let finalMessage = message.trim();
      if (authorName) {
        finalMessage = `[Author: ${authorName}] ${finalMessage}`;
      }

      const { commitAndPush } = await import("../github");
      const site = res.locals.site as any;
      const result = await commitAndPush(finalMessage, {
        force: !!force,
        files: Array.isArray(files) ? files : undefined,
        repoUrl: site?.config?.githubRepoUrl,
        contentRoot: site?.contentRootName,
      });

      if (result.success) {
        res.json({ success: true, commitHash: result.commitHash });
      } else {
        res.status(400).json({ success: false, error: result.error });
      }
    } catch (error) {
      log.error({ err: error }, "Error committing to GitHub:");
      res.status(500).json({ error: "Failed to commit changes" });
    }
  });

  // Get conflict information (missed commits from remote)
  app.get("/api/github/conflict-info", async (req, res) => {
    try {
      const { getConflictInfo } = await import("../github");
      const conflictInfo = await getConflictInfo();
      res.json(conflictInfo);
    } catch (error) {
      log.error({ err: error }, "Error getting conflict info:");
      res.status(500).json({ error: "Failed to get conflict info" });
    }
  });

  // Sync local state with remote (accept remote changes)
  app.post("/api/github/sync", async (req, res) => {
    try {
      const { syncWithRemote } = await import("../github");
      const result = await syncWithRemote();

      if (result.success) {
        res.json({ success: true });
      } else {
        res.status(400).json({ success: false, error: result.error });
      }
    } catch (error) {
      log.error({ err: error }, "Error syncing with remote:");
      res.status(500).json({ error: "Failed to sync with remote" });
    }
  });

  // Check for pull conflicts (files changed both locally and remotely)
  app.get("/api/github/pull-conflicts", async (req, res) => {
    try {
      const { checkPullConflicts } = await import("../github");
      const result = await checkPullConflicts();
      res.json(result);
    } catch (error) {
      log.error({ err: error }, "Error checking pull conflicts:");
      res.status(500).json({ error: "Failed to check pull conflicts" });
    }
  });

  // Get status for a single file (local vs remote)
  app.get("/api/github/file-status", async (req, res) => {
    try {
      const filePath = req.query.file as string;
      if (!filePath) {
        res.status(400).json({ error: "Missing file parameter" });
        return;
      }
      const { getRemoteFileStatus } = await import("../github");
      const status = await getRemoteFileStatus(filePath);
      res.json(status);
    } catch (error) {
      log.error({ err: error }, "Error getting file status:");
      res.status(500).json({ error: "Failed to get file status" });
    }
  });

  // Commit a single file to remote
  app.post("/api/github/commit-file", async (req, res) => {
    try {
      const { filePath, message, author } = req.body;
      if (!filePath || !message) {
        res.status(400).json({ error: "Missing filePath or message" });
        return;
      }
      const { commitSingleFile } = await import("../github");
      const result = await commitSingleFile({ filePath, message, author });

      if (result.success) {
        res.json({ success: true, commitSha: result.commitSha });
      } else {
        res.status(400).json({ success: false, error: result.error });
      }
    } catch (error) {
      log.error({ err: error }, "Error committing file:");
      res.status(500).json({ error: "Failed to commit file" });
    }
  });

  // Pull a single file from remote
  app.post("/api/github/pull-file", async (req, res) => {
    try {
      const { filePath } = req.body;
      if (!filePath) {
        res.status(400).json({ error: "Missing filePath" });
        return;
      }
      const { pullSingleFile } = await import("../github");
      const result = await pullSingleFile(filePath);

      if (result.success) {
        res.json({ success: true });
      } else {
        res.status(400).json({ success: false, error: result.error });
      }
    } catch (error) {
      log.error({ err: error }, "Error pulling file:");
      res.status(500).json({ error: "Failed to pull file" });
    }
  });

  // Sync local state with remote (update lastSyncedCommit to current remote HEAD)
  app.post("/api/github/sync-with-remote", async (req, res) => {
    try {
      const { syncWithRemote } = await import("../github");
      const result = await syncWithRemote();

      if (result.success) {
        res.json({ success: true });
      } else {
        res.status(400).json({ success: false, error: result.error });
      }
    } catch (error) {
      log.error({ err: error }, "Error syncing with remote:");
      res.status(500).json({ error: "Failed to sync with remote" });
    }
  });

  app.get("/api/github/auto-commit/status", async (_req, res) => {
    try {
      const { getAutoCommitStatus } = await import("../auto-commit");
      res.json(getAutoCommitStatus());
    } catch (error) {
      log.error({ err: error }, "Error getting auto-commit status:");
      res.status(500).json({ error: "Failed to get auto-commit status" });
    }
  });

  app.post("/api/github/auto-commit/flush", async (_req, res) => {
    try {
      const { flushPendingChanges } = await import("../auto-commit");
      const result = await flushPendingChanges();
      res.json(result);
    } catch (error) {
      log.error({ err: error }, "Error flushing auto-commit:");
      res.status(500).json({ error: "Failed to flush pending changes" });
    }
  });

  app.post("/api/github/auto-commit/config", async (req, res) => {
    try {
      const { commitIntervalSeconds } = req.body;
      if (
        typeof commitIntervalSeconds === "number" &&
        commitIntervalSeconds >= 1
      ) {
        const { updateSyncConfig } = await import("../sync-state");
        updateSyncConfig({ commitIntervalSeconds });
        res.json({ success: true, commitIntervalSeconds });
      } else {
        res
          .status(400)
          .json({ error: "commitIntervalSeconds must be a number >= 1" });
      }
    } catch (error) {
      log.error({ err: error }, "Error updating auto-commit config:");
      res.status(500).json({ error: "Failed to update auto-commit config" });
    }
  });

  app.get("/api/github/auto-commit/conflicts", async (_req, res) => {
    try {
      const { getConflictedFiles } = await import("../auto-commit");
      res.json({ conflicts: getConflictedFiles() });
    } catch (error) {
      log.error({ err: error }, "Error getting conflicts:");
      res.status(500).json({ error: "Failed to get conflicts" });
    }
  });

  app.post("/api/github/auto-commit/clear-conflict", async (req, res) => {
    try {
      const { filePath } = req.body;
      if (!filePath) {
        res.status(400).json({ error: "filePath is required" });
        return;
      }
      const { clearConflict } = await import("../auto-commit");
      const cleared = clearConflict(filePath);
      res.json({ success: cleared });
    } catch (error) {
      log.error({ err: error }, "Error clearing conflict:");
      res.status(500).json({ error: "Failed to clear conflict" });
    }
  });

  // Get live bootstrap progress state (no auth required — state is read-only)
  app.get("/api/github/bootstrap-status", async (_req, res) => {
    const { getBootstrapState } = await import("../github");
    res.json(getBootstrapState());
  });

  // Trigger a full bootstrap pull from the content repo (re-downloads all files)
  app.post("/api/github/content/bootstrap", async (_req, res) => {
    try {
      const { bootstrapContentFromRemote } = await import("../github");
      const result = await bootstrapContentFromRemote();
      if (result.success) {
        res.json({ success: true, pulled: result.pulled, errors: result.errors, commitSha: result.commitSha });
      } else {
        res.status(500).json({ success: false, pulled: result.pulled, errors: result.errors, commitSha: result.commitSha });
      }
    } catch (error) {
      log.error({ err: error }, "Error running bootstrap pull:");
      res.status(500).json({ error: "Bootstrap pull failed" });
    }
  });

  // Push all local content files to the remote content repo (seed operation)
  app.post("/api/github/content/push-all", async (_req, res) => {
    try {
      const { pushAllContentToRemote } = await import("../github");
      const site = res.locals.site as any;
      const result = await pushAllContentToRemote({
        contentRoot: site?.contentRoot,
        repoUrl: site?.config?.githubRepoUrl,
      });
      res.json({ success: result.errors.length === 0, committed: result.committed.length, errors: result.errors });
    } catch (error) {
      log.error({ err: error }, "Error running push-all:");
      res.status(500).json({ error: "Push-all failed" });
    }
  });

  // Get available variants for a content type and slug (reads versioning.yml)
}
