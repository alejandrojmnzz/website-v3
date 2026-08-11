/**
 * Hints for multi-article pages (always one logical article).
 *
 * Runtime keys off article count + page order — not a share choice.
 * TOC chrome / reading time / meta: first article only (desktop side TOC may
 * still appear on later parts). See explain_site topic "sections".
 */

import { estimateReadingMinutes } from "@shared/reading-time";
import type { McpWarning, NextAction } from "./respond.js";

export const ARTICLE_SPLIT_ALWAYS_SHARE: McpWarning = {
  code: "article_split_always_share",
  message:
    "This page has multiple article sections — they always continue one piece. " +
    "TOC on/off = first article's show_toc only. Reading time and meta appear only on the first article " +
    "(combined bodies). Mobile/top TOC only on the first; desktop side TOC may still appear on later parts. " +
    "Put the lead article first. toc_group is optional/legacy (not a share decision). " +
    "See get_component_variant → article_split_toc_group or explain_site topic 'sections'.",
};

export const ARTICLE_LEAD_TOC_MISCONFIGURED: McpWarning = {
  code: "article_lead_toc_misconfigured",
  message:
    "The first article lacks show_toc: true but a later article has show_toc: true. " +
    "Only the first article's show_toc controls the shared TOC — later show_toc flags are non-effects. " +
    "Set show_toc: true on the first article (sections.N.show_toc).",
};

export const ARTICLE_LEAD_ORDER_SUSPICIOUS: McpWarning = {
  code: "article_lead_order_suspicious",
  message:
    "A later article has substantially more content than the first. " +
    "Put the lead (main) article first in sections order so reading time and the mobile TOC appear at the page start. " +
    "No auto-reorder — move sections manually if needed.",
};

type ArticleEntry = {
  index: number;
  toc_group?: string;
  show_toc?: boolean;
  content: string;
};

function articleEntries(sections: Array<Record<string, unknown>>): ArticleEntry[] {
  return sections
    .map((s, index) => ({
      index,
      type: s.type,
      toc_group: typeof s.toc_group === "string" && s.toc_group ? s.toc_group : undefined,
      show_toc: s.show_toc === true,
      content: typeof s.content === "string" ? s.content : "",
    }))
    .filter((s) => s.type === "article")
    .map(({ index, toc_group, show_toc, content }) => ({
      index,
      toc_group,
      show_toc,
      content,
    }));
}

function stampGroupUpdates(
  articles: ArticleEntry[],
  groupId: string,
): Array<{ field_path: string; value: unknown }> {
  const updates: Array<{ field_path: string; value: unknown }> = [];
  articles.forEach((a, i) => {
    updates.push({ field_path: `sections.${a.index}.toc_group`, value: groupId });
    updates.push({ field_path: `sections.${a.index}.toc_position`, value: "side" });
    if (i === 0) {
      updates.push({ field_path: `sections.${a.index}.show_toc`, value: true });
    }
  });
  return updates;
}

/** One update_fields next_action per section index (MCP rejects multi-section in one call). */
function stampGroupNextActions(opts: {
  articles: ArticleEntry[];
  groupId: string;
  slug: string;
  locale: string;
  reason: string;
}): NextAction[] {
  const updates = stampGroupUpdates(opts.articles, opts.groupId);
  const byIndex = new Map<number, Array<{ field_path: string; value: unknown }>>();
  for (const u of updates) {
    const m = u.field_path.match(/^sections\.(\d+)/);
    if (!m) continue;
    const idx = parseInt(m[1], 10);
    const list = byIndex.get(idx) || [];
    list.push(u);
    byIndex.set(idx, list);
  }
  return [...byIndex.entries()]
    .sort(([a], [b]) => a - b)
    .map(([idx, sectionUpdates]) => ({
      tool: "update_fields",
      priority: "recommended" as const,
      reason: `${opts.reason} (sections.${idx})`,
      args_hint: {
        slug: opts.slug,
        locale: opts.locale,
        updates: sectionUpdates,
        confirm_live_edit: true,
      },
    }));
}

function leadMisconfigWarnings(articles: ArticleEntry[]): McpWarning[] {
  if (articles.length < 2) return [];
  const warnings: McpWarning[] = [];
  const first = articles[0]!;
  const laterHasToc = articles.slice(1).some((a) => a.show_toc);
  if (!first.show_toc && laterHasToc) {
    warnings.push(ARTICLE_LEAD_TOC_MISCONFIGURED);
  }
  const firstMinutes = first.content.trim()
    ? estimateReadingMinutes(first.content)
    : 0;
  for (const later of articles.slice(1)) {
    if (!later.content.trim()) continue;
    const laterMinutes = estimateReadingMinutes(later.content);
    if (laterMinutes > firstMinutes) {
      warnings.push(ARTICLE_LEAD_ORDER_SUSPICIOUS);
      break;
    }
  }
  return warnings;
}

/**
 * Auto-stamp for add_section: when the page already has articles, mutate the new
 * article with toc_group and return sibling field ops so the lead gets show_toc.
 */
