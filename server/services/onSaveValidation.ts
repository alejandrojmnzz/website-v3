/**
 * Scoped on-save validation: debounced entry-local validators after content save;
 * queue redirects full-graph job when redirect config changes.
 */

import { ValidationService } from "../../scripts/validation/service";
import { ENTRY_LOCAL_VALIDATOR_NAMES } from "../../scripts/validation/shared/runClass";
import { entryKeyFromContentFile } from "../../scripts/validation/shared/entryKey";
import { getCanonicalUrl } from "../../scripts/validation/shared/canonicalUrls";
import type { ContentIndex } from "../content-index";
import type { ValidationCacheService } from "./validationCacheService";
import { startDiagnosticsJob, isDiagnosticsRunning } from "./diagnosticsJobService";
import { child } from "../logger";

const log = child({ module: "onSaveValidation" });

const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
const DEBOUNCE_MS = 1500;

export type OnSaveValidationArgs = {
  contentRoot: string;
  contentRootName: string;
  ci: ContentIndex;
  cache: ValidationCacheService;
  /** Absolute or site-relative path that was written */
  filePath?: string;
  contentType?: string;
  slug?: string;
  locale?: string;
  /** When true, also queue redirects cross-entry job */
  redirectsChanged?: boolean;
};

function resolveEntryFromPath(
  ci: ContentIndex,
  filePath: string | undefined,
  contentType?: string,
  slug?: string,
  locale?: string,
): { contentType: string; slug: string; locale: string } | null {
  if (contentType && slug && locale) {
    return { contentType, slug, locale };
  }
  if (!filePath) return null;
  const norm = filePath.replace(/\\/g, "/");
  const m = norm.match(
    /\/(programs|landings|locations|pages|blog|workshops|events|courses)\/([^/]+)\/([^/]+)\.ya?ml$/i,
  );
  if (!m) return null;
  const folder = m[1]!.toLowerCase();
  const typeMap: Record<string, string> = {
    programs: "program",
    landings: "landing",
    locations: "location",
    pages: "page",
    blog: "blog",
    workshops: "workshop",
    events: "event",
    courses: "course",
  };
  const ct = typeMap[folder] ?? folder.replace(/s$/, "");
  const sl = m[2]!;
  const localePart = m[3]!;
  const loc = localePart.includes(".") ? localePart.split(".").pop()! : localePart;
  if (loc === "_common") return null;
  return { contentType: ct, slug: sl, locale: loc };
}

async function runEntryLocalNow(args: OnSaveValidationArgs): Promise<void> {
  const resolved = resolveEntryFromPath(
    args.ci,
    args.filePath,
    args.contentType,
    args.slug,
    args.locale,
  );
  if (!resolved) {
    log.info("[OnSaveValidation] Could not resolve entry from save; marking dirty only");
    return;
  }

  const service = new ValidationService();
  await service.buildContext({ contentRoot: args.contentRoot, ci: args.ci });
  const context = service.getContext();
  if (!context) return;

  const allFiles = context.contentFiles;
  const filtered = allFiles.filter(
    (f) =>
      f.type === resolved.contentType &&
      f.slug === resolved.slug &&
      (f.locale === resolved.locale ||
        (resolved.locale === "en" && f.locale === "_common")),
  );
  if (filtered.length === 0) {
    log.warn(
      { resolved },
      "[OnSaveValidation] No contentFiles matched entry",
    );
    return;
  }

  const entryKeys = filtered.map((f) => entryKeyFromContentFile(f));
  for (const ek of entryKeys) {
    args.cache.markEntryDirty(ek);
  }

  if (isDiagnosticsRunning(args.contentRoot)) {
    log.info(
      { entryKeys },
      "[OnSaveValidation] Diagnostics job running — deferred entry-local apply (dirty only)",
    );
    return;
  }

  context.contentFiles = filtered;
  try {
    const result = await service.runValidators({
      validators: [...ENTRY_LOCAL_VALIDATOR_NAMES],
      includeArtifacts: false,
    });
    context.contentFiles = allFiles;
    for (const file of filtered) {
      args.cache.registerUrl(getCanonicalUrl(file), entryKeyFromContentFile(file));
    }
    args.cache.applyValidatorResults(result.validators, {
      contentFiles: allFiles,
      entryKeys,
      markSiteWide: false,
    });
    await args.cache.flush();
    log.info(
      { entryKeys, errorCount: result.summary.failed },
      "[OnSaveValidation] Entry-local validation applied",
    );
  } catch (err) {
    context.contentFiles = allFiles;
    log.warn({ err }, "[OnSaveValidation] Entry-local run failed");
  }
}

async function queueRedirectsJob(args: OnSaveValidationArgs): Promise<void> {
  args.cache.markScopeDirty("redirects");
  try {
    const result = await startDiagnosticsJob({
      contentRoot: args.contentRoot,
      contentRootName: args.contentRootName,
      ci: args.ci,
      cache: args.cache,
      validators: ["redirects"],
      freshness: "hard",
      include_artifacts: false,
    });
    if (result.status === "busy") {
      log.info(
        { job_id: result.job_id },
        "[OnSaveValidation] Redirects job deferred — diagnostics busy (scope left dirty)",
      );
      return;
    }
    log.info("[OnSaveValidation] Queued redirects diagnostics job");
  } catch (err) {
    log.warn({ err }, "[OnSaveValidation] Failed to queue redirects job");
  }
}

/**
 * Schedule debounced entry-local validation after a content save.
 * If redirectsChanged, also queues a redirects full-graph job (not debounced with entry).
 */
export function scheduleOnSaveValidation(args: OnSaveValidationArgs): void {
  const key = [
    args.contentRoot,
    args.contentType,
    args.slug,
    args.locale,
    args.filePath,
  ]
    .filter(Boolean)
    .join("|");

  if (args.redirectsChanged) {
    void queueRedirectsJob(args);
  }

  const existing = debounceTimers.get(key);
  if (existing) clearTimeout(existing);

  debounceTimers.set(
    key,
    setTimeout(() => {
      debounceTimers.delete(key);
      void runEntryLocalNow(args);
    }, DEBOUNCE_MS),
  );
}

/** Immediate redirects-only (e.g. custom-redirects.yml editor). */
export function scheduleRedirectsValidation(args: OnSaveValidationArgs): void {
  void queueRedirectsJob(args);
}
