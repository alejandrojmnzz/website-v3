/**
 * Common schemas shared across multiple components
 * These are imported by individual component schemas
 */
import { z } from "zod";

// CTA Button - used in many components
export const ctaButtonSchema = z.object({
  text: z.string(),
  url: z.string(),
  variant: z.enum(["primary", "secondary", "outline"]),
  button_variant: z.string().optional(),
  text_color: z.string().optional(),
  icon: z.string().optional(),
  us_only: z.boolean().optional(),
});

export type CtaButton = z.infer<typeof ctaButtonSchema>;

// Video configuration - used in hero, two_column, etc.
export const videoConfigSchema = z.object({
  url: z.string().optional(),
  ratio: z.string().optional(),
  mobile_ratio: z.string().optional(),
  width: z.string().optional(), // CSS width value e.g., "400px", "100%"
  muted: z.boolean().optional(),
  autoplay: z.boolean().optional(),
  loop: z.boolean().optional(),
  preview_image_url: z.string().optional(),
  with_shadow_border: z.boolean().optional(),
});

export type VideoConfig = z.infer<typeof videoConfigSchema>;

// Backward compatible video input - accepts string URL or full object
// Use normalizeVideoConfig() helper to convert to VideoConfig
export const videoInputSchema = z.union([z.string(), videoConfigSchema]);

export type VideoInput = z.infer<typeof videoInputSchema>;

// Image reference - used in hero, features_grid, etc.
export const imageSchema = z.object({
  src: z.string(),
  alt: z.string(),
});

export type ImageDef = z.infer<typeof imageSchema>;

// Image with CSS properties - for editable image positioning and styling
export const imageWithStyleSchema = z.object({
  src: z.string(),
  alt: z.string().optional(),
  object_fit: z.enum(["cover", "contain", "fill", "none", "scale-down"]).optional(),
  object_position: z.string().optional(), // e.g., "center top", "50% 20%", "left center"
  width: z.string().optional(), // CSS width value
  height: z.string().optional(), // CSS height value
  max_width: z.string().optional(),
  max_height: z.string().optional(),
  border_radius: z.string().optional(), // e.g., "8px", "1rem", "50%"
  opacity: z.number().min(0).max(1).optional(),
  filter: z.string().optional(), // e.g., "grayscale(100%)", "brightness(1.2)"
});

export type ImageWithStyle = z.infer<typeof imageWithStyleSchema>;

// Lead Form field config
export const leadFormFieldConfigSchema = z.object({
  visible: z.boolean().optional(),
  required: z.boolean().optional(),
  default: z.string().optional(),
  default_country: z.string().optional(), // ISO 3166-1 alpha-2 e.g. "ES", "US" – passed to PhoneInput defaultCountry
  helper_text: z.string().optional(),
  placeholder: z.string().optional(),
  show_label: z.boolean().optional(),
  label: z.string().optional(),
  slugs: z.array(z.string()).optional(), // For program field: limits which programs appear in the dropdown
});

// Webhook configuration — used at form-level, per-event, and global tracking level
export const webhookConfigSchema = z.object({
  url: z.string().url(),
  method: z.enum(["POST", "GET"]).default("POST"),
});

export type WebhookConfig = z.infer<typeof webhookConfigSchema>;

// Lead Form data schema
export const leadFormDataSchema = z.object({
  variant: z.enum(["stacked", "inline"]).optional(),
  conversion_name: z.string().optional(), // Tracking event name for conversions
  title: z.string().optional(),
  subtitle: z.string().optional(),
  submit_label: z.string().optional(),
  tags: z.string().optional(),
  automations: z.string().optional(),
  // Form-level webhook — highest priority in the three-level chain
  webhook: webhookConfigSchema.optional(),
  fields: z.object({
    email: leadFormFieldConfigSchema.optional(),
    first_name: leadFormFieldConfigSchema.optional(),
    last_name: leadFormFieldConfigSchema.optional(),
    phone: leadFormFieldConfigSchema.optional(),
    program: leadFormFieldConfigSchema.optional(),
    region: leadFormFieldConfigSchema.optional(),
    location: leadFormFieldConfigSchema.optional(),
    coupon: leadFormFieldConfigSchema.optional(),
    client_comments: leadFormFieldConfigSchema.optional(),
  }).optional(),
  success: z.object({
    url: z.string().optional(),
    message: z.string().optional(),
  }).optional(),
  terms_url: z.string().optional(),
  privacy_url: z.string().optional(),
  consent: z.object({
    email: z.boolean().optional(),
    sms: z.boolean().optional(),
    whatsapp: z.boolean().optional(),
    marketing: z.boolean().optional(),
    marketing_text: z.string().optional(),
    sms_text: z.string().optional(),
    sms_usa_only: z.boolean().optional(),
  }).optional(),
  show_terms: z.boolean().optional(),
  className: z.string().optional(),
  button_className: z.string().optional(),
  terms_className: z.string().optional(),
});

export type LeadFormData = z.infer<typeof leadFormDataSchema>;

// Card item - used in ai_learning, mentorship
export const cardItemSchema = z.object({
  icon: z.string(),
  title: z.string(),
  description: z.string(),
});

export type CardItem = z.infer<typeof cardItemSchema>;

// Stat item - used in certificate, etc.
export const statItemSchema = z.object({
  value: z.string(),
  label: z.string(),
  description: z.string().optional(),
  benefits: z.array(z.object({ text: z.string() })).optional(),
});

export type StatItem = z.infer<typeof statItemSchema>;

// Logo item - used in whos_hiring
export const logoItemSchema = z.object({
  src: z.string(),
  alt: z.string(),
});

export type LogoItem = z.infer<typeof logoItemSchema>;
