/**
 * Helpers for sharing a table of contents across multiple article sections
 * on the same page (toc_group / show_toc conventions).
 *
 * Split articles: every member of a toc_group shows the same merged TOC,
 * sticky within that piece's scroll range.
 */

export type ArticleOnPage = { index: number; toc_group?: string };

export function newTocGroupId(): string {
  return `group_${Math.floor(Math.random() * 1_000_000_000)}`;
}

export function listArticlesOnPage(
  sections: Array<Record<string, unknown>>,
): ArticleOnPage[] {
  return sections
    .map((s, index) => ({
      index,
      toc_group:
        typeof s.toc_group === "string" && s.toc_group ? s.toc_group : undefined,
      type: s.type,
    }))
    .filter((s) => s.type === "article")
    .map(({ index, toc_group }) => ({ index, toc_group }));
}

/** Resolve the single shared group for the page (first non-empty), or a new id. */
export function resolveTocGroupId(articles: ArticleOnPage[]): string {
  return articles.find((a) => a.toc_group)?.toc_group ?? newTocGroupId();
}

/**
 * Ops to assign toc_group / show_toc on existing articles before inserting a new one.
 * Every member of the shared group gets show_toc: true (each piece shows the merged TOC).
 */
export function buildSiblingTocGroupOps(
  articles: ArticleOnPage[],
  _insertIndex: number,
  groupId: string,
): {
  ops: Array<{ action: "update_field"; path: string; value: unknown }>;
  newShowToc: boolean;
} {
  const ops = articles.flatMap((a) => [
    {
      action: "update_field" as const,
      path: `sections.${a.index}.toc_group`,
      value: groupId,
    },
    {
      action: "update_field" as const,
      path: `sections.${a.index}.show_toc`,
      value: true,
    },
    {
      action: "update_field" as const,
      path: `sections.${a.index}.toc_position`,
      value: "side",
    },
  ]);

  return { ops, newShowToc: true };
}

/**
 * Ops for siblings when activating TOC on an existing article and choosing to share.
 * Current section is updated locally (not via these ops). All members get show_toc: true
 * so each piece renders the same merged TOC.
 */
export function buildSiblingShareOpsForActivation(
  articles: ArticleOnPage[],
  currentIndex: number,
  groupId: string,
): Array<{ action: "update_field"; path: string; value: unknown }> {
  return articles
    .filter((a) => a.index !== currentIndex)
    .flatMap((a) => [
      {
        action: "update_field" as const,
        path: `sections.${a.index}.toc_group`,
        value: groupId,
      },
      {
        action: "update_field" as const,
        path: `sections.${a.index}.show_toc`,
        value: true,
      },
      {
        action: "update_field" as const,
        path: `sections.${a.index}.toc_position`,
        value: "side",
      },
    ]);
}
