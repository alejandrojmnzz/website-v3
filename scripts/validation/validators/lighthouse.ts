/**
 * Lighthouse Validator
 *
 * Runs Google PageSpeed Insights (PSI) audits against the deployed site.
 * No local Chrome install needed — PSI runs Lighthouse on Google's servers.
 *
 * Env vars:
 *   SITE_URL            — required for audits, e.g. https://www.4geeksacademy.com
 *   GOOGLE_PSI_API_KEY  — optional, raises rate limit from 400 to 25 000 req/day
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";
import type {
  Validator,
  ValidatorResult,
  ValidationContext,
  ValidationIssue,
} from "../shared/types";
import { getCanonicalUrl } from "../shared/canonicalUrls";
import { gcs } from "../../../server/gcs";
import { siteLighthouseGcsPrefix } from "@shared/gcsKeys";
import { getDefaultContentFolder } from "../../../server/site-config";

export interface PageReport {
  url: string;
  slug: string;
  strategy: "mobile";
  timestamp: string;
  performanceScore: number;
  seoScore: number;
  bestPracticesScore: number;
  metrics: { lcp: number; fcp: number; cls: number; ttfb: number };
  opportunities: {
    id: string;
    title: string;
    description?: string;
    displayValue?: string;
    savings_ms?: number;
  }[];
  diagnostics: { id: string; title: string; description: string }[];
}

const PSI_API = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function todayGcsPrefix(context: ValidationContext): string {
  const d = new Date();
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const date = `${yyyy}-${mm}-${dd}`;
  const siteFolder = context.contentRoot
    ? path.relative(process.cwd(), context.contentRoot).replace(/\\/g, "/")
    : getDefaultContentFolder();
  return siteLighthouseGcsPrefix(siteFolder, date);
}

function todayLocalDir(): string {
  const d = new Date();
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return path.join("reports", "lighthouse", `${yyyy}-${mm}-${dd}`);
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function urlSuffix(url: string): string {
  return crypto.createHash("md5").update(url).digest("hex").slice(0, 6);
}

export function safeReportFilename(slug: string, url: string): string {
  return `${slug}--${urlSuffix(url)}.json`;
}

function firstSentence(text: string | undefined): string {
  if (!text) return "";
  const match = text.match(/[^.!?]*[.!?]/);
  return match ? match[0].trim() : text.slice(0, 200).trim();
}

export async function auditUrl(
  url: string,
  apiKey?: string
): Promise<Record<string, unknown>> {
  const params = new URLSearchParams({
    url,
    strategy: "mobile",
  });
  params.append("category", "performance");
  params.append("category", "seo");
  params.append("category", "best-practices");
  if (apiKey) params.set("key", apiKey);

  const endpoint = `${PSI_API}?${params.toString()}`;
  const res = await fetch(endpoint);

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`PSI API ${res.status} for ${url}: ${body.slice(0, 300)}`);
  }

  return res.json() as Promise<Record<string, unknown>>;
}

function parseScore(
  categories: Record<string, unknown>,
  key: string
): number {
  const cat = categories[key] as { score?: number } | undefined;
  if (!cat || cat.score == null) return 0;
  return Math.round(cat.score * 100);
}

function parseMetrics(
  audits: Record<string, unknown>
): PageReport["metrics"] {
  function ms(id: string): number {
    const a = audits[id] as { numericValue?: number } | undefined;
    return a?.numericValue != null ? Math.round(a.numericValue) : 0;
  }
  return {
    lcp: ms("largest-contentful-paint"),
    fcp: ms("first-contentful-paint"),
    cls: Math.round(
      ((audits["cumulative-layout-shift"] as { numericValue?: number } | undefined)
        ?.numericValue ?? 0) * 1000
    ) / 1000,
    ttfb: ms("server-response-time"),
  };
}

export function buildPageReport(
  url: string,
  slug: string,
  data: Record<string, unknown>
): PageReport {
  const lr = data.lighthouseResult as Record<string, unknown>;
  const categories = (lr.categories ?? {}) as Record<string, unknown>;
  const audits = (lr.audits ?? {}) as Record<string, unknown>;

  const performanceScore = parseScore(categories, "performance");
  const seoScore = parseScore(categories, "seo");
  const bestPracticesScore = parseScore(categories, "best-practices");
  const metrics = parseMetrics(audits);

  const opportunities: PageReport["opportunities"] = [];
  const diagnostics: PageReport["diagnostics"] = [];

  for (const [id, raw] of Object.entries(audits)) {
    const audit = raw as {
      score?: number | null;
      scoreDisplayMode?: string;
      title?: string;
      description?: string;
      displayValue?: string;
      details?: { overallSavingsMs?: number };
    };

    if (
      audit.score == null ||
      audit.score >= 1 ||
      audit.scoreDisplayMode === "informational" ||
      audit.scoreDisplayMode === "notApplicable"
    ) {
      continue;
    }

    const savingsMs = audit.details?.overallSavingsMs;
    if (savingsMs != null && savingsMs > 0) {
      opportunities.push({
        id,
        title: audit.title ?? id,
        description: audit.description,
        displayValue: audit.displayValue,
        savings_ms: Math.round(savingsMs),
      });
    } else {
      diagnostics.push({
        id,
        title: audit.title ?? id,
        description: audit.description ?? "",
      });
    }
  }

  return {
    url,
    slug,
    strategy: "mobile",
    timestamp: new Date().toISOString(),
    performanceScore,
    seoScore,
    bestPracticesScore,
    metrics,
    opportunities,
    diagnostics,
  };
}

function reportToIssues(
  report: PageReport
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const issueType: ValidationIssue["type"] =
    report.performanceScore < 50 ? "error" : "warning";

  for (const opp of report.opportunities) {
    const code = `PSI_${opp.id.toUpperCase().replace(/-/g, "_")}`;
    issues.push({
      type: issueType,
      code,
      message: `[${report.slug}] ${opp.title}${opp.displayValue ? `: ${opp.displayValue}` : ""}`,
      file: report.url,
      suggestion: firstSentence(opp.description),
    });
  }

  for (const diag of report.diagnostics) {
    const code = `PSI_${diag.id.toUpperCase().replace(/-/g, "_")}`;
    issues.push({
      type: issueType,
      code,
      message: `[${report.slug}] ${diag.title}`,
      file: report.url,
      suggestion: firstSentence(diag.description),
    });
  }

  return issues;
}

export const lighthouseValidator: Validator = {
  name: "lighthouse",
  description:
    "Google PageSpeed Insights audit for all public en-locale pages",
  apiExposed: false,
  estimatedDuration: "slow",
  category: "performance",

  async run(context: ValidationContext): Promise<ValidatorResult> {
    const startTime = Date.now();
    const errors: ValidationIssue[] = [];
    const warnings: ValidationIssue[] = [];

    const siteBaseUrl = process.env.SITE_URL?.replace(/\/$/, "");
    if (!siteBaseUrl) {
      warnings.push({
        type: "warning",
        code: "PSI_NO_BASE_URL",
        message:
          "SITE_URL is not set — skipping Lighthouse audit. Set it to your deployed public URL (e.g. https://www.4geeksacademy.com).",
      });
      return {
        name: "lighthouse",
        description: this.description,
        status: "warning",
        errors,
        warnings,
        duration: Date.now() - startTime,
      };
    }

    const apiKey = process.env.GOOGLE_PSI_API_KEY;

    const seen = new Set<string>();
    const urlEntries: { url: string; slug: string }[] = [];

    for (const file of context.contentFiles) {
      if (file.locale !== "en") continue;

      const canonicalPath = getCanonicalUrl(file);
      if (canonicalPath.startsWith("/private")) continue;

      const fullUrl = file.meta?.canonical_url
        ? file.meta.canonical_url
        : `${siteBaseUrl}${canonicalPath}`;

      if (seen.has(fullUrl)) continue;
      seen.add(fullUrl);
      urlEntries.push({ url: fullUrl, slug: file.slug });
    }

    if (urlEntries.length === 0) {
      warnings.push({
        type: "warning",
        code: "PSI_NO_PAGES",
        message:
          "No en-locale public pages found in context — nothing to audit.",
      });
      return {
        name: "lighthouse",
        description: this.description,
        status: "warning",
        errors,
        warnings,
        duration: Date.now() - startTime,
      };
    }

    gcs.initFromEnv();

    const gcsPrefix = todayGcsPrefix(context);
    const localDir = todayLocalDir();

    const pages: PageReport[] = [];

    for (let i = 0; i < urlEntries.length; i++) {
      const { url, slug } = urlEntries[i];

      if (i > 0) {
        await sleep(500);
      }

      let report: PageReport;
      try {
        const data = await auditUrl(url, apiKey);
        report = buildPageReport(url, slug, data);
      } catch (err) {
        warnings.push({
          type: "warning",
          code: "PSI_REQUEST_FAILED",
          message: `Failed to audit ${url}: ${err}`,
          file: url,
        });
        continue;
      }

      const filename = safeReportFilename(slug, url);
      try {
        if (gcs.available) {
          await gcs.upload(
            `${gcsPrefix}/${filename}`,
            Buffer.from(JSON.stringify(report, null, 2)),
            "application/json",
            { cacheControl: "no-store" }
          );
        } else {
          ensureDir(localDir);
          fs.writeFileSync(path.join(localDir, filename), JSON.stringify(report, null, 2));
        }
      } catch {
        /* non-fatal */
      }

      pages.push(report);

      const pageIssues = reportToIssues(report);
      for (const issue of pageIssues) {
        if (issue.type === "error") {
          errors.push(issue);
        } else {
          warnings.push(issue);
        }
      }
    }

    const sorted = [...pages].sort(
      (a, b) => a.performanceScore - b.performanceScore
    );
    try {
      if (gcs.available) {
        await gcs.upload(
          `${gcsPrefix}/_summary.json`,
          Buffer.from(JSON.stringify(sorted, null, 2)),
          "application/json",
          { cacheControl: "no-store" }
        );
      } else {
        ensureDir(localDir);
        fs.writeFileSync(
          path.join(localDir, "_summary.json"),
          JSON.stringify(sorted, null, 2)
        );
      }
    } catch {
      /* non-fatal */
    }

    const status =
      errors.length > 0
        ? "failed"
        : warnings.length > 0
        ? "warning"
        : "passed";

    return {
      name: "lighthouse",
      description: this.description,
      status,
      errors,
      warnings,
      duration: Date.now() - startTime,
      artifacts: {
        pages,
        savedTo: gcs.available ? gcsPrefix : localDir,
      },
    };
  },
};
