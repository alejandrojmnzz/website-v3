/**
 * FAQ Component Schemas - v1.0
 */
import { z } from "zod";

export const relatedFeaturesEnum = z.enum([
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
]);

export type RelatedFeature = z.infer<typeof relatedFeaturesEnum>;

export const faqItemSchema = z.object({
  question: z.string(),
  answer: z.string(),
  locations: z.array(z.string()).optional().default(["all"]),
  related_features: z.array(relatedFeaturesEnum).optional().default([]),
  priority: z.number().int().optional().default(0),
}).refine(
  (data) => {
    const tagCount = data.related_features?.length || 0;
    return tagCount <= 2;
  },
  {
    message: "FAQs should have at most 2 tags (1 tag preferred, 2 only in extraordinary cases). 3+ tags are not allowed.",
    path: ["related_features"],
  }
);

export const faqItemOverrideSchema = z.object({
  hideOnLocations: z.array(z.string()).optional(),
});

export const faqSectionSchema = z
  .object({
    type: z.literal("faq"),
    title: z.string(),
    items: z.array(faqItemSchema).optional(),
    related_features: z.array(relatedFeaturesEnum).optional(),
    item_overrides: z.record(z.string(), faqItemOverrideSchema).optional(),
    cta: z
      .object({
        text: z.string().optional(),
        button: z
          .object({
            label: z.string(),
            url: z.string(),
          })
          .optional(),
      })
      .optional(),
  })
  .refine(
    (data) => (data.related_features?.length ?? 0) <= 3,
    {
      message: "FAQ section may have at most 3 topics selected.",
      path: ["related_features"],
    }
  );

export const centralizedFaqsSchema = z.object({
  faqs: z.array(faqItemSchema),
});

export type FaqItem = z.infer<typeof faqItemSchema>;
export type FAQ = FaqItem;
export type FaqItemOverride = z.infer<typeof faqItemOverrideSchema>;
export type FaqSection = z.infer<typeof faqSectionSchema>;
export type CentralizedFaqs = z.infer<typeof centralizedFaqsSchema>;
