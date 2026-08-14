import { useState } from "react";
import { AlertTriangle, ArrowLeftRight, ChevronDown, Loader2, Menu, Pencil, Plus, Trash2 } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEditModeOptional } from "@/contexts/EditModeContext";
import { editCommonContent, editContent } from "@/lib/contentApi";
import { getDebugToken } from "@/hooks/useDebugAuth";
import { apiRequest } from "@/lib/queryClient";
import { useLocation } from "wouter";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

interface MenuSlotPlaceholderProps {
  position: "top" | "bottom";
  currentMenuId: string | null | undefined;
  contentType: string;
  slug: string;
  locale: string;
  onMenuChange?: (menuId: string | null) => void;
  /** Shared-layout page that is still attached to the type template. */
  isSharedTemplate?: boolean;
  /** Shared-layout page that has been detached from the type template. */
  isDetached?: boolean;
}

export default function MenuSlotPlaceholder({
  position,
  currentMenuId,
  contentType,
  slug,
  locale,
  onMenuChange,
  isSharedTemplate,
  isDetached,
}: MenuSlotPlaceholderProps) {
  const editMode = useEditModeOptional();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [isOpen, setIsOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [pendingAction, setPendingAction] = useState<{ menuId: string | null } | null>(null);
  const [detachDialogOpen, setDetachDialogOpen] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const { data: menusData } = useQuery<{ menus: { name: string; file: string }[] }>({
    queryKey: ["/api/menus"],
    queryFn: async () => {
      const response = await fetch("/api/menus");
      if (!response.ok) throw new Error("Failed to load menus");
      return response.json();
    },
    enabled: !!editMode?.isEditMode,
  });

  const menuIds = menusData?.menus?.map((m) => m.name) || [];

  const isRemoving = pendingAction?.menuId === null;
  const actionLabel = isRemoving ? "Remove" : (currentMenuId ? "Change" : "Add");
  const keepLabel = isRemoving || !currentMenuId ? "Keep the menu" : "Keep current menu";

  const menuFieldPath = position === "top" ? "layout.menu.top" : "layout.menu.bottom";

  const applyToAll = async (menuId: string | null) => {
    setIsSaving(true);
    try {
      const body: Record<string, Record<string, string | null>> = {
        menu: { [position]: menuId },
      };
      await apiRequest("PUT", `/api/content-types/${contentType}/layout`, body);
      onMenuChange?.(menuId);
      queryClient.invalidateQueries({ queryKey: ["/api/content-types"] });
      queryClient.invalidateQueries({ queryKey: ["/api/menus"] });
    } catch (err) {
      toast({ title: "Failed to update layout", description: String(err), variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  const applyToDetachedEntry = async (menuId: string | null) => {
    setIsSaving(true);
    try {
      const result = await editContent({
        contentType,
        slug,
        locale,
        operations: [{ action: "update_field", path: menuFieldPath, value: menuId }],
      });
      if (result.success) {
        onMenuChange?.(menuId);
        queryClient.invalidateQueries({ queryKey: ["/api/content-types"] });
        queryClient.invalidateQueries({ queryKey: ["/api/menus"] });
      } else {
        toast({
          title: "Failed to update layout",
          description: result.error || "Unknown error",
          variant: "destructive",
        });
      }
    } catch (err) {
      toast({ title: "Failed to update layout", description: String(err), variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  const handleMenuOptionClick = (menuId: string | null) => {
    setIsOpen(false);
    if (isSharedTemplate) {
      setPendingAction({ menuId });
      setDetachDialogOpen(true);
      setShowAdvanced(false);
    } else if (isDetached) {
      void applyToDetachedEntry(menuId);
    } else {
      setPendingAction({ menuId });
    }
  };

  const handleKeep = () => {
    setDetachDialogOpen(false);
    setPendingAction(null);
    setShowAdvanced(false);
  };

  const handleDetach = async () => {
    setIsSaving(true);
    try {
      const token = getDebugToken();
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Token ${token}`;
      const res = await fetch(`/api/content/${contentType}/${slug}/detach`, {
        method: "POST",
        headers,
        body: "{}",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: data.error || "Failed to detach entry", variant: "destructive" });
        return;
      }
      toast({
        title: "Entry detached",
        description: "This page now owns its own structure. Change the menu again to update it here only.",
      });
      setDetachDialogOpen(false);
      setPendingAction(null);
      setShowAdvanced(false);
      onMenuChange?.(currentMenuId ?? null);
      queryClient.invalidateQueries();
    } catch {
      toast({ title: "Failed to detach entry", variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  const handleApplyToAll = async () => {
    if (!pendingAction) return;
    await applyToAll(pendingAction.menuId);
    setPendingAction(null);
  };

  const handleApplyToEntry = async () => {
    if (!pendingAction) return;
    setIsSaving(true);
    const result = await editCommonContent({
      contentType,
      slug,
      operations: [{ action: "update_field", path: menuFieldPath, value: pendingAction.menuId }],
    });
    if (result.success) {
      setPendingAction(null);
      onMenuChange?.(pendingAction.menuId);
      queryClient.invalidateQueries({ queryKey: ["/api/content-types"] });
      queryClient.invalidateQueries({ queryKey: ["/api/menus"] });
    } else {
      toast({ title: "Failed to update layout", description: result.error || "Unknown error", variant: "destructive" });
    }
    setIsSaving(false);
  };

  if (!editMode?.isEditMode) return null;
  if (editMode.previewBreakpoint === "mobile") return null;

  const detachDialog = (
    <Dialog
      open={detachDialogOpen}
      onOpenChange={(open) => {
        if (!open && !isSaving) handleKeep();
      }}
    >
      <DialogContent className="sm:max-w-md" data-testid="dialog-menu-detach">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            Change menu on a shared template
          </DialogTitle>
          <DialogDescription asChild>
            <div className="space-y-2 text-sm text-muted-foreground">
              <p>
                This {position} menu comes from the shared <strong>{contentType}</strong> template,
                so every {contentType} shows it.
              </p>
              <p>
                To {isRemoving ? "remove" : "change"} it only on <strong>{slug}</strong>, this page
                must be detached from the shared template. Detaching does not change the menu yet —
                you can edit it afterward on this page alone.
              </p>
            </div>
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3 py-2">
          <Button
            variant="outline"
            className="w-full justify-start gap-3 h-auto py-3 px-4"
            onClick={handleKeep}
            disabled={isSaving}
            data-testid="button-menu-keep"
          >
            <div className="flex flex-col items-start gap-0.5 text-left whitespace-normal">
              <span className="font-medium">{keepLabel}</span>
              <span className="text-xs text-muted-foreground">
                No changes. All {contentType}s keep the shared menu.
              </span>
            </div>
          </Button>
          <Button
            variant="outline"
            className="w-full justify-start gap-3 h-auto py-3 px-4"
            onClick={() => void handleDetach()}
            disabled={isSaving}
            data-testid="button-menu-detach"
          >
            <div className="flex flex-col items-start gap-0.5 text-left whitespace-normal">
              <span className="font-medium flex items-center gap-2">
                {isSaving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Detach this {contentType}
              </span>
              <span className="text-xs text-muted-foreground">
                This page gets its own layout. The menu stays until you change it again here.
                Other {contentType}s are unchanged.
              </span>
            </div>
          </Button>
        </div>
        <div className="space-y-2">
          <button
            type="button"
            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
            onClick={() => setShowAdvanced((v) => !v)}
            data-testid="button-toggle-menu-detach-advanced"
          >
            {showAdvanced ? "Hide advanced details" : "Read more (advanced)"}
            <ChevronDown
              className={`h-3.5 w-3.5 transition-transform ${showAdvanced ? "rotate-180" : ""}`}
            />
          </button>
          {showAdvanced && (
            <div className="rounded-md border border-border bg-muted/40 p-3 space-y-3 text-xs text-muted-foreground">
              <div>
                <p className="font-medium text-foreground mb-1">What detach does</p>
                <p>
                  Detach copies the live shared template (
                  <code className="text-[11px]">single.&lt;locale&gt;.yml</code>
                  ) into this entry&apos;s locale files and sets{" "}
                  <code className="text-[11px]">detached: true</code> in{" "}
                  <code className="text-[11px]">_common.yml</code>. Page versions then belong to
                  this entry instead of the shared template.
                </p>
              </div>
              <div>
                <p className="font-medium text-foreground mb-1">After you detach</p>
                <p>
                  Change or remove the menu again on this page — that edit applies only here.
                  Re-attach later from the debug panel; custom structure (including a custom menu)
                  may be lost.
                </p>
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={handleKeep} disabled={isSaving} data-testid="button-menu-detach-cancel">
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  const scopeDialog = (
    <Dialog
      open={pendingAction !== null && !isSharedTemplate && !isDetached}
      onOpenChange={(open) => {
        if (!open) setPendingAction(null);
      }}
    >
      <DialogContent data-testid="dialog-menu-scope">
        <DialogHeader>
          <DialogTitle data-testid="text-menu-scope-title">
            {actionLabel} menu — choose scope
          </DialogTitle>
          <DialogDescription data-testid="text-menu-scope-description">
            {isRemoving
              ? <>Remove the {position} menu from all <strong>{contentType}s</strong> or only from the <strong>{slug}</strong> {contentType}?</>
              : <>Add <strong>{pendingAction?.menuId}</strong> as the {position} menu to all <strong>{contentType}s</strong> or only to the <strong>{slug}</strong> {contentType}?</>}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex flex-col gap-2 sm:flex-row">
          <Button
            variant="default"
            onClick={handleApplyToAll}
            disabled={isSaving}
            data-testid="button-apply-all"
          >
            {actionLabel} from all {contentType}s
          </Button>
          <Button
            variant="outline"
            onClick={handleApplyToEntry}
            disabled={isSaving}
            data-testid="button-apply-entry"
          >
            {actionLabel} only from {slug}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  if (currentMenuId) {
    const positionClasses = position === "top" ? "bottom-2 right-2" : "top-2 right-2";

    return (
      <>
        {detachDialog}
        {scopeDialog}
        <div
          className={`absolute z-[60] flex items-center gap-1 transition-opacity duration-150 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto ${positionClasses}`}
          data-testid={`menu-slot-${position}-assigned`}
        >
          <button
            className="p-2 bg-primary text-primary-foreground rounded-md shadow-lg hover-elevate flex items-center gap-1.5 cursor-pointer"
            onClick={() => navigate(`/private/menu-editor/${currentMenuId}?locale=${locale}`)}
            disabled={isSaving}
            data-testid={`button-edit-menu-${position}`}
          >
            <Pencil className="w-3.5 h-3.5" />
            <span className="text-xs font-medium">{currentMenuId}</span>
          </button>
          <Popover open={isOpen} onOpenChange={setIsOpen}>
            <PopoverTrigger asChild>
              <button
                className="p-2 bg-muted text-muted-foreground rounded-md shadow-lg hover-elevate cursor-pointer"
                disabled={isSaving}
                data-testid={`button-change-menu-${position}`}
              >
                <ArrowLeftRight className="w-3.5 h-3.5" />
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-48 p-1" align="center">
              <div className="flex flex-col">
                {menuIds.map((id) => (
                  <Button
                    key={id}
                    variant="ghost"
                    size="sm"
                    className={`justify-start text-xs ${id === currentMenuId ? "toggle-elevate toggle-elevated" : ""}`}
                    onClick={() => handleMenuOptionClick(id)}
                    data-testid={`menu-option-${position}-${id}`}
                  >
                    <Menu className="w-3.5 h-3.5 mr-2 flex-shrink-0" />
                    {id}
                  </Button>
                ))}
              </div>
            </PopoverContent>
          </Popover>
          <button
            className="p-2 bg-muted text-destructive rounded-md shadow-lg hover-elevate cursor-pointer"
            onClick={() => handleMenuOptionClick(null)}
            disabled={isSaving}
            data-testid={`button-clear-menu-${position}`}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </>
    );
  }

  return (
    <>
      {detachDialog}
      {scopeDialog}
      <Popover open={isOpen} onOpenChange={setIsOpen}>
        <PopoverTrigger asChild>
          <button
            className="w-full flex items-center justify-center gap-2 py-3 border-2 border-dashed border-muted-foreground/20 hover-elevate cursor-pointer transition-colors"
            disabled={isSaving}
            data-testid={`menu-slot-${position}-empty`}
          >
            <Plus className="w-4 h-4 text-muted-foreground/50" />
            <span className="text-xs text-muted-foreground/50">
              Add a menu on the {position} of your page (optional)
            </span>
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-48 p-1" align="center">
          <div className="flex flex-col">
            {menuIds.map((id) => (
              <Button
                key={id}
                variant="ghost"
                size="sm"
                className="justify-start text-xs"
                onClick={() => handleMenuOptionClick(id)}
                data-testid={`menu-option-${position}-${id}`}
              >
                <Menu className="w-3.5 h-3.5 mr-2 flex-shrink-0" />
                {id}
              </Button>
            ))}
          </div>
        </PopoverContent>
      </Popover>
    </>
  );
}
