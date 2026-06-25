import { contentIndex } from "../content-index";
import { getDefaultLocale } from "../settings";
import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";
import { child } from "../logger";
const log = child({ module: "ai/ContentCompiler" });



interface CompiledContext {
  pageContext: string;
  globalSummary: string;
}

const MARKETING_CONTENT_PATH = path.resolve(process.env.CONTENT_FOLDER || "content");

function loadYamlFile(filePath: string): Record<string, unknown> | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = yaml.load(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function extractTextFields(obj: Record<string, unknown>, prefix = ""): string[] {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined) continue;
    if (typeof value === "string" && value.length > 0 && !value.startsWith("http") && !value.startsWith("{{")) {
      const label = prefix ? `${prefix}.${key}` : key;
      if (["slug", "template", "version", "type", "section_id", "id", "bc_slug", "job_role"].includes(key)) continue;
      lines.push(`${label}: ${value}`);
    } else if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === "string" && item.length > 0) {
          lines.push(`- ${item}`);
        } else if (typeof item === "object" && item !== null) {
          lines.push(...extractTextFields(item as Record<string, unknown>, key));
        }
      }
    } else if (typeof value === "object") {
      lines.push(...extractTextFields(value as Record<string, unknown>, prefix ? `${prefix}.${key}` : key));
    }
  }
  return lines;
}

export class ContentCompiler {
  compilePageContext(contentType: string, slug: string, locale: string): string {
    const effectiveLocale = locale || getDefaultLocale();

    try {
      const result = contentIndex.loadMergedContent(contentType, slug, effectiveLocale);
      const merged = result?.data;
      if (!merged) return `No content found for ${contentType}/${slug}`;

      const lines: string[] = [];
      lines.push(`# ${contentType}: ${slug}`);
      lines.push("");

      if (merged.title) lines.push(`Title: ${merged.title as string}`);
      if (merged.name) lines.push(`Name: ${merged.name as string}`);
      if (merged.description) lines.push(`Description: ${merged.description as string}`);
      if (merged.city) lines.push(`City: ${merged.city as string}`);
      if (merged.country) lines.push(`Country: ${merged.country as string}`);
      if (merged.address) lines.push(`Address: ${merged.address as string}`);
      if (merged.phone) lines.push(`Phone: ${merged.phone as string}`);

      if (merged.meta && typeof merged.meta === "object") {
        const meta = merged.meta as Record<string, unknown>;
        if (meta.description) lines.push(`Meta Description: ${meta.description as string}`);
      }

      if (merged.sections && Array.isArray(merged.sections)) {
        for (const section of merged.sections) {
          if (typeof section !== "object" || section === null) continue;
          const s = section as Record<string, unknown>;
          const sType = s.type as string;
          lines.push("");
          lines.push(`## Section: ${sType || "unknown"}`);

          const sectionLines = extractTextFields(s);
          lines.push(...sectionLines);
        }
      }

      return lines.join("\n");
    } catch (err) {
      log.error({ err: err }, `[ContentCompiler] Error compiling ${contentType}/${slug}:`);
      return `Error loading content for ${contentType}/${slug}`;
    }
  }

  compileGeneralPageContext(slug: string, locale: string): string {
    const effectiveLocale = locale || getDefaultLocale();

    try {
      const result = contentIndex.loadMergedContent("page", slug, effectiveLocale);
      const pageData = result?.data;
      if (!pageData) return "";

      const lines: string[] = [];
      lines.push(`# Page: ${slug}`);
      lines.push("");

      if (pageData.title) lines.push(`Title: ${pageData.title as string}`);
      if (pageData.description) lines.push(`Description: ${pageData.description as string}`);

      if (pageData.meta && typeof pageData.meta === "object") {
        const meta = pageData.meta as Record<string, unknown>;
        if (meta.title) lines.push(`Meta Title: ${meta.title as string}`);
        if (meta.description) lines.push(`Meta Description: ${meta.description as string}`);
      }

      if (pageData.sections && Array.isArray(pageData.sections)) {
        for (const section of pageData.sections) {
          if (typeof section !== "object" || section === null) continue;
          const s = section as Record<string, unknown>;
          const sType = s.type as string;
          lines.push("");
          lines.push(`## Section: ${sType || "unknown"}`);
          const sectionLines = extractTextFields(s);
          lines.push(...sectionLines);
        }
      }

      return lines.join("\n");
    } catch (err) {
      log.error({ err: err }, `[ContentCompiler] Error compiling page/${slug}:`);
      return "";
    }
  }

