import { useState } from "react";
import {
  IconArrowLeft,
  IconPlus,
  IconTrash,
  IconCheck,
  IconX,
  IconLayersIntersect,
  IconLoader2,
  IconEye,
  IconFileText,
  IconAdjustments,
} from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

import { Link } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Overlay, OverlayConfig } from "@/hooks/useOverlays";

const COMPONENT_LABELS: Record<string, string> = {
  modal: "Modal",
  top_banner: "Top Banner",
  slide_in: "Slide-In",
};

const TRIGGER_LABELS: Record<string, string> = {
  page_load: "Page Load",
  time_delay: "Time Delay",
  scroll_depth: "Scroll Depth",
  exit_intent: "Exit Intent",
};

const FREQUENCY_LABELS: Record<string, string> = {
  once: "Once",
  session: "Per Session",
  always: "Always",
};

function triggerDelayLabel(overlay: Overlay): string {
  const ev = overlay.trigger.event;
  if ((ev === "page_load" || ev === "time_delay") && overlay.trigger.delay) {
    return `${overlay.trigger.delay}ms`;
  }
  if (ev === "scroll_depth" && overlay.trigger.delay != null) {
    return `${overlay.trigger.delay}%`;
  }
  return "";
}

function pageTargetingLabel(overlay: Overlay): string {
  const pages = overlay.targeting.pages;
  if (pages === "all") return "All pages";
  if (Array.isArray(pages)) {
    if (pages.length === 0) return "No pages";
    if (pages.length === 1) return pages[0];
    return `${pages.length} pages`;
  }
  return "All pages";
}

function geoTargetingLabel(overlay: Overlay): string {
  const geo = overlay.targeting.geo;
  if (!geo) return "All countries";
  const parts: string[] = [];
  if (geo.countries && geo.countries.length > 0) parts.push(geo.countries.join(", "));
  if (geo.regions && geo.regions.length > 0) parts.push(geo.regions.join(", "));
  if (geo.exclude_countries && geo.exclude_countries.length > 0)
    parts.push(`Excl. ${geo.exclude_countries.join(", ")}`);
  return parts.length > 0 ? parts.join(" · ") : "All countries";
}

function newOverlay(): Overlay {
  return {
    id: `overlay-${Date.now()}`,
    enabled: true,
    trigger: { event: "page_load", delay: 0 },
    targeting: { pages: "all", geo: {} },
    frequency: "once",
    component: "modal",
    content: { title: "", body: "", cta: { label: "", href: "" }, image_id: "" },
  };
}

