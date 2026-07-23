/**
 * Shared-layout detection and next_actions builders for MCP page tools.
 */

import fs from "fs";
import path from "path";
import type { ContentTypeConfig } from "./content.js";
import { getDirectory, loadContentTypes, isDbBacked } from "./content.js";
import type { NextAction, McpSideEffect, McpWarning } from "./respond.js";

export type LayoutTarget = "auto" | "entry" | "type_single";

/** Versioning API slug: attached shared-layout → `single`; else entry slug. */
export function versioningApiSlug(
  contentType: string,
  entrySlug: string,
  contentPath?: string,
): string {
  const config = getContentTypeConfig(contentType, contentPath);
  if (!isSharedLayoutType(config)) return entrySlug;
  const typeDir = getDirectory(contentType, config!);
  const commonPath = path.join(contentPath || "", typeDir, entrySlug, "_common.yml");
  if (fs.existsSync(commonPath)) {
    try {
      const raw = fs.readFileSync(commonPath, "utf-8");
      if (/^\s*detached:\s*true\s*$/m.test(raw)) return entrySlug;
    } catch { /* ignore */ }
  }
  return "single";
}

export function getContentTypeConfig(
  contentType: string,
  contentPath?: string,
): ContentTypeConfig | null {
  const configs = loadContentTypes(contentPath);
  return configs[contentType] ?? null;
}

/** Sibling locales that have single.{locale}.yml under the type directory. */
export function listSiblingSingleLocales(
  contentType: string,
  sourceLocale: string,
  contentPath: string,
  config: ContentTypeConfig,
): string[] {
  const typeDir = path.join(contentPath, getDirectory(contentType, config));
  if (!fs.existsSync(typeDir)) return [];
  const locales: string[] = [];
  for (const name of fs.readdirSync(typeDir)) {
    const m = /^single\.([a-z]{2}(?:-[a-z]+)?)\.yml$/i.exec(name);
    if (!m) continue;
    if (m[1] === sourceLocale) continue;
    locales.push(m[1]);
  }
  return locales;
}

/** Sibling entry locale yml files for the same slug (excluding source). */
export function listSiblingEntryLocales(
  contentType: string,
  slug: string,
  sourceLocale: string,
  contentPath: string,
  config: ContentTypeConfig,
): string[] {
  const entryDir = path.join(contentPath, getDirectory(contentType, config), slug);
  if (!fs.existsSync(entryDir)) return [];
  const locales: string[] = [];
  for (const name of fs.readdirSync(entryDir)) {
    const m = /^([a-z]{2}(?:-[a-z]+)?)\.ya?ml$/i.exec(name);
    if (!m) continue;
    if (m[1] === sourceLocale) continue;
    if (name.startsWith("_") || name.includes(".")) {
      // skip versioning.yml etc. — locale files are exactly xx.yml
      if (name.split(".").length !== 2) continue;
    }
    locales.push(m[1]);
  }
  return locales;
}

export function pathForLayoutTarget(opts: {
  contentPath: string;
  contentType: string;
  config: ContentTypeConfig;
  slug: string;
  locale: string;
  layoutTarget: "entry" | "type_single";
  variant?: string;
}): { filePath: string; relativeHint: string; layer: "entry_locale" | "type_single" | "variant" } {
  const typeDir = getDirectory(opts.contentType, opts.config);
  if (opts.layoutTarget === "type_single") {
    const fileName = opts.variant
      ? `single.${opts.variant}.${opts.locale}.yml`
      : `single.${opts.locale}.yml`;
    return {
      filePath: path.join(opts.contentPath, typeDir, fileName),
      relativeHint: `${typeDir}/${fileName}`,
      layer: opts.variant ? "variant" : "type_single",
    };
  }
  if (opts.variant) {
    const fileName = `${opts.variant}.${opts.locale}.yml`;
    return {
      filePath: path.join(opts.contentPath, typeDir, opts.slug, fileName),
      relativeHint: `${typeDir}/${opts.slug}/${fileName}`,
      layer: "variant",
    };
  }
  const fileName = `${opts.locale}.yml`;
  return {
    filePath: path.join(opts.contentPath, typeDir, opts.slug, fileName),
    relativeHint: `${typeDir}/${opts.slug}/${fileName}`,
    layer: "entry_locale",
  };
}

