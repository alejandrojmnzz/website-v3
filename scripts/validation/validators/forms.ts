/**
 * Forms Validator
 *
 * Scans all content files and reports:
 * - conversion_name values that are set but not in the known conversion events list
 * - missing conversion_name when the section type has a form-settings field-editor bind
 */

import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";
import type { Validator, ValidatorResult, ValidationContext, ValidationIssue } from "../shared/types";
import {
  validateFormSection,
  validateRequiredConversionName,
} from "../../../shared/validateFormSection";
import { resolveBoundFormSettingsPath } from "../../../shared/wipeOnDuplicate";
import { getAllDirectories } from "../../../server/content-types";
import { getTrackingSettings } from "../../../server/settings";
import { loadAllFieldEditors } from "../../../server/component-registry";

const CONTENT_DIRS = getAllDirectories().map((dir) => `4geeks-com/${dir}`);

function walkYamlFiles(dir: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkYamlFiles(fullPath));
    } else if (entry.name.endsWith(".yml") || entry.name.endsWith(".yaml")) {
      results.push(fullPath);
    }
  }
  return results;
}

export const formsValidator: Validator = {
  name: "forms",
  description:
    "Validates form conversion_name (required when form-settings is bound; must match known events when set)",
  apiExposed: true,
  estimatedDuration: "fast",
  category: "forms",

  async run(_context: ValidationContext): Promise<ValidatorResult> {
    const startTime = Date.now();
    const errors: ValidationIssue[] = [];
    const warnings: ValidationIssue[] = [];
    const conversionNames = getTrackingSettings().conversion_events.map((e) => e.name);
    const allFieldEditors = loadAllFieldEditors();

    for (const contentDir of CONTENT_DIRS) {
      const fullDir = path.join(process.cwd(), contentDir);
      const yamlFiles = walkYamlFiles(fullDir);

      for (const filePath of yamlFiles) {
        let parsed: Record<string, unknown>;
        try {
          const raw = fs.readFileSync(filePath, "utf-8");
          const loaded = yaml.load(raw);
          if (!loaded || typeof loaded !== "object" || Array.isArray(loaded)) continue;
          parsed = loaded as Record<string, unknown>;
        } catch {
          continue;
        }

        const sections = Array.isArray(parsed.sections) ? parsed.sections : [];
        for (let i = 0; i < sections.length; i++) {
          const section = sections[i];
          if (!section || typeof section !== "object" || Array.isArray(section)) continue;
          const sec = section as Record<string, unknown>;
          const relativePath = path.relative(process.cwd(), filePath);

          const err = validateFormSection(sec, conversionNames);
          if (err) {
            errors.push({
              type: "error",
              code: "FORM_INVALID_CONVERSION_NAME",
              message: `sections[${i}].form conversion_name is invalid. File: ${relativePath}`,
              file: relativePath,
              suggestion: err,
            });
          }

          const sectionType = String(sec.type ?? "");
          const editors = allFieldEditors[sectionType] ?? {};
          const variant = typeof sec.variant === "string" ? sec.variant : undefined;
          const formSettingsPath = resolveBoundFormSettingsPath(editors, variant);
          const requiredErr = validateRequiredConversionName(sec, formSettingsPath);
          if (requiredErr) {
            errors.push({
              type: "error",
              code: "FORM_MISSING_CONVERSION_NAME",
              message: `sections[${i}]: ${requiredErr}. File: ${relativePath}`,
              file: relativePath,
              suggestion: requiredErr,
            });
          }
        }
      }
    }

    return {
      name: this.name,
      description: this.description,
      status: errors.length > 0 ? "failed" : "passed",
      errors,
      warnings,
      duration: Date.now() - startTime,
    };
  },
};
