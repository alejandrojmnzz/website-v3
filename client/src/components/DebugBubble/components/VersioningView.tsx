import { useState } from "react";
import { useSearch } from "wouter";
import { deslugify } from "../utils/debugHelpers";
import { IconArrowLeft, IconGitBranch, IconRefresh, IconPencil, IconCheck, IconX, IconPlayerPlay, IconPlus, IconHistory, IconExternalLink, IconArrowBackUp, IconCrown, IconTrash, IconDots, IconCode, IconShare, IconCopy } from "@tabler/icons-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { getDebugToken } from "@/hooks/useDebugAuth";
import { emitVariantCreated, emitVariantDeleted, emitVariantPromoted } from "@/lib/contentEvents";
import type { MenuView, ContentInfo, VersioningResponse } from "../types";
import { STORAGE_KEY, OPEN_STORAGE_KEY } from "../types";

interface VersioningViewProps {
  setMenuView: (v: MenuView) => void;
  contentInfo: ContentInfo;
  versioningLoading: boolean;
  versioningData: VersioningResponse | null;
  navigate: (path: string) => void;
  pathname: string;
  onVersioningDataUpdate?: (data: VersioningResponse) => void;
  onEditVariantYaml: (locale: string, variantSlug: string) => void;
}

export function VersioningView({
  setMenuView,
  contentInfo,
  versioningLoading,
  versioningData,
  navigate,
  pathname,
  onVersioningDataUpdate,
  onEditVariantYaml,
}: VersioningViewProps) {
  const { toast } = useToast();
  const locales = versioningData?.versioning ? Object.keys(versioningData.versioning) : [];
  const dialogLocales = locales.length > 0 ? locales : (versioningData?.availableLocales ?? ["en"]);

  const searchString = useSearch();
  const activeVariant = new URLSearchParams(searchString).get("variant") ?? null;

  const [editingLocale, setEditingLocale] = useState<string | null>(null);
  const [tempAllocations, setTempAllocations] = useState<Record<string, number>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [savedLocale, setSavedLocale] = useState<string | null>(null);

  const [createVersionOpen, setCreateVersionOpen] = useState(false);
  const [createVersionSlug, setCreateVersionSlug] = useState("");
  const [createVersionLocale, setCreateVersionLocale] = useState("en");
  const [isCreatingVersion, setIsCreatingVersion] = useState(false);

  const [shareTarget, setShareTarget] = useState<{ locale: string; slug: string } | null>(null);

  const [promoteTarget, setPromoteTarget] = useState<{ locale: string; slug: string } | null>(null);
  const [isPromoting, setIsPromoting] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<{ locale: string; slug: string; allocation: number } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const [showRestorePanel, setShowRestorePanel] = useState(false);
  const [restoreHistory, setRestoreHistory] = useState<Array<{ sha: string; date: string; author: string; subject: string }>>([]);
  const [restoreHistoryLoading, setRestoreHistoryLoading] = useState(false);
  const [repoUrl, setRepoUrl] = useState<string | null>(null);
  const [restoreTarget, setRestoreTarget] = useState<string | null>(null);
  const [isRestoring, setIsRestoring] = useState(false);

  // DB-single template versioning
  const isDatabaseSingle = versioningData?.isDatabaseSingle ?? false;
  const [promoteScopeTarget, setPromoteScopeTarget] = useState<{ locale: string; slug: string } | null>(null);
  const [isPromotingScope, setIsPromotingScope] = useState(false);

  const isPreview = pathname.startsWith("/private/preview/");

  const persistOpenStateForNavigation = () => {
    if (typeof window !== "undefined") {
      sessionStorage.setItem(OPEN_STORAGE_KEY, "true");
      sessionStorage.setItem(STORAGE_KEY, "versioning");
    }
  };

  const buildPublicPath = (type: string, slug: string, locale: string): string => {
    if (type === "program") return `/${locale}/career-programs/${slug}`;
    if (type === "location") return `/${locale}/location/${slug}`;
    if (type === "landing") return `/landing/${slug}`;
    return `/${locale}/${slug}`;
  };

  const handleSwitchVariant = (locale: string, variantSlug: string) => {
    persistOpenStateForNavigation();
    if (isPreview && contentInfo.type && contentInfo.slug) {
      navigate(
        `/private/preview/${contentInfo.type}/${contentInfo.slug}?variant=${encodeURIComponent(variantSlug)}&locale=${locale}`
      );
    } else {
      const { type, slug } = contentInfo;
      if (!type || !slug) return;
      const basePath = buildPublicPath(type, slug, locale);
      window.location.href = `${basePath}?force_variant=${encodeURIComponent(variantSlug)}`;
    }
  };

  const handleEditVariant = (locale: string, variantSlug: string) => {
    const { type, slug } = contentInfo;
    if (!type || !slug) return;
    persistOpenStateForNavigation();
    navigate(
      `/private/preview/${type}/${slug}?variant=${encodeURIComponent(variantSlug)}&locale=${locale}`
    );
  };

  const handleSwitchToDefault = (locale: string) => {
    persistOpenStateForNavigation();
    if (isPreview && contentInfo.type && contentInfo.slug) {
      navigate(`/private/preview/${contentInfo.type}/${contentInfo.slug}?locale=${locale}`);
    } else {
      const { type, slug } = contentInfo;
      if (!type || !slug) return;
      window.location.href = buildPublicPath(type, slug, locale);
    }
  };

  const handleEditDefault = (locale: string) => {
    const { type, slug } = contentInfo;
    if (!type || !slug) return;
    persistOpenStateForNavigation();
    navigate(`/private/preview/${type}/${slug}?locale=${locale}`);
  };

  const handleCreateVersion = async () => {
    const { type, slug } = contentInfo;
    if (!type || !slug || !createVersionSlug) return;
    setIsCreatingVersion(true);
    try {
      const token = getDebugToken();
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Token ${token}`;
      const res = await fetch(`/api/versioning/${type}/${slug}`, {
        method: "POST",
        headers,
        body: JSON.stringify({ variantSlug: createVersionSlug, locale: createVersionLocale }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ title: data.error || "Failed to create version", variant: "destructive" });
        return;
      }
      toast({ title: `Version "${createVersionSlug}" created` });
      emitVariantCreated({ contentType: type, slug, locale: createVersionLocale, variantSlug: createVersionSlug });
      setCreateVersionOpen(false);
      setCreateVersionSlug("");
      if (onVersioningDataUpdate) {
        fetch(`/api/versioning/${type}/${slug}`)
          .then((r) => r.json())
          .then(onVersioningDataUpdate)
          .catch(() => {});
      }
      persistOpenStateForNavigation();
      navigate(`/private/preview/${type}/${slug}?force_variant=${encodeURIComponent(createVersionSlug)}&locale=${createVersionLocale}`);
    } catch {
      toast({ title: "Failed to create version", variant: "destructive" });
    } finally {
      setIsCreatingVersion(false);
    }
  };

  const handlePromote = async () => {
    if (!promoteTarget || !contentInfo.type || !contentInfo.slug) return;
    setIsPromoting(true);
    try {
      const token = getDebugToken();
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Token ${token}`;
      const res = await fetch(
        `/api/versioning/${contentInfo.type}/${contentInfo.slug}/${promoteTarget.locale}/promote/${promoteTarget.slug}`,
        { method: "POST", headers }
      );
      const data = await res.json();
      if (!res.ok) {
        toast({ title: data.error || "Failed to promote variant", variant: "destructive" });
        return;
      }
      toast({ title: `Variant "${promoteTarget.slug}" promoted to default` });
      emitVariantPromoted({ contentType: contentInfo.type, slug: contentInfo.slug, locale: promoteTarget.locale, variantSlug: promoteTarget.slug });
      setPromoteTarget(null);
      if (onVersioningDataUpdate) {
        fetch(`/api/versioning/${contentInfo.type}/${contentInfo.slug}`)
          .then((r) => r.json())
          .then(onVersioningDataUpdate)
          .catch(() => {});
      }
    } catch {
      toast({ title: "Failed to promote variant", variant: "destructive" });
    } finally {
      setIsPromoting(false);
    }
  };

  const handlePromoteWithScope = async (scope: "item" | "template") => {
    if (!promoteScopeTarget || !contentInfo.type || !contentInfo.slug) return;
    setIsPromotingScope(true);
    try {
      const token = getDebugToken();
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Token ${token}`;
      const res = await fetch(
        `/api/versioning/${contentInfo.type}/${contentInfo.slug}/${promoteScopeTarget.locale}/promote/${promoteScopeTarget.slug}`,
        { method: "POST", headers, body: JSON.stringify({ scope }) }
      );
      const data = await res.json();
      if (!res.ok) {
        toast({ title: data.error || "Failed to promote variant", variant: "destructive" });
        return;
      }
      const msg = scope === "template"
        ? `Template actualizado — todos los items verán este cambio`
        : `Override aplicado a "${contentInfo.slug}"`;
      toast({ title: msg });
      emitVariantPromoted({ contentType: contentInfo.type, slug: contentInfo.slug, locale: promoteScopeTarget.locale, variantSlug: promoteScopeTarget.slug });
      setPromoteScopeTarget(null);
      // Redirect to the original item URL, stripping the variant preview param
      const cleanParams = new URLSearchParams(window.location.search);
      cleanParams.delete("variant");
      cleanParams.delete("force_variant");
      const qs = cleanParams.toString();
      window.location.href = window.location.pathname + (qs ? `?${qs}` : "");
      return;
    } catch {
      toast({ title: "Failed to promote variant", variant: "destructive" });
    } finally {
      setIsPromotingScope(false);
    }
  };

  const handleDeleteVariant = async () => {
    if (!deleteTarget || !contentInfo.type || !contentInfo.slug) return;
    setIsDeleting(true);
    try {
      const token = getDebugToken();
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Token ${token}`;
      const res = await fetch(
        `/api/versioning/${contentInfo.type}/${contentInfo.slug}/${deleteTarget.locale}/${deleteTarget.slug}`,
        { method: "DELETE", headers }
      );
      const data = await res.json();
      if (!res.ok) {
        toast({ title: data.error || "Failed to delete variant", variant: "destructive" });
        return;
      }
      toast({ title: `Variant "${deleteTarget.slug}" deleted` });
      emitVariantDeleted({ contentType: contentInfo.type, slug: contentInfo.slug, locale: deleteTarget.locale, variantSlug: deleteTarget.slug });
      setDeleteTarget(null);
      if (onVersioningDataUpdate) {
        onVersioningDataUpdate(data);
      }
    } catch {
      toast({ title: "Failed to delete variant", variant: "destructive" });
    } finally {
      setIsDeleting(false);
    }
  };

  const openEditAllocations = (locale: string) => {
    const localeData = versioningData?.versioning?.[locale];
    if (!localeData) return;
    const allocations: Record<string, number> = {};
    localeData.variants.forEach((v) => {
      allocations[v.slug] = v.allocation;
    });
    const variantSum = localeData.variants.reduce((s, v) => s + v.allocation, 0);
    allocations["__default__"] = Math.max(0, 100 - variantSum);
    setTempAllocations(allocations);
    setEditingLocale(locale);
  };

  const cancelEdit = () => {
    setEditingLocale(null);
    setTempAllocations({});
  };

  const handleSaveAllocations = async () => {
    if (!editingLocale || !contentInfo.type || !contentInfo.slug) return;
    const localeData = versioningData?.versioning?.[editingLocale];
    if (!localeData) return;

    setIsSaving(true);
    try {
      const token = getDebugToken();
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Token ${token}`;

      const variants = localeData.variants.map((v) => ({
        slug: v.slug,
        allocation: tempAllocations[v.slug] ?? v.allocation,
      })).filter((v) => v.slug !== "__default__");

      const res = await fetch(
        `/api/versioning/${contentInfo.type}/${contentInfo.slug}/${editingLocale}`,
        {
          method: "PATCH",
          headers,
          body: JSON.stringify({ variants }),
        }
      );

      if (!res.ok) throw new Error("Failed to save allocations");

      const updated = await fetch(
        `/api/versioning/${contentInfo.type}/${contentInfo.slug}`
      ).then((r) => r.json());

      if (onVersioningDataUpdate) onVersioningDataUpdate(updated);

      toast({
        title: "Traffic split saved",
        description: "Allocation changes have been committed to version control and will go live on next deploy.",
        duration: 5000,
      });
      setSavedLocale(editingLocale);
      setTimeout(() => setSavedLocale(null), 4000);
      setEditingLocale(null);
      setTempAllocations({});
    } catch {
      toast({
        title: "Failed to save",
        description: "Could not update traffic allocation.",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleOpenRestorePanel = async () => {
    setShowRestorePanel(true);
    if (restoreHistory.length > 0) return;
    setRestoreHistoryLoading(true);
    const { type, slug } = contentInfo;
    if (!type || !slug) { setRestoreHistoryLoading(false); return; }
    const folder = `4geeks-com/${type}/${slug}`;
    try {
      const data = await fetch(`/api/git/folder-history?folder=${encodeURIComponent(folder)}&limit=30`).then(r => r.json());
      setRestoreHistory(data.entries || []);
      setRepoUrl(data.repoUrl || null);
    } catch {
      setRestoreHistory([]);
    } finally {
      setRestoreHistoryLoading(false);
    }
  };

  const handleRestore = async () => {
    if (!restoreTarget || !contentInfo.type || !contentInfo.slug) return;
    setIsRestoring(true);
    const folder = `4geeks-com/${contentInfo.type}/${contentInfo.slug}`;
    try {
      const token = getDebugToken();
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Token ${token}`;
      const res = await fetch("/api/git/restore-folder", {
        method: "POST",
        headers,
        body: JSON.stringify({ folder, sha: restoreTarget }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ title: data.error || "Restore failed", variant: "destructive" });
        return;
      }
      toast({ title: "Folder restored", description: `Content restored to commit ${restoreTarget.slice(0, 7)}` });
      setRestoreTarget(null);
      setShowRestorePanel(false);
      setRestoreHistory([]);
      if (onVersioningDataUpdate && contentInfo.type && contentInfo.slug) {
        fetch(`/api/versioning/${contentInfo.type}/${contentInfo.slug}`)
          .then(r => r.json())
          .then(onVersioningDataUpdate)
          .catch(() => {});
      }
    } catch {
      toast({ title: "Restore failed", variant: "destructive" });
    } finally {
      setIsRestoring(false);
    }
  };

  const totalTemp = Object.values(tempAllocations).reduce((s, v) => s + v, 0);

  return (
    <>
      <div className="px-3 py-2 border-b">
        <div className="flex items-center gap-3">
          <button
            onClick={() => showRestorePanel ? setShowRestorePanel(false) : setMenuView("main")}
            className="p-1 rounded-md hover-elevate"
            data-testid="button-back-to-main-versioning"
          >
            <IconArrowLeft className="h-4 w-4" />
          </button>
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-sm">{showRestorePanel ? "Restore History" : "Versions"}</h3>
            <p className="text-xs text-muted-foreground truncate">
              {contentInfo.label}: {contentInfo.slug}
            </p>
          </div>
          {!showRestorePanel && (
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <Button
                size="sm"
                variant="outline"
                className="h-7 gap-1 text-xs"
                onClick={() => {
                  setCreateVersionLocale(dialogLocales[0] ?? "en");
                  setCreateVersionSlug("");
                  setCreateVersionOpen(true);
                }}
                data-testid="button-new-version"
              >
                <IconPlus className="h-3 w-3" />
                New
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 gap-1 text-xs"
                onClick={handleOpenRestorePanel}
                data-testid="button-open-restore-panel"
              >
                <IconHistory className="h-3 w-3" />
                Restore
              </Button>
            </div>
          )}
        </div>
      </div>

      {showRestorePanel && (
        <div className="overflow-y-auto overflow-x-hidden max-h-[380px]">
          <div className="p-2 space-y-1">
            {restoreHistoryLoading ? (
              <div className="flex items-center justify-center py-8">
                <IconRefresh className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : restoreHistory.length === 0 ? (
              <div className="text-center py-8 px-4">
                <IconHistory className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">No git history found for this content folder</p>
              </div>
            ) : (
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground px-2 pb-1">
                  Select a commit to restore the entire content folder to that snapshot.
                </p>
                {restoreHistory.map((entry) => {
                  const relDate = (() => {
                    const diff = Date.now() - new Date(entry.date).getTime();
                    const mins = Math.floor(diff / 60000);
                    if (mins < 60) return `${mins}m ago`;
                    const hrs = Math.floor(mins / 60);
                    if (hrs < 24) return `${hrs}h ago`;
                    return `${Math.floor(hrs / 24)}d ago`;
                  })();
                  const githubUrl = repoUrl
                    ? `${repoUrl}/tree/${entry.sha}/4geeks-com/${contentInfo.type}/${contentInfo.slug}`
                    : null;
                  return (
                    <div key={entry.sha} className="flex items-start justify-between gap-2 px-2 py-1.5 rounded-md hover-elevate">
                      <div className="min-w-0 flex-1">
                        <p className="text-xs truncate text-foreground">{entry.subject}</p>
                        <p className="text-[10px] text-muted-foreground mt-0.5">
                          {entry.author} · {relDate} · <span className="font-mono">{entry.sha.slice(0, 7)}</span>
                        </p>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        {githubUrl && (
                          <a
                            href={githubUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            title="View on GitHub"
                            className="p-1 rounded hover-elevate text-muted-foreground"
                            data-testid={`button-github-link-${entry.sha}`}
                          >
                            <IconExternalLink className="h-3.5 w-3.5" />
                          </a>
                        )}
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-5 px-1.5 py-0 text-[10px] leading-none"
                          onClick={() => setRestoreTarget(entry.sha)}
                          data-testid={`button-restore-commit-${entry.sha}`}
                        >
                          Restore
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {!showRestorePanel && (
      <div className="overflow-y-auto overflow-x-hidden max-h-[380px]">
        <div className="p-2 space-y-1">
          {versioningLoading ? (
            <div className="flex items-center justify-center py-8">
              <IconRefresh className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : !versioningData?.hasVersioningFile ? (
            <div className="text-center py-8 px-4">
              <IconGitBranch className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
              {isDatabaseSingle ? (
                <>
                  <p className="text-sm text-muted-foreground mb-2">No template variants yet</p>
                  <p className="text-xs text-muted-foreground">
                    Click <strong>New</strong> to create a draft variant of <code className="bg-muted px-1 rounded">single.en.yml</code>
                  </p>
                </>
              ) : (
                <>
                  <p className="text-sm text-muted-foreground mb-2">No versioning file found</p>
                  <p className="text-xs text-muted-foreground">
                    Create <code className="bg-muted px-1 rounded">versioning.yml</code> in the content folder
                  </p>
                </>
              )}
            </div>
          ) : locales.length === 0 ? (
            <div className="text-center py-8 px-4">
              <IconGitBranch className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">No variants defined</p>
            </div>
          ) : (
            locales.map((locale) => {
              const localeData = versioningData!.versioning![locale];
              const isEditing = editingLocale === locale;
              return (
                <div key={locale} className="px-2 py-2">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs text-muted-foreground">
                        {isDatabaseSingle ? "Template variants for" : "Traffic allocation for"}
                      </span>
                      <Badge variant="secondary" className="text-[10px] px-1.5 py-0 leading-4">
                        {locale.toUpperCase()}
                      </Badge>
                      <span className="text-xs text-muted-foreground">locale</span>
                      {savedLocale === locale && (
                        <Badge variant="default" className="text-[10px] px-1.5 py-0 leading-4 gap-0.5 flex items-center">
                          <IconCheck className="h-2.5 w-2.5" />
                          Saved
                        </Badge>
                      )}
                    </div>
                    {!isDatabaseSingle && (!isEditing ? (
                      <button
                        onClick={() => openEditAllocations(locale)}
                        className="p-1 rounded-md hover-elevate text-muted-foreground"
                        title="Edit traffic allocation"
                        data-testid={`button-edit-allocations-${locale}`}
                      >
                        <IconPencil className="h-3.5 w-3.5" />
                      </button>
                    ) : (
                      <div className="flex items-center gap-1">
                        <Badge
                          variant={totalTemp === 100 ? "default" : "destructive"}
                          className="text-xs"
                          data-testid="badge-total-allocation"
                        >
                          {totalTemp}%
                        </Badge>
                        <button
                          onClick={handleSaveAllocations}
                          disabled={isSaving || totalTemp !== 100}
                          className="p-1 rounded-md hover-elevate text-muted-foreground disabled:opacity-40 disabled:cursor-not-allowed"
                          title={totalTemp !== 100 ? `Total must equal 100% (currently ${totalTemp}%)` : "Save allocations"}
                          data-testid={`button-save-allocations-${locale}`}
                        >
                          {isSaving ? (
                            <IconRefresh className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <IconCheck className="h-3.5 w-3.5" />
                          )}
                        </button>
                        <button
                          onClick={cancelEdit}
                          className="p-1 rounded-md hover-elevate text-muted-foreground"
                          title="Cancel"
                          data-testid={`button-cancel-allocations-${locale}`}
                        >
                          <IconX className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>

                  <div className="space-y-2">
                    {/* Synthetic default row — hidden for DB singles (no allocation concept) */}
                    {!isDatabaseSingle && (() => {
                      const variantTotal = localeData.variants.reduce((sum, v) => sum + (v.allocation ?? 0), 0);
                      const defaultAllocation = Math.max(0, 100 - variantTotal);
                      const isDefaultActive = activeVariant === null;
                      const defaultTempValue = tempAllocations["__default__"] ?? defaultAllocation;
                      const variantTempTotal = localeData.variants.reduce((sum, v) => sum + (tempAllocations[v.slug] ?? (v.allocation ?? 0)), 0);
                      const defaultMaxAllowed = Math.max(0, 100 - variantTempTotal);
                      return (
                        <div key="__default__" className={isDefaultActive ? "rounded-md bg-primary/10 px-2 py-1 -mx-2" : ""}>
                          <div className="flex items-center justify-between text-sm gap-2">
                            <div className="flex items-center gap-1.5 min-w-0">
                              {isDefaultActive && (
                                <span className="h-2 w-2 rounded-full bg-primary flex-shrink-0" data-testid={`dot-active-variant-${locale}-default`} />
                              )}
                              <button
                                onClick={() => handleEditDefault(locale)}
                                title="Edit default version"
                                className={`truncate text-left hover:underline ${isDefaultActive ? "font-semibold text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                                data-testid={`button-edit-variant-${locale}-default`}
                              >
                                Default
                              </button>
                              {isDefaultActive && (
                                <Badge variant="default" className="text-[10px] px-1.5 py-0 leading-4 flex-shrink-0" data-testid={`badge-active-variant-${locale}`}>
                                  active
                                </Badge>
                              )}
                            </div>
                            <div className="flex items-center gap-1.5 flex-shrink-0">
                              {!isEditing && (
                                <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground font-medium">
                                  {defaultAllocation}%
                                </span>
                              )}
                            </div>
                          </div>
                          {isEditing && (
                            <div className="mt-1.5 flex items-center gap-2">
                              <Slider
                                value={[defaultTempValue]}
                                min={0}
                                max={100}
                                step={1}
                                onValueChange={([value]) =>
                                  setTempAllocations((prev) => ({
                                    ...prev,
                                    __default__: Math.min(value, defaultMaxAllowed),
                                  }))
                                }
                                className="flex-1"
                                data-testid={`slider-allocation-${locale}-default`}
                              />
                              <span className="text-xs font-medium tabular-nums w-8 text-right">
                                {defaultTempValue}%
                              </span>
                            </div>
                          )}
                        </div>
                      );
                    })()}
                    {localeData.variants.map((variant) => {
                      const isActive = activeVariant === variant.slug;
                      return (
                      <div key={variant.slug} className={isActive ? "rounded-md bg-primary/10 px-2 py-1 -mx-2" : ""}>
                        <div className="flex items-center justify-between text-sm gap-2">
                          <div className="flex items-center gap-1.5 min-w-0">
                            {isActive && (
                              <span className="h-2 w-2 rounded-full bg-primary flex-shrink-0" data-testid={`dot-active-variant-${locale}-${variant.slug}`} />
                            )}
                            <div className="flex flex-col min-w-0">
                              <button
                                onClick={() => handleEditVariant(locale, variant.slug)}
                                title={`Edit variant: ${variant.slug}`}
                                className={`truncate text-left hover:underline ${isActive ? "font-semibold text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                                data-testid={`button-edit-variant-${locale}-${variant.slug}`}
                              >
                                {deslugify(variant.slug)}
                              </button>
                              {isActive && isDatabaseSingle && contentInfo.slug && contentInfo.type && (
                                <button
                                  onClick={() => navigate(`/private/preview/${contentInfo.type}/${contentInfo.slug}`)}
                                  className="text-[10px] text-muted-foreground hover:text-foreground hover:underline text-left truncate leading-tight mt-0.5"
                                  title={`Ver item original: ${contentInfo.slug}`}
                                >
                                  ↳ {contentInfo.slug}
                                </button>
                              )}
                            </div>
                            {isActive && (
                              <Badge variant="default" className="text-[10px] px-1.5 py-0 leading-4 flex-shrink-0" data-testid={`badge-active-variant-${locale}`}>
                                active
                              </Badge>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5 flex-shrink-0">
                            {!isEditing && !isDatabaseSingle && (
                              <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground font-medium">
                                {variant.allocation ?? 0}%
                              </span>
                            )}
                            {!isEditing && (
                              <TooltipProvider delayDuration={300}>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      size="icon"
                                      variant="ghost"
                                      className="h-5 w-5 shrink-0"
                                      onClick={() => setShareTarget({ locale, slug: variant.slug })}
                                      data-testid={`button-share-variant-${locale}-${variant.slug}`}
                                    >
                                      <IconShare className="h-3 w-3" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent side="top">
                                    <p>Share preview link</p>
                                  </TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            )}
                            {!isEditing && (
                              <TooltipProvider delayDuration={300}>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      size="icon"
                                      variant="ghost"
                                      className="h-5 w-5 shrink-0 transition-colors hover:bg-yellow-100 hover:text-yellow-700 dark:hover:bg-yellow-900/40 dark:hover:text-yellow-400"
                                      onClick={() => isDatabaseSingle
                                        ? setPromoteScopeTarget({ locale, slug: variant.slug })
                                        : setPromoteTarget({ locale, slug: variant.slug })
                                      }
                                      data-testid={`button-promote-variant-${locale}-${variant.slug}`}
                                    >
                                      <IconCrown className="h-3 w-3" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent side="top">
                                    <p>Promote this version</p>
                                  </TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            )}
                            {!isEditing && (
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    className="h-5 w-5 shrink-0"
                                    data-testid={`button-variant-menu-${locale}-${variant.slug}`}
                                  >
                                    <IconDots className="h-3 w-3" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="w-40">
                                  <DropdownMenuItem
                                    onClick={() => onEditVariantYaml(locale, variant.slug)}
                                    className="text-[13px]"
                                    data-testid={`menu-edit-yaml-variant-${locale}-${variant.slug}`}
                                  >
                                    <IconCode className="h-3.5 w-3.5 mr-2" />
                                    Edit YAML
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onClick={() => setDeleteTarget({ locale, slug: variant.slug, allocation: variant.allocation })}
                                    className="text-[13px] text-destructive"
                                    data-testid={`menu-delete-variant-${locale}-${variant.slug}`}
                                  >
                                    <IconTrash className="h-3.5 w-3.5 mr-2" />
                                    Delete variant
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            )}
                          </div>
                        </div>
                        {!isDatabaseSingle && isEditing && (() => {
                          const thisValue = tempAllocations[variant.slug] ?? (variant.allocation ?? 0);
                          const othersTotal = localeData.variants.reduce((sum, v) => {
                            if (v.slug === variant.slug) return sum;
                            return sum + (tempAllocations[v.slug] ?? (v.allocation ?? 0));
                          }, 0) + (tempAllocations["__default__"] ?? 0);
                          const maxAllowed = Math.max(0, 100 - othersTotal);
                          return (
                            <div className="mt-1.5 flex items-center gap-2">
                              <Slider
                                value={[thisValue]}
                                min={0}
                                max={100}
                                step={1}
                                onValueChange={([value]) =>
                                  setTempAllocations((prev) => ({
                                    ...prev,
                                    [variant.slug]: Math.min(value, maxAllowed),
                                  }))
                                }
                                className="flex-1"
                                data-testid={`slider-allocation-${locale}-${variant.slug}`}
                              />
                              <span className="text-xs font-medium tabular-nums w-8 text-right">
                                {thisValue}%
                              </span>
                            </div>
                          );
                        })()}
                      </div>
                    );
                    })}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
      )}

      <Dialog open={createVersionOpen} onOpenChange={(open) => {
        setCreateVersionOpen(open);
        if (!open) setCreateVersionSlug("");
      }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {isDatabaseSingle ? "Create template variant" : `Create new version for ${contentInfo.slug}`}
            </DialogTitle>
            <DialogDescription>
              {isDatabaseSingle
                ? <>A draft copy of <code className="text-xs bg-muted px-1 py-0.5 rounded">single.{createVersionLocale}.yml</code> will be created. You can edit it freely — when ready, promote it to a specific item or to the whole template.</>
                : <>A new version of <strong>{contentInfo.label || contentInfo.slug}</strong> will be created but your users will not see it unless traffic is assigned to it later.</>
              }
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-1">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Locale</label>
              <Select value={createVersionLocale} onValueChange={setCreateVersionLocale}>
                <SelectTrigger data-testid="select-version-locale">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {dialogLocales.map((loc) => (
                    <SelectItem key={loc} value={loc}>{loc.toUpperCase()}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Version name</label>
              <Input
                placeholder="e.g. colorful, dark-hero, new-cta"
                value={createVersionSlug}
                onChange={(e) => setCreateVersionSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                data-testid="input-version-slug"
              />
              <p className="text-xs text-muted-foreground">Lowercase letters, numbers, and hyphens only.</p>
            </div>
            {createVersionSlug && contentInfo.slug && (
              <div className="rounded-md bg-muted px-3 py-2 space-y-0.5">
                <p className="text-xs font-medium">File that will be created:</p>
                <p className="text-xs font-mono text-muted-foreground break-all">
                  {isDatabaseSingle
                    ? `single-${createVersionSlug}.${createVersionLocale}.yml`
                    : `${contentInfo.slug}/${createVersionSlug}.${createVersionLocale}.yml`
                  }
                </p>
              </div>
            )}
            <div className="rounded-md bg-muted px-3 py-2">
              <p className="text-xs text-muted-foreground">
                {isDatabaseSingle
                  ? <>Draft only — no visitors will see it. Preview it anytime with <code className="text-xs">?force_variant=</code>. Choose the promotion scope when you're ready.</>
                  : <>Starts with <strong>0% traffic allocation</strong> — no real visitors will see it until you allocate traffic. You can preview it anytime using <code className="text-xs">?force_variant=</code>.</>
                }
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateVersionOpen(false)}>Cancel</Button>
            <Button
              onClick={handleCreateVersion}
              disabled={!createVersionSlug || isCreatingVersion}
              data-testid="button-confirm-create-version"
            >
              {isCreatingVersion && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Create version
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={promoteTarget !== null} onOpenChange={(open) => { if (!open) setPromoteTarget(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Are you sure you want to promote this variant?</DialogTitle>
            <DialogDescription>
              This action will remove the default current page and replace it with this{" "}
              <code className="text-xs bg-muted px-1 py-0.5 rounded">{promoteTarget?.slug}</code>{" "}
              variant and 100% of the traffic will now be directed to this by default.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-col gap-2 sm:flex-col">
            <Button
              variant="destructive"
              onClick={handlePromote}
              disabled={isPromoting}
              className="w-full"
              data-testid="button-confirm-promote"
            >
              {isPromoting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <IconCrown className="h-4 w-4" />
              )}
              Yes, promote and replace original
            </Button>
            <Button
              variant="outline"
              onClick={() => setPromoteTarget(null)}
              disabled={isPromoting}
              className="w-full"
              data-testid="button-cancel-promote"
            >
              <IconX className="h-4 w-4" />
              No, keep it as a secondary variant
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteTarget !== null} onOpenChange={(open) => { if (!open && !isDeleting) setDeleteTarget(null); }}>
        <DialogContent className="max-w-md">
          {deleteTarget?.allocation && deleteTarget.allocation > 0 ? (
            <>
              <DialogHeader>
                <DialogTitle>Cannot delete this variant</DialogTitle>
                <DialogDescription>
                  Variant{" "}
                  <code className="text-xs bg-muted px-1 py-0.5 rounded">{deleteTarget?.slug}</code>{" "}
                  currently has <strong>{deleteTarget?.allocation}% traffic allocation</strong>. You must set its traffic to 0% before deleting it.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setDeleteTarget(null)}
                  data-testid="button-close-delete-blocked"
                >
                  Close
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>Delete this variant?</DialogTitle>
                <DialogDescription>
                  This will permanently remove the variant file for{" "}
                  <code className="text-xs bg-muted px-1 py-0.5 rounded">{deleteTarget?.slug}</code>{" "}
                  ({deleteTarget?.locale}) and remove it from the versioning list. This action cannot be undone.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setDeleteTarget(null)}
                  disabled={isDeleting}
                  data-testid="button-cancel-delete-variant"
                >
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  onClick={handleDeleteVariant}
                  disabled={isDeleting}
                  data-testid="button-confirm-delete-variant"
                >
                  {isDeleting ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <IconTrash className="h-4 w-4 mr-2" />
                  )}
                  Delete variant
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={shareTarget !== null} onOpenChange={(open) => { if (!open) setShareTarget(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Share this variant</DialogTitle>
            <DialogDescription>
              Anyone with this link will see the{" "}
              <code className="text-xs bg-muted px-1 py-0.5 rounded">{shareTarget?.slug}</code>{" "}
              variant regardless of traffic allocation. Use it to share a preview with stakeholders or clients without changing any live traffic split.
            </DialogDescription>
          </DialogHeader>
          {shareTarget && contentInfo.type && contentInfo.slug && (
            <div className="flex items-center gap-2">
              <Input
                readOnly
                value={`${window.location.origin}${buildPublicPath(contentInfo.type, contentInfo.slug, shareTarget.locale)}?force_variant=${encodeURIComponent(shareTarget.slug)}`}
                className="font-mono text-xs"
                data-testid="input-share-variant-url"
              />
              <Button
                size="icon"
                variant="ghost"
                onClick={() => {
                  const url = `${window.location.origin}${buildPublicPath(contentInfo.type!, contentInfo.slug!, shareTarget.locale)}?force_variant=${encodeURIComponent(shareTarget.slug)}`;
                  navigator.clipboard.writeText(url).then(() => {
                    toast({ title: "Copied!", description: "Variant link copied to clipboard." });
                  });
                }}
                data-testid="button-copy-share-url"
              >
                <IconCopy className="h-4 w-4" />
              </Button>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setShareTarget(null)} data-testid="button-close-share-modal">
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* DB-single scope selection dialog: choose between promoting to this item or the whole template */}
      <Dialog open={promoteScopeTarget !== null} onOpenChange={(open) => { if (!open && !isPromotingScope) setPromoteScopeTarget(null); }}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle className="text-base">Publicar variante "{promoteScopeTarget?.slug}"</DialogTitle>
            <DialogDescription className="text-sm leading-relaxed">
              Esta variante es un borrador del <strong>template compartido</strong> — el archivo <code className="bg-muted px-1 py-0.5 rounded text-xs">single.{promoteScopeTarget?.locale}.yml</code> que define la estructura visual de <em>todos</em> los items de <code className="bg-muted px-1 py-0.5 rounded text-xs">{contentInfo.type}</code>. Elige cómo aplicar los cambios:
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            {/* Option A — per-entry override */}
            <button
              className="w-full text-left rounded-lg border border-border bg-background hover:bg-muted/50 transition-colors p-4 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              disabled={isPromotingScope}
              onClick={() => handlePromoteWithScope("item")}
              data-testid="button-promote-scope-item"
            >
              <div className="flex gap-3 items-start">
                <span className="text-xl mt-0.5">👤</span>
                <div>
                  <p className="font-semibold text-sm">Solo este item — <span className="font-normal text-muted-foreground">"{contentInfo.slug}"</span></p>
                  <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                    Guarda la variante como un <strong>override per-entry</strong>: crea un archivo exclusivo para este item que sobreescribe el template compartido únicamente aquí. El resto de items del content type <em>no se ven afectados</em>. Ideal para personalizar un item puntual sin tocar los demás.
                  </p>
                  <p className="text-xs text-muted-foreground mt-1.5 font-mono bg-muted/60 rounded px-2 py-1 inline-block">
                    {contentInfo.type}/{contentInfo.slug}/{promoteScopeTarget?.locale}.yml
                  </p>
                </div>
              </div>
            </button>

            {/* Option B — full template */}
            <button
              className="w-full text-left rounded-lg border border-yellow-300 dark:border-yellow-700 bg-background hover:bg-yellow-50 dark:hover:bg-yellow-950/30 transition-colors p-4 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-yellow-400"
              disabled={isPromotingScope}
              onClick={() => handlePromoteWithScope("template")}
              data-testid="button-promote-scope-template"
            >
              <div className="flex gap-3 items-start">
                <span className="text-xl mt-0.5">🌐</span>
                <div>
                  <p className="font-semibold text-sm text-yellow-700 dark:text-yellow-400">Template completo — todos los items de "{contentInfo.type}"</p>
                  <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                    Sobreescribe el <strong>template compartido</strong> con el contenido de esta variante. Todos los items que no tengan un override per-entry verán este cambio automáticamente. La variante borrador se elimina al publicar.
                  </p>
                  <p className="text-xs text-muted-foreground mt-1.5 font-mono bg-muted/60 rounded px-2 py-1 inline-block">
                    {contentInfo.type}/single.{promoteScopeTarget?.locale}.yml
                  </p>
                </div>
              </div>
            </button>
          </div>

          <DialogFooter className="flex items-center gap-2">
            {isPromotingScope && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
            <Button variant="ghost" onClick={() => setPromoteScopeTarget(null)} disabled={isPromotingScope} data-testid="button-cancel-promote-scope">
              Cancelar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={restoreTarget !== null} onOpenChange={(open) => { if (!open) setRestoreTarget(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Restore content folder?</DialogTitle>
            <DialogDescription>
              This will overwrite every file in{" "}
              <code className="text-xs bg-muted px-1 py-0.5 rounded">
                4geeks-com/{contentInfo.type}/{contentInfo.slug}/
              </code>{" "}
              with the versions from commit{" "}
              <code className="text-xs bg-muted px-1 py-0.5 rounded">{restoreTarget?.slice(0, 7)}</code>.
              The restore itself will be saved as a new commit so it can be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setRestoreTarget(null)}
              disabled={isRestoring}
              data-testid="button-cancel-restore"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleRestore}
              disabled={isRestoring}
              data-testid="button-confirm-restore"
            >
              {isRestoring ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <IconArrowBackUp className="h-4 w-4 mr-2" />
              )}
              Yes, restore this snapshot
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
