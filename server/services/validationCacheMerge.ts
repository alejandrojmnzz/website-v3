/**
 * Helpers for writing validation results into the per-URL cache with
 * full replace vs partial merge-by-validator-name semantics.
 */

import type {
  PageCacheEntry,
  ValidationIssue,
  ValidatorResult,
} from "../../scripts/validation/shared/types";

export function stampIssuesFromValidator(
  issues: ValidationIssue[],
  validatorName: string,
  category?: ValidationIssue["category"],
): ValidationIssue[] {
  return issues.map((issue) => ({
    ...issue,
    validator: validatorName,
    ...(category ? { category: issue.category ?? category } : {}),
  }));
}

function keepIssuesNotFrom(
  issues: ValidationIssue[],
  ranValidators: Set<string>,
): ValidationIssue[] {
  return issues.filter((i) => !i.validator || !ranValidators.has(i.validator));
}

export function collectIssuesByFile(
  validators: ValidatorResult[],
): Map<string, { errors: ValidationIssue[]; warnings: ValidationIssue[] }> {
  const byFile = new Map<string, { errors: ValidationIssue[]; warnings: ValidationIssue[] }>();
  for (const v of validators) {
    for (const issue of stampIssuesFromValidator(v.errors, v.name, v.category)) {
      if (!issue.file) continue;
      if (!byFile.has(issue.file)) byFile.set(issue.file, { errors: [], warnings: [] });
      byFile.get(issue.file)!.errors.push(issue);
    }
    for (const issue of stampIssuesFromValidator(v.warnings, v.name, v.category)) {
      if (!issue.file) continue;
      if (!byFile.has(issue.file)) byFile.set(issue.file, { errors: [], warnings: [] });
      byFile.get(issue.file)!.warnings.push(issue);
    }
  }
  return byFile;
}

/** Build a full page cache entry (replaces prior issues for that URL). */
export function buildFullPageCacheEntry(
  errors: ValidationIssue[],
  warnings: ValidationIssue[],
  nowIso: string,
): PageCacheEntry {
  return {
    lastRunAt: nowIso,
    lastFullRunAt: nowIso,
    errors,
    warnings,
  };
}

/** Merge partial validator results into an existing page entry by validator name. */
export function mergePartialPageCacheEntry(
  existing: PageCacheEntry | undefined,
  newErrors: ValidationIssue[],
  newWarnings: ValidationIssue[],
  ranValidators: Set<string>,
  nowIso: string,
): PageCacheEntry {
  const prevErrors = existing?.errors ?? [];
  const prevWarnings = existing?.warnings ?? [];
  return {
    lastRunAt: nowIso,
    lastFullRunAt: existing?.lastFullRunAt,
    lastPartialRunAt: nowIso,
    errors: [...keepIssuesNotFrom(prevErrors, ranValidators), ...newErrors],
    warnings: [...keepIssuesNotFrom(prevWarnings, ranValidators), ...newWarnings],
  };
}

export function isUrlStaleForFullRun(
  entry: PageCacheEntry | undefined,
  maxAgeSeconds: number,
  nowMs: number = Date.now(),
): boolean {
  const fullAt = entry?.lastFullRunAt;
  if (!fullAt) return true;
  const ageSec = (nowMs - Date.parse(fullAt)) / 1000;
  if (Number.isNaN(ageSec)) return true;
  return ageSec > maxAgeSeconds;
}
