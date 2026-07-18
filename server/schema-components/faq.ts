import { resolveFaqItems, type FaqSection } from "../ssr-schema";
import type { SchemaComponentContributor } from "./types";

/**
 * Contributes the section's resolved question/answer pairs. All FAQ sections on
 * a page accumulate into a single deduped FAQPage document (see `collectSectionSchemas`).
 */
export const contributeFaq: SchemaComponentContributor = (section, context) => {
  const items = resolveFaqItems(
    section as unknown as FaqSection,
    context.locale,
    context.locationSlug,
    context.programSlug,
    context.contentRoot,
  );
  if (items.length === 0) return [];
  return [{ kind: "faq-items", items }];
};
