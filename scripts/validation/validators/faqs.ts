/**
 * FAQ Validator
 *
 * Validates FAQ content files:
 * - Checks that all FAQ entries have a last_updated date
 * - Verifies answers were updated within the last 6 months
 * - Validates both en.yml and es.yml FAQ files
 */

import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";
import type {
  Validator,
  ValidatorResult,
  ValidationContext,
  ValidationIssue,
} from "../shared/types";

const SIX_MONTHS_MS = 6 * 30 * 24 * 60 * 60 * 1000;

interface FAQEntry {
  question: string;
  answer: string;
  last_updated?: string;
  locations?: string[];
  related_features?: string[];
  priority?: number;
}

interface FAQFile {
  faqs: FAQEntry[];
}

function validateFAQFile(
  filePath: string,
  errors: ValidationIssue[],
  warnings: ValidationIssue[],
): number {
  const now = Date.now();
  const sixMonthsAgo = now - SIX_MONTHS_MS;
  let entriesChecked = 0;

  if (!fs.existsSync(filePath)) {
    errors.push({
      type: "error",
      code: "FAQ_FILE_NOT_FOUND",
      message: `FAQ file not found: ${filePath}`,
      file: filePath,
      suggestion: "Create the FAQ file with the required structure",
    });
    return 0;
  }

  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const parsed = yaml.load(content) as FAQFile;

    if (!parsed?.faqs || !Array.isArray(parsed.faqs)) {
      errors.push({
        type: "error",
        code: "INVALID_FAQ_STRUCTURE",
        message: "FAQ file must contain a 'faqs' array",
        file: filePath,
        suggestion: "Add a 'faqs:' key with an array of FAQ entries",
      });
      return 0;
    }

    parsed.faqs.forEach((faq, index) => {
      entriesChecked++;
      const questionPreview =
        faq.question?.substring(0, 50) || `Entry ${index + 1}`;

      if (!faq.last_updated) {
        errors.push({
          type: "error",
          code: "MISSING_LAST_UPDATED",
          message: `FAQ "${questionPreview}..." is missing last_updated date`,
          file: filePath,
          line: index + 1,
          suggestion: "Add 'last_updated: YYYY-MM-DD' to this FAQ entry",
        });
        return;
      }

      const updateDate = new Date(faq.last_updated);
      if (isNaN(updateDate.getTime())) {
        errors.push({
          type: "error",
          code: "INVALID_DATE_FORMAT",
          message: `FAQ "${questionPreview}..." has invalid date format: ${faq.last_updated}`,
          file: filePath,
          line: index + 1,
          suggestion: "Use YYYY-MM-DD format (e.g., 2025-01-15)",
        });
        return;
      }

      if (updateDate.getTime() < sixMonthsAgo) {
        const monthsAgo = Math.floor(
          (now - updateDate.getTime()) / (30 * 24 * 60 * 60 * 1000),
        );
        errors.push({
          type: "error",
          code: "STALE_FAQ_ANSWER",
          message: `FAQ "${questionPreview}..." was last updated ${monthsAgo} months ago (${faq.last_updated})`,
          file: filePath,
          line: index + 1,
          suggestion:
            "Review and update this FAQ answer, then set last_updated to today's date",
        });
      }

      // Validate tag count: warn on 2 tags, error on 3+ tags
      const tagCount = faq.related_features?.length || 0;
      if (tagCount > 2) {
        errors.push({
          type: "error",
          code: "TOO_MANY_TAGS",
          message: `FAQ "${questionPreview}..." has ${tagCount} tags. Maximum allowed is 2 (1 tag preferred, 2 only in extraordinary cases).`,
          file: filePath,
          line: index + 1,
          suggestion: "Reduce to 1-2 tags. Keep only the most relevant tag(s).",
        });
      }
    });
  } catch (error) {
    errors.push({
      type: "error",
      code: "FAQ_PARSE_ERROR",
      message: `Failed to parse FAQ file: ${error instanceof Error ? error.message : String(error)}`,
      file: filePath,
      suggestion: "Check the YAML syntax in this file",
    });
  }

  return entriesChecked;
}

export const faqsValidator: Validator = {
  name: "faqs",
  description:
    "Validates FAQ entries have last_updated dates within 6 months and proper tag counts (max 2 tags)",
  apiExposed: true,
  estimatedDuration: "fast",
  category: "content",

  async run(_context: ValidationContext): Promise<ValidatorResult> {
    const startTime = Date.now();
    const errors: ValidationIssue[] = [];
    const warnings: ValidationIssue[] = [];

    const faqDir = path.resolve(process.cwd(), "4geeks-com/faqs");
    const enFile = path.join(faqDir, "en.yml");
    const esFile = path.join(faqDir, "es.yml");

    const enCount = validateFAQFile(enFile, errors, warnings);
    const esCount = validateFAQFile(esFile, errors, warnings);

    const duration = Date.now() - startTime;
    const staleCount = errors.filter(
      (e) => e.code === "STALE_FAQ_ANSWER",
    ).length;
    const missingDateCount = errors.filter(
      (e) => e.code === "MISSING_LAST_UPDATED",
    ).length;

    return {
      name: this.name,
      description: this.description,
      status:
        errors.length > 0
          ? "failed"
          : warnings.length > 0
            ? "warning"
            : "passed",
      errors,
      warnings,
      duration,
      artifacts: {
        filesChecked: 2,
        totalFAQs: enCount + esCount,
        englishFAQs: enCount,
        spanishFAQs: esCount,
        staleFAQs: staleCount,
        missingDates: missingDateCount,
      },
    };
  },
};
