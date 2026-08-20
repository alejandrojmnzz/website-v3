import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import type { Validator, ValidatorResult, ValidationContext, ValidationIssue } from "../shared/types";
import { contentIndex } from "../../../server/content-index";
import { createPublicUrlResolver } from "../../../server/redirects";
import { isClusterRequired, isSeoMonitoringEnabled } from "../../../server/seo-monitoring";
import { loadSeoIndex } from "../../../server/seo-index";
import { classifyClusterEntry } from "../../../server/seo-cluster-stats";

interface SeoConfig {
  intents: Record<string, { label: string; description: string }>;
  intent_defaults: Record<string, string>;
  focus_features: Record<string, { label: string; description: string }>;
}

function loadSeoConfig(contentRoot?: string): SeoConfig | null {
  const candidates: string[] = [];
  if (contentRoot) {
    const root = path.isAbsolute(contentRoot) ? contentRoot : path.join(process.cwd(), contentRoot);
    candidates.push(path.join(root, "seo-config.yml"));
  }
  candidates.push(
    path.join(process.cwd(), "site_4geeks-com", "seo-config.yml"),
    path.join(process.cwd(), "4geeks-com", "seo-config.yml"),
  );
  const configPath = candidates.find((p) => fs.existsSync(p));
  if (!configPath) return null;
  try {
    const raw = fs.readFileSync(configPath, "utf-8");
    return yaml.load(raw) as SeoConfig;
  } catch {
    return null;
  }
}

function effectivePillar(seo: NonNullable<ValidationContext["contentFiles"][0]["seo"]>): string | null | "opted_out" {
  if (seo.pillar_path === null) return "opted_out";
  const fromPath = typeof seo.pillar_path === "string" ? seo.pillar_path.trim() : "";
  if (fromPath) return fromPath;
  const legacy = typeof seo.pillar === "string" ? seo.pillar.trim() : "";
  if (legacy) return legacy;
  return null;
}

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

    const config = loadSeoConfig(context.contentRoot);
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
    const seoIndex = loadSeoIndex(context.contentRoot);
    const orphanIds = new Set(seoIndex.orphans);

    const seen = new Set<string>();
    const pillarRefs = new Map<string, string[]>();

    for (const file of context.contentFiles) {
      const key = `${file.slug}:${file.type}:${file.locale}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const monitored = isSeoMonitoringEnabled(file.type, context.contentRoot);
      const requireCluster = isClusterRequired(file.type, context.contentRoot);
      const seo = file.seo;

      if (!seo) {
        if (monitored && requireCluster) {
          warnings.push({
            type: "warning",
            code: "ORPHAN_PAGE",
            message: `${file.type} page "${file.slug}" (${file.locale}) has no seo block — it belongs to no cluster`,
            file: file.filePath,
            suggestion: "Add a seo: block with pillar_path (hub URL) or pillar_path: null to opt out",
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
      }

      if (seo.is_pillar === true) {
        continue;
      }

      const pillar = effectivePillar(seo);
      if (pillar === "opted_out") {
        continue;
      }

      if (pillar) {
        const pillarLocale = file.locale === "_common" ? "en" : file.locale;
        if (!publicUrls.isLive(pillar, pillarLocale)) {
          const hubEntry = Object.values(seoIndex.entries).find(
            (e) => e.path === pillar || e.pillar_path === pillar,
          );
          const reason = hubEntry && !hubEntry.is_pillar ? "hub_not_pillar" : "hub_not_found";
          errors.push({
            type: "error",
            code: "INVALID_PILLAR",
            message:
              reason === "hub_not_pillar"
                ? `seo.pillar_path "${pillar}" resolves to a live page that is not marked as a pillar hub for "${file.slug}" (${file.locale})`
                : `seo.pillar_path "${pillar}" does not resolve to a known pillar hub for "${file.slug}" (${file.locale})`,
            file: file.filePath,
            suggestion:
              reason === "hub_not_pillar"
                ? "Mark the target page as seo.is_pillar: true or pick another hub URL"
                : "Check the pillar URL matches a valid pillar hub in the site",
          });
        } else {
          const refs = pillarRefs.get(pillar) || [];
          refs.push(file.slug);
          pillarRefs.set(pillar, refs);
        }
      } else if (monitored && requireCluster) {
        const indexRow = seoIndex.entries[`${file.type}/${file.slug}/${file.locale}`];
        const bucket = indexRow
          ? classifyClusterEntry(indexRow, orphanIds)
          : typeof seo.main_keyword === "string" && seo.main_keyword.trim()
            ? "partiallySet"
            : "unclustered";
        const code = bucket === "partiallySet" ? "PARTIALLY_SET_CLUSTER" : "ORPHAN_PAGE";
        const detail =
          bucket === "partiallySet"
            ? "has seo.main_keyword but no seo.pillar_path"
            : "has no seo.pillar_path — it belongs to no cluster";
        warnings.push({
          type: "warning",
          code,
          message: `${file.type} page "${file.slug}" (${file.locale}) ${detail}`,
          file: file.filePath,
          suggestion: "Set seo.pillar_path to the hub URL, or seo.pillar_path: null to opt out",
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
