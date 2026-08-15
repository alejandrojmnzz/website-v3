export interface GscInspectionRecord {
  inspectedAt: string;
  coverageState?: string;
  indexingState?: string;
  verdict?: string;
  lastCrawlTime?: string;
  robotsTxtState?: string;
  pageFetchState?: string;
  googleCanonical?: string;
  userCanonical?: string;
  error?: string;
}

export interface GscCoverageBucket {
  inSitemap: number;
  inspected: number;
  indexed: number;
  notIndexed: number;
  neverChecked: number;
}

export interface GscExceptionRow {
  loc: string;
  content_type?: string;
  coverageState?: string;
  googleCanonical?: string;
  userCanonical?: string;
}

export interface GscInspectionSummary {
  sitemapCount: number;
  inspected: number;
  indexed: number;
  notIndexed: number;
  errors: number;
  neverChecked: number;
  notOnSitemap: number;
  newestInspectedAt: string | null;
  byContentType: Record<string, GscCoverageBucket>;
  exceptions: {
    notIndexed: GscExceptionRow[];
    canonicalMismatch: GscExceptionRow[];
  };
}

export interface GscResolvedUrl {
  requested: string;
  loc: string | null;
  inSitemap: boolean;
  isDraft: boolean;
  isPreview: boolean;
}

export interface GscInspectionGetResponse {
  configured: boolean;
  siteUrl: string | null;
  suggestedSiteUrl: string | null;
  credentialsConfigured: boolean;
  credentialsSource: "gsc" | "gcs" | null;
  credentialsEnvVar: "GCS_CREDENTIALS_JSON" | "GCS_KEY_FILENAME" | "GSC_CREDENTIALS_JSON" | "GSC_KEY_FILENAME";
  serviceAccountEmail: string | null;
  propertyAccess: "ok" | "denied" | "unknown";
  siteUrlMatch: boolean | null;
  homepageLoc: string | null;
  summary: GscInspectionSummary;
  resolved?: GscResolvedUrl;
  record?: GscInspectionRecord | null;
  records?: Record<string, GscInspectionRecord>;
}

export function gscHeadline(record: GscInspectionRecord | null | undefined, resolved?: GscResolvedUrl): string {
  if (resolved?.isDraft) return "Not in sitemap (draft)";
  if (record?.error && !record.verdict && !record.coverageState) return "Error";
  if (!record) return "Never checked";
  const verdict = (record.verdict || "").toUpperCase();
  if (verdict === "PASS") return "Indexed";
  const coverage = (record.coverageState || "").toLowerCase();
  if (coverage.includes("submitted and indexed") || coverage === "indexed") return "Indexed";
  if (record.error) return "Error";
  return "Not indexed";
}

export function isGscPropertyAccessDenied(message: string | undefined | null): boolean {
  if (!message) return false;
  const m = message.toLowerCase();
  if (m.includes("permission_denied")) return true;
  if (m.includes("does not have sufficient permission")) return true;
  if (m.includes("user does not have")) return true;
  if (m.includes("caller does not have permission")) return true;
  if (/\b403\b/.test(m) && (m.includes("permission") || m.includes("forbidden") || m.includes("access"))) {
    return true;
  }
  return false;
}

/** Page-errors Crawlers tab: not configured or not indexed counts as an error. */
export function gscCrawlerErrorCount(opts: {
  configured?: boolean;
  record?: GscInspectionRecord | null;
  resolved?: GscResolvedUrl;
  loadError?: boolean;
}): number {
  if (opts.loadError) return 1;
  if (opts.configured === false) return 1;
  if (opts.configured !== true) return 0;
  const headline = gscHeadline(opts.record, opts.resolved);
  if (headline === "Not indexed" || headline === "Error") return 1;
  return 0;
}
