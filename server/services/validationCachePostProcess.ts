import type { ValidationRunResult, ValidationContext } from "../../scripts/validation/shared/types";
import type { ValidationCacheService } from "./validationCacheService";
import { getCanonicalUrl } from "../../scripts/validation/shared/canonicalUrls";
import {
  buildFullPageCacheEntry,
  collectIssuesByFile,
  mergePartialPageCacheEntry,
} from "./validationCacheMerge";

/** Extract db slug from issue file path like `4geeks-com/db/blog_posts/config.yml`. */
function dbNameFromIssueFile(file: string): string | null {
  const match = file.match(/\/db\/([^/]+)\/config\.yml$/);
  return match ? match[1] : null;
}

export type ApplyValidationRunOptions = {
  /** When true, merge by validator name instead of replacing page entries. */
  partial?: boolean;
};

/**
 * Persists page and database validation results from a run into the site cache.
 */
export async function applyValidationRunToCache(
  cache: ValidationCacheService,
  result: ValidationRunResult,
  context: ValidationContext,
  options: ApplyValidationRunOptions = {},
): Promise<void> {
  const nowIso = new Date().toISOString();
  const partial = options.partial === true;
  const ranValidators = new Set(result.validators.map((v) => v.name));
  const byFile = collectIssuesByFile(result.validators);

  const seenUrls = new Set<string>();
  for (const file of context.contentFiles) {
    const url = getCanonicalUrl(file);
    if (seenUrls.has(url)) continue;
    seenUrls.add(url);

    const fileIssues = byFile.get(file.filePath) ?? { errors: [], warnings: [] };
    if (partial) {
      cache.setByUrl(
        url,
        mergePartialPageCacheEntry(
          cache.getByUrl(url),
          fileIssues.errors,
          fileIssues.warnings,
          ranValidators,
          nowIso,
        ),
      );
    } else {
      cache.setByUrl(
        url,
        buildFullPageCacheEntry(fileIssues.errors, fileIssues.warnings, nowIso),
      );
    }
  }

  const dbHealth = result.validators.find((v) => v.name === "database-health");
  if (dbHealth) {
    const byDb = new Map<string, { errors: typeof dbHealth.errors; warnings: typeof dbHealth.warnings }>();

    for (const issue of dbHealth.errors) {
      if (!issue.file) continue;
      const dbName = dbNameFromIssueFile(issue.file);
      if (!dbName) continue;
      if (!byDb.has(dbName)) byDb.set(dbName, { errors: [], warnings: [] });
      byDb.get(dbName)!.errors.push({ ...issue, validator: "database-health" });
    }
    for (const issue of dbHealth.warnings) {
      if (!issue.file) continue;
      const dbName = dbNameFromIssueFile(issue.file);
      if (!dbName) continue;
      if (!byDb.has(dbName)) byDb.set(dbName, { errors: [], warnings: [] });
      byDb.get(dbName)!.warnings.push({ ...issue, validator: "database-health" });
    }

    const artifacts = dbHealth.artifacts?.databases as
      | Record<string, { errorCount: number; warningCount: number }>
      | undefined;
    const dbNames = artifacts ? Object.keys(artifacts) : [...byDb.keys()];

    for (const dbName of dbNames) {
      const issues = byDb.get(dbName) ?? { errors: [], warnings: [] };
      cache.setByDatabase(dbName, {
        lastRunAt: nowIso,
        errors: issues.errors,
        warnings: issues.warnings,
      });
    }
  }

  if (!partial) {
    cache.markFullRunAt(nowIso);
  }
  await cache.flush();
}
