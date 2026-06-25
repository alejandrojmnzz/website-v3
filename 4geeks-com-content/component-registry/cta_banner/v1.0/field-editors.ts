/**
 * Field Editor Configuration for CTA Banner Component
 * 
 * Defines which fields in this component should use special editors
 * in the Props tab of the section editor panel.
 * 
 * Note: The 'variant' field is handled directly in SectionEditorPanel.tsx
 * with a dedicated VariantPicker component for cta_banner sections.
 * 
 * EditorType options: "icon-picker" | "color-picker" | "image-picker" | "link-picker" | "variant-picker" | "rich-text-editor"
 */

export type EditorType = "icon-picker" | "color-picker" | "image-picker" | "link-picker" | "variant-picker" | "rich-text-editor" | "form-settings";

export const fieldEditors: Record<string, EditorType> = {
  "form_background": "color-picker",
  "terms_color": "color-picker",
  "buttons[].button_variant": "variant-picker",
  "buttons[].text_color": "color-picker:text" as EditorType,
  "buttons[].url": "link-picker",
  "cta_url": "link-picker",
  "form": "form-settings",
};
