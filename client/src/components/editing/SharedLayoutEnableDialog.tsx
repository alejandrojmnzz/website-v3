import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AlertTriangle } from "lucide-react";

export interface SharedLayoutDivergence {
  locale: string;
  sectionCount: number;
  sectionIds: string[];
}

export interface SharedLayoutBindingSummary {
  id: string;
  name?: string;
  component: string;
  locale: string;
  memberCount: number;
  members: Array<{ contentType: string; slug: string; sectionId: string }>;
}

interface SharedLayoutEnableDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (baseLocale: string) => void;
  locales: string[];
  divergences: SharedLayoutDivergence[];
  /** Binding groups that will be dissolved when shared layout is enabled. */
  bindings?: SharedLayoutBindingSummary[];
  isLoading?: boolean;
}

export function SharedLayoutEnableDialog({
  open,
  onClose,
  onConfirm,
  locales,
  divergences,
  bindings = [],
  isLoading = false,
}: SharedLayoutEnableDialogProps) {
  const defaultLocale = locales.includes("en") ? "en" : locales[0] || "en";
  const [baseLocale, setBaseLocale] = useState(defaultLocale);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !isLoading) onClose(); }}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            Enable shared layout
          </DialogTitle>
          <DialogDescription>
            Pick which locale is the structural base. Sibling locale singles will be aligned to
            that structure. Content differences stay on each locale or as entry overlays.
            {bindings.length > 0
              ? " Section bindings cannot be used with shared layout and will be removed."
              : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="shared-layout-base-locale">Base locale</Label>
            <Select value={baseLocale} onValueChange={setBaseLocale}>
              <SelectTrigger id="shared-layout-base-locale" data-testid="select-shared-layout-base">
                <SelectValue placeholder="Select locale" />
              </SelectTrigger>
              <SelectContent>
                {locales.map((loc) => (
                  <SelectItem key={loc} value={loc}>
                    {loc}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {divergences.length > 0 && (
            <div className="rounded-md border border-border p-3 space-y-2">
              <p className="text-sm font-medium text-foreground">Current locale differences</p>
              <ul className="text-xs text-muted-foreground space-y-1 max-h-40 overflow-y-auto">
                {divergences.map((d) => (
                  <li key={d.locale} data-testid={`divergence-row-${d.locale}`}>
                    <strong className="text-foreground">{d.locale}</strong>: {d.sectionCount}{" "}
                    section{d.sectionCount === 1 ? "" : "s"}
                    {d.sectionIds.length > 0
                      ? ` (${d.sectionIds.slice(0, 6).join(", ")}${d.sectionIds.length > 6 ? "…" : ""})`
                      : ""}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {bindings.length > 0 && (
            <div
              className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 space-y-2"
              data-testid="shared-layout-bindings-warning"
            >
              <p className="text-sm font-medium text-foreground">
                {bindings.length} section binding{bindings.length === 1 ? "" : "s"} will be removed
              </p>
              <p className="text-xs text-muted-foreground">
                Shared layout and section bindings do not mix. Confirming dissolves these binding
                groups for this content type.
              </p>
              <ul className="text-xs text-muted-foreground space-y-1.5 max-h-40 overflow-y-auto">
                {bindings.map((b) => (
                  <li key={b.id} data-testid={`binding-row-${b.id}`}>
                    <strong className="text-foreground">
                      {b.name || b.component}
                    </strong>{" "}
                    ({b.locale}) — {b.memberCount} page{b.memberCount === 1 ? "" : "s"}:{" "}
                    {b.members
                      .slice(0, 4)
                      .map((m) => `${m.slug}#${m.sectionId}`)
                      .join(", ")}
                    {b.members.length > 4 ? "…" : ""}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-end">
          <Button
            variant="ghost"
            onClick={onClose}
            disabled={isLoading}
            data-testid="button-shared-layout-enable-cancel"
          >
            Cancel
          </Button>
          <Button
            onClick={() => onConfirm(baseLocale)}
            disabled={isLoading || !baseLocale}
            data-testid="button-shared-layout-enable-confirm"
          >
            {isLoading
              ? "Enabling…"
              : bindings.length > 0
                ? "Enable and remove bindings"
                : "Enable shared layout"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
