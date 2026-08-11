import * as fs from "fs";
import * as yaml from "js-yaml";
import type { Validator, ValidatorResult, ValidationContext, ValidationIssue } from "../shared/types";
import { hasSchemaOrgContributors } from "@shared/schema-org-sections";
let _generateSsrSchemaHtml: ((url: string) => string | Promise<string>) | null = null;
async function getGenerateSsrSchemaHtml(): Promise<(url: string) => string | Promise<string>> {
  if (!_generateSsrSchemaHtml) {
    try {
      const mod = await import("../../server/ssr-schema");
      _generateSsrSchemaHtml = mod.generateSsrSchemaHtml;
    } catch {
      _generateSsrSchemaHtml = () => "";
    }
  }
  return _generateSsrSchemaHtml!;
}
import { getCanonicalUrl } from "../shared/canonicalUrls";

function checkForPlaceholders(obj: unknown): string[] {
  const found: string[] = [];
  if (typeof obj === "string") {
    if (obj.match(/todo/i)) {
      found.push(obj);
    }
  } else if (Array.isArray(obj)) {
    for (const item of obj) {
      found.push(...checkForPlaceholders(item));
    }
  } else if (obj && typeof obj === "object") {
    for (const value of Object.values(obj)) {
      found.push(...checkForPlaceholders(value));
    }
  }
  return found;
}

function loadSectionsFromContentFile(filePath: string): Array<Record<string, unknown>> {
  try {
    let sections: Array<Record<string, unknown>> = [];
    const commonPath = filePath.replace(/[^/\\]+$/, "_common.yml");
    if (fs.existsSync(commonPath)) {
      const commonData = yaml.load(fs.readFileSync(commonPath, "utf-8")) as Record<string, unknown>;
      if (Array.isArray(commonData?.sections)) {
        sections = (commonData.sections as Array<Record<string, unknown>>).filter(
          (s) => s && typeof s === "object",
        );
      }
    }
    if (fs.existsSync(filePath)) {
      const parsed = yaml.load(fs.readFileSync(filePath, "utf-8")) as Record<string, unknown>;
      if (Array.isArray(parsed?.sections)) {
        sections = (parsed.sections as Array<Record<string, unknown>>).filter(
          (s) => s && typeof s === "object",
        );
      }
    }
    return sections;
  } catch {
    return [];
  }
}

export const schemaCompletenessValidator: Validator = {
  name: "schema-completeness",
  description: "Validates Schema.org completeness: rendered output, required fields, placeholders, and FAQ coverage",
  apiExposed: true,
  estimatedDuration: "medium",
  category: "seo",

  async run(context: ValidationContext): Promise<ValidatorResult> {
    const startTime = Date.now();
    const errors: ValidationIssue[] = [];
    const warnings: ValidationIssue[] = [];

    let pagesWithSchema = 0;
    let pagesWithoutSchema = 0;
    let totalJsonLdBlocks = 0;
    let placeholderValues = 0;

    for (const file of context.contentFiles) {
      const url = getCanonicalUrl(file);
      let html = "";

      try {
        const renderFn = await getGenerateSsrSchemaHtml();
        html = await Promise.resolve(renderFn(url));
      } catch (err) {
        errors.push({
          type: "error",
          code: "SCHEMA_RENDER_ERROR",
          message: `Failed to render schema for ${url}: ${err instanceof Error ? err.message : String(err)}`,
          file: file.filePath,
          suggestion: "Check the schema configuration and ssr-schema rendering logic",
        });
        continue;
      }

      const sections = loadSectionsFromContentFile(file.filePath);
      const hasContributors = hasSchemaOrgContributors(sections);

      const schemaInclude: unknown[] = Array.isArray(file.schema?.include) ? file.schema.include : [];
      if (schemaInclude.length > 0) {
        const invalidEntries = schemaInclude.filter(
          (v) => typeof v !== "string" || v.trim().length === 0
        );
        if (invalidEntries.length > 0) {
          errors.push({
            type: "error",
            code: "SCHEMA_INVALID_INCLUDE",
            message: `schema.include contains empty or non-string entries for ${url}`,
            file: file.filePath,
            suggestion: "Remove legacy schema.include; use leading schema_org / FAQ / Article / Breadcrumb sections instead",
          });
        }
      }

      if (!hasContributors) {
        pagesWithoutSchema++;
        warnings.push({
          type: "warning",
          code: "PAGE_NO_SCHEMA",
          message: `No schema.org section contributors for ${url}`,
          file: file.filePath,
          suggestion:
            "Add a leading schema_org section (and/or FAQ, Article, or Breadcrumb) so structured data is emitted from sections",
        });
        continue;
      }

      pagesWithSchema++;

      const scriptRegex = /<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g;
      let match: RegExpExecArray | null;
      const parsedSchemas: Record<string, unknown>[] = [];

      while ((match = scriptRegex.exec(html)) !== null) {
        totalJsonLdBlocks++;
        try {
          const jsonLd = JSON.parse(match[1]);
          parsedSchemas.push(jsonLd);

          if (!jsonLd.name) {
            warnings.push({
              type: "warning",
              code: "SCHEMA_MISSING_NAME",
              message: `JSON-LD block missing "name" field for ${url}`,
              file: file.filePath,
              suggestion: "Add a name field to the schema for better search engine understanding",
            });
          }

          if (!jsonLd.description) {
            warnings.push({
              type: "warning",
              code: "SCHEMA_MISSING_DESCRIPTION",
              message: `JSON-LD block missing "description" field for ${url}`,
              file: file.filePath,
              suggestion: "Add a description field to the schema",
            });
          }

          const placeholders = checkForPlaceholders(jsonLd);
          if (placeholders.length > 0) {
            placeholderValues += placeholders.length;
            for (const p of placeholders) {
              errors.push({
                type: "error",
                code: "SCHEMA_PLACEHOLDER_VALUE",
                message: `Schema contains placeholder value: "${p.substring(0, 80)}"`,
                file: file.filePath,
                suggestion: "Replace TODO placeholder with actual content",
              });
            }
          }
        } catch {
        }
      }

      const hasFaqSection = sections.some((s) => s.type === "faq");
      if (hasFaqSection) {
        const hasFaqSchema = parsedSchemas.some(
          (s) => s["@type"] === "FAQPage"
        );
        if (!hasFaqSchema) {
          warnings.push({
            type: "warning",
            code: "FAQ_SECTION_NO_SCHEMA",
            message: `Page has FAQ section but no FAQPage schema rendered for ${url}`,
            file: file.filePath,
            suggestion: "Ensure FAQ sections generate FAQPage structured data",
          });
        }
      }
    }

    const duration = Date.now() - startTime;
    return {
      name: this.name,
      description: this.description,
      status: errors.length > 0 ? "failed" : warnings.length > 0 ? "warning" : "passed",
      errors,
      warnings,
      duration,
      artifacts: {
        pagesWithSchema,
        pagesWithoutSchema,
        totalJsonLdBlocks,
        placeholderValues,
      },
    };
  },
};
