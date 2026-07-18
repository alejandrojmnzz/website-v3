/**
 * Schema components: section types that contribute schema.org JSON-LD during SSR.
 *
 * Contributors are plain server-side functions keyed by section `type` — React
 * components and `SectionRenderer` are never involved. Registry `schema.yml`
 * files may carry an advisory `schema_org.handler` field for discovery/docs,
 * but the executable mapping lives in `server/schema-components/index.ts`.
 */

export interface SchemaComponentContext {
  locale: string;
  contentRoot: string;
  baseUrl: string;
  /** Set when rendering a location detail page (enables location-scoped FAQs). */
  locationSlug?: string;
  /** Set when rendering a program detail page (prioritizes program-tagged FAQs). */
  programSlug?: string;
}

export type SchemaContribution =
  /** Accumulated across all FAQ sections on the page, deduped, and emitted as one FAQPage. */
  | { kind: "faq-items"; items: Array<{ question: string; answer: string }> }
  /** A standalone JSON-LD document, deduped by `dedupeKey` (defaults to its JSON serialization). */
  | { kind: "document"; schema: Record<string, unknown>; dedupeKey?: string };

export type SchemaComponentContributor = (
  section: Record<string, unknown>,
  context: SchemaComponentContext,
) => SchemaContribution[];
