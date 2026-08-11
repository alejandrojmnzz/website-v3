/**
 * Helpers for create_entry / list_entry_seo / get_content_type_info / SAFE_TOP_LEVEL.
 * Rules are driven by content-type config — never hardcode a contentType name.
 */
import fs from "fs";
import path from "path";
import {
  getDirectory,
  isDbBacked,
  isSharedLayoutConfig,
  safeLoad,
  type ContentTypeConfig,
} from "./content.js";
import { actionRequired, type McpTextResult, type NextAction } from "./respond.js";

export const MULTI_SITE_TOOL_BLURB =
  "Multi-site: always pass site (domain from sites.yml, e.g. \"4geeks.com\"). If unsure, call list_sites first.";

export const SITE_PARAM_DESC =
  'Domain of the target site from sites.yml, e.g. "4geeks.com" (required when multiple sites are configured; optional when only one site exists). ' +
  MULTI_SITE_TOOL_BLURB;

/** editor.type values allowed as top-level batch/update paths (plus title/slug/settings). */
export const SAFE_EDITOR_TYPES = new Set([
  "text",
  "textarea",
  "markdown",
  "tags",
  "select",
  "datetime",
  "date",
  "image",
  "pdf",
  "boolean",
  "number",
  "json",
]);

export function listExtraUrlPatternParams(
  urlPattern?: Record<string, string> | null,
): string[] {
  if (!urlPattern) return [];
  const keys = new Set<string>();
  for (const pattern of Object.values(urlPattern)) {
    if (!pattern) continue;
    const matches = pattern.match(/:([a-zA-Z_]+)/g) || [];
    for (const m of matches) {
      const key = m.slice(1);
      if (key !== "slug" && key !== "locale") keys.add(key);
    }
  }
  return [...keys];
}

export type EditorFieldHint = {
  required?: boolean;
  type?: string;
  allow_custom_values?: boolean;
  populate_options?: boolean;
  description?: string;
  /** Required when type is `json` — JSON Schema contract for agents and saves. */
  schema?: Record<string, unknown>;
};

export function getEditorConfig(config: ContentTypeConfig): Record<string, EditorFieldHint> {
  const editor = (config as { editor?: Record<string, EditorFieldHint> }).editor;
  return editor && typeof editor === "object" ? editor : {};
}

export function requiredEditorFields(config: ContentTypeConfig): string[] {
  const editor = getEditorConfig(config);
  return Object.entries(editor)
    .filter(([, hint]) => hint?.required === true)
    .map(([k]) => k);
}

/** Top-level field paths writable via batch_update_fields / update_section_field. */
export function safeTopLevelFieldsForConfig(config: ContentTypeConfig): Set<string> {
  const allowed = new Set(["title", "slug", "settings"]);
  const editor = getEditorConfig(config);
  const mapping = config.field_mapping || {};
  for (const key of Object.keys(mapping)) {
    if (key.startsWith("_")) continue;
    const hint = editor[key];
    if (hint?.type && SAFE_EDITOR_TYPES.has(hint.type)) {
      allowed.add(key);
    } else if (
      !hint &&
      ["title", "description", "content", "tags", "lang", "status", "image", "category"].includes(key)
    ) {
      allowed.add(key);
    }
  }
  for (const [key, hint] of Object.entries(editor)) {
    if (hint?.type && SAFE_EDITOR_TYPES.has(hint.type)) allowed.add(key);
  }
  return allowed;
}

export function extractParamSlug(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const slug = (value as Record<string, unknown>).slug;
    if (typeof slug === "string" && slug.trim()) return slug.trim();
  }
  return null;
}

/** Scan entry folders for distinct values of a URL/index param (e.g. category.slug). */
export function observeParamValues(
  contentPath: string,
  contentType: string,
  config: ContentTypeConfig,
  param: string,
): string[] {
  const dir = path.join(contentPath, getDirectory(contentType, config));
  if (!fs.existsSync(dir)) return [];
  const seen = new Set<string>();
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith("_")) continue;
    const candidates = [
      path.join(dir, entry.name, "_common.yml"),
      path.join(dir, entry.name, "en.yml"),
      path.join(dir, entry.name, "es.yml"),
    ];
    for (const file of candidates) {
      if (!fs.existsSync(file)) continue;
      try {
        const data = safeLoad(fs.readFileSync(file, "utf-8")) as Record<string, unknown> | null;
        if (!data) continue;
        const slug = extractParamSlug(data[param]);
        if (slug) seen.add(slug);
      } catch {
        /* skip */
      }
    }
  }
  return [...seen].sort();
}

export function collectProposedUrlParamValues(
  common: Record<string, unknown>,
  locales: Record<string, Record<string, unknown>>,
  params: string[],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const param of params) {
    const fromCommon = extractParamSlug(common[param]);
    if (fromCommon) {
      out[param] = fromCommon;
      continue;
    }
    for (const locData of Object.values(locales)) {
      const v = extractParamSlug(locData[param]);
      if (v) {
        out[param] = v;
        break;
      }
    }
  }
  return out;
}

export function missingRequiredFields(
  config: ContentTypeConfig,
  common: Record<string, unknown>,
  localePayload: Record<string, unknown>,
): string[] {
  const missing: string[] = [];
  for (const field of requiredEditorFields(config)) {
    const val = localePayload[field] ?? common[field];
    if (val === undefined || val === null || val === "") {
      missing.push(field);
      continue;
    }
    if (typeof val === "string" && !val.trim()) missing.push(field);
  }
  return [...new Set(missing)];
}

export function siteFailResult(
  errorJson: string,
  tool?: string,
  retryArgs?: Record<string, unknown>,
): McpTextResult {
  let parsed: {
    error?: string;
    message?: string;
    available_sites?: string[];
  };
  try {
    parsed = JSON.parse(errorJson) as typeof parsed;
  } catch {
    return actionRequired(
      { success: false, action_required: "site_required", message: errorJson },
      [{ tool: "list_sites", reason: "List configured site domains", priority: "required" }],
    );
  }
  const sites = parsed.available_sites ?? [];
  const hintSite = sites[0];
  const next: NextAction[] = [
    {
      tool: "list_sites",
      reason: "List configured domains and content folders",
      priority: "required",
    },
  ];
  if (tool && hintSite) {
    next.push({
      tool,
      reason: `Retry with site: "${hintSite}"`,
      priority: "required",
      args_hint: { ...(retryArgs || {}), site: hintSite },
    });
  }
  return actionRequired(
    {
      success: false,
      action_required: parsed.error || "multi_site_domain_required",
      message:
        (parsed.message || "Pass the site parameter (domain).") +
        " " +
        MULTI_SITE_TOOL_BLURB,
      available_sites: sites,
    },
    next,
  );
}

export function bodyModelForConfig(config: ContentTypeConfig): string {
  if (isSharedLayoutConfig(config)) {
    return "locale_fields_plus_shared_single";
  }
  return "sections_owned";
}

export function createViaForConfig(config: ContentTypeConfig): "create_entry" | null {
  return isDbBacked(config) ? null : "create_entry";
}
