export type ValidationCounts = { errorCount: number; warningCount: number };

export function lookupValidationSummary(
  summary: Record<string, ValidationCounts>,
  opts: {
    contentType?: string;
    slug?: string;
    locale?: string;
    path?: string;
    pathOnly?: string;
  },
): ValidationCounts | undefined {
  const keys: string[] = [];
  if (opts.contentType && opts.slug && opts.locale) {
    keys.push(`${opts.contentType}/${opts.slug}/${opts.locale}`);
  }
  if (opts.path) keys.push(opts.path);
  if (opts.pathOnly && opts.pathOnly !== opts.path) keys.push(opts.pathOnly);
  for (const key of keys) {
    const entry = summary[key];
    if (entry) return entry;
  }
  return undefined;
}
