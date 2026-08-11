import type { SchemaComponentContributor } from "./types";

/**
 * Contributes article body text so collectSectionSchemas can emit one unified
 * Article / BlogPosting document (see article-bodies kind).
 */
export const contributeArticle: SchemaComponentContributor = (section) => {
  const content = typeof section.content === "string" ? section.content.trim() : "";
  if (!content) return [];
  return [{ kind: "article-bodies", bodies: [content] }];
};
