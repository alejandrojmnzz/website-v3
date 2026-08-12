/**
 * Schema.org section — Props card with curated @type picker + live JSON-LD preview.
 * Properties remain editable in the Code tab.
 */
export type EditorType = string;

export const fieldEditors: Record<string, EditorType> = {
  schema_type: "schema-org-section-editor",
};
