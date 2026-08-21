import type { EntryRunMeta } from "../../scripts/validation/shared/types";

export type CoverageFilter = "all" | "fresh" | "not_fresh";

export type UrlCoverageRow = {
  url: string;
  lastFullRunAt: string | null;
  isFresh: boolean;
  coveredCount: number;
  expectedCount: number;
  coveragePercent: number;
  oldestCoveredAt: string | null;
};

export type UrlCoverageSummary = {
  meanPercent: number;
  fullyCovered: number;
  totalUrls: number;
  expectedValidators: number;
};

export type UrlCoveragePage = {
  totalItems: number;
  page: number;
  pageSize: number;
  coverage: UrlCoverageSummary;
  items: UrlCoverageRow[];
};

type CoverageInputRow = {
  url: string;
  lastFullRunAt: string | null;
  runMeta?: EntryRunMeta;
};

const MAX_PAGE_SIZE = 200;

function oldestIso(values: string[]): string | null {
  let oldest: number | null = null;
  for (const v of values) {
    const ts = Date.parse(v);
    if (Number.isNaN(ts)) continue;
    if (oldest === null || ts < oldest) oldest = ts;
  }
  return oldest === null ? null : new Date(oldest).toISOString();
}

function parseSortTs(lastFullRunAt: string | null): number {
  if (!lastFullRunAt) return 0;
  const ts = Date.parse(lastFullRunAt);
  return Number.isNaN(ts) ? 0 : ts;
}

export function buildUrlCoveragePage(
  rows: CoverageInputRow[],
  expectedValidators: string[],
  opts?: {
    q?: string;
    filter?: CoverageFilter;
    page?: number;
    pageSize?: number;
  },
): UrlCoveragePage {
  const expectedCount = expectedValidators.length;
  const expectedSet = new Set(expectedValidators);
  const normalizedRows: UrlCoverageRow[] = rows.map((row) => {
    const byValidator = row.runMeta?.byValidator ?? {};
    const coveredValidatorTs = Object.entries(byValidator)
      .filter(([validator]) => expectedSet.has(validator))
      .map(([, iso]) => iso);
    const coveredCount = coveredValidatorTs.length;
    const isFresh = expectedCount > 0 ? coveredCount >= expectedCount : true;
    const coveragePercent = expectedCount > 0
      ? Math.round((coveredCount / expectedCount) * 100)
      : 100;
    return {
      url: row.url,
      lastFullRunAt: row.lastFullRunAt,
      isFresh,
      coveredCount,
      expectedCount,
      coveragePercent,
      oldestCoveredAt: oldestIso(coveredValidatorTs),
    };
  });

  const totalUrls = normalizedRows.length;
  const fullyCovered = normalizedRows.filter((r) => r.isFresh).length;
  const meanPercent = totalUrls > 0
    ? Math.round(normalizedRows.reduce((sum, r) => sum + r.coveragePercent, 0) / totalUrls)
    : 0;

  const q = (opts?.q ?? "").trim().toLowerCase();
  const filter = opts?.filter ?? "all";
  const filtered = normalizedRows.filter((row) => {
    if (filter === "fresh" && !row.isFresh) return false;
    if (filter === "not_fresh" && row.isFresh) return false;
    if (q && !row.url.toLowerCase().includes(q)) return false;
    return true;
  });

  const sorted = filtered.sort((a, b) => parseSortTs(a.lastFullRunAt) - parseSortTs(b.lastFullRunAt));
  const pageSize = Math.max(1, Math.min(opts?.pageSize ?? 50, MAX_PAGE_SIZE));
  const totalItems = sorted.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const page = Math.max(1, Math.min(opts?.page ?? 1, totalPages));
  const start = (page - 1) * pageSize;
  const items = sorted.slice(start, start + pageSize);

  return {
    totalItems,
    page,
    pageSize,
    coverage: {
      meanPercent,
      fullyCovered,
      totalUrls,
      expectedValidators: expectedCount,
    },
    items,
  };
}

