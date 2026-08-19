/**
 * Helpers for writing validation results into the unified issue store
 * with replace-by-validator semantics (entry-local vs site-wide clear).
 */

import { createHash } from "crypto";
import type {
  ContentFile,
  IssueTarget,
  PageCacheEntry,
  StoredValidationIssue,
  ValidationIssue,
  ValidatorResult,
} from "../../scripts/validation/shared/types";
import { entryKeyFromContentFile } from "../../scripts/validation/shared/entryKey";
import { getCanonicalUrl } from "../../scripts/validation/shared/canonicalUrls";
import {
  getValidatorRunClass,
  scopesForValidator,
  type ValidationScope,
} from "../../scripts/validation/shared/runClass";

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

/** Stable issue id from validator + code + sorted target keys. */
export function buildIssueId(
  validator: string,
  code: string,
  targets: IssueTarget[],
): string {
  const parts = targets
    .map((t) => {
      switch (t.type) {
        case "entry":
          return `entry:${t.entryKey}`;
        case "redirect":
          return `redirect:${t.from}`;
        case "media":
          return `media:${t.imageId}`;
        case "database":
          return `database:${t.dbSlug}`;
        case "file":
          return `file:${t.path}`;
        default:
          return JSON.stringify(t);
      }
    })
    .sort();
  const raw = `${validator}|${code}|${parts.join("|")}`;
  return createHash("sha256").update(raw).digest("hex").slice(0, 16);
}

function filePathToEntryKey(
  filePath: string,
  contentFiles: ContentFile[],
): string | null {
  const match = contentFiles.find(
    (f) => f.filePath === filePath || f.filePath.endsWith(filePath) || filePath.endsWith(f.filePath),
  );
  if (match) return entryKeyFromContentFile(match);
  // Heuristic: .../programs/slug/en.yml
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
  const contentType = typeMap[folder] ?? folder.replace(/s$/, "");
  const slug = m[2]!;
  const localePart = m[3]!;
  const locale = localePart.includes(".")
    ? localePart.split(".").pop()!
    : localePart;
  if (locale === "_common") return null;
  return `${contentType}/${slug}/${locale}`;
}

/** Build targets + scopes for a raw ValidationIssue from a validator run. */
export function issueToStored(
  issue: ValidationIssue,
  validatorName: string,
  nowIso: string,
  contentFiles: ContentFile[],
  extraTargets: IssueTarget[] = [],
): StoredValidationIssue {
  const targets: IssueTarget[] = [...extraTargets];
  if (issue.file) {
    const entryKey = filePathToEntryKey(issue.file, contentFiles);
    if (entryKey) {
      const file = contentFiles.find((f) => entryKeyFromContentFile(f) === entryKey);
      targets.push({
        type: "entry",
        entryKey,
        url: file ? getCanonicalUrl(file) : undefined,
        file: issue.file,
        slug: file?.slug,
        contentType: file?.type,
      });
    } else {
      targets.push({ type: "file", path: issue.file });
    }
  }

  // Extract redirect "from" paths from conflict messages when present
  const redirectMatch = issue.message.match(/"(\/[^"]+)"/);
  if (
    (issue.code === "REDIRECT_CONFLICT" ||
      issue.code === "REDIRECT_OVERLAP" ||
      issue.code === "REDIRECT_OVERWRITES_CONTENT" ||
      issue.code === "SELF_REDIRECT") &&
    redirectMatch
  ) {
    const from = redirectMatch[1]!;
    if (!targets.some((t) => t.type === "redirect" && t.from === from)) {
      targets.push({ type: "redirect", from });
    }
  }

  // Fan-out: parse second file path from REDIRECT_CONFLICT messages
  if (issue.code === "REDIRECT_CONFLICT" || issue.code === "REDIRECT_OVERLAP") {
    const claimed = issue.message.match(/claimed by both "([^"]+)" and "([^"]+)"/);
    const conflicts = issue.message.match(/conflicts with "([^"]+)"/);
    const paths = claimed
      ? [claimed[1]!, claimed[2]!]
      : conflicts
        ? [issue.file, conflicts[1]!].filter(Boolean) as string[]
        : [];
    for (const p of paths) {
      const ek = filePathToEntryKey(p, contentFiles);
      if (ek && !targets.some((t) => t.type === "entry" && t.entryKey === ek)) {
        const file = contentFiles.find((f) => entryKeyFromContentFile(f) === ek);
        targets.push({
          type: "entry",
          entryKey: ek,
          url: file ? getCanonicalUrl(file) : undefined,
          file: p,
          slug: file?.slug,
          contentType: file?.type,
        });
      }
    }
  }

  const dbMatch = issue.file?.match(/\/db\/([^/]+)\//);
  if (dbMatch) {
    targets.push({ type: "database", dbSlug: dbMatch[1]! });
  }

  const scopes = scopesForValidator(validatorName);
  const id = buildIssueId(validatorName, issue.code, targets);

  return {
    id,
    code: issue.code,
    severity: issue.type === "error" ? "error" : "warning",
    message: issue.message,
    suggestion: issue.suggestion,
    validator: validatorName,
    scopes,
    targets,
    file: issue.file,
    line: issue.line,
    category: issue.category,
    lastSeenAt: nowIso,
    lastRunAt: nowIso,
  };
}

