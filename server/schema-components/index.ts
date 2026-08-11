import { buildFaqPageSchema, dedupeFaqItems } from "../ssr-schema";
import { getOrganizationDocument } from "../schema-org";
import { contributeArticle } from "./article";
import { contributeBreadcrumb } from "./breadcrumb";
import { contributeFaq } from "./faq";
import { contributeSchemaOrg } from "./schema_org";
import type {
  SchemaComponentContext,
  SchemaComponentContributor,
  SchemaContribution,
  SchemaOrgPreviewDocument,
} from "./types";

export type {
  SchemaComponentContext,
  SchemaComponentContributor,
  SchemaContribution,
  SchemaOrgPreviewDocument,
} from "./types";

/**
 * Section types that contribute schema.org JSON-LD during SSR, keyed by
 * section `type`. Add new entries here to make a component schema-aware.
 */
export const schemaComponentContributors: Record<string, SchemaComponentContributor> = {
  faq: contributeFaq,
  breadcrumb: contributeBreadcrumb,
  schema_org: contributeSchemaOrg,
  article: contributeArticle,
};

function stripMarkdownRough(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_~>#-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildArticleDocument(
  bodies: string[],
  context: SchemaComponentContext,
): Record<string, unknown> | null {
  const combined = bodies.map((b) => b.trim()).filter(Boolean).join("\n\n");
  if (!combined) return null;
  const schemaType = context.contentType === "blog" ? "BlogPosting" : "Article";
  const articleBody = stripMarkdownRough(combined).slice(0, 5000);
  const doc: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": schemaType,
    headline: context.title || undefined,
    description: context.description || undefined,
    url: context.pageUrl || undefined,
    datePublished: context.publishedAt || undefined,
    dateModified: context.updatedAt || context.publishedAt || undefined,
    articleBody: articleBody || undefined,
  };
  if (context.image) doc.image = context.image;
  if (context.authorName) {
    doc.author = { "@type": "Person", name: context.authorName };
  }
  if (context.baseUrl) {
    doc.publisher = {
      "@type": "Organization",
      name: "4Geeks Academy",
      url: context.baseUrl,
    };
  }
  // Drop undefined keys
  for (const key of Object.keys(doc)) {
    if (doc[key] === undefined) delete doc[key];
  }
  return doc;
}

export interface CollectSectionSchemasResult {
  documents: Record<string, unknown>[];
  preview: SchemaOrgPreviewDocument[];
}

/**
 * Runs every registered contributor over the page's final (fully merged)
 * sections and merges the contributions into an ordered list of JSON-LD
 * documents:
 *
 * - `document` contributions keep section order and are deduped by key.
 * - `faq-items` accumulate → one FAQPage.
 * - `article-bodies` accumulate → one Article/BlogPosting.
 * - `standalone-organization` dual-emits site Organization once by @id.
 */
export function collectSectionSchemasDetailed(
  sections: Array<Record<string, unknown>>,
  context: SchemaComponentContext,
): CollectSectionSchemasResult {
  const documents: Record<string, unknown>[] = [];
  const preview: SchemaOrgPreviewDocument[] = [];
  const seenDocumentKeys = new Set<string>();
  const faqItems: Array<{ question: string; answer: string }> = [];
  const articleBodies: string[] = [];
  let needOrg = false;
  let orgId: string | undefined;

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
      } else if (contribution.kind === "article-bodies") {
        articleBodies.push(...contribution.bodies);
      } else if (contribution.kind === "standalone-organization") {
        needOrg = true;
        orgId = contribution.organizationId;
      } else {
        const key = contribution.dedupeKey ?? JSON.stringify(contribution.schema);
        if (seenDocumentKeys.has(key)) continue;
        seenDocumentKeys.add(key);
        documents.push(contribution.schema);
        preview.push({
          schema: contribution.schema,
          source: contribution.source ?? "schema_org",
        });
      }
    }
  }

  const articleDoc = buildArticleDocument(articleBodies, context);
  if (articleDoc) {
    documents.push(articleDoc);
    preview.push({ schema: articleDoc, source: "article" });
  }

  const dedupedFaqItems = dedupeFaqItems(faqItems);
  if (dedupedFaqItems.length > 0) {
    const faqDoc = buildFaqPageSchema(dedupedFaqItems);
    documents.push(faqDoc);
    preview.push({ schema: faqDoc, source: "faq" });
  }

  if (needOrg) {
    const orgDoc = getOrganizationDocument(context.locale, context.contentRoot);
    if (orgDoc) {
      const id = (orgDoc["@id"] as string) || orgId || "";
      const already = documents.some((d) => d["@id"] === id && d["@type"]);
      if (!already) {
        documents.push(orgDoc);
        preview.push({ schema: orgDoc, source: "organization" });
      }
    }
  }

  return { documents, preview };
}

export function collectSectionSchemas(
  sections: Array<Record<string, unknown>>,
  context: SchemaComponentContext,
): Record<string, unknown>[] {
  return collectSectionSchemasDetailed(sections, context).documents;
}
