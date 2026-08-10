/**
 * Async diagnostics jobs shared by MCP and the staff Diagnostics dashboard.
 *
 * - Max 1 running job per contentRoot
 * - Exact-scope dedupe returns the existing job_id
 * - Envelopes under {contentRoot}/.cache/diagnostics-jobs/{jobId}.json (last 50)
 * - Issues persist in ValidationCacheService; artifacts stay in-memory until GET
 */

import * as fs from "fs";
import * as path from "path";
import type {
  PageCacheEntry,
  ValidationIssue,
  ValidatorResult,
} from "../../scripts/validation/shared/types";
import { ValidationService } from "../../scripts/validation/service";
import { getCanonicalUrl } from "../../scripts/validation/shared/canonicalUrls";
import { validators as defaultValidators, getValidator } from "../../scripts/validation/validators";
import type { ContentIndex } from "../content-index";
import type { ValidationCacheService } from "./validationCacheService";
import {
  buildFullPageCacheEntry,
  collectIssuesByFile,
  isUrlStaleForFullRun,
  mergePartialPageCacheEntry,
} from "./validationCacheMerge";
import { child } from "../logger";

const log = child({ module: "diagnosticsJobService" });

const MAX_JOB_ENVELOPES = 50;
const SKIP_FOR_PER_PAGE = new Set(["broken-anchors", "slug-conflicts"]);
const SITE_WIDE_VALIDATORS = new Set([
  "database-health",
  "broken-anchors",
  "slug-conflicts",
  "orphaned-files",
  "images",
  "image-optimization",
  "image-tags",
  "hero-image-tags",
  "field-mappings",
  "sitemap",
]);

export type DiagnosticsFreshness = "hard" | "max_age";
export type DiagnosticsJobStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cached"
  | "busy"
  | "not_found";

export interface DiagnosticsJobRequest {
  contentRoot: string;
  contentRootName: string;
  ci: ContentIndex;
  cache: ValidationCacheService;
  slugs?: string[];
  urls?: string[];
  freshness?: DiagnosticsFreshness;
  max_age_seconds?: number;
  validators?: string[];
  include_artifacts?: boolean;
  categories?: string[];
}

export interface DiagnosticsJobEnvelope {
  jobId: string;
  status: Exclude<DiagnosticsJobStatus, "cached" | "busy" | "not_found">;
  contentRootName: string;
  scopeKey: string;
  slugs?: string[];
  urls?: string[];
  freshness: DiagnosticsFreshness;
  max_age_seconds: number;
  validators?: string[];
  include_artifacts: boolean;
  categories?: string[];
  startedAt: number;
  completedAt?: number;
  processed: number;
  total: number;
  staleUrlCount: number;
  urlCount: number;
  summary?: { errorCount: number; warningCount: number };
  error?: string;
  partial: boolean;
}

export interface DiagnosticsJobRecord extends DiagnosticsJobEnvelope {
  validatorResults?: ValidatorResult[];
  resultIssuesBySlug?: Record<string, MappedIssue[]>;
}

export interface MappedIssue {
  code: string;
  message: string;
  severity: "error" | "warning";
  category: string;
  validator?: string;
  file?: string;
  suggestion?: string;
  url?: string;
}

export type StartDiagnosticsResult =
  | {
      status: "cached";
      issuesBySlug: Record<string, MappedIssue[]>;
      lastFullRunAtBySlug: Record<string, string | null>;
      cacheMisses: string[];
      retry_after_seconds: number;
    }
  | {
      status: "queued" | "running";
      job_id: string;
      reused?: boolean;
      retry_after_seconds: number;
      scope: {
        urlCount: number;
        staleUrlCount: number;
        slugs?: string[];
        validators?: string[];
        partial: boolean;
      };
    }
  | {
      status: "busy";
      code: "diagnostics_busy";
      job_id: string;
      retry_after_seconds: number;
      message: string;
    };

