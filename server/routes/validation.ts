import type { Express, Response } from "express";
import * as fs from "fs";
import * as path from "path";
import { getValidationService } from "../../scripts/validation/service";
import { getCanonicalUrl } from "../../scripts/validation/shared/canonicalUrls";
import { getValidationCacheService } from "../services/validationCacheService";
import {
  isNonLocalFilesystemSrc,
  buildRegistrySrcToIdMap,
  resolveRegistryReference,
} from "../../scripts/validation/shared/imageRegistrySrc";
import type { ProgressEvent } from "../../scripts/validation/fixers/types";
import { contentIndex } from "../content-index";
import { getAvailableSchemaKeys } from "../schema-org";
import { generateSsrSchemaHtml } from "../ssr-schema";
import { mediaGallery, MediaGallery } from "../media-gallery";
import {

  safeYamlLoad,
  requireCapability,
  createValidationFixRun,
  appendValidationRunLog,
  applyFixerProgress,
  resolveFixerPipeline,
  validationRuns,
  validationRunOrder,
  MAX_VALIDATION_RUNS,
  MAX_RUN_LOG_ENTRIES,
  ValidationFixRunState,
  ValidationFixRunLogEntry,
  FixerItemStatus,
} from "./_helpers";
import { child } from "../logger";
const log = child({ module: "routes/validation" });

/** Returns the per-site ContentIndex for this request, falling back to the global singleton in single-site mode. */
function getCI(res: Response): typeof contentIndex {
  return (res.locals.site as any)?.contentIndex ?? contentIndex;
}

function getContentRoot(res: Response): string {
  return (res.locals.site as any)?.contentRoot ?? path.join(process.cwd(), process.env.CONTENT_FOLDER || "default-site-content");
}

function getMediaGallery(res: Response): MediaGallery {
  return (res.locals.site as any)?.mediaGallery ?? mediaGallery;
}

function getValidationCache(res: Response) {
  return (res.locals.site as any)?.validationCache ?? getValidationCacheService();
}

/**
 * Returns a valid ValidationContext for the current request's site.
 *
 * Reuses the cached context only when it was built for the same site
 * (matched by contentRoot). If the cached context belongs to a different
 * site — e.g. after a dev-site switch — it clears the stale context and
 * rebuilds with the correct ContentIndex and contentRoot.
 */
async function ensureSiteContext(service: ReturnType<typeof getValidationService>, res: Response) {
  const contentRoot = getContentRoot(res);
  const existing = service.getContext();
  if (existing && existing.contentRoot === contentRoot) {
    return existing;
  }
  service.clearContext();
  return service.buildContext({ contentRoot, ci: getCI(res) });
}

