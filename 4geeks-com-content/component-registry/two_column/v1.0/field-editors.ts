export type EditorType = string;

export const fieldEditors: Record<string, EditorType> = {
  "left.image": "image-with-style-picker",
  "right.image": "image-with-style-picker",
  "left.bullets[].icon": "icon-picker",
  "right.bullets[].icon": "icon-picker",
  "left.bullet_icon": "icon-picker",
  "right.bullet_icon": "icon-picker",
  "benefit_items[].icon": "icon-picker",
  "cta_button.text": "text-input",
  "cta_button.url": "link-picker",
  "cta_button.variant": "string-picker:primary,secondary,outline",
  "cta_button.icon": "icon-picker",
};
