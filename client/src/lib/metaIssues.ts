const VALID_CHANGE_FREQUENCIES = [
  "always",
  "hourly",
  "daily",
  "weekly",
  "monthly",
  "yearly",
  "never",
] as const;

const VALID_ROBOTS = ["index", "noindex", "follow", "nofollow", "none", "all"];

export interface MetaIssue {
  code: string;
  message: string;
}

function asString(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return "";
}

/** Client-side meta checks mirroring the meta validator + SeoModal length guidance. */
export function getMetaIssues(meta: Record<string, unknown> | null | undefined): MetaIssue[] {
  const issues: MetaIssue[] = [];
  const m = meta || {};

  const pageTitle = asString(m.page_title).trim();
  const description = asString(m.description).trim();

  if (!pageTitle) {
    issues.push({ code: "MISSING_PAGE_TITLE", message: "Missing page_title in meta" });
  } else if (pageTitle.length > 60) {
    issues.push({
      code: "PAGE_TITLE_TOO_LONG",
      message: `page_title is ${pageTitle.length} characters (recommended ≤ 60)`,
    });
  }

  if (!description) {
    issues.push({ code: "MISSING_DESCRIPTION", message: "Missing description in meta" });
  } else if (description.length > 160) {
    issues.push({
      code: "DESCRIPTION_TOO_LONG",
      message: `description is ${description.length} characters (recommended ≤ 160)`,
    });
  }

  const ogImage = asString(m.og_image).trim();
  const ogImageUsable =
    !!ogImage &&
    !/\{\{/.test(ogImage) &&
    (/^https?:\/\//i.test(ogImage) || ogImage.startsWith("/"));
  if (!ogImageUsable) {
    issues.push({ code: "MISSING_OG_IMAGE", message: "Missing og_image in meta" });
  }

  if (m.priority !== undefined && m.priority !== null && m.priority !== "") {
    const priority =
      typeof m.priority === "number" ? m.priority : Number.parseFloat(asString(m.priority));
    if (Number.isNaN(priority) || priority < 0 || priority > 1) {
      issues.push({
        code: "INVALID_PRIORITY",
        message: `Invalid priority value: ${m.priority}. Must be between 0 and 1`,
      });
    }
  }

  const changeFrequency = asString(m.change_frequency).trim();
  if (changeFrequency && !VALID_CHANGE_FREQUENCIES.includes(changeFrequency as (typeof VALID_CHANGE_FREQUENCIES)[number])) {
    issues.push({
      code: "INVALID_CHANGE_FREQUENCY",
      message: `Invalid change_frequency: "${changeFrequency}"`,
    });
  }

  const robots = asString(m.robots).trim();
  if (robots) {
    const parts = robots.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
    for (const part of parts) {
      if (!VALID_ROBOTS.includes(part)) {
        issues.push({
          code: "UNKNOWN_ROBOTS_DIRECTIVE",
          message: `Unknown robots directive: "${part}"`,
        });
      }
    }
  }

  return issues;
}
