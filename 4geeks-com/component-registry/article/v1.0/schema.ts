/**
 * Article Component Schemas - v1.0
 * 
 * Variants:
 * - default: Full-width article with optional top or side table of contents
 */
import { z } from "zod";

export const articleSectionSchema = z.object({
  type: z.literal("article"),
  variant: z.enum(["default"]).optional(),
  content: z.string().describe("Markdown content for the article body"),
  show_toc: z.boolean().optional().describe("Whether to show the auto-generated table of contents"),
  toc_position: z.enum(["top", "side"]).optional().describe("Position of the table of contents: top (above content) or side (sticky sidebar following scroll)"),
});

export type ArticleSection = z.infer<typeof articleSectionSchema>;
