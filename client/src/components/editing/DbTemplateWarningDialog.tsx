import { AlertTriangle, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export type DbTemplateOperation = "delete" | "add" | "update";

interface DbTemplateWarningDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  operation: DbTemplateOperation;
  contentType: string;
  isLoading?: boolean;
}

function formatContentType(raw: string): string {
  return raw
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function operationLabel(op: DbTemplateOperation): string {
  switch (op) {
    case "delete": return "Delete section";
    case "add": return "Add section";
    case "update": return "Update section";
  }
}

function operationVerb(op: DbTemplateOperation): string {
  switch (op) {
    case "delete": return "remove it from";
    case "add": return "add it to";
    case "update": return "update it in";
  }
}

function operationExtra(op: DbTemplateOperation): string {
  switch (op) {
    case "delete":
      return " The section is removed from every locale's single template (sibling locales stay in sync).";
    case "add":
      return " The new section is mirrored to sibling locale singles; unfinished locales get a needs-edit label and stay hidden from the public until edited.";
    case "update":
      return " Allowlisted layout and visibility changes sync across locale singles. type/version/variant changes are not auto-replicated — update sibling locales manually.";
  }
}

export function DbTemplateWarningDialog({
  open,
  onClose,
  onConfirm,
  operation,
  contentType,
  isLoading = false,
}: DbTemplateWarningDialogProps) {
  const typeName = formatContentType(contentType);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !isLoading) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            {operationLabel(operation)} — shared template
          </DialogTitle>
          <DialogDescription>
            This change affects the shared template and will apply to{" "}
            <strong>all {typeName} entries</strong> and every locale single template
            on this site. Confirming will {operationVerb(operation)} the template for every{" "}
            {typeName} entry.
            {operationExtra(operation)}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-end">
          <Button
            variant="ghost"
            onClick={onClose}
            disabled={isLoading}
            data-testid="button-db-template-warn-cancel"
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={onConfirm}
            disabled={isLoading}
            data-testid="button-db-template-warn-confirm"
          >
            {isLoading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            Apply to all {typeName} entries
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