const jobsById = new Map<string, DiagnosticsJobRecord>();
const runningByContentRoot = new Map<string, string>();
const jobCi = new Map<string, ContentIndex>();
const jobCache = new Map<string, ValidationCacheService>();
const jobContentRoot = new Map<string, string>();

function jobsDir(contentRoot: string): string {
  return path.join(contentRoot, ".cache", "diagnostics-jobs");
}

function ensureJobsDir(contentRoot: string): string {
  const dir = jobsDir(contentRoot);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function writeEnvelope(contentRoot: string, job: DiagnosticsJobEnvelope): void {
  const dir = ensureJobsDir(contentRoot);
  const filePath = path.join(dir, `${job.jobId}.json`);
  fs.writeFileSync(filePath, JSON.stringify(job, null, 2) + "\n", "utf-8");
  pruneEnvelopes(dir);
}

function pruneEnvelopes(dir: string): void {
  try {
    const files = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => {
        const full = path.join(dir, f);
        return { full, mtime: fs.statSync(full).mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime);
    for (const stale of files.slice(MAX_JOB_ENVELOPES)) {
      try {
        fs.unlinkSync(stale.full);
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }
}

function readEnvelopeFromDisk(
  contentRoot: string,
  jobId: string,
): DiagnosticsJobEnvelope | null {
  const filePath = path.join(jobsDir(contentRoot), `${jobId}.json`);
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as DiagnosticsJobEnvelope;
  } catch {
    return null;
  }
}

function scopeKey(req: {
  slugs?: string[];
  urls?: string[];
  validators?: string[];
  freshness: DiagnosticsFreshness;
  max_age_seconds: number;
}): string {
  const slugs = [...(req.slugs ?? [])].map((s) => s.toLowerCase()).sort();
  const urls = [...(req.urls ?? [])].map((u) => u.toLowerCase()).sort();
  const validators = [...(req.validators ?? [])].map((v) => v.toLowerCase()).sort();
  return JSON.stringify({
    slugs,
    urls,
    validators,
    freshness: req.freshness,
    max_age_seconds: req.freshness === "hard" ? 0 : req.max_age_seconds,
  });
}

function retryAfterSeconds(urlCount: number): number {
  return urlCount > 50 ? 15 : 5;
}

async function resolveUrlTargets(
  contentRoot: string,
  ci: ContentIndex,
  slugs?: string[],
  urls?: string[],
): Promise<{ url: string; slug: string; filePath: string; locale: string; type: string }[]> {
  const service = new ValidationService();
  const context = await service.buildContext({ contentRoot, ci });
  const slugSet = slugs && slugs.length > 0 ? new Set(slugs) : null;
  const urlSet =
    urls && urls.length > 0
      ? new Set(urls.map((u) => u.toLowerCase().replace(/\/$/, "") || "/"))
      : null;

  const targets: {
    url: string;
    slug: string;
    filePath: string;
    locale: string;
    type: string;
  }[] = [];
  const seen = new Set<string>();

  for (const file of context.contentFiles) {
    if (slugSet && !slugSet.has(file.slug)) continue;
    const url = getCanonicalUrl(file);
    const norm = url.toLowerCase().replace(/\/$/, "") || "/";
    if (urlSet && !urlSet.has(norm)) continue;
    if (seen.has(norm)) continue;
    seen.add(norm);
    targets.push({
      url,
      slug: file.slug,
      filePath: file.filePath,
      locale: file.locale,
      type: file.type,
    });
  }

  return targets;
}

function mapEntryIssues(
  url: string,
  entry: PageCacheEntry | undefined,
  categories?: string[],
): MappedIssue[] {
  if (!entry) return [];
  const catSet = categories && categories.length > 0 ? new Set(categories) : null;
  const all: MappedIssue[] = [
    ...(entry.errors ?? []).map((e) => ({
      code: e.code,
      message: e.message,
      severity: "error" as const,
      category: e.category ?? "other",
      ...(e.validator ? { validator: e.validator } : {}),
      ...(e.file ? { file: e.file } : {}),
      ...(e.suggestion ? { suggestion: e.suggestion } : {}),
      url,
    })),
    ...(entry.warnings ?? []).map((w) => ({
      code: w.code,
      message: w.message,
      severity: "warning" as const,
      category: w.category ?? "other",
      ...(w.validator ? { validator: w.validator } : {}),
      ...(w.file ? { file: w.file } : {}),
      ...(w.suggestion ? { suggestion: w.suggestion } : {}),
      url,
    })),
  ];
  return catSet ? all.filter((i) => catSet.has(i.category)) : all;
}

function issuesBySlugFromTargets(
  cache: ValidationCacheService,
  targets: { url: string; slug: string }[],
  categories?: string[],
): {
  issuesBySlug: Record<string, MappedIssue[]>;
  lastFullRunAtBySlug: Record<string, string | null>;
  cacheMisses: string[];
} {
  const issuesBySlug: Record<string, MappedIssue[]> = {};
  const lastFullRunAtBySlug: Record<string, string | null> = {};
  const cacheMisses: string[] = [];

  for (const t of targets) {
    if (!issuesBySlug[t.slug]) issuesBySlug[t.slug] = [];
    const entry = cache.getByUrl(t.url);
    if (!entry) {
      if (!cacheMisses.includes(t.slug)) cacheMisses.push(t.slug);
      lastFullRunAtBySlug[t.slug] = lastFullRunAtBySlug[t.slug] ?? null;
      continue;
    }
    issuesBySlug[t.slug].push(...mapEntryIssues(t.url, entry, categories));
    const full = entry.lastFullRunAt ?? null;
    const prev = lastFullRunAtBySlug[t.slug];
    if (!prev || (full && full > prev)) lastFullRunAtBySlug[t.slug] = full;
  }

  return { issuesBySlug, lastFullRunAtBySlug, cacheMisses };
}

function effectiveValidatorNames(requested?: string[]): {
  pageValidators: string[];
  siteWideValidators: string[];
  partial: boolean;
} {
  const pool = defaultValidators.map((v) => v.name).filter((n) => n !== "lighthouse");
  const names =
    requested && requested.length > 0
      ? requested.filter((n) => n !== "lighthouse" && !!getValidator(n))
      : pool;

  const resolved = names.filter((n) => n !== "lighthouse" && !!getValidator(n));
  const partial = !!(requested && requested.length > 0);
  const pageValidators = resolved.filter(
    (n) => !SITE_WIDE_VALIDATORS.has(n) && !SKIP_FOR_PER_PAGE.has(n),
  );
  const siteWideValidators = resolved.filter((n) => SITE_WIDE_VALIDATORS.has(n));
  // If caller asked for skip-for-per-page validators explicitly (partial), include as site-wide
  if (partial) {
    for (const n of resolved) {
      if (SKIP_FOR_PER_PAGE.has(n) && !siteWideValidators.includes(n)) {
        siteWideValidators.push(n);
      }
    }
  }
  return { pageValidators, siteWideValidators, partial };
}

async function runJob(contentRoot: string, jobId: string): Promise<void> {
  const job = jobsById.get(jobId);
  if (!job) return;

  job.status = "running";
  writeEnvelope(contentRoot, toEnvelope(job));

  try {
    const ci = jobCi.get(jobId);
    const cache = jobCache.get(jobId);
    if (!ci || !cache) {
      throw new Error("Job context missing (ci/cache)");
    }
    const service = new ValidationService();
    const context = await service.buildContext({
      contentRoot,
      ci,
    });
    const includeArtifacts = job.include_artifacts;
    const { pageValidators, siteWideValidators, partial } = effectiveValidatorNames(
      job.validators,
    );

    const allTargets = await resolveUrlTargets(
      contentRoot,
      ci,
      job.slugs,
      job.urls,
    );

    let staleTargets = allTargets;
    if (!partial && job.freshness === "max_age") {
      staleTargets = allTargets.filter((t) =>
        isUrlStaleForFullRun(cache.getByUrl(t.url), job.max_age_seconds),
      );
    }

    const workUnits =
      (pageValidators.length > 0 ? staleTargets.length : 0) +
      (siteWideValidators.length > 0 ? 1 : 0);
    job.total = Math.max(workUnits, 1);
    job.staleUrlCount = staleTargets.length;
    job.urlCount = allTargets.length;
    job.processed = 0;
    writeEnvelope(contentRoot, toEnvelope(job));

    const allValidatorResults: ValidatorResult[] = [];
    const allContentFiles = context.contentFiles;
    const nowIso = () => new Date().toISOString();

    for (const target of pageValidators.length > 0 ? staleTargets : []) {
      const normalizedTarget = target.url.toLowerCase().replace(/\/$/, "") || "/";
      const filteredFiles = allContentFiles.filter((file) => {
        const fileUrl = getCanonicalUrl(file).toLowerCase().replace(/\/$/, "") || "/";
        return fileUrl === normalizedTarget;
      });
      context.contentFiles = filteredFiles;
      try {
        const result = await service.runValidators({
          validators: pageValidators,
          includeArtifacts,
        });
        allValidatorResults.push(...result.validators);

        const byFile = collectIssuesByFile(result.validators);
        const combinedErrors: ValidationIssue[] = [];
        const combinedWarnings: ValidationIssue[] = [];
        for (const file of filteredFiles) {
          const fileIssues = byFile.get(file.filePath) ?? { errors: [], warnings: [] };
          combinedErrors.push(...fileIssues.errors);
          combinedWarnings.push(...fileIssues.warnings);
        }
        const ts = nowIso();
        if (partial) {
          cache.setByUrl(
            target.url,
            mergePartialPageCacheEntry(
              cache.getByUrl(target.url),
              combinedErrors,
              combinedWarnings,
              new Set(pageValidators),
              ts,
            ),
          );
        } else {
          cache.setByUrl(
            target.url,
            buildFullPageCacheEntry(combinedErrors, combinedWarnings, ts),
          );
        }
      } finally {
        context.contentFiles = allContentFiles;
      }
      job.processed += 1;
      if (job.processed % 5 === 0) writeEnvelope(contentRoot, toEnvelope(job));
    }

    if (siteWideValidators.length > 0) {
      context.contentFiles = allContentFiles;
      const result = await service.runValidators({
        validators: siteWideValidators,
        includeArtifacts,
      });
      allValidatorResults.push(...result.validators);

      // Apply site-wide issues that have file paths onto URLs; database-health via post-process logic
      const byFile = collectIssuesByFile(result.validators);
      const ts = nowIso();
      const ran = new Set(siteWideValidators);
      const seenUrls = new Set<string>();
      for (const file of allContentFiles) {
        const url = getCanonicalUrl(file);
        if (seenUrls.has(url)) continue;
        seenUrls.add(url);
        if (job.slugs?.length && !job.slugs.includes(file.slug)) continue;
        const fileIssues = byFile.get(file.filePath);
        if (!fileIssues) continue;
        if (partial) {
          cache.setByUrl(
            url,
            mergePartialPageCacheEntry(
              cache.getByUrl(url),
              fileIssues.errors,
              fileIssues.warnings,
              ran,
              ts,
            ),
          );
        } else if (staleTargets.some((t) => t.url === url) || job.freshness === "hard") {
          // For full jobs, site-wide issues merge into pages that were refreshed or all on hard
          const existing = cache.getByUrl(url);
          if (existing) {
            cache.setByUrl(
              url,
              mergePartialPageCacheEntry(
                existing,
                fileIssues.errors,
                fileIssues.warnings,
                ran,
                existing.lastFullRunAt ? existing.lastRunAt : ts,
              ),
            );
            // Preserve lastFullRunAt if already set by per-URL pass
            const updated = cache.getByUrl(url)!;
            if (existing.lastFullRunAt) {
              cache.setByUrl(url, {
                ...updated,
                lastFullRunAt: existing.lastFullRunAt,
                lastRunAt: existing.lastFullRunAt,
              });
            }
          }
        }
      }

      // database-health db map
      const dbHealth = result.validators.find((v) => v.name === "database-health");
      if (dbHealth) {
        const { applyValidationRunToCache } = await import("./validationCachePostProcess");
        await applyValidationRunToCache(
          cache,
          { summary: { total: 1, passed: 0, failed: 0, warnings: 0, duration: 0 }, validators: [dbHealth] },
          context,
          { partial: true },
        );
      }

      job.processed += 1;
    }

    if (!partial) {
      cache.markFullRunAt(nowIso());
    }
    await cache.flush();

    // Collapse duplicate validator names (per-URL runs append many copies) for UI
    const byName = new Map<string, ValidatorResult>();
    for (const v of allValidatorResults) {
      const prev = byName.get(v.name);
      if (!prev) {
        byName.set(v.name, { ...v, errors: [...v.errors], warnings: [...v.warnings] });
      } else {
        prev.errors.push(...v.errors);
        prev.warnings.push(...v.warnings);
        prev.duration += v.duration;
        if (v.status === "failed") prev.status = "failed";
        else if (v.status === "warning" && prev.status === "passed") prev.status = "warning";
        if (v.artifacts && includeArtifacts) {
          prev.artifacts = { ...(prev.artifacts ?? {}), ...v.artifacts };
        }
      }
    }
    job.validatorResults = [...byName.values()];

    const { issuesBySlug } = issuesBySlugFromTargets(cache, allTargets, job.categories);
    job.resultIssuesBySlug = issuesBySlug;

    let errorCount = 0;
    let warningCount = 0;
    for (const issues of Object.values(issuesBySlug)) {
      for (const i of issues) {
        if (i.severity === "error") errorCount += 1;
        else warningCount += 1;
      }
    }
    job.summary = { errorCount, warningCount };
    job.status = "completed";
    job.completedAt = Date.now();
    job.processed = job.total;
    writeEnvelope(contentRoot, toEnvelope(job));
  } catch (err) {
    log.error({ err, jobId }, "Diagnostics job failed");
    job.status = "failed";
    job.error = err instanceof Error ? err.message : String(err);
    job.completedAt = Date.now();
    writeEnvelope(contentRoot, toEnvelope(job));
  } finally {
    if (runningByContentRoot.get(contentRoot) === jobId) {
      runningByContentRoot.delete(contentRoot);
    }
    jobCi.delete(jobId);
    jobCache.delete(jobId);
    // Keep jobContentRoot for list/get until pruned from memory map naturally
  }
}

function toEnvelope(job: DiagnosticsJobRecord): DiagnosticsJobEnvelope {
  return {
    jobId: job.jobId,
    status: job.status,
    contentRootName: job.contentRootName,
    scopeKey: job.scopeKey,
    slugs: job.slugs,
    urls: job.urls,
    freshness: job.freshness,
    max_age_seconds: job.max_age_seconds,
    validators: job.validators,
    include_artifacts: job.include_artifacts,
    categories: job.categories,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    processed: job.processed,
    total: job.total,
    staleUrlCount: job.staleUrlCount,
    urlCount: job.urlCount,
    summary: job.summary,
    error: job.error,
    partial: job.partial,
  };
}

export async function startDiagnosticsJob(
  req: DiagnosticsJobRequest,
): Promise<StartDiagnosticsResult> {
  const freshness: DiagnosticsFreshness = req.freshness === "hard" ? "hard" : "max_age";
  const maxAge = typeof req.max_age_seconds === "number" && req.max_age_seconds > 0
    ? req.max_age_seconds
    : 86400;
  const { pageValidators, siteWideValidators, partial } = effectiveValidatorNames(
    req.validators,
  );

  if (req.slugs && req.slugs.length > 0) {
    const targetsProbe = await resolveUrlTargets(
      req.contentRoot,
      req.ci,
      req.slugs,
      req.urls,
    );
    if (targetsProbe.length === 0) {
      throw new Error(`No YAML-backed pages found for slugs: ${req.slugs.join(", ")}`);
    }
  }

  const key = scopeKey({
    slugs: req.slugs,
    urls: req.urls,
    validators: req.validators,
    freshness,
    max_age_seconds: maxAge,
  });

  const runningId = runningByContentRoot.get(req.contentRoot);
  if (runningId) {
    const running = jobsById.get(runningId);
    if (running && (running.status === "queued" || running.status === "running")) {
      if (running.scopeKey === key) {
        return {
          status: running.status,
          job_id: running.jobId,
          reused: true,
          retry_after_seconds: retryAfterSeconds(running.urlCount || 1),
          scope: {
            urlCount: running.urlCount,
            staleUrlCount: running.staleUrlCount,
            slugs: running.slugs,
            validators: running.validators,
            partial: running.partial,
          },
        };
      }
      return {
        status: "busy",
        code: "diagnostics_busy",
        job_id: running.jobId,
        retry_after_seconds: retryAfterSeconds(running.urlCount || 1),
        message:
          "Another diagnostics job is already running for this site. Poll that job_id or wait and retry.",
      };
    }
  }

  const allTargets = await resolveUrlTargets(
    req.contentRoot,
    req.ci,
    req.slugs,
    req.urls,
  );

  let staleTargets = allTargets;
  if (!partial && freshness === "max_age") {
    staleTargets = allTargets.filter((t) =>
      isUrlStaleForFullRun(req.cache.getByUrl(t.url), maxAge),
    );
  }

  const needsWork =
    (pageValidators.length > 0 && (partial || freshness === "hard" || staleTargets.length > 0)) ||
    (siteWideValidators.length > 0 && (partial || freshness === "hard" || staleTargets.length > 0));

  // Cached hit: full job, max_age, nothing stale, and we have targets
  if (!partial && freshness === "max_age" && staleTargets.length === 0 && allTargets.length > 0) {
    // Still run site-wide if never done? For simplicity, if all URLs have lastFullRunAt, return cached
    const { issuesBySlug, lastFullRunAtBySlug, cacheMisses } = issuesBySlugFromTargets(
      req.cache,
      allTargets,
      req.categories,
    );
    return {
      status: "cached",
      issuesBySlug,
      lastFullRunAtBySlug,
      cacheMisses,
      retry_after_seconds: 0,
    };
  }

  if (!needsWork && allTargets.length === 0 && siteWideValidators.length === 0) {
    return {
      status: "cached",
      issuesBySlug: {},
      lastFullRunAtBySlug: {},
      cacheMisses: [],
      retry_after_seconds: 0,
    };
  }

  const jobId = `diag-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const job: DiagnosticsJobRecord = {
    jobId,
    status: "queued",
    contentRootName: req.contentRootName,
    scopeKey: key,
    slugs: req.slugs,
    urls: req.urls,
    freshness,
    max_age_seconds: maxAge,
    validators: req.validators,
    include_artifacts: !!req.include_artifacts,
    categories: req.categories,
    startedAt: Date.now(),
    processed: 0,
    total: Math.max(
      (pageValidators.length > 0 ? (partial || freshness === "hard" ? allTargets.length : staleTargets.length) : 0) +
        (siteWideValidators.length > 0 ? 1 : 0),
      1,
    ),
    staleUrlCount: staleTargets.length,
    urlCount: allTargets.length,
    partial,
  };

  jobsById.set(jobId, job);
  jobCi.set(jobId, req.ci);
  jobCache.set(jobId, req.cache);
  jobContentRoot.set(jobId, req.contentRoot);
  runningByContentRoot.set(req.contentRoot, jobId);
  writeEnvelope(req.contentRoot, toEnvelope(job));

  setImmediate(() => {
    void runJob(req.contentRoot, jobId);
  });

  return {
    status: "queued",
    job_id: jobId,
    retry_after_seconds: retryAfterSeconds(allTargets.length),
    scope: {
      urlCount: allTargets.length,
      staleUrlCount: staleTargets.length,
      slugs: req.slugs,
      validators: req.validators,
      partial,
    },
  };
}

export function getDiagnosticsJob(
  contentRoot: string,
  jobId: string,
): {
  status: DiagnosticsJobStatus;
  job?: DiagnosticsJobRecord;
  code?: string;
  message?: string;
  retry_after_seconds?: number;
} {
  const mem = jobsById.get(jobId);
  if (mem) {
    const retry =
      mem.status === "queued" || mem.status === "running"
        ? retryAfterSeconds(mem.urlCount || 1)
        : 0;
    return { status: mem.status, job: mem, retry_after_seconds: retry };
  }

  const disk = readEnvelopeFromDisk(contentRoot, jobId);
  if (disk) {
    // Completed envelope without in-memory artifacts
    if (disk.status === "completed" || disk.status === "failed") {
      return {
        status: disk.status,
        job: disk,
        retry_after_seconds: 0,
        message:
          disk.status === "completed"
            ? "Job finished; artifacts may be unavailable after restart. Read validation cache or re-run with include_artifacts."
            : disk.error,
      };
    }
    // Was running but process lost it
    return {
      status: "not_found",
      code: "diagnostics_job_lost",
      message:
        "Job expired, evicted, or lost on restart. Call run_page_diagnostics / start a new diagnostics job — do not keep polling this job_id.",
      retry_after_seconds: 0,
    };
  }

  return {
    status: "not_found",
    code: "diagnostics_job_lost",
    message:
      "Job expired, evicted, or lost on restart. Call run_page_diagnostics / start a new diagnostics job — do not keep polling this job_id.",
    retry_after_seconds: 0,
  };
}

export function listDiagnosticsJobs(contentRoot: string): DiagnosticsJobEnvelope[] {
  const dir = jobsDir(contentRoot);
  const byId = new Map<string, DiagnosticsJobEnvelope>();
  try {
    if (fs.existsSync(dir)) {
      for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".json"))) {
        try {
          const e = JSON.parse(
            fs.readFileSync(path.join(dir, f), "utf-8"),
          ) as DiagnosticsJobEnvelope;
          byId.set(e.jobId, e);
        } catch {
          /* ignore */
        }
      }
    }
  } catch {
    /* ignore */
  }
  for (const [id, j] of jobsById) {
    if (jobContentRoot.get(id) === contentRoot || fs.existsSync(path.join(dir, `${id}.json`))) {
      byId.set(id, toEnvelope(j));
    }
  }
  return [...byId.values()].sort((a, b) => b.startedAt - a.startedAt).slice(0, MAX_JOB_ENVELOPES);
}

export function listCacheIssues(
  cache: ValidationCacheService,
): Array<{
  url: string;
  severity: "error" | "warning";
  code: string;
  message: string;
  validator?: string;
  category?: string;
  lastFullRunAt?: string;
  suggestion?: string;
  file?: string;
}> {
  const out: Array<{
    url: string;
    severity: "error" | "warning";
    code: string;
    message: string;
    validator?: string;
    category?: string;
    lastFullRunAt?: string;
    suggestion?: string;
    file?: string;
  }> = [];
  for (const [url, entry] of cache.getAll()) {
    for (const e of entry.errors) {
      out.push({
        url,
        severity: "error",
        code: e.code,
        message: e.message,
        validator: e.validator,
        category: e.category,
        lastFullRunAt: entry.lastFullRunAt,
        suggestion: e.suggestion,
        file: e.file,
      });
    }
    for (const w of entry.warnings) {
      out.push({
        url,
        severity: "warning",
        code: w.code,
        message: w.message,
        validator: w.validator,
        category: w.category,
        lastFullRunAt: entry.lastFullRunAt,
        suggestion: w.suggestion,
        file: w.file,
      });
    }
  }
  return out;
}

/** Exported for tests / run-page SKIP set (lighthouse removed). */
export const DIAGNOSTICS_SKIP_FOR_PER_PAGE = SKIP_FOR_PER_PAGE;