export function confirmLayoutTargetPayload(opts: {
  contentType: string;
  slug: string;
  locale: string;
  tool: string;
}): Record<string, unknown> {
  return {
    action_required: "confirm_layout_target",
    message:
      `Content type '${opts.contentType}' uses a shared layout. This edit may change single.${opts.locale}.yml (all entries) or only this entry overlay. Re-call with layout_target set.`,
    options: [
      `layout_target: "type_single" — write the shared single.${opts.locale}.yml (affects all attached entries in this locale)`,
      `Detach the entry first if you need a custom section tree, then edit as a standalone page`,
    ],
    detected: {
      contentType: opts.contentType,
      shared_layout: true,
      slug: opts.slug,
      locale: opts.locale,
    },
  };
}

/** Required sibling sync next_actions for a structural tool on type_single. */
export function siblingSingleStructuralActions(opts: {
  tool: string;
  contentType: string;
  sourceLocale: string;
  siblingLocales: string[];
  reasonPrefix: string;
  argsHintBase: Record<string, unknown>;
}): NextAction[] {
  return opts.siblingLocales.map((loc) => ({
    tool: opts.tool,
    priority: "required" as const,
    reason:
      `${opts.reasonPrefix} Replicate allowlisted structure only to single.${loc}.yml — do NOT copy marketing copy. Blast radius: every ${opts.contentType} entry uses this template.`,
    args_hint: {
      ...opts.argsHintBase,
      contentType: opts.contentType,
      slug: "single",
      locale: loc,
      layout_target: "type_single",
      confirm_layout_target: true,
    },
  }));
}

export function sharedTemplateBlastSideEffect(contentType: string, locale: string): McpSideEffect {
  return {
    kind: "shared_template_blast_radius",
    summary: `This is the shared layout for content type '${contentType}'. All ${contentType} entries in locale '${locale}' render sections from single.${locale}.yml — not a single post.`,
  };
}

export function localeSiblingSyncSideEffect(summary: string): McpSideEffect {
  return {
    kind: "locale_sibling_sync",
    summary,
  };
}

export const BATCH_BINDING_WARNING: McpWarning = {
  code: "batch_update_no_binding_propagate",
  message:
    "batch_update_fields does not propagate section bindings. Only this page was patched. For bound sections, re-apply the same field changes with update_section_field / update_section_fields (single-section live edits) so server binding propagate runs, or manually update each bound sibling.",
};

export const ADD_SECTION_NO_BINDING_FANOUT: McpWarning = {
  code: "add_section_no_binding_fanout",
  message:
    "add_section only wrote this page. It does not add the section to other pages in any section-binding group. Bindings sync content on live field updates for members that already share a section_id — they do not auto-create topology on siblings.",
};

export const REMOVE_SECTION_NO_BINDING_FANOUT: McpWarning = {
  code: "remove_section_no_binding_fanout",
  message:
    "remove_section only removed the section on this page. Bound sibling pages still have this section_id until you remove it there (or clean bindings).",
};

export const REPLACE_NO_BINDING_FANOUT: McpWarning = {
  code: "replace_page_sections_no_binding_fanout",
  message:
    "Full sections replace applied to this page only. Section bindings were not synced. Do not use replace_page_sections to propagate bound content — edit live fields (or update_section) so server binding propagate runs.",
};

export const REORDER_NO_BINDING_FANOUT: McpWarning = {
  code: "reorder_sections_no_binding_fanout",
  message:
    "reorder_sections only changed order on this page. Bound siblings keep their own section order; bindings sync content fields, not topology order.",
};

export const CREATE_PAGE_SHARED_LAYOUT_WARNING: McpWarning = {
  code: "create_page_shared_layout_inherits_single",
  message:
    "This content type uses a shared layout. The new entry does not own the full section shell — structure comes from single.{locale}.yml. Prefer empty or patch-shaped sections in locale files. Editing shared structure later requires layout_target on section tools and affects all entries.",
};

/** Extend ContentTypeConfig typing for single_template without changing loaders. */
export function configIsSharedLayout(config: ContentTypeConfig): boolean {
  return isSharedLayoutType(config) || isDbBacked(config);
}
