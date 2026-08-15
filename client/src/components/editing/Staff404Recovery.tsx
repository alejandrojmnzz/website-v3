import { useEditModeOptional } from "@/contexts/EditModeContext";
import Staff404Layout from "@/components/editing/Staff404Layout";
import type { Staff404Surface } from "@/lib/staff404";

export default function Staff404Recovery({
  alwaysShow = false,
  surface = "public",
  typeLabel = "page",
  slug,
  contentType,
  yamlExists = false,
  onEditYaml,
}: {
  alwaysShow?: boolean;
  surface?: Staff404Surface;
  typeLabel?: string;
  slug?: string;
  contentType?: string;
  yamlExists?: boolean;
  onEditYaml?: () => void;
}) {
  const editMode = useEditModeOptional();
  if (!alwaysShow && !editMode?.isEditMode) return null;

  return (
    <div className="mt-6 w-full" data-testid="staff-404-recovery">
      <Staff404Layout
        surface={surface}
        typeLabel={typeLabel}
        slug={slug}
        contentType={contentType}
        isValidType={surface === "databaseSingle" ? !!contentType : false}
        yamlExists={yamlExists}
        staffOrEditMode
        compact
        onEditYaml={onEditYaml}
      />
    </div>
  );
}
