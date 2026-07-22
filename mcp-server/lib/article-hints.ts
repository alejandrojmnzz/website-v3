/**
 * Hints for multi-article pages that should share a TOC via toc_group.
 */

import type { McpWarning, NextAction } from "./respond.js";

export const ARTICLE_TOC_GROUP_SUGGESTED: McpWarning = {
  code: "article_toc_group_suggested",
  message:
    "This page already has one or more article sections. To unify their tables of contents, " +
    "set the same toc_group on every article (e.g. group_123456789), with show_toc: true only on " +
    "the first article in page order and show_toc: false on the rest. See get_component_variant " +
    "for article (example: article_split_toc_group) or explain_site topic 'sections'.",
};

function articleEntries(
  sections: Array<Record<string, unknown>>,
): Array<{ index: number; toc_group?: string }> {
  return sections
    .map((s, index) => ({
      index,
      type: s.type,
      toc_group: typeof s.toc_group === "string" && s.toc_group ? s.toc_group : undefined,
    }))
    .filter((s) => s.type === "article")
    .map(({ index, toc_group }) => ({ index, toc_group }));
}

function allShareGroup(
  articles: Array<{ toc_group?: string }>,
  groupId: string,
): boolean {
  return articles.length > 0 && articles.every((a) => a.toc_group === groupId);
}

/**
 * After adding an article: warn when the page already had articles and TOC
 * grouping is incomplete. Returns post-insert indices for next_actions.
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

  // Post-insert indices for every article (existing shifted + new).
  const postArticles: Array<{ index: number; toc_group?: string }> = [];
  for (const a of existingArticles) {
    postArticles.push({
      index: a.index >= insertAt ? a.index + 1 : a.index,
      toc_group: a.toc_group,
    });
  }
  const newGroup =
    typeof opts.newSection.toc_group === "string" && opts.newSection.toc_group
      ? opts.newSection.toc_group
      : undefined;
  postArticles.push({ index: insertAt, toc_group: newGroup });
  postArticles.sort((a, b) => a.index - b.index);

  const preferredGroup =
    newGroup ||
    existingArticles.find((a) => a.toc_group)?.toc_group ||
    `group_${Math.floor(Math.random() * 1_000_000_000)}`;

  if (allShareGroup(postArticles, preferredGroup)) {
    return { warnings: [], next_actions: [] };
  }

  const fields: Record<string, unknown> = {};
  postArticles.forEach((a, order) => {
    fields[`sections.${a.index}.toc_group`] = preferredGroup;
    fields[`sections.${a.index}.show_toc`] = order === 0;
    if (order === 0) {
      fields[`sections.${a.index}.toc_position`] = "side";
    }
  });

  return {
    warnings: [ARTICLE_TOC_GROUP_SUGGESTED],
    next_actions: [
      {
        tool: "update_section_fields",
        priority: "recommended",
        reason:
          "Ask the user if these articles should share one TOC. If yes, apply the same toc_group " +
          "to all articles (show_toc only on the first). If they should stay separate, ignore this.",
        args_hint: {
          slug: opts.slug,
          locale: opts.locale,
          fields,
          confirm_live_edit: true,
        },
      },
      {
        tool: "get_component_variant",
        priority: "optional",
        reason: "Read article field docs (including toc_group) and a worked YAML example.",
        args_hint: {
          componentType: "article",
          variant: "default",
        },
      },
    ],
  };
}

/**
 * After replace_page_sections: warn when 2+ articles do not all share one toc_group.
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

  if (allShareGroup(articles, preferredGroup)) {
    return { warnings: [], next_actions: [] };
  }

  const fields: Record<string, unknown> = {};
  articles.forEach((a, order) => {
    fields[`sections.${a.index}.toc_group`] = preferredGroup;
    fields[`sections.${a.index}.show_toc`] = order === 0;
    if (order === 0) {
      fields[`sections.${a.index}.toc_position`] = "side";
    }
  });

  return {
    warnings: [ARTICLE_TOC_GROUP_SUGGESTED],
    next_actions: [
      {
        tool: "update_section_fields",
        priority: "recommended",
        reason:
          "Multiple articles on this page do not share one toc_group. Ask the user whether to unify their TOC, then apply these fields if yes.",
        args_hint: {
          slug: opts.slug,
          locale: opts.locale,
          fields,
          confirm_live_edit: true,
        },
      },
    ],
  };
}