function OverlayInlinePreview({ overlay }: { overlay: Overlay }) {
  const { content } = overlay;

  const ctaButton = content.cta?.label ? (
    <span className="inline-flex items-center rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground cursor-default select-none">
      {content.cta.label}
    </span>
  ) : null;

  if (overlay.component === "top_banner") {
    return (
      <div className="rounded-md overflow-hidden border border-border">
        <div className="bg-primary text-primary-foreground px-4 py-2 flex items-center gap-3">
          <div className="flex-1 min-w-0 flex flex-wrap items-center gap-2">
            {content.title && <span className="font-semibold text-sm">{content.title}</span>}
            {content.body && <span className="text-sm opacity-90">{content.body}</span>}
            {ctaButton}
          </div>
          <span className="shrink-0 opacity-60 cursor-default">
            <IconX size={14} />
          </span>
        </div>
        <div className="bg-muted/30 h-14 flex items-center justify-center">
          <span className="text-xs text-muted-foreground">Page content below</span>
        </div>
      </div>
    );
  }

  if (overlay.component === "slide_in") {
    return (
      <div className="rounded-md overflow-hidden border border-border bg-muted/20 relative" style={{ minHeight: "10rem" }}>
        <div className="absolute bottom-3 right-3 w-64 rounded-[0.8rem] border border-border bg-card shadow-md p-3">
          <div className="flex items-start justify-between gap-2 mb-1">
            <span className="text-sm font-semibold leading-snug">{content.title}</span>
            <span className="opacity-40 cursor-default shrink-0"><IconX size={14} /></span>
          </div>
          {content.body && <p className="text-xs text-muted-foreground mb-2">{content.body}</p>}
          {ctaButton}
        </div>
        <div className="h-10 flex items-start pl-3 pt-3">
          <span className="text-xs text-muted-foreground">Page content</span>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-md overflow-hidden border border-border bg-muted/20 relative" style={{ minHeight: "12rem" }}>
      <div className="absolute inset-0 bg-background/60 backdrop-blur-[1px] flex items-center justify-center p-4">
        <div className="w-full max-w-sm rounded-[0.8rem] border border-border bg-card shadow-lg p-5">
          <div className="flex items-start justify-between gap-2 mb-2">
            <span className="text-sm font-semibold leading-snug">{content.title || "Untitled overlay"}</span>
            <span className="opacity-40 cursor-default shrink-0"><IconX size={14} /></span>
          </div>
          {content.body && <p className="text-xs text-muted-foreground mb-4">{content.body}</p>}
          <div className="flex justify-end gap-2">
            <span className="inline-flex items-center rounded-md px-3 py-1.5 text-xs font-medium border border-border cursor-default">
              Dismiss
            </span>
            {ctaButton}
          </div>
        </div>
      </div>
      <div className="h-10 flex items-start pl-3 pt-3">
        <span className="text-xs text-muted-foreground">Page content</span>
      </div>
    </div>
  );
}

type SheetTab = "content" | "conditions";

export default function PrivateOverlays() {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [expandedPreviewId, setExpandedPreviewId] = useState<string | null>(null);

  const [sheetDraft, setSheetDraft] = useState<Overlay | null>(null);
  const [sheetTab, setSheetTab] = useState<SheetTab>("content");
  const [sheetSaving, setSheetSaving] = useState(false);

  const { data, isLoading } = useQuery<OverlayConfig>({
    queryKey: ["/api/overlays"],
    staleTime: 30_000,
  });

  const overlays: Overlay[] = data?.overlays ?? [];

  async function saveAll(updated: Overlay[]): Promise<boolean> {
    setSaving(true);
    try {
      await apiRequest("PUT", "/api/overlays", { overlays: updated });
      await queryClient.invalidateQueries({ queryKey: ["/api/overlays"] });
      toast({ title: "Overlays saved" });
      return true;
    } catch {
      toast({ title: "Failed to save overlays", variant: "destructive" });
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function toggleEnabled(overlay: Overlay) {
    const updated = overlays.map((o) =>
      o.id === overlay.id ? { ...o, enabled: !o.enabled } : o
    );
    await saveAll(updated);
  }

  function openSheet(overlay: Overlay | null) {
    const draft = overlay ? structuredClone(overlay) : newOverlay();
    setSheetDraft(draft);
    setSheetTab("content");
  }

  function closeSheet() {
    setSheetDraft(null);
  }

  function handleTabChange(tab: string) {
    setSheetTab(tab as SheetTab);
  }

  function patchContent(partial: Partial<Overlay["content"]>) {
    if (!sheetDraft) return;
    setSheetDraft({ ...sheetDraft, content: { ...sheetDraft.content, ...partial } });
  }

  function patchOverlay(partial: Partial<Overlay>) {
    if (!sheetDraft) return;
    setSheetDraft({ ...sheetDraft, ...partial });
  }

  function patchTrigger(partial: Partial<Overlay["trigger"]>) {
    if (!sheetDraft) return;
    setSheetDraft({ ...sheetDraft, trigger: { ...sheetDraft.trigger, ...partial } });
  }

  function patchGeo(partial: Partial<NonNullable<Overlay["targeting"]["geo"]>>) {
    if (!sheetDraft) return;
    setSheetDraft({
      ...sheetDraft,
      targeting: {
        ...sheetDraft.targeting,
        geo: { ...(sheetDraft.targeting.geo ?? {}), ...partial },
      },
    });
  }

  async function saveSheet() {
    if (!sheetDraft) return;
    const toSave = sheetDraft;
    if (!toSave.id?.trim()) {
      toast({ title: "Overlay ID is required", variant: "destructive" });
      return;
    }
    setSheetSaving(true);
    try {
      const isNew = !overlays.find((o) => o.id === sheetDraft.id);
      const updated = isNew
        ? [...overlays, toSave]
        : overlays.map((o) => (o.id === sheetDraft.id ? toSave : o));
      const ok = await saveAll(updated);
      if (ok) closeSheet();
    } finally {
      setSheetSaving(false);
    }
  }

  async function deleteOverlay(id: string) {
    const updated = overlays.filter((o) => o.id !== id);
    await saveAll(updated);
    setConfirmDeleteId(null);
  }

  const geo = sheetDraft?.targeting.geo ?? {};
  const pagesIsAll = sheetDraft?.targeting.pages === "all";
  const pagesArray = Array.isArray(sheetDraft?.targeting.pages)
    ? sheetDraft!.targeting.pages.join("\n")
    : "";
  const isNewOverlay = sheetDraft ? !overlays.find((o) => o.id === sheetDraft.id) : false;

  return (
    <div className="max-w-4xl mx-auto py-8 px-4 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/private/diagnostics">
              <IconArrowLeft size={18} />
            </Link>
          </Button>
          <div>
            <h1 className="text-xl font-semibold flex items-center gap-2">
              <IconLayersIntersect size={20} />
              Modals &amp; CTA Overlays
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Event-triggered overlays — configure triggers, page targeting, geo targeting, and frequency.
            </p>
          </div>
        </div>
        <Button onClick={() => openSheet(null)} data-testid="button-create-overlay">
          <IconPlus size={16} />
          New overlay
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground gap-2">
          <IconLoader2 size={18} className="animate-spin" />
          Loading overlays…
        </div>
      ) : overlays.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <IconLayersIntersect size={32} className="mx-auto mb-3 opacity-40" />
            <p className="font-medium">No overlays configured</p>
            <p className="text-sm mt-1">
              Click &ldquo;New overlay&rdquo; to create your first modal, banner, or slide-in.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {overlays.map((overlay) => (
            <Card key={overlay.id} data-testid={`card-overlay-${overlay.id}`}>
              <CardHeader className="pb-3 flex flex-row items-start justify-between gap-3">
                <div className="space-y-1 min-w-0">
                  <CardTitle className="text-base flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm">{overlay.id}</span>
                    <Badge variant={overlay.enabled ? "default" : "secondary"}>
                      {overlay.enabled ? "Enabled" : "Disabled"}
                    </Badge>
                    <Badge variant="outline">
                      {COMPONENT_LABELS[overlay.component] ?? overlay.component}
                    </Badge>
                  </CardTitle>
                  <CardDescription className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
                    <span>
                      <span className="text-foreground/60">Trigger:</span>{" "}
                      {TRIGGER_LABELS[overlay.trigger.event] ?? overlay.trigger.event}
                      {triggerDelayLabel(overlay) && ` (${triggerDelayLabel(overlay)})`}
                    </span>
                    <span>
                      <span className="text-foreground/60">Freq:</span>{" "}
                      {FREQUENCY_LABELS[overlay.frequency] ?? overlay.frequency}
                    </span>
                    <span>
                      <span className="text-foreground/60">Pages:</span>{" "}
                      {pageTargetingLabel(overlay)}
                    </span>
                    <span>
                      <span className="text-foreground/60">Geo:</span>{" "}
                      {geoTargetingLabel(overlay)}
                    </span>
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Switch
                    checked={overlay.enabled}
                    onCheckedChange={() => toggleEnabled(overlay)}
                    aria-label="Toggle enabled"
                    data-testid={`switch-overlay-enabled-${overlay.id}`}
                    disabled={saving}
                  />
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() =>
                      setExpandedPreviewId(
                        expandedPreviewId === overlay.id ? null : overlay.id
                      )
                    }
                    aria-label="Toggle preview"
                    data-testid={`button-preview-overlay-${overlay.id}`}
                    className={expandedPreviewId === overlay.id ? "toggle-elevate toggle-elevated" : "toggle-elevate"}
                  >
                    <IconEye size={16} />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => openSheet(overlay)}
                    title="Edit overlay"
                    data-testid={`button-edit-overlay-${overlay.id}`}
                  >
                    <IconCode size={16} />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => setConfirmDeleteId(overlay.id)}
                    data-testid={`button-delete-overlay-${overlay.id}`}
                  >
                    <IconTrash size={16} />
                  </Button>
                </div>
              </CardHeader>
              {overlay.content.title && (
                <CardContent className="pt-0 pb-3">
                  <p className="text-sm font-medium">{overlay.content.title}</p>
                  {overlay.content.body && (
                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                      {overlay.content.body}
                    </p>
                  )}
                </CardContent>
              )}
              {expandedPreviewId === overlay.id && (
                <CardContent className="pt-0 pb-4 border-t border-border mt-1">
                  <div className="flex items-center gap-1.5 mb-3 text-xs text-muted-foreground">
                    <IconEye size={12} />
                    Preview
                    <span className="ml-auto opacity-60">
                      {COMPONENT_LABELS[overlay.component] ?? overlay.component}
                    </span>
                  </div>
                  <OverlayInlinePreview overlay={overlay} />
                </CardContent>
              )}
            </Card>
          ))}
        </div>
      )}

      {/* Delete confirmation */}
      <Dialog
        open={!!confirmDeleteId}
        onOpenChange={(open) => { if (!open) setConfirmDeleteId(null); }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete overlay?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This will permanently remove{" "}
            <span className="font-mono">{confirmDeleteId}</span> from the YAML.
            This cannot be undone.
          </p>
          <DialogFooter className="gap-2">
            <Button
              variant="ghost"
              onClick={() => setConfirmDeleteId(null)}
              data-testid="button-cancel-delete-overlay"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => confirmDeleteId && deleteOverlay(confirmDeleteId)}
              disabled={saving}
              data-testid="button-confirm-delete-overlay"
            >
              {saving ? <IconLoader2 size={16} className="animate-spin" /> : <IconTrash size={16} />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 3-tab overlay editor sheet */}
      <Sheet open={!!sheetDraft} onOpenChange={(open) => { if (!open) closeSheet(); }}>
        <SheetContent side="right" className="w-full sm:max-w-2xl flex flex-col p-0">
          <SheetHeader className="px-6 pt-6 pb-4 shrink-0">
            <SheetTitle className="flex items-center gap-2">
              <IconLayersIntersect size={18} />
              {isNewOverlay ? "New overlay" : sheetDraft?.id}
            </SheetTitle>
            <SheetDescription>
              {isNewOverlay
                ? "Configure content, conditions, and trigger settings for the new overlay."
                : "Edit content, conditions, or raw YAML for this overlay."}
            </SheetDescription>
          </SheetHeader>

          <Tabs
            value={sheetTab}
            onValueChange={handleTabChange}
            className="flex-1 flex flex-col"
          >
            <TabsList className="w-full shrink-0 rounded-none border-b bg-transparent p-0 h-auto justify-start gap-0">
              <TabsTrigger value="content" className="flex items-center gap-1.5 rounded-none px-5 py-3 data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary -mb-px" data-testid="tab-content">
                <IconFileText size={14} />
                Content
              </TabsTrigger>
              <TabsTrigger value="conditions" className="flex items-center gap-1.5 rounded-none px-5 py-3 data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary -mb-px" data-testid="tab-conditions">
                <IconAdjustments size={14} />
                Conditions
              </TabsTrigger>
            </TabsList>

            {/* Content tab */}
            <TabsContent value="content" style={{ height: "calc(100vh - 242px)" }} className="overflow-y-auto overflow-x-hidden px-6 py-4 mt-0">
              {sheetDraft && (
                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <Label>Title</Label>
                    <Input
                      value={sheetDraft.content.title}
                      onChange={(e) => patchContent({ title: e.target.value })}
                      placeholder="Enter a headline"
                      data-testid="input-overlay-title"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Body</Label>
                    <Textarea
                      value={sheetDraft.content.body}
                      rows={3}
                      onChange={(e) => patchContent({ body: e.target.value })}
                      placeholder="Supporting copy"
                      data-testid="input-overlay-body"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label>CTA label</Label>
                      <Input
                        value={sheetDraft.content.cta?.label ?? ""}
                        onChange={(e) =>
                          patchContent({
                            cta: {
                              ...(sheetDraft.content.cta ?? {}),
                              label: e.target.value,
                              href: sheetDraft.content.cta?.href ?? "",
                            },
                          })
                        }
                        placeholder="Apply now"
                        data-testid="input-overlay-cta-label"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>CTA URL</Label>
                      <Input
                        value={sheetDraft.content.cta?.href ?? ""}
                        onChange={(e) =>
                          patchContent({
                            cta: {
                              ...(sheetDraft.content.cta ?? {}),
                              href: e.target.value,
                              label: sheetDraft.content.cta?.label ?? "",
                            },
                          })
                        }
                        placeholder="/en/apply"
                        data-testid="input-overlay-cta-href"
                      />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Image ID <span className="text-muted-foreground font-normal">(from image registry, optional)</span></Label>
                    <Input
                      value={sheetDraft.content.image_id ?? ""}
                      onChange={(e) => patchContent({ image_id: e.target.value })}
                      placeholder="my-image-id"
                      data-testid="input-overlay-image-id"
                    />
                  </div>
                </div>
              )}
            </TabsContent>

            {/* Conditions tab */}
            <TabsContent value="conditions" style={{ height: "calc(100vh - 242px)" }} className="overflow-y-auto overflow-x-hidden px-6 py-4 mt-0">
              {sheetDraft && (
                <div className="space-y-5">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label>Trigger event</Label>
                      <Select
                        value={sheetDraft.trigger.event}
                        onValueChange={(v) =>
                          patchTrigger({ event: v as Overlay["trigger"]["event"] })
                        }
                      >
                        <SelectTrigger data-testid="select-overlay-trigger">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="page_load">Page Load</SelectItem>
                          <SelectItem value="time_delay">Time Delay</SelectItem>
                          <SelectItem value="scroll_depth">Scroll Depth</SelectItem>
                          <SelectItem value="exit_intent">Exit Intent</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label>
                        {sheetDraft.trigger.event === "scroll_depth"
                          ? "Scroll threshold (%)"
                          : "Delay (ms)"}
                      </Label>
                      <Input
                        type="number"
                        value={sheetDraft.trigger.delay ?? ""}
                        onChange={(e) =>
                          patchTrigger({
                            delay: e.target.value === "" ? undefined : Number(e.target.value),
                          })
                        }
                        placeholder={sheetDraft.trigger.event === "scroll_depth" ? "50" : "2000"}
                        data-testid="input-overlay-delay"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label>Frequency</Label>
                      <Select
                        value={sheetDraft.frequency}
                        onValueChange={(v) => patchOverlay({ frequency: v as Overlay["frequency"] })}
                      >
                        <SelectTrigger data-testid="select-overlay-frequency">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="once">Once (localStorage)</SelectItem>
                          <SelectItem value="session">Per session</SelectItem>
                          <SelectItem value="always">Always</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Page targeting</Label>
                      <Select
                        value={pagesIsAll ? "all" : "specific"}
                        onValueChange={(v) =>
                          patchOverlay({
                            targeting: {
                              ...sheetDraft.targeting,
                              pages: v === "all" ? "all" : [],
                            },
                          })
                        }
                      >
                        <SelectTrigger data-testid="select-overlay-pages">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All pages</SelectItem>
                          <SelectItem value="specific">Specific pages</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  {!pagesIsAll && (
                    <div className="space-y-1.5">
                      <Label>Page paths <span className="text-muted-foreground font-normal">(one per line)</span></Label>
                      <Textarea
                        value={pagesArray}
                        rows={3}
                        onChange={(e) =>
                          patchOverlay({
                            targeting: {
                              ...sheetDraft.targeting,
                              pages: e.target.value
                                .split("\n")
                                .map((s) => s.trim())
                                .filter(Boolean),
                            },
                          })
                        }
                        placeholder="/en/career-programs&#10;/es/programas-de-carrera"
                        data-testid="input-overlay-pages"
                      />
                    </div>
                  )}

                  <div className="border-t pt-4 space-y-3">
                    <p className="text-sm font-medium text-muted-foreground">Geo targeting <span className="font-normal">(all optional)</span></p>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <Label>Countries <span className="text-muted-foreground font-normal">(ISO codes, comma-separated)</span></Label>
                        <Input
                          value={(geo.countries ?? []).join(", ")}
                          onChange={(e) =>
                            patchGeo({
                              countries: e.target.value
                                .split(",")
                                .map((s) => s.trim().toUpperCase())
                                .filter(Boolean),
                            })
                          }
                          placeholder="US, CA"
                          data-testid="input-overlay-countries"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Regions / states <span className="text-muted-foreground font-normal">(comma-separated)</span></Label>
                        <Input
                          value={(geo.regions ?? []).join(", ")}
                          onChange={(e) =>
                            patchGeo({
                              regions: e.target.value
                                .split(",")
                                .map((s) => s.trim())
                                .filter(Boolean),
                            })
                          }
                          placeholder="Florida, Texas"
                          data-testid="input-overlay-regions"
                        />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Exclude countries <span className="text-muted-foreground font-normal">(ISO codes, comma-separated)</span></Label>
                      <Input
                        value={(geo.exclude_countries ?? []).join(", ")}
                        onChange={(e) =>
                          patchGeo({
                            exclude_countries: e.target.value
                              .split(",")
                              .map((s) => s.trim().toUpperCase())
                              .filter(Boolean),
                          })
                        }
                        placeholder="GB, AU"
                        data-testid="input-overlay-exclude-countries"
                      />
                    </div>
                  </div>
                </div>
              )}
            </TabsContent>

          </Tabs>

          <div className="px-6 py-4 border-t flex justify-end gap-2 shrink-0">
            <Button
              variant="ghost"
              onClick={closeSheet}
              data-testid="button-cancel-sheet"
            >
              <IconX size={16} />
              Cancel
            </Button>
            <Button
              onClick={saveSheet}
              disabled={sheetSaving}
              data-testid="button-save-sheet"
            >
              {sheetSaving ? (
                <IconLoader2 size={16} className="animate-spin" />
              ) : (
                <IconCheck size={16} />
              )}
              Save
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