export function registerValidationRoutes(app: Express): void {
  // ============================================
  // Validation API Endpoints
  // ============================================

  // List available validators
  app.get("/api/validation/validators", (_req, res) => {
    const service = getValidationService();
    const validators = service.getAvailableValidators();
    res.json({
      validators,
      total: validators.length,
    });
  });

  // Run all or specific validators
  app.post("/api/validation/run", async (req, res) => {
    try {
      const { validators: validatorNames, includeArtifacts } = req.body;

      const service = getValidationService();

      // Clear previous context to get fresh data
      service.clearContext();
      await service.buildContext({ contentRoot: getContentRoot(res), ci: getCI(res) });

      const result = await service.runValidators({
        validators: validatorNames,
        includeArtifacts: includeArtifacts ?? false,
      });

      // Post-process: flush cache before responding so any immediate re-fetch
      // sees the updated results (no race condition).
      try {
        const cache = getValidationCache(res);
        const context = service.getContext();
        if (context) {
          const nowIso = new Date().toISOString();

          const byFile = new Map<string, { errors: typeof result.validators[0]["errors"]; warnings: typeof result.validators[0]["warnings"] }>();

          for (const v of result.validators) {
            for (const issue of v.errors) {
              if (!issue.file) continue;
              if (v.category) issue.category = v.category;
              if (!byFile.has(issue.file)) byFile.set(issue.file, { errors: [], warnings: [] });
              byFile.get(issue.file)!.errors.push(issue);
            }
            for (const issue of v.warnings) {
              if (!issue.file) continue;
              if (v.category) issue.category = v.category;
              if (!byFile.has(issue.file)) byFile.set(issue.file, { errors: [], warnings: [] });
              byFile.get(issue.file)!.warnings.push(issue);
            }
          }

          const seenUrls = new Set<string>();
          for (const file of context.contentFiles) {
            const url = getCanonicalUrl(file);
            if (seenUrls.has(url)) continue;
            seenUrls.add(url);

            const fileIssues = byFile.get(file.filePath) ?? { errors: [], warnings: [] };
            cache.setByUrl(url, {
              lastRunAt: nowIso,
              errors: fileIssues.errors,
              warnings: fileIssues.warnings,
            });
          }

          cache.markFullRunAt(nowIso);
          await cache.flush();
        }
      } catch (err) {
        log.warn({ err }, "ValidationCache post-process error (non-fatal)");
      }

      res.json(result);
    } catch (error) {
      log.error({ err: error }, "Validation error:");
      res.status(500).json({
        error: "Validation failed",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // Run validators for a single page only — faster than a full site scan
  app.post("/api/validation/run-page", async (req, res) => {
    try {
      const { url, validators: validatorNames } = req.body;

      if (!url || typeof url !== "string") {
        return res.status(400).json({ error: "Missing or invalid 'url' field" });
      }

      // These validators are inherently site-wide and cannot run meaningfully
      // on a single page — skip them for per-page runs.
      const SKIP_FOR_PER_PAGE = new Set(["lighthouse", "broken-anchors", "slug-conflicts"]);

      const service = getValidationService();
      service.clearContext();
      await service.buildContext({ contentRoot: getContentRoot(res), ci: getCI(res) });

      const context = service.getContext();
      if (!context) {
        return res.status(500).json({ error: "Failed to build validation context" });
      }

      // Filter contentFiles to only those matching the requested URL
      const normalizedTarget = url.toLowerCase().replace(/\/$/, "") || "/";
      const allContentFiles = context.contentFiles;
      const filteredFiles = allContentFiles.filter((file) => {
        const fileUrl = getCanonicalUrl(file).toLowerCase().replace(/\/$/, "") || "/";
        return fileUrl === normalizedTarget;
      });

      // Temporarily narrow the context so validators only see the target page
      context.contentFiles = filteredFiles;

      let effectiveValidators = validatorNames as string[] | undefined;
      if (effectiveValidators) {
        effectiveValidators = effectiveValidators.filter((n) => !SKIP_FOR_PER_PAGE.has(n));
      }

      let result;
      try {
        result = await service.runValidators({
          validators: effectiveValidators,
          includeArtifacts: false,
        });
      } finally {
        // Restore original contentFiles regardless of success/failure
        context.contentFiles = allContentFiles;
      }

      // Update only this page's cache entry; leave all other entries untouched
      try {
        const cache = getValidationCache(res);
        const nowIso = new Date().toISOString();

        const byFile = new Map<string, { errors: typeof result.validators[0]["errors"]; warnings: typeof result.validators[0]["warnings"] }>();
        for (const v of result.validators) {
          for (const issue of v.errors) {
            if (!issue.file) continue;
            if (v.category) issue.category = v.category;
            if (!byFile.has(issue.file)) byFile.set(issue.file, { errors: [], warnings: [] });
            byFile.get(issue.file)!.errors.push(issue);
          }
          for (const issue of v.warnings) {
            if (!issue.file) continue;
            if (v.category) issue.category = v.category;
            if (!byFile.has(issue.file)) byFile.set(issue.file, { errors: [], warnings: [] });
            byFile.get(issue.file)!.warnings.push(issue);
          }
        }

        // Accumulate all issues across files that belong to this URL
        const combinedErrors: typeof result.validators[0]["errors"] = [];
        const combinedWarnings: typeof result.validators[0]["warnings"] = [];
        for (const file of filteredFiles) {
          const fileIssues = byFile.get(file.filePath) ?? { errors: [], warnings: [] };
          combinedErrors.push(...fileIssues.errors);
          combinedWarnings.push(...fileIssues.warnings);
        }

        cache.setByUrl(url, {
          lastRunAt: nowIso,
          errors: combinedErrors,
          warnings: combinedWarnings,
        });
        await cache.flush();
      } catch (err) {
        log.warn({ err }, "ValidationCache post-process error (non-fatal)");
      }

      res.json(result);
    } catch (error) {
      log.error({ err: error }, "Validation run-page error:");
      res.status(500).json({
        error: "Validation failed",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // Explicit JSON format alias — same as /run but with a format extension
  app.post("/api/validation/run.json", async (req, res) => {
    try {
      const { validators: validatorNames, includeArtifacts } = req.body;
      const service = getValidationService();
      service.clearContext();
      await service.buildContext({ contentRoot: getContentRoot(res), ci: getCI(res) });
      const result = await service.runValidators({
        validators: validatorNames,
        includeArtifacts: includeArtifacts ?? false,
      });
      res.json(result);
    } catch (error) {
      log.error({ err: error }, "Validation error:");
      res.status(500).json({
        error: "Validation failed",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // LLM prompt format — runs validators and returns a copy-pasteable prompt
  app.post("/api/validation/run.prompt", async (req, res) => {
    try {
      const { validators: validatorNames, includeArtifacts } = req.body;
      const { formatAsLlmPrompt } = await import("../../scripts/validation/reporting/llm-prompt");
      const service = getValidationService();
      service.clearContext();
      await service.buildContext({ contentRoot: getContentRoot(res), ci: getCI(res) });
      const result = await service.runValidators({
        validators: validatorNames,
        includeArtifacts: includeArtifacts ?? false,
      });
      const prompt = formatAsLlmPrompt(result);
      const issueCount = result.validators.reduce(
        (n, v) => n + v.errors.length + v.warnings.length,
        0,
      );
      res.json({
        prompt,
        validatorNames: result.validators.map((v) => v.name),
        issueCount,
      });
    } catch (error) {
      log.error({ err: error }, "Validation prompt error:");
      res.status(500).json({
        error: "Validation prompt failed",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // Generate a focused LLM prompt scoped to a specific promptTemplate key
  // Used when multiple validators share the same fix.promptTemplate and a combined prompt is more useful
  app.post("/api/validation/fix-prompt", async (req, res) => {
    try {
      const { promptTemplate, validators: validatorNames } = req.body as {
        promptTemplate?: string;
        validators?: string[];
      };
      const { formatAsLlmPrompt } = await import("../../scripts/validation/reporting/llm-prompt");
      const service = getValidationService();
      service.clearContext();
      await service.buildContext({ contentRoot: getContentRoot(res), ci: getCI(res) });
      const result = await service.runValidators({
        validators: validatorNames,
        includeArtifacts: false,
      });
      if (promptTemplate) {
        for (const v of result.validators) {
          v.errors = v.errors.filter((i: any) => i.fix?.promptTemplate === promptTemplate);
          v.warnings = v.warnings.filter((i: any) => i.fix?.promptTemplate === promptTemplate);
        }
        result.validators = result.validators.filter(
          (v) => v.errors.length > 0 || v.warnings.length > 0
        );
      }
      const issueCount = result.validators.reduce(
        (n, v) => n + v.errors.length + v.warnings.length,
        0,
      );
      const prompt = formatAsLlmPrompt(result);
      res.json({
        prompt,
        promptTemplate: promptTemplate ?? null,
        validatorNames: result.validators.map((v) => v.name),
        issueCount,
      });
    } catch (error) {
      log.error({ err: error }, "Fix-prompt error:");
      res.status(500).json({
        error: "Fix prompt failed",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // Save a full JSON report to /tmp/validation-reports/
  app.post("/api/validation/save-report", async (_req, res) => {
    try {
      const { formatAsJson } = await import("../../scripts/validation/reporting/json");
      const fs = await import("fs");
      const path = await import("path");

      const service = getValidationService();
      service.clearContext();
      await service.buildContext({ contentRoot: getContentRoot(res), ci: getCI(res) });

      const result = await service.runValidators({ includeArtifacts: true });

      const timestamp = new Date().toISOString();
      const fileName = `report-${timestamp.replace(/[:.]/g, "-")}.json`;
      const dir = "/tmp/validation-reports";
      const filePath = path.join(dir, fileName);

      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(filePath, formatAsJson(result, { pretty: true, includeTimestamp: true }), "utf-8");

      res.json({ ok: true, path: filePath, timestamp, summary: result.summary });
    } catch (error) {
      log.error({ err: error }, "Save-report error:");
      res.status(500).json({
        error: "Failed to save report",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // Run a single validator
  app.post("/api/validation/run/:name", async (req, res) => {
    try {
      const { name } = req.params;
      const { includeArtifacts } = req.body;

      const contentRoot: string = (res.locals.site as any)?.contentRoot
        ?? path.join(process.cwd(), process.env.CONTENT_FOLDER || "default-site-content");

      const service = getValidationService();

      // Clear previous context to get fresh data
      service.clearContext();
      await service.buildContext({ contentRoot, ci: getCI(res) });

      const result = await service.runSingleValidator(
        name,
        includeArtifacts ?? false,
      );

      res.json(result);
    } catch (error) {
      log.error({ err: error }, "Validation error:");
      res.status(500).json({
        error: "Validation failed",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // Get validation context info (for debugging)
  app.get("/api/validation/context", async (_req, res) => {
    try {
      const service = getValidationService();
      const context = await ensureSiteContext(service, res);

      if (!context) {
        res.status(500).json({ error: "Failed to build context" });
        return;
      }

      // contentFiles is a flat array - count by type
      const contentFiles = context.contentFiles;
      const typeCounts = {
        programs: contentFiles.filter((f) => f.type === "program").length,
        landings: contentFiles.filter((f) => f.type === "landing").length,
        locations: contentFiles.filter((f) => f.type === "location").length,
        pages: contentFiles.filter((f) => f.type === "page").length,
      };

      res.json({
        contentFiles: typeCounts,
        totalFiles: contentFiles.length,
        validUrls: context.validUrls.size,
        availableSchemas: context.availableSchemas.length,
        redirects: context.redirectMap.size,
      });
    } catch (error) {
      log.error({ err: error }, "Context build error:");
      res.status(500).json({ error: "Failed to get context" });
    }
  });

  // Clear validation cache
  app.post("/api/validation/clear-cache", (_req, res) => {
    const service = getValidationService();
    service.clearContext();
    res.json({ success: true, message: "Validation cache cleared" });
  });

  // Run a named fixer
  app.post("/api/validation/fix/:fixerName", async (req, res) => {
    try {
      const { fixerName } = req.params;
      const { getFixer } = await import("../../scripts/validation/fixers/index");
      if (!getFixer(fixerName)) {
        res.status(404).json({ error: `Fixer "${fixerName}" not found` });
        return;
      }
      const pipeline = resolveFixerPipeline(
        fixerName,
        (name) => getFixer(name) as { runAfter?: string[] } | undefined,
      );
      const createdRuns = pipeline.map((name) => createValidationFixRun(fixerName, name));
      let finalResult = {
        ok: true,
        message: `Completed ${pipeline.length} fixer(s)`,
      };

      for (let i = 0; i < pipeline.length; i++) {
        const currentFixerName = pipeline[i];
        const run = createdRuns[i];
        const currentFixer = getFixer(currentFixerName);
        if (!currentFixer) {
          run.running = false;
          run.completedAt = Date.now();
          run.message = `Fixer "${currentFixerName}" not found`;
          finalResult = { ok: false, message: run.message };
          break;
        }

        run.running = true;
        try {
          const result = await currentFixer.run({
            ...(req.body || {}),
            onProgress: (event: ProgressEvent) => applyFixerProgress(run, event),
          });
          run.running = false;
          run.completedAt = Date.now();
          run.message = result.message;
          finalResult = { ok: result.ok, message: result.message };
          if (!result.ok) {
            break;
          }
        } catch (error) {
          run.running = false;
          run.completedAt = Date.now();
          run.failed += 1;
          run.message = error instanceof Error ? error.message : "Unknown fixer error";
          finalResult = { ok: false, message: run.message };
          break;
        }
      }

      res.json({
        ...finalResult,
        runIds: createdRuns.map((run) => run.runId),
        pipeline,
      });
    } catch (error) {
      log.error({ err: error }, "Fixer error:");
      res.status(500).json({
        error: "Fixer failed",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // List available fixers
  app.get("/api/validation/fixers", async (_req, res) => {
    try {
      const { listFixers } = await import("../../scripts/validation/fixers/index");
      res.json(listFixers());
    } catch (error) {
      res.status(500).json({ error: "Failed to list fixers" });
    }
  });

  app.get("/api/validation/runs", (_req, res) => {
    const runs = validationRunOrder
      .map((runId) => validationRuns.get(runId))
      .filter((run): run is ValidationFixRunState => Boolean(run))
      .sort((a, b) => b.startedAt - a.startedAt);
    res.json(runs);
  });

  app.post("/api/validation/runs/clear", (_req, res) => {
    const cleared = validationRunOrder.length;
    validationRuns.clear();
    validationRunOrder.length = 0;
    res.json({ ok: true, cleared });
  });

  app.get("/api/validation/cache-summary", (_req, res) => {
    const cache = getValidationCache(res);
    const all = cache.getAll();
    const summary: Record<string, { errorCount: number; warningCount: number }> = {};
    for (const [url, entry] of all) {
      summary[url] = {
        errorCount: entry.errors.length,
        warningCount: entry.warnings.length,
      };
    }
    res.json(summary);
  });

  // ============================================
  // Diagnostics API
  // ============================================

  app.get("/api/diagnostics/pages", async (_req, res) => {
    try {
      const service = getValidationService();
      const context = await ensureSiteContext(service, res);

      const pages = context.contentFiles.map((file) => {
        const url = getCanonicalUrl(file);
        return {
          url,
          title: file.title || file.slug,
          locale: file.locale,
          contentType: file.type,
          slug: file.slug,
          filePath: file.filePath,
          hasMeta: !!(file.meta?.page_title && file.meta?.description),
          hasSchema: !!(file.schema?.include && file.schema.include.length > 0),
        };
      });

      res.json({ pages, total: pages.length });
    } catch (error) {
      log.error({ err: error }, "Diagnostics pages error:");
      res.status(500).json({ error: "Failed to load pages" });
    }
  });

  app.get("/api/diagnostics/page", async (req, res) => {
    try {
      const url = req.query.url as string;
      if (!url) {
        res.status(400).json({ error: "Missing url query parameter" });
        return;
      }

      const service = getValidationService();
      const context = await ensureSiteContext(service, res);

      const matchingFiles = context.contentFiles.filter(
        (f: any) => getCanonicalUrl(f) === url,
      );
      const urlLocale = url.startsWith("/es/")
        ? "es"
        : url.startsWith("/en/")
          ? "en"
          : null;
      const file =
        (urlLocale && matchingFiles.find((f: any) => f.locale === urlLocale)) ||
        matchingFiles.find((f: any) => f.locale !== "_common") ||
        matchingFiles[0] ||
        null;

      if (!file) {
        res.status(404).json({ error: `No content found for URL: ${url}` });
        return;
      }

      let rawData: Record<string, unknown> = {};
      try {
        const commonPath = path.join(
          path.dirname(file.filePath),
          "_common.yml",
        );
        if (fs.existsSync(commonPath)) {
          const commonData =
            (safeYamlLoad(fs.readFileSync(commonPath, "utf-8")) as Record<
              string,
              unknown
            >) || {};
          rawData = { ...commonData };
        }
        if (fs.existsSync(file.filePath)) {
          const localeData =
            (safeYamlLoad(fs.readFileSync(file.filePath, "utf-8")) as Record<
              string,
              unknown
            >) || {};
          rawData = { ...rawData, ...localeData };
        }
      } catch {}

      const schemaValidation: {
        valid: boolean;
        errors: Array<{
          path: string;
          code: string;
          message: string;
          expected?: string;
          received?: string;
        }>;
      } = { valid: true, errors: [] };
      try {
        const contentTypes = ["program", "landing", "location", "page"];
        if (contentTypes.includes(file.type)) {
          let inferredLocale = file.locale;
          if (!inferredLocale || inferredLocale === "_common") {
            inferredLocale =
              urlLocale || (url.startsWith("/es/") ? "es" : "en");
          }
          const folderSlug = path.basename(path.dirname(file.filePath));
          const result = getCI(res).loadContent({
            contentType: file.type,
            slug: folderSlug,
            localeOrVariant: inferredLocale,
          });
          if (!result.success) {
            schemaValidation.valid = false;
            schemaValidation.errors.push({
              path: "",
              code: "CONTENT_LOAD_FAILED",
              message: result.error,
            });
          } else {
            const data = result.data as Record<string, unknown>;
            const meta = data.meta as Record<string, unknown> | undefined;
            if (!meta?.page_title) {
              schemaValidation.errors.push({
                path: "meta.page_title",
                code: "MISSING_META",
                message: "Missing meta.page_title — a fallback will be used at render time",
              });
            }
            if (!meta?.description) {
              schemaValidation.errors.push({
                path: "meta.description",
                code: "MISSING_META",
                message: "Missing meta.description — an empty string fallback will be used",
              });
            }
          }
        }
      } catch (e) {
        schemaValidation.valid = false;
        schemaValidation.errors.push({
          path: "",
          code: "SCHEMA_CHECK_ERROR",
          message: String(e),
        });
      }

      const sections = (rawData.sections as any[]) || [];
      const sectionTypes = sections
        .filter((s: any) => s?.type)
        .map((s: any) => s.type);
      const hasFaq = sectionTypes.includes("faq");

      let schemaHtml = "";
      let parsedSchemas: any[] = [];
      try {
        schemaHtml = generateSsrSchemaHtml(url, getCI(res), getContentRoot(res));
        const scriptRegex =
          /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g;
        let match: RegExpExecArray | null;
        while ((match = scriptRegex.exec(schemaHtml)) !== null) {
          try {
            parsedSchemas.push(JSON.parse(match[1]));
          } catch {}
        }
      } catch {}

      const imageIds = new Set<string>();
      function extractImageIds(obj: unknown): void {
        if (!obj || typeof obj !== "object") return;
        if (Array.isArray(obj)) {
          obj.forEach(extractImageIds);
          return;
        }
        const rec = obj as Record<string, unknown>;
        for (const [key, value] of Object.entries(rec)) {
          if (
            (key === "image_id" || key === "image") &&
            typeof value === "string"
          ) {
            imageIds.add(value);
          } else if (typeof value === "object" && value !== null) {
            extractImageIds(value);
          }
        }
      }
      extractImageIds(rawData);

      let registryImages: Record<string, any> = {};
      try {
        const reg = getMediaGallery(res).getRegistry();
        if (reg) {
          registryImages = reg.images || {};
        }
      } catch {}

      const missingFromRegistry: string[] = [];
      const missingFromDisk: string[] = [];
      const srcToId = buildRegistrySrcToIdMap(registryImages);
      imageIds.forEach((ref) => {
        const resolved = resolveRegistryReference(ref, registryImages, srcToId);
        if (resolved === null) {
          missingFromRegistry.push(ref);
          return;
        }
        if (registryImages[resolved].src) {
          const src = String(registryImages[resolved].src);
          if (!isNonLocalFilesystemSrc(src)) {
            const srcPath = path.join(process.cwd(), src);
            if (!fs.existsSync(srcPath)) {
              missingFromDisk.push(resolved);
            }
          }
        }
      });

      const counterpartFile = context.contentFiles.find(
        (f: any) =>
          f.slug === file.slug &&
          f.type === file.type &&
          f.locale !== file.locale,
      );
      const counterpartUrl = counterpartFile
        ? getCanonicalUrl(counterpartFile)
        : null;

      const incomingRedirects: string[] = [];
      if (context.redirectMap && context.redirectMap.size > 0) {
        context.redirectMap.forEach((entry: any, from: string) => {
          if (entry.to === url) {
            incomingRedirects.push(from);
          }
        });
      }

      const issues: any[] = [];

      if (!schemaValidation.valid) {
        for (const err of schemaValidation.errors) {
          issues.push({
            type: "error",
            code: err.code,
            message: err.path ? `${err.path}: ${err.message}` : err.message,
            category: "schema-validation",
            details: {
              path: err.path,
              expected: err.expected,
              received: err.received,
            },
          });
        }
      }
      for (const err of schemaValidation.errors) {
        if (err.code === "MISSING_META") {
          issues.push({
            type: "warning",
            code: err.code,
            message: err.message,
            category: "meta",
            details: { path: err.path },
          });
        }
      }

      const schemaData = rawData.schema as
        | { include?: string[]; overrides?: Record<string, unknown> }
        | undefined;
      if (schemaData?.include) {
        const availableKeys = getAvailableSchemaKeys();
        const availableSet = new Set(availableKeys);
        for (const ref of schemaData.include) {
          if (!availableSet.has(ref)) {
            issues.push({
              type: "error",
              code: "INVALID_SCHEMA_REF",
              message: `Invalid schema reference: "${ref}"`,
              category: "schema-org",
            });
          }
        }
        if (schemaData.overrides) {
          for (const key of Object.keys(schemaData.overrides)) {
            if (!availableSet.has(key)) {
              issues.push({
                type: "error",
                code: "INVALID_SCHEMA_OVERRIDE",
                message: `Invalid schema override key: "${key}"`,
                category: "schema-org",
              });
            }
          }
        }
      }

      const meta = file.meta || {};
      let seoScore = 0;
      let seoMax = 0;

      seoMax += 20;
      if (meta.page_title) {
        seoScore += 20;
      } else {
        issues.push({
          type: "warning",
          code: "MISSING_PAGE_TITLE",
          message: "Missing page_title",
        });
      }

      seoMax += 10;
      if (
        meta.page_title &&
        meta.page_title.length >= 30 &&
        meta.page_title.length <= 60
      ) {
        seoScore += 10;
      }

      seoMax += 20;
      if (meta.description) {
        seoScore += 20;
      } else {
        issues.push({
          type: "warning",
          code: "MISSING_DESCRIPTION",
          message: "Missing description",
        });
      }

      seoMax += 10;
      if (
        meta.description &&
        meta.description.length >= 70 &&
        meta.description.length <= 160
      ) {
        seoScore += 10;
      }

      seoMax += 10;
      if (meta.og_image) seoScore += 10;

      seoMax += 10;
      if (meta.canonical_url) seoScore += 10;

      let schemaScore = 0;
      let schemaMax = 0;

      schemaMax += 30;
      if (file.schema?.include && file.schema.include.length > 0) {
        schemaScore += 30;
      }

      schemaMax += 20;
      if (parsedSchemas.length > 0) {
        schemaScore += 20;
      }

      schemaMax += 15;
      if (parsedSchemas.some((s: any) => s.name)) {
        schemaScore += 15;
      }

      schemaMax += 15;
      if (parsedSchemas.some((s: any) => s.description)) {
        schemaScore += 15;
      }

      schemaMax += 10;
      const hasPlaceholders = parsedSchemas.some((s: any) =>
        JSON.stringify(s).match(/todo/i),
      );
      if (!hasPlaceholders) {
        schemaScore += 10;
      }

      schemaMax += 10;
      if (hasFaq) {
        if (parsedSchemas.some((s: any) => s["@type"] === "FAQPage")) {
          schemaScore += 10;
        }
      } else {
        schemaScore += 10;
      }

      let contentScore = 0;
      let contentMax = 0;

      contentMax += 25;
      if (sections.length > 0) {
        contentScore += 25;
      }

      contentMax += 20;
      const allTyped = sections.every((s: any) => s.type);
      if (sections.length > 0 && allTyped) {
        contentScore += 20;
      }

      contentMax += 20;
      if (counterpartFile) {
        contentScore += 20;
      }

      const emptyFields: string[] = [];
      function findEmptyFields(obj: unknown, path: string = ""): void {
        if (!obj || typeof obj !== "object") return;
        if (Array.isArray(obj)) {
          obj.forEach((item, i) => findEmptyFields(item, `${path}[${i}]`));
          return;
        }
        const rec = obj as Record<string, unknown>;
        const criticalKeys = new Set([
          "title",
          "heading",
          "description",
          "subtitle",
          "tagline",
        ]);
        for (const [key, value] of Object.entries(rec)) {
          const fieldPath = path ? `${path}.${key}` : key;
          if (
            criticalKeys.has(key) &&
            typeof value === "string" &&
            value.trim() === ""
          ) {
            emptyFields.push(fieldPath);
          } else if (typeof value === "object" && value !== null) {
            findEmptyFields(value, fieldPath);
          }
        }
      }
      findEmptyFields(rawData);

      contentMax += 20;
      if (missingFromRegistry.length === 0 && missingFromDisk.length === 0) {
        contentScore += 20;
      }

      const seoPercent = seoMax > 0 ? Math.round((seoScore / seoMax) * 100) : 0;
      const schemaPercent =
        schemaMax > 0 ? Math.round((schemaScore / schemaMax) * 100) : 0;
      const contentPercent =
        contentMax > 0 ? Math.round((contentScore / contentMax) * 100) : 0;
      const totalScore = Math.round(
        (seoPercent + schemaPercent + contentPercent) / 3,
      );

      const cachedEntry = getValidationCache(res).getByUrl(url) ?? null;

      res.json({
        url,
        contentType: file.type,
        slug: file.slug,
        locale: file.locale,
        filePath: file.filePath,
        title: file.title,

        cached: cachedEntry,

        schemaValidation,

        meta: {
          page_title: meta.page_title || null,
          titleLength: meta.page_title ? meta.page_title.length : 0,
          description: meta.description || null,
          descriptionLength: meta.description ? meta.description.length : 0,
          og_image: meta.og_image || null,
          canonical_url: meta.canonical_url || null,
          robots: meta.robots || null,
        },

        schema: {
          configured: !!(
            file.schema?.include && file.schema.include.length > 0
          ),
          includes: file.schema?.include || [],
          renderedJsonLd: parsedSchemas,
          htmlPreview: schemaHtml,
        },

        sections: {
          count: sections.length,
          types: sectionTypes,
          hasFaq,
        },

        images: {
          referencedIds: Array.from(imageIds),
          missingFromRegistry,
          missingFromDisk,
        },

        translations: {
          locale: file.locale,
          availableLocales: [
            file.locale,
            ...(counterpartFile ? [counterpartFile.locale] : []),
          ],
          counterpartUrl,
        },

        redirects: {
          incomingRedirects,
        },

        emptyFields,

        issues,

        score: {
          total: totalScore,
          seo: seoPercent,
          schema: schemaPercent,
          content: contentPercent,
        },
      });
    } catch (error) {
      log.error({ err: error }, "Diagnostics page error:");
      res.status(500).json({ error: "Failed to generate page diagnostics" });
    }
  });
}
