/**
 * Pure helpers for MCP local database item tools (FAQ defaults, dedupe, indexing).
 */

export const FAQ_DB_NAME = "frequently_asked_questions";

export function normalizeFaqQuestion(question: string): string {
  return question
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ");
}

export function faqDuplicateKey(locale: string, question: string): string {
  return `${locale.toLowerCase().trim()}|${normalizeFaqQuestion(question)}`;
}

export function applyFaqDefaults(
  item: Record<string, unknown>,
): Record<string, unknown> {
  const out = { ...item };
  if (out.last_updated == null || out.last_updated === "") {
    out.last_updated = new Date().toISOString().slice(0, 10);
  }
  if (out.priority == null || out.priority === "") {
    out.priority = 2;
  }
  if (out.locations == null) {
    out.locations = ["all"];
  }
  return out;
}

export function validateFaqItem(
  item: Record<string, unknown>,
  opts?: { requireLocale?: boolean },
): { ok: true } | { ok: false; message: string } {
  const requireLocale = opts?.requireLocale !== false;
  if (typeof item.question !== "string" || !item.question.trim()) {
    return { ok: false, message: "FAQ item requires non-empty string field: question" };
  }
  if (typeof item.answer !== "string" || !item.answer.trim()) {
    return { ok: false, message: "FAQ item requires non-empty string field: answer" };
  }
  if (requireLocale && (typeof item.locale !== "string" || !item.locale.trim())) {
    return { ok: false, message: "FAQ item requires non-empty string field: locale" };
  }
  return { ok: true };
}

export function findFaqDuplicateIndex(
  items: Record<string, unknown>[],
  locale: string,
  question: string,
  excludeIndex?: number,
): number {
  const key = faqDuplicateKey(locale, question);
  for (let i = 0; i < items.length; i++) {
    if (excludeIndex !== undefined && i === excludeIndex) continue;
    const loc = String(items[i].locale ?? "");
    const q = String(items[i].question ?? "");
    if (!q) continue;
    if (faqDuplicateKey(loc, q) === key) return i;
  }
  return -1;
}

export type IndexedItem = Record<string, unknown> & { index: number };

/** Stamp every row with its global array index. */
export function withGlobalIndices(
  items: Record<string, unknown>[],
): IndexedItem[] {
  return items.map((item, index) => ({ ...item, index }));
}

/**
 * Filter indexed items without renumbering. `filters` values are OR within a field,
 * AND across fields. Special key `locale` matches item.locale.
 */
export function filterIndexedItems(
  items: IndexedItem[],
  filters: Record<string, string | string[]> | undefined,
): IndexedItem[] {
  if (!filters || Object.keys(filters).length === 0) return items;
  return items.filter((item) => {
    for (const [field, rawValues] of Object.entries(filters)) {
      const values = (Array.isArray(rawValues) ? rawValues : [rawValues]).map(String);
      if (values.length === 0) continue;
      const fieldVal = item[field];
      const match = Array.isArray(fieldVal)
        ? values.some((v) => fieldVal.map(String).includes(v))
        : values.includes(String(fieldVal ?? ""));
      if (!match) return false;
    }
    return true;
  });
}

export function paginateItems<T>(
  items: T[],
  page: number,
  limit: number,
): { items: T[]; page: number; limit: number; total_count: number } {
  const safePage = Math.max(1, page);
  const safeLimit = Math.max(1, Math.min(1000, limit));
  const start = (safePage - 1) * safeLimit;
  return {
    items: items.slice(start, start + safeLimit),
    page: safePage,
    limit: safeLimit,
    total_count: items.length,
  };
}

export function summarizeUsage(report: {
  content_types?: Array<{ name: string; label?: string }>;
  queries?: Array<{ file?: string; content_type?: string; kind?: string }>;
}): {
  content_type_count: number;
  query_count: number;
  sample_files: string[];
} {
  const queries = report.queries ?? [];
  const sample_files = queries
    .map((q) => q.file)
    .filter((f): f is string => typeof f === "string" && f.length > 0)
    .slice(0, 8);
  return {
    content_type_count: report.content_types?.length ?? 0,
    query_count: queries.length,
    sample_files,
  };
}
