import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import type { Validator, ValidatorResult, ValidationContext, ValidationIssue } from "../shared/types";
import { contentIndex } from "../../../server/content-index";
import { createPublicUrlResolver } from "../../../server/redirects";

interface SeoConfig {
  intents: Record<string, { label: string; description: string }>;
  intent_defaults: Record<string, string>;
  focus_features: Record<string, { label: string; description: string }>;
}

function loadSeoConfig(contentRoot?: string): SeoConfig | null {
  const candidates = [
    path.join(process.cwd(), "site_4geeks-com", "seo-config.yml"),
    path.join(process.cwd(), "4geeks-com", "seo-config.yml"),
  ];
  if (contentRoot) candidates.unshift(path.join(process.cwd(), contentRoot, "seo-config.yml"));
  const configPath = candidates.find((p) => fs.existsSync(p));
  if (!configPath) return null;
  try {
    const raw = fs.readFileSync(configPath, "utf-8");
    return yaml.load(raw) as SeoConfig;
  } catch {
    return null;
  }
}

const PILLAR_CONTENT_TYPES = new Set(["programs", "landing", "landings", "pages", "page", "locations", "location"]);

export const seoIntentValidator: Validator = {
  name: "seo-intent",
  description: "Validates funnel.stage on _common.yml, pillar pages, focus features, and cluster consistency",
  apiExposed: true,
  estimatedDuration: "fast",
  category: "seo",

  async run(context: ValidationContext): Promise<ValidatorResult> {
    const startTime = Date.now();
    const errors: ValidationIssue[] = [];
    const warnings: ValidationIssue[] = [];

    const config = loadSeoConfig();
    if (!config) {
      return {
        name: this.name,
        description: this.description,
        status: "failed",
        errors: [{
          type: "error",
          code: "CONFIG_MISSING",
          message: "4geeks-com/seo-config.yml not found",
          suggestion: "Create the seo-config.yml file with intents, intent_defaults, and focus_features",
        }],
        warnings: [],
        duration: Date.now() - startTime,
      };
    }

    const validIntents = new Set(Object.keys(config.intents));
    const validFeatures = new Set(Object.keys(config.focus_features));
    const publicUrls = createPublicUrlResolver(contentIndex);

    const seen = new Set<string>();
    const pillarRefs = new Map<string, string[]>();

    for (const file of context.contentFiles) {
      const key = `${file.slug}:${file.type}:${file.locale}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const seo = file.seo;
      const contentTypeForCheck = file.type;
      const isHighPriorityType = contentTypeForCheck === "programs" ||
        contentTypeForCheck === "landings" ||
        contentTypeForCheck === "landing";

      if (!seo) {
        if (isHighPriorityType) {
          warnings.push({
            type: "warning",
            code: "MISSING_INTENT",
            message: `No seo block found for ${file.type} page "${file.slug}" (${file.locale})`,
            file: file.filePath,
            suggestion: `Add a seo: block with intent: and optionally pillar: and focus_features:`,
          });
        }
        continue;
      }

      if (seo.intent !== undefined && seo.intent !== null) {
        if (!validIntents.has(seo.intent)) {
          errors.push({
            type: "error",
            code: "INVALID_INTENT",
            message: `Invalid intent "${seo.intent}" for "${file.slug}" (${file.locale})`,
            file: file.filePath,
            suggestion: `Valid values: ${[...validIntents].join(", ")}`,
          });
        }
      } else if (isHighPriorityType) {
        warnings.push({
          type: "warning",
          code: "MISSING_INTENT",
          message: `Missing seo.intent for ${file.type} page "${file.slug}" (${file.locale})`,
          file: file.filePath,
          suggestion: `Set seo.intent to one of: ${[...validIntents].join(", ")}`,
        });
      }

      if (seo.pillar) {
        const pillarLocale = file.locale === "_common" ? "en" : file.locale;
        if (!publicUrls.isLive(seo.pillar, pillarLocale)) {
          errors.push({
            type: "error",
            code: "INVALID_PILLAR",
            message: `seo.pillar "${seo.pillar}" does not resolve to a known page for "${file.slug}" (${file.locale})`,
            file: file.filePath,
            suggestion: "Check the pillar URL matches a valid page URL in the site",
          });
        } else {
          const refs = pillarRefs.get(seo.pillar) || [];
          refs.push(file.slug);
          pillarRefs.set(seo.pillar, refs);
        }
      } else if (isHighPriorityType) {
        warnings.push({
          type: "warning",
          code: "ORPHAN_PAGE",
          message: `${file.type} page "${file.slug}" (${file.locale}) has no seo.pillar — it belongs to no cluster`,
          file: file.filePath,
          suggestion: "Set seo.pillar to the URL of the main topic page this page supports",
        });
      }

      if (Array.isArray(seo.focus_features) && seo.focus_features.length > 0) {
        for (const feature of seo.focus_features) {
          if (!validFeatures.has(feature)) {
            errors.push({
              type: "error",
              code: "INVALID_FOCUS_FEATURE",
              message: `Unknown focus_feature "${feature}" in "${file.slug}" (${file.locale})`,
              file: file.filePath,
              suggestion: `Valid focus_features: ${[...validFeatures].join(", ")}`,
            });
          }
        }
      }
    }

    const status = errors.length > 0 ? "failed" : warnings.length > 0 ? "warning" : "passed";

    return {
      name: this.name,
      description: this.description,
      status,
      errors,
      warnings,
      duration: Date.now() - startTime,
      artifacts: {
        pillarClusterSummary: Object.fromEntries(pillarRefs),
        clustersFound: pillarRefs.size,
      },
    };
  },
};
