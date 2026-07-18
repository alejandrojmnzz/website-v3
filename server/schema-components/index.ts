import { buildFaqPageSchema, dedupeFaqItems } from "../ssr-schema";
import { contributeBreadcrumb } from "./breadcrumb";
import { contributeFaq } from "./faq";
import type {
  SchemaComponentContext,
  SchemaComponentContributor,
  SchemaContribution,
} from "./types";

export type {
  SchemaComponentContext,
  SchemaComponentContributor,
  SchemaContribution,
} from "./types";

/**
 * Section types that contribute schema.org JSON-LD during SSR, keyed by
 * section `type`. Add new entries here to make a component schema-aware.
 */
export const schemaComponentContributors: Record<string, SchemaComponentContributor> = {
  faq: contributeFaq,
  breadcrumb: contributeBreadcrumb,
};

/**
 * Runs every registered contributor over the page's final (fully merged)
 * sections and merges the contributions into an ordered list of JSON-LD
 * documents:
 *
 * - `document` contributions keep section order and are deduped by key.
 * - `faq-items` contributions accumulate across sections, are deduped by
 *   normalized question, and emit a single trailing FAQPage document.
 *
 * Sections without a registered contributor are ignored, so a page can mix
 * listing components, FAQ sections, and anything else — only schema-aware
 * sections affect the output.
 */
export function collectSectionSchemas(
  sections: Array<Record<string, unknown>>,
  context: SchemaComponentContext,
): Record<string, unknown>[] {
  const documents: Record<string, unknown>[] = [];
  const seenDocumentKeys = new Set<string>();
  const faqItems: Array<{ question: string; answer: string }> = [];

  for (const section of sections) {
    if (!section || typeof section !== "object") continue;
    const contributor = schemaComponentContributors[String(section.type ?? "")];
    if (!contributor) continue;

    let contributions: SchemaContribution[];
    try {
      contributions = contributor(section, context);
    } catch {
      continue;
    }

    for (const contribution of contributions) {
      if (contribution.kind === "faq-items") {
        faqItems.push(...contribution.items);
      } else {
        const key = contribution.dedupeKey ?? JSON.stringify(contribution.schema);
        if (seenDocumentKeys.has(key)) continue;
        seenDocumentKeys.add(key);
        documents.push(contribution.schema);
      }
    }
  }

  const dedupedFaqItems = dedupeFaqItems(faqItems);
  if (dedupedFaqItems.length > 0) {
    documents.push(buildFaqPageSchema(dedupedFaqItems));
  }

  return documents;
}
