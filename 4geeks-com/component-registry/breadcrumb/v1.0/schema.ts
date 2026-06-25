import { z } from "zod";

export const breadcrumbItemSchema = z.object({
  label: z.string().min(1),
  url: z.string().optional(),
});

export const breadcrumbSectionSchema = z.object({
  type: z.literal("breadcrumb"),
  items: z.array(breadcrumbItemSchema).min(1),
});

export type BreadcrumbItem = z.infer<typeof breadcrumbItemSchema>;
export type BreadcrumbSection = z.infer<typeof breadcrumbSectionSchema>;
