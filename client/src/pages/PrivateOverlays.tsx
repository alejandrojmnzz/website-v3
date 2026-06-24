import { useState } from "react";
import {
  IconArrowLeft,
  IconPlus,
  IconTrash,
  IconEdit,
  IconCheck,
  IconX,
  IconLayersIntersect,
  IconLoader2,
  IconEye,
  IconChevronDown,
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
  if (geo.countries && geo.countries.length > 0) {
    parts.push(geo.countries.join(", "));
  }
  if (geo.regions && geo.regions.length > 0) {
    parts.push(geo.regions.join(", "));
  }
  if (geo.exclude_countries && geo.exclude_countries.length > 0) {
    parts.push(`Excl. ${geo.exclude_countries.join(", ")}`);
  }
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
            {content.title && (
              <span className="font-semibold text-sm">{content.title}</span>
            )}
            {content.body && (
              <span className="text-sm opacity-90">{content.body}</span>
            )}
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
          {content.body && (
            <p className="text-xs text-muted-foreground mb-2">{content.body}</p>
          )}
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
          {content.body && (
            <p className="text-xs text-muted-foreground mb-4">{content.body}</p>
          )}
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

interface OverlayFormProps {
  overlay: Overlay;
  onChange: (o: Overlay) => void;
}

function OverlayForm({ overlay, onChange }: OverlayFormProps) {
  const set = (partial: Partial<Overlay>) =>
    onChange({ ...overlay, ...partial });
  const setContent = (partial: Partial<Overlay["content"]>) =>
    onChange({ ...overlay, content: { ...overlay.content, ...partial } });
  const setTrigger = (partial: Partial<Overlay["trigger"]>) =>
    onChange({ ...overlay, trigger: { ...overlay.trigger, ...partial } });
  const setGeo = (partial: Partial<NonNullable<Overlay["targeting"]["geo"]>>) =>
    onChange({
      ...overlay,
      targeting: {
        ...overlay.targeting,
        geo: { ...(overlay.targeting.geo ?? {}), ...partial },
      },
    });

  const geo = overlay.targeting.geo ?? {};
  const pagesIsAll = overlay.targeting.pages === "all";
  const pagesArray = Array.isArray(overlay.targeting.pages)
    ? overlay.targeting.pages.join("\n")
    : "";

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label>ID</Label>
          <Input
            value={overlay.id}
            onChange={(e) => set({ id: e.target.value })}
            data-testid="input-overlay-id"
          />
        </div>
        <div className="space-y-1.5">
          <Label>Component type</Label>
          <Select
            value={overlay.component}
            onValueChange={(v) => set({ component: v as Overlay["component"] })}
          >
            <SelectTrigger data-testid="select-overlay-component">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="modal">Modal</SelectItem>
              <SelectItem value="top_banner">Top Banner</SelectItem>
              <SelectItem value="slide_in">Slide-In</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label>Trigger event</Label>
          <Select
            value={overlay.trigger.event}
            onValueChange={(v) =>
              setTrigger({ event: v as Overlay["trigger"]["event"] })
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
            {overlay.trigger.event === "scroll_depth"
              ? "Scroll threshold (%)"
              : "Delay (ms)"}
          </Label>
          <Input
            type="number"
            value={overlay.trigger.delay ?? ""}
            onChange={(e) =>
              setTrigger({
                delay: e.target.value === "" ? undefined : Number(e.target.value),
              })
            }
            placeholder={overlay.trigger.event === "scroll_depth" ? "50" : "2000"}
            data-testid="input-overlay-delay"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label>Frequency</Label>
          <Select
            value={overlay.frequency}
            onValueChange={(v) => set({ frequency: v as Overlay["frequency"] })}
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
              onChange({
                ...overlay,
                targeting: {
                  ...overlay.targeting,
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
          <Label>Page paths (one per line)</Label>
          <Textarea
            value={pagesArray}
            rows={3}
            onChange={(e) =>
              onChange({
                ...overlay,
                targeting: {
                  ...overlay.targeting,
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
        <p className="text-sm font-medium text-muted-foreground">Geo targeting (all optional)</p>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>Countries (ISO codes, comma-separated)</Label>
            <Input
              value={(geo.countries ?? []).join(", ")}
              onChange={(e) =>
                setGeo({
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
            <Label>Regions / states (comma-separated)</Label>
            <Input
              value={(geo.regions ?? []).join(", ")}
              onChange={(e) =>
                setGeo({
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
          <Label>Exclude countries (ISO codes, comma-separated)</Label>
          <Input
            value={(geo.exclude_countries ?? []).join(", ")}
            onChange={(e) =>
              setGeo({
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

      <div className="border-t pt-4 space-y-3">
        <p className="text-sm font-medium text-muted-foreground">Content</p>
        <div className="space-y-1.5">
          <Label>Title</Label>
          <Input
            value={overlay.content.title}
            onChange={(e) => setContent({ title: e.target.value })}
            placeholder="Enter a headline"
            data-testid="input-overlay-title"
          />
        </div>
        <div className="space-y-1.5">
          <Label>Body</Label>
          <Textarea
            value={overlay.content.body}
            rows={3}
            onChange={(e) => setContent({ body: e.target.value })}
            placeholder="Supporting copy"
            data-testid="input-overlay-body"
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>CTA label</Label>
            <Input
              value={overlay.content.cta?.label ?? ""}
              onChange={(e) =>
                setContent({ cta: { ...(overlay.content.cta ?? {}), label: e.target.value, href: overlay.content.cta?.href ?? "" } })
              }
              placeholder="Apply now"
              data-testid="input-overlay-cta-label"
            />
          </div>
          <div className="space-y-1.5">
            <Label>CTA URL</Label>
            <Input
              value={overlay.content.cta?.href ?? ""}
              onChange={(e) =>
                setContent({ cta: { ...(overlay.content.cta ?? {}), href: e.target.value, label: overlay.content.cta?.label ?? "" } })
              }
              placeholder="/en/apply"
              data-testid="input-overlay-cta-href"
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label>Image ID (from image registry, optional)</Label>
          <Input
            value={overlay.content.image_id ?? ""}
            onChange={(e) => setContent({ image_id: e.target.value })}
            placeholder="my-image-id"
            data-testid="input-overlay-image-id"
          />
        </div>
      </div>
    </div>
  );
}

export default function PrivateOverlays() {
  const { toast } = useToast();
  const [editingOverlay, setEditingOverlay] = useState<Overlay | null>(null);
  const [editDraft, setEditDraft] = useState<Overlay | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [expandedPreviewId, setExpandedPreviewId] = useState<string | null>(null);

  const { data, isLoading } = useQuery<OverlayConfig>({
    queryKey: ["/api/overlays"],
    staleTime: 30_000,
  });

  const overlays: Overlay[] = data?.overlays ?? [];

  async function saveAll(updated: Overlay[]) {
    setSaving(true);
    try {
      await apiRequest("PUT", "/api/overlays", { overlays: updated });
      await queryClient.invalidateQueries({ queryKey: ["/api/overlays"] });
      toast({ title: "Overlays saved" });
    } catch {
      toast({ title: "Failed to save overlays", variant: "destructive" });
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

  function openCreate() {
    const o = newOverlay();
    setEditingOverlay(o);
    setEditDraft(o);
  }

  function openEdit(overlay: Overlay) {
    setEditingOverlay(overlay);
    setEditDraft(structuredClone(overlay));
  }

  async function saveEdit() {
    if (!editDraft) return;
    const isNew = !overlays.find((o) => o.id === editDraft.id);
    const updated = isNew
      ? [...overlays, editDraft]
      : overlays.map((o) => (o.id === editDraft.id ? editDraft : o));
    await saveAll(updated);
    setEditingOverlay(null);
    setEditDraft(null);
  }

  async function deleteOverlay(id: string) {
    const updated = overlays.filter((o) => o.id !== id);
    await saveAll(updated);
    setConfirmDeleteId(null);
  }

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
        <Button onClick={openCreate} data-testid="button-create-overlay">
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
                    onClick={() => openEdit(overlay)}
                    data-testid={`button-edit-overlay-${overlay.id}`}
                  >
                    <IconEdit size={16} />
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

      {/* Edit / Create dialog */}
      <Dialog
        open={!!editingOverlay}
        onOpenChange={(open) => {
          if (!open) {
            setEditingOverlay(null);
            setEditDraft(null);
          }
        }}
      >
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editDraft && overlays.find((o) => o.id === editDraft.id)
                ? "Edit overlay"
                : "New overlay"}
            </DialogTitle>
          </DialogHeader>
          {editDraft && (
            <OverlayForm overlay={editDraft} onChange={setEditDraft} />
          )}
          <DialogFooter className="gap-2">
            <Button
              variant="ghost"
              onClick={() => {
                setEditingOverlay(null);
                setEditDraft(null);
              }}
              data-testid="button-cancel-overlay-edit"
            >
              Cancel
            </Button>
            <Button
              onClick={saveEdit}
              disabled={saving}
              data-testid="button-save-overlay"
            >
              {saving ? (
                <IconLoader2 size={16} className="animate-spin" />
              ) : (
                <IconCheck size={16} />
              )}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
    </div>
  );
}
