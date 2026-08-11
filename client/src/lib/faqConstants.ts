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

export function faqItemKey(question: string | null | undefined): string {
  return String(question ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 80);
}

/**
 * Normalize FAQ entry lists from YAML / template resolution.
 * Unresolved binds like `{{ single.faq_entries | [] }}` stay strings — never spread those.
 */
export function normalizeFaqEntries(value: unknown): SimpleFaq[] {
  if (!Array.isArray(value)) return [];
  const out: SimpleFaq[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    if (typeof row.question !== "string" || typeof row.answer !== "string") continue;
    out.push({ question: row.question, answer: row.answer });
  }
  return out;
}