export function prepareArticleAddStamp(opts: {
  existingSections: Array<Record<string, unknown>>;
  newSection: Record<string, unknown>;
  insertIndex?: number;
}): {
  section: Record<string, unknown>;
  siblingOps: Array<{ action: "update_field"; path: string; value: unknown }>;
} | null {
  if (opts.newSection.type !== "article") return null;
  const existing = articleEntries(opts.existingSections);
  if (existing.length === 0) return null;

  const groupId =
    (typeof opts.newSection.toc_group === "string" && opts.newSection.toc_group) ||
    existing.find((a) => a.toc_group)?.toc_group ||
    `group_${Math.floor(Math.random() * 1_000_000_000)}`;

  const section = {
    ...opts.newSection,
    toc_group: groupId,
    toc_position:
      opts.newSection.toc_position === "top" || opts.newSection.toc_position === "side"
        ? opts.newSection.toc_position
        : "side",
  };

  const siblingOps: Array<{ action: "update_field"; path: string; value: unknown }> = [];
  for (const a of existing) {
    siblingOps.push({
      action: "update_field",
      path: `sections.${a.index}.toc_group`,
      value: groupId,
    });
    siblingOps.push({
      action: "update_field",
      path: `sections.${a.index}.toc_position`,
      value: "side",
    });
  }
  const first = existing[0]!;
  siblingOps.push({
    action: "update_field",
    path: `sections.${first.index}.show_toc`,
    value: true,
  });

  return { section, siblingOps };
}

/**
 * After adding an article when the page already had articles.
 */
export function hintsAfterAddArticle(opts: {
  existingSections: Array<Record<string, unknown>>;
  newSection: Record<string, unknown>;
  /** Insert index used for add_item; omit means append. */
  insertIndex?: number;
  slug: string;
  locale: string;
}): { warnings: McpWarning[]; next_actions: NextAction[] } {
  if (opts.newSection.type !== "article") {
    return { warnings: [], next_actions: [] };
  }

  const existingArticles = articleEntries(opts.existingSections);
  if (existingArticles.length === 0) {
    return { warnings: [], next_actions: [] };
  }

  const insertAt =
    opts.insertIndex !== undefined && opts.insertIndex >= 0
      ? opts.insertIndex
      : opts.existingSections.length;

  const postArticles: ArticleEntry[] = [];
  for (const a of existingArticles) {
    postArticles.push({
      ...a,
      index: a.index >= insertAt ? a.index + 1 : a.index,
    });
  }
  const newGroup =
    typeof opts.newSection.toc_group === "string" && opts.newSection.toc_group
      ? opts.newSection.toc_group
      : undefined;
  postArticles.push({
    index: insertAt,
    toc_group: newGroup,
    show_toc: opts.newSection.show_toc === true,
    content: typeof opts.newSection.content === "string" ? opts.newSection.content : "",
  });
  postArticles.sort((a, b) => a.index - b.index);

  const preferredGroup =
    newGroup ||
    existingArticles.find((a) => a.toc_group)?.toc_group ||
    `group_${Math.floor(Math.random() * 1_000_000_000)}`;

  const warnings: McpWarning[] = [ARTICLE_SPLIT_ALWAYS_SHARE, ...leadMisconfigWarnings(postArticles)];
  const next_actions: NextAction[] = [];

  const needsStamp =
    !postArticles.every((a) => a.toc_group === preferredGroup) ||
    postArticles[0]?.show_toc !== true;

  if (needsStamp) {
    next_actions.push(
      ...stampGroupNextActions({
        articles: postArticles,
        groupId: preferredGroup,
        slug: opts.slug,
        locale: opts.locale,
        reason:
          "Stamp toc_group on articles and set show_toc: true on the first (lead) article. " +
          "Articles always continue one piece — there is no separate-TOC option. " +
          "Later show_toc flags do not control TOC chrome.",
      }),
    );
  }

  if (warnings.some((w) => w.code === "article_lead_toc_misconfigured") && !needsStamp) {
    next_actions.push({
      tool: "update_fields",
      priority: "recommended",
      reason: "Set show_toc: true on the first article so the shared TOC appears at the page start.",
      args_hint: {
        slug: opts.slug,
        locale: opts.locale,
        updates: [
          { field_path: `sections.${postArticles[0]!.index}.show_toc`, value: true },
        ],
        confirm_live_edit: true,
      },
    });
  }

  next_actions.push({
    tool: "get_component_variant",
    priority: "optional",
    reason: "Read article split-page docs and example article_split_toc_group.",
    args_hint: {
      componentType: "article",
      variant: "default",
    },
  });

  return { warnings, next_actions };
}

/**
 * After replace_entry_sections: educate + warn on lead misconfig / missing stamps.
 */
export function hintsAfterReplaceSections(opts: {
  sections: Array<Record<string, unknown>>;
  slug: string;
  locale: string;
}): { warnings: McpWarning[]; next_actions: NextAction[] } {
  const articles = articleEntries(opts.sections);
  if (articles.length < 2) {
    return { warnings: [], next_actions: [] };
  }

  const preferredGroup =
    articles.find((a) => a.toc_group)?.toc_group ||
    `group_${Math.floor(Math.random() * 1_000_000_000)}`;

  const warnings: McpWarning[] = [ARTICLE_SPLIT_ALWAYS_SHARE, ...leadMisconfigWarnings(articles)];
  const next_actions: NextAction[] = [];

  const needsStamp =
    !articles.every((a) => a.toc_group === preferredGroup) || articles[0]?.show_toc !== true;

  if (needsStamp) {
    next_actions.push(
      ...stampGroupNextActions({
        articles,
        groupId: preferredGroup,
        slug: opts.slug,
        locale: opts.locale,
        reason:
          "Multiple articles always continue one piece. Apply toc_group and show_toc: true on the first article.",
      }),
    );
  }

  return { warnings, next_actions };
}
