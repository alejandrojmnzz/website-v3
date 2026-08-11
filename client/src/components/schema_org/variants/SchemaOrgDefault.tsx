import { useEditModeOptional } from "@/contexts/EditModeContext";

interface SchemaOrgDefaultProps {
  data: {
    schema_type?: string;
    properties?: Record<string, unknown>;
  };
}

/**
 * Invisible on the public site. In edit mode, shows a compact badge so staff
 * can select / reorder the leading schema.org block.
 */
export default function SchemaOrgDefault({ data }: SchemaOrgDefaultProps) {
  const editMode = useEditModeOptional();
  if (!editMode?.isEditMode) return null;

  const schemaType = data.schema_type || "Schema";
  return (
    <div
      className="border border-dashed border-amber-600/50 bg-amber-950/40 px-4 py-3 text-sm text-amber-100"
      data-testid="schema-org-section-edit"
    >
      <div className="font-medium">Schema.org · {schemaType}</div>
      <p className="mt-1 text-xs text-amber-200/80">
        Edit-mode only. Emits JSON-LD on SSR. Always kept at the top of the section list.
        {(schemaType === "WebSite" || schemaType === "Organization") && (
          <>
            {" "}
            Prefills from site <code className="text-amber-100">schema-org.yml</code>; changes are
            page-local and do not update the site template.
          </>
        )}
      </p>
    </div>
  );
}
