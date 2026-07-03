import type { ValidationRunResult, ValidationContext } from "../../scripts/validation/shared/types";
import type { ValidationCacheService } from "./validationCacheService";
import { getCanonicalUrl } from "../../scripts/validation/shared/canonicalUrls";

/** Extract db slug from issue file path like `4geeks-com/db/blog_posts/config.yml`. */
function dbNameFromIssueFile(file: string): string | null {
  const match = file.match(/\/db\/([^/]+)\/config\.yml$/);
  return match ? match[1] : null;
}

/**
 * Persists page and database validation results from a run into the site cache.
 */
export async function applyValidationRunToCache(
  cache: ValidationCacheService,
  result: ValidationRunResult,
  context: ValidationContext,
): Promise<void> {
  const nowIso = new Date().toISOString();

  const byFile = new Map<
    string,
    { errors: typeof result.validators[0]["errors"]; warnings: typeof result.validators[0]["warnings"] }
  >();

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

  const dbHealth = result.validators.find((v) => v.name === "database-health");
  if (dbHealth) {
    const byDb = new Map<string, { errors: typeof dbHealth.errors; warnings: typeof dbHealth.warnings }>();

    for (const issue of dbHealth.errors) {
      if (!issue.file) continue;
      const dbName = dbNameFromIssueFile(issue.file);
      if (!dbName) continue;
      if (!byDb.has(dbName)) byDb.set(dbName, { errors: [], warnings: [] });
      byDb.get(dbName)!.errors.push(issue);
    }
    for (const issue of dbHealth.warnings) {
      if (!issue.file) continue;
      const dbName = dbNameFromIssueFile(issue.file);
      if (!dbName) continue;
      if (!byDb.has(dbName)) byDb.set(dbName, { errors: [], warnings: [] });
      byDb.get(dbName)!.warnings.push(issue);
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

  cache.markFullRunAt(nowIso);
  await cache.flush();
}
