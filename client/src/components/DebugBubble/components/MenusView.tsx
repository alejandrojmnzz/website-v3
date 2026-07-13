import { useState } from "react";
import { ChevronDown, ChevronRight, Menu, MoreVertical, Pencil, RefreshCw, Trash2 } from "lucide-react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { MenuFileItem, MenuData } from "../types";

interface UsageData {
  defaultContentTypes: { name: string; position: "top" | "bottom" | "both" }[];
  overrides: { contentType: string; slug: string; source: string; position: "top" | "bottom" }[];
}

export function MenusView() {
  const [expandedMenu, setExpandedMenu] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [usageData, setUsageData] = useState<UsageData | null>(null);
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: menusData, isLoading } = useQuery<{ menus: MenuFileItem[] }>({
    queryKey: ["/api/menus"],
  });

  const { data: menuDetailData, isFetching: isMenuLoading } = useQuery<{ name: string; data: MenuData }>({
    queryKey: ["/api/menus", expandedMenu],
    enabled: !!expandedMenu,
  });

  const deleteMutation = useMutation({
    mutationFn: (name: string) => apiRequest("DELETE", `/api/menus/${name}`),
    onSuccess: (_data, name) => {
      queryClient.invalidateQueries({ queryKey: ["/api/menus"] });
      if (expandedMenu === name) setExpandedMenu(null);
      toast({ title: "Menu deleted", description: `"${name}" has been removed.` });
      setDeleteTarget(null);
      setUsageData(null);
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      toast({ title: "Delete failed", description: msg, variant: "destructive" });
    },
  });

  const menus = menusData?.menus || [];
  const menuData = menuDetailData?.data;

  const toggleMenu = (name: string) => {
    setExpandedMenu(expandedMenu === name ? null : name);
  };

  const handleEditMenu = (e: React.MouseEvent, menuName: string) => {
    e.stopPropagation();
    navigate(`/private/menu-editor/${menuName}`);
  };

  const handleDeleteClick = async (e: React.MouseEvent, menuName: string) => {
    e.stopPropagation();
    try {
      const res = await apiRequest("GET", `/api/menus/${menuName}/usage`);
      const data: UsageData = await res.json();
      setUsageData(data);
    } catch {
      setUsageData({ defaultContentTypes: [], overrides: [] });
    }
    setDeleteTarget(menuName);
  };

  const confirmDelete = () => {
    if (deleteTarget) deleteMutation.mutate(deleteTarget);
  };

  const hasUsage = usageData && (usageData.defaultContentTypes.length > 0 || usageData.overrides.length > 0);

  return (
    <>
      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : menus.length === 0 ? (
        <div className="text-center py-8 px-4">
          <Menu className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
          <p className="text-sm text-muted-foreground mb-2">No menus found</p>
          <p className="text-xs text-muted-foreground">
            Add <code className="bg-muted px-1 rounded">.yml</code> files to{" "}
            <code className="bg-muted px-1 rounded">site_*/menus/</code>{" "}
            or use the + button above.
          </p>
        </div>
      ) : (
        menus.map((menu) => (
          <div key={menu.name} className="mb-1">
            <div className="flex items-center gap-1">
              <button
                onClick={() => toggleMenu(menu.name)}
                className="flex items-center gap-2 flex-1 px-3 py-2 rounded-md text-sm hover-elevate cursor-pointer"
                data-testid={`button-menu-${menu.name}`}
              >
                {isMenuLoading && expandedMenu === menu.name ? (
                  <RefreshCw className="h-4 w-4 text-muted-foreground animate-spin flex-shrink-0" />
                ) : expandedMenu === menu.name ? (
                  <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                ) : (
                  <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                )}
                <Menu className="h-4 w-4 text-primary flex-shrink-0" />
                <span className="font-medium">{menu.name}</span>
                <span className="text-xs text-muted-foreground ml-auto">{menu.file}</span>
              </button>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    className="flex-shrink-0 p-1 rounded bg-muted hover:bg-muted-foreground/20 transition-colors"
                    onClick={(e) => e.stopPropagation()}
                    data-testid={`button-menu-options-${menu.name}`}
                  >
                    <MoreVertical className="h-3 w-3 text-muted-foreground" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-36">
                  <DropdownMenuItem
                    onClick={(e) => handleEditMenu(e, menu.name)}
                    className="text-[13px]"
                    data-testid={`menu-edit-${menu.name}`}
                  >
                    <Pencil className="h-3.5 w-3.5 mr-2" />
                    Edit
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={(e) => handleDeleteClick(e, menu.name)}
                    className="text-[13px] text-destructive"
                    data-testid={`menu-delete-${menu.name}`}
                  >
                    <Trash2 className="h-3.5 w-3.5 mr-2" />
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            {expandedMenu === menu.name && menuData && (
              <div className="ml-4 border-l pl-2 space-y-1 mt-1">
                {menuData?.navbar?.items?.map((item, index) => (
                  <a
                    key={index}
                    href={item.href}
                    className="flex items-center justify-between px-3 py-1.5 rounded-md text-xs text-muted-foreground hover-elevate cursor-pointer"
                    data-testid={`link-menu-item-${item.label.toLowerCase().replace(/\s+/g, "-")}`}
                  >
                    <span>{item.label}</span>
                    <span className="text-xs opacity-60">{item.component}</span>
                  </a>
                ))}
                {menuData?.footer?.columns?.map((column: { title: string; items?: { label: string; href: string }[] }, index: number) => (
                  <div
                    key={index}
                    className="flex items-center justify-between px-3 py-1.5 rounded-md text-xs text-muted-foreground"
                    data-testid={`debug-footer-column-${index}`}
                  >
                    <span>{column.title}</span>
                    <span className="text-xs opacity-60">{column.items?.length || 0} links</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))
      )}

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) { setDeleteTarget(null); setUsageData(null); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete menu "{deleteTarget}"?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div>
                <p>This will permanently delete the menu file and cannot be undone.</p>
                {hasUsage && (
                  <div className="mt-3 space-y-1">
                    <p className="text-sm font-medium text-foreground">This menu is currently in use:</p>
                    {usageData!.defaultContentTypes.map((ct) => (
                      <p key={ct.name} className="text-xs">
                        Content type <span className="font-medium">{ct.name}</span> ({ct.position} menu)
                      </p>
                    ))}
                    {usageData!.overrides.map((o, i) => (
                      <p key={i} className="text-xs">
                        Page <span className="font-medium">{o.slug}</span> ({o.contentType}, {o.position})
                      </p>
                    ))}
                    <p className="text-xs text-muted-foreground mt-2">All references will be removed automatically.</p>
                  </div>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-delete-menu-cancel">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="bg-destructive text-destructive-foreground"
              data-testid="button-delete-menu-confirm"
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
