import { useState } from "react";
import { IconPlus, IconUser, IconUsers } from "@tabler/icons-react";
import { useEditModeOptional } from "@/contexts/EditModeContext";
import ComponentPickerModal from "./ComponentPickerModal";
import { SpacingControlPopover } from "./SpacingControlPopover";
import type { Section } from "@shared/schema";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface AddSectionButtonProps {
  insertIndex: number;
  sections?: Section[];
  contentType?: string;
  slug?: string;
  locale?: string;
  variant?: string;
  version?: number;
  isSharedTemplate?: boolean;
  singleEntry?: Record<string, unknown>;
}

export function AddSectionButton({
  insertIndex,
  sections = [],
  contentType,
  slug,
  locale,
  variant,
  version,
  isSharedTemplate,
  singleEntry,
}: AddSectionButtonProps) {
  const editMode = useEditModeOptional();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [scopeDialogOpen, setScopeDialogOpen] = useState(false);
  const [addScope, setAddScope] = useState<"entry" | "template" | undefined>(undefined);

  if (!editMode || !editMode.isEditMode) {
    return null;
  }

  const handleOpenModal = () => {
    if (isSharedTemplate && singleEntry && !variant) {
      setScopeDialogOpen(true);
    } else {
      setIsModalOpen(true);
    }
  };

  const handleScopeChoice = (scope: "entry" | "template") => {
    setAddScope(scope);
    setScopeDialogOpen(false);
    setIsModalOpen(true);
  };

  const handleCloseScope = () => {
    setScopeDialogOpen(false);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setAddScope(undefined);
  };

  const typeLabel = contentType
    ? contentType.replace(/_/g, " ").replace(/s$/, "")
    : "entry";

  return (
    <>
      <div
        className="relative h-0 group z-30"
        data-testid={`add-section-zone-${insertIndex}`}
      >
        <div className="absolute inset-x-0 top-0 -translate-y-1/2 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-200">
          <div className="flex-1 h-px bg-primary/40" />
          <div className="mx-3 flex items-center gap-2">
            <button
              onClick={handleOpenModal}
              className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-full border border-dashed border-primary text-primary bg-background shadow-sm hover:bg-primary/10 hover:px-4 hover:py-2 hover:gap-2 transition-all duration-200"
              data-testid={`button-add-section-${insertIndex}`}
            >
              <IconPlus size={16} />
              <span className="text-xs font-medium">Add</span>
            </button>
            <SpacingControlPopover
              insertIndex={insertIndex}
              sections={sections}
              contentType={contentType}
              slug={slug}
              locale={locale}
              variant={variant}
              version={version}
            />
          </div>
          <div className="flex-1 h-px bg-primary/40" />
        </div>
      </div>

      <Dialog open={scopeDialogOpen} onOpenChange={(open) => { if (!open) handleCloseScope(); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Where should this section appear?</DialogTitle>
            <DialogDescription>
              This page uses a shared template. Choose whether the new section
              should apply only to this {typeLabel}, or to every {typeLabel} of
              this type.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2 pt-1">
            <Button
              variant="outline"
              className="w-full justify-start gap-2"
              data-testid="button-scope-this-entry"
              onClick={() => handleScopeChoice("entry")}
            >
              <IconUser size={16} className="shrink-0" />
              This {typeLabel} only
            </Button>
            <Button
              variant="outline"
              className="w-full justify-start gap-2"
              data-testid="button-scope-all-entries"
              onClick={() => handleScopeChoice("template")}
            >
              <IconUsers size={16} className="shrink-0" />
              All {typeLabel}s — shared template
            </Button>
            <Button
              variant="ghost"
              className="w-full"
              onClick={handleCloseScope}
            >
              Cancel
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {isModalOpen && (
        <ComponentPickerModal
          isOpen={isModalOpen}
          onClose={handleCloseModal}
          insertIndex={insertIndex}
          sections={sections}
          contentType={contentType}
          slug={slug}
          locale={locale}
          variant={variant}
          version={version}
          isSharedTemplate={isSharedTemplate}
          singleEntry={singleEntry}
          addScope={addScope}
        />
      )}
    </>
  );
}