export function storedToValidationIssue(s: StoredValidationIssue): ValidationIssue {
  return {
    type: s.severity === "error" ? "error" : "warning",
    code: s.code,
    message: s.message,
    file: s.file,
    line: s.line,
    suggestion: s.suggestion,
    category: s.category,
    validator: s.validator,
    validationCacheBuiltAt: s.lastRunAt,
  };
}

export function pageEntryFromStored(
  issues: StoredValidationIssue[],
  runMeta?: { lastRunAt?: string; lastFullRunAt?: string },
): PageCacheEntry {
  const errors = issues
    .filter((i) => i.severity === "error")
    .map(storedToValidationIssue);
  const warnings = issues
    .filter((i) => i.severity === "warning" || i.severity === "info")
    .map(storedToValidationIssue);
  const lastRunAt = runMeta?.lastRunAt ?? issues[0]?.lastRunAt ?? new Date().toISOString();
  return {
    lastRunAt,
    lastFullRunAt: runMeta?.lastFullRunAt ?? lastRunAt,
    errors,
    warnings,
  };
}

/** @deprecated Prefer applyValidatorResultsToStore on ValidationCacheService. */
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

/** @deprecated Prefer applyValidatorResultsToStore on ValidationCacheService. */
export function mergePartialPageCacheEntry(
  existing: PageCacheEntry | undefined,
  newErrors: ValidationIssue[],
  newWarnings: ValidationIssue[],
  ranValidators: Set<string>,
  nowIso: string,
): PageCacheEntry {
  const keep = (issues: ValidationIssue[]) =>
    issues.filter((i) => !i.validator || !ranValidators.has(i.validator));
  return {
    lastRunAt: nowIso,
    lastFullRunAt: existing?.lastFullRunAt,
    lastPartialRunAt: nowIso,
    errors: [...keep(existing?.errors ?? []), ...newErrors],
    warnings: [...keep(existing?.warnings ?? []), ...newWarnings],
  };
}

export const CACHE_FRESHNESS_MAX_AGE_SECONDS = 86400;

export function isUrlStaleForFullRun(
  entry: PageCacheEntry | undefined,
  maxAgeSeconds: number,
  nowMs: number = Date.now(),
): boolean {
  const fullAt = entry?.lastFullRunAt;
  if (!fullAt) return true;
  const ageSec = (nowMs - DateParseSafe(fullAt)) / 1000;
  if (Number.isNaN(ageSec)) return true;
  return ageSec > maxAgeSeconds;
}

export function summarizeCacheFreshness(
  entries: Iterable<PageCacheEntry | undefined>,
  maxAgeSeconds: number = CACHE_FRESHNESS_MAX_AGE_SECONDS,
  nowMs: number = Date.now(),
): { fresh: number; stale: number; total: number; max_age_seconds: number } {
  let fresh = 0;
  let stale = 0;
  for (const entry of entries) {
    if (isUrlStaleForFullRun(entry, maxAgeSeconds, nowMs)) stale += 1;
    else fresh += 1;
  }
  return {
    fresh,
    stale,
    total: fresh + stale,
    max_age_seconds: maxAgeSeconds,
  };
}

function DateParseSafe(iso: string): number {
  return Date.parse(iso);
}

export function isEntryKeyStaleForFullRun(
  lastFullRunAt: string | undefined | null,
  maxAgeSeconds: number,
  nowMs: number = Date.now(),
): boolean {
  if (!lastFullRunAt) return true;
  const ageSec = (nowMs - Date.parse(lastFullRunAt)) / 1000;
  if (Number.isNaN(ageSec)) return true;
  return ageSec > maxAgeSeconds;
}

export { getValidatorRunClass, scopesForValidator };
export type { ValidationScope };