  compileProgramSummary(locale: string): string {
    const slugs = contentIndex.listContentSlugs("program");
    const lines: string[] = ["# Available Programs", ""];

    for (const slug of slugs) {
      try {
        const result = contentIndex.loadMergedContent("program", slug, locale);
        const data = result?.data;
        if (!data) continue;
        const title = (data.title as string) || slug;
        const meta = data.meta as Record<string, unknown> | undefined;
        const desc = (meta?.description as string) || "";
        lines.push(`- **${title}** (${slug}): ${desc}`);
      } catch {
        continue;
      }
    }

    return lines.join("\n");
  }

  compileLocationSummary(locale: string): string {
    const slugs = contentIndex.listContentSlugs("location");
    const lines: string[] = ["# Available Locations", ""];

    for (const slug of slugs) {
      try {
        const result = contentIndex.loadMergedContent("location", slug, locale);
        const data = result?.data;
        if (!data) continue;
        const name = (data.name as string) || slug;
        const city = (data.city as string) || "";
        const country = (data.country as string) || "";
        lines.push(`- **${name}** (${slug}): ${city}, ${country}`);
      } catch {
        continue;
      }
    }

    return lines.join("\n");
  }

  compileFaqContext(programSlug?: string, locale?: string): string {
    const effectiveLocale = locale || getDefaultLocale();
    const lines: string[] = ["# Frequently Asked Questions", ""];

    const faqFilePath = path.join(MARKETING_CONTENT_PATH, "faqs", `${effectiveLocale}.yml`);
    const faqData = loadYamlFile(faqFilePath);
    if (faqData && Array.isArray(faqData.faqs)) {
      lines.push("## General FAQs");
      for (const faq of faqData.faqs) {
        if (typeof faq !== "object" || faq === null) continue;
        const f = faq as Record<string, unknown>;
        if (f.question && f.answer) {
          lines.push(`Q: ${f.question as string}`);
          lines.push(`A: ${f.answer as string}`);
          lines.push("");
        }
      }
    }

    const slugsToCheck = programSlug ? [programSlug] : contentIndex.listContentSlugs("program");

    for (const slug of slugsToCheck) {
      try {
        const result = contentIndex.loadMergedContent("program", slug, effectiveLocale);
        const data = result?.data;
        if (!data || !data.sections || !Array.isArray(data.sections)) continue;

        for (const section of data.sections) {
          if (typeof section !== "object" || section === null) continue;
          const s = section as Record<string, unknown>;
          if (s.type !== "faq") continue;
          const items = s.items as Array<Record<string, unknown>> | undefined;
          if (!items) continue;

          lines.push(`## FAQs for ${slug}`);
          for (const item of items) {
            if (item.question && item.answer) {
              lines.push(`Q: ${item.question as string}`);
              lines.push(`A: ${item.answer as string}`);
              lines.push("");
            }
          }
        }
      } catch {
        continue;
      }
    }

    return lines.join("\n");
  }

  compileGlobalSummary(locale: string): string {
    const parts: string[] = [];
    parts.push(this.compileProgramSummary(locale));
    parts.push("");
    parts.push(this.compileLocationSummary(locale));
    return parts.join("\n");
  }

  compile(contentType: string | null, slug: string | null, locale: string): CompiledContext {
    let pageContext = "";

    if (contentType && slug) {
      pageContext = this.compilePageContext(contentType, slug, locale);
    } else if (slug) {
      pageContext = this.compileGeneralPageContext(slug, locale);
    }

    const globalSummary = this.compileGlobalSummary(locale);

    return { pageContext, globalSummary };
  }
}

export const contentCompiler = new ContentCompiler();
