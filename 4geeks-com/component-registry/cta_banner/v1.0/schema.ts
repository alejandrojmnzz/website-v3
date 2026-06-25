/**
 * CTA Banner Component Schemas - v1.0
 */
import { z } from "zod";
import { ctaButtonSchema, leadFormDataSchema } from "../../_common/schema";

// Base schema with common fields
const ctaBannerBaseSchema = z.object({
  type: z.literal("cta_banner"),
  version: z.string().optional(),
  title: z.string().optional(),
  subtitle: z.string().optional(),
  background: z.string().optional(),
});

// Default variant: shows message + buttons on all screen sizes
export const ctaBannerDefaultSchema = ctaBannerBaseSchema.extend({
  variant: z.literal("default").optional(),
  cta_text: z.string().optional(),
  cta_url: z.string().optional(),
  buttons: z.array(ctaButtonSchema).optional(),
}).refine(
  (data) => (data.cta_text && data.cta_url) || (data.buttons && data.buttons.length > 0),
  { message: "Either cta_text/cta_url or buttons array must be provided for default variant" }
);

// Form variant: shows form on all screen sizes
// Desktop: message on left, form on right
// Mobile: stacked layout (message above, form below)
export const ctaBannerFormSchema = ctaBannerBaseSchema.extend({
  variant: z.literal("form"),
  form: leadFormDataSchema,
  form_background: z.string().optional(),
  terms_color: z.string().optional(),
});

// Unified schema supporting both variants
export const ctaBannerSectionSchema = z.discriminatedUnion("variant", [
  ctaBannerDefaultSchema.innerType().extend({ variant: z.literal("default") }),
  ctaBannerFormSchema,
]).or(
  // Backward compatibility: treat sections without variant as "default"
  ctaBannerDefaultSchema
);

export type CtaBannerDefault = z.infer<typeof ctaBannerDefaultSchema>;
export type CtaBannerForm = z.infer<typeof ctaBannerFormSchema>;
export type CtaBannerSection = z.infer<typeof ctaBannerSectionSchema>;
