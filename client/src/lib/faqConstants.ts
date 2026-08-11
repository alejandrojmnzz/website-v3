import { resolveSingleTemplateValue } from "@shared/json-field";
import {
  faqItemKey,
  normalizeFaqEntries,
  applyFaqHideOnLocations,
} from "@shared/faq-listing";

export { faqItemKey, normalizeFaqEntries, applyFaqHideOnLocations };

export type RelatedFeature =
  | "online-platform"
  | "mentors-and-teachers"
  | "price"
  | "career-support"
  | "content-and-syllabus"
  | "job-guarantee"
  | "full-stack"
  | "cybersecurity"
  | "data-science"
  | "applied-ai"
  | "ai-engineering"
  | "outcomes"
  | "scholarships"
  | "rigobot"
  | "learnpack"
  | "certification";

export const AVAILABLE_RELATED_FEATURES: RelatedFeature[] = [
  "online-platform",
  "mentors-and-teachers",
  "price",
  "career-support",
  "content-and-syllabus",
  "job-guarantee",
  "full-stack",
  "cybersecurity",
  "data-science",
  "applied-ai",
  "ai-engineering",
  "outcomes",
  "scholarships",
  "rigobot",
  "learnpack",
  "certification",
];

export const MAX_RELATED_FEATURES = 2;

/** Max topics selectable for an FAQ section block in the editor (per-FAQ items stay at MAX_RELATED_FEATURES). */
export const MAX_FAQ_SECTION_TOPICS = 3;

export interface FaqItem {
  locale?: string;
  question: string;
  answer: string;
  locations?: string[];
  related_features?: string[];
  last_updated?: string;
  priority?: number;
}

export interface SimpleFaq {
  question: string;
  answer: string;
}

export function filterFaqsByRelatedFeatures(
  faqs: FaqItem[],
  options: {
    relatedFeatures?: string[];
    location?: string;
    limit?: number;
    programSlug?: string;
  } = {}
): SimpleFaq[] {
  const { relatedFeatures, location, limit, programSlug } = options;
  let filtered = [...faqs];

  if (location) {
    // On location page: show only FAQs for this specific location
    filtered = filtered.filter((faq) => {
      return faq.locations?.includes(location);
    });
  } else {
    // On general page: only show "all" FAQs, exclude location-specific ones
    filtered = filtered.filter((faq) => {
      const locations = faq.locations || ["all"];
      return locations.includes("all") || locations.length === 0;
    });
  }

  if (relatedFeatures && relatedFeatures.length > 0) {
    filtered = filtered.filter((faq) => {
      const faqFeatures = faq.related_features || [];
      return relatedFeatures.some((feature) => faqFeatures.includes(feature));
    });
  }

  if (relatedFeatures && relatedFeatures.length > 0) {
    filtered = filtered.sort((a, b) => {
      const aFeatures = a.related_features || [];
      const bFeatures = b.related_features || [];
      const aMatchCount = relatedFeatures.filter((f) => aFeatures.includes(f)).length;
      const bMatchCount = relatedFeatures.filter((f) => bFeatures.includes(f)).length;

      // Prioritize FAQs that have the programSlug tag when programSlug is provided and in selected topics
      const shouldPrioritizeProgram = programSlug && relatedFeatures.includes(programSlug);
      if (shouldPrioritizeProgram) {
        const aHasProgram = aFeatures.includes(programSlug);
        const bHasProgram = bFeatures.includes(programSlug);
        if (aHasProgram !== bHasProgram) {
          return aHasProgram ? -1 : 1; // FAQs with programSlug come first (lower sort value)
        }
      }

      if (bMatchCount !== aMatchCount) {
        return bMatchCount - aMatchCount;
      }
      return (a.priority ?? 2) - (b.priority ?? 2);
    });
  } else {
    filtered = filtered.sort((a, b) => (a.priority ?? 2) - (b.priority ?? 2));
  }

  if (limit !== undefined && limit > 0) {
    filtered = filtered.slice(0, limit);
  }

  return filtered.map(({ question, answer }) => ({ question, answer }));
}

/**
 * Resolve `hardcoded_entries` when it is still a `{{ single.* }}` bind, then normalize.
 * Literal arrays pass through unchanged.
 */
export function resolveFaqHardcodedEntries(
  raw: unknown,
  singleEntry?: Record<string, unknown> | null,
): SimpleFaq[] {
  const resolved = resolveSingleTemplateValue(raw, singleEntry ?? {});
  return normalizeFaqEntries(resolved);
}

/**
 * Resolve `dynamic_entries.search` when it is still a `{{ single.* }}` bind.
 */
export function resolveFaqSearchPhrase(
  raw: unknown,
  singleEntry?: Record<string, unknown> | null,
): string {
  const resolved = resolveSingleTemplateValue(raw, singleEntry ?? {});
  return typeof resolved === "string" ? resolved.trim() : "";
}
