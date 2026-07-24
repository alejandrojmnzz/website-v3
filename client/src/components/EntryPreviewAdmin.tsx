import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Image, Loader2, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

export interface ContentTypePreviewConfig {
  component: string;
  variant?: string;
  version?: string;
  theme?: "dark" | "light";
  widths?: number[];
  maxHeight?: number;
  dirty_on_prop_change?: boolean;
  props?: Record<string, string>;
}

interface EntryPreviewStats {
  fromSource: number;
  generated: number;
  missing: number;
  dirty: number;
  failed: number;
  preview: boolean;
}

export function EntryPreviewKpiCard({ contentType }: { contentType: string }) {
  const { toast } = useToast();
  const [confirmRetryOpen, setConfirmRetryOpen] = useState(false);

  const { data, isLoading, refetch, isFetching } = useQuery<EntryPreviewStats>({
    queryKey: ["/api/content-types", contentType, "entry-previews", "stats"],
    queryFn: () =>
      fetch(`/api/content-types/${encodeURIComponent(contentType)}/entry-previews/stats`).then((r) =>
        r.json(),
      ),
  });

  const retryMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/content-types/${encodeURIComponent(contentType)}/entry-previews/retry-failed`, {}).then(
        (r) => r.json(),
      ),
    onSuccess: (result: { retried: number }) => {
      toast({
        title: "Retry queued",
        description: `${result.retried} preview(s) marked dirty for re-capture`,
      });
      setConfirmRetryOpen(false);
      refetch();
      queryClient.invalidateQueries({
        queryKey: ["/api/content-types", contentType, "entry-previews"],
      });
    },
    onError: () => {
      toast({ title: "Retry failed", variant: "destructive" });
    },
  });

  return (
    <>
      <Card data-testid="card-kpi-entry-previews">
        <CardContent className="pt-4 pb-3 space-y-1">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Image className="h-3.5 w-3.5" />
              <span>Preview Images</span>
            </div>
            <Button
              size="icon"
              variant="ghost"
              onClick={() => refetch()}
              disabled={isFetching}
              data-testid="button-refresh-entry-preview-stats"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
            </Button>
          </div>
          {isLoading ? (
            <p className="text-sm font-medium">...</p>
          ) : !data?.preview ? (
            <p className="text-xs text-muted-foreground">No preview component configured</p>
          ) : (
            <>
              <p className="text-sm font-medium" data-testid="text-entry-preview-stats">
                {data.generated} gen · {data.fromSource} source · {data.missing} missing
              </p>
              <div className="flex flex-wrap gap-2 text-xs">
                {data.dirty > 0 && (
                  <Badge variant="secondary" data-testid="badge-entry-preview-dirty">
                    {data.dirty} dirty
                  </Badge>
                )}
                {data.failed > 0 && (
                  <button
                    type="button"
                    className="text-red-500 hover:underline"
                    onClick={() => setConfirmRetryOpen(true)}
                    data-testid="button-retry-failed-entry-previews"
                  >
                    {data.failed} failed — Retry
                  </button>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Dialog open={confirmRetryOpen} onOpenChange={setConfirmRetryOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Retry failed previews?</DialogTitle>
            <DialogDescription>
              Clears the failed flag and marks those entries dirty so they can be captured again when
              you open the entries list.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setConfirmRetryOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={retryMutation.isPending}
              onClick={() => retryMutation.mutate()}
              data-testid="button-confirm-retry-failed-previews"
            >
              {retryMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
              Retry failed
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function EntryPreviewConfigCard({
  contentType,
  preview,
}: {
  contentType: string;
  preview: ContentTypePreviewConfig | null | undefined;
}) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [component, setComponent] = useState(preview?.component || "hero");
  const [variant, setVariant] = useState(preview?.variant || "singleColumn");
  const [version, setVersion] = useState(preview?.version || "1.0");
  const [theme, setTheme] = useState<"dark" | "light">(preview?.theme || "dark");
  const [dirtyOnPropChange, setDirtyOnPropChange] = useState(!!preview?.dirty_on_prop_change);
  const [propsText, setPropsText] = useState(
    Object.entries(preview?.props || { title: "title", subtitle: "description" })
      .map(([k, v]) => `${k}: ${v}`)
      .join("\n"),
  );

  useEffect(() => {
    if (!open) return;
    setComponent(preview?.component || "hero");
    setVariant(preview?.variant || "singleColumn");
    setVersion(preview?.version || "1.0");
    setTheme(preview?.theme || "dark");
    setDirtyOnPropChange(!!preview?.dirty_on_prop_change);
    setPropsText(
      Object.entries(preview?.props || { title: "title", subtitle: "description" })
        .map(([k, v]) => `${k}: ${v}`)
        .join("\n"),
    );
  }, [open, preview]);

  const parsedProps = useMemo(() => {
    const out: Record<string, string> = {};
    for (const line of propsText.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const idx = trimmed.indexOf(":");
      if (idx < 0) continue;
      const k = trimmed.slice(0, idx).trim();
      const v = trimmed.slice(idx + 1).trim();
      if (k && v) out[k] = v;
    }
    return out;
  }, [propsText]);

  const save = async (clear = false) => {
    setSaving(true);
    try {
      const body = clear
        ? { preview: null }
        : {
            preview: {
              component: component.trim(),
              variant: variant.trim() || undefined,
              version: version.trim() || undefined,
              theme,
              widths: [1200],
              maxHeight: 630,
              dirty_on_prop_change: dirtyOnPropChange,
              props: parsedProps,
            },
          };
      const res = await apiRequest("PUT", `/api/content-types/${encodeURIComponent(contentType)}/config`, body);
      const data = await res.json();
      if (!res.ok) {
        toast({ title: data.error || "Failed to save preview config", variant: "destructive" });
        return;
      }
      if (data.warning) {
        toast({ title: "Saved with warning", description: data.warning });
      } else {
        toast({ title: clear ? "Preview config cleared" : "Preview config saved" });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/content-types", contentType, "config"] });
      queryClient.invalidateQueries({
        queryKey: ["/api/content-types", contentType, "entry-previews"],
      });
      setOpen(false);
    } catch {
      toast({ title: "Failed to save preview config", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Card data-testid="card-entry-preview-config">
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">OG Preview</CardTitle>
          <Image className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-xs text-muted-foreground leading-relaxed">
            {preview?.component
              ? `${preview.component}${preview.variant ? ` / ${preview.variant}` : ""} — screenshots when image is missing`
              : "Configure a component to generate OG / list thumbnails when image is empty."}
          </p>
          <button
            type="button"
            className="text-xs text-primary hover:underline"
            onClick={() => setOpen(true)}
            data-testid="button-edit-entry-preview-config"
          >
            {preview?.component ? "Edit preview config" : "Configure preview"}
          </button>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Entry preview component</DialogTitle>
            <DialogDescription>
              Used for admin thumbnails and og:image when the reserved image field is missing or 404.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">Component</Label>
                <Input
                  value={component}
                  onChange={(e) => setComponent(e.target.value)}
                  className="text-xs font-mono"
                  data-testid="input-preview-component"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Variant</Label>
                <Input
                  value={variant}
                  onChange={(e) => setVariant(e.target.value)}
                  className="text-xs font-mono"
                  data-testid="input-preview-variant"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Version</Label>
                <Input
                  value={version}
                  onChange={(e) => setVersion(e.target.value)}
                  className="text-xs font-mono"
                  data-testid="input-preview-version"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Theme</Label>
                <div className="flex items-center gap-2 h-9">
                  <Switch
                    checked={theme === "dark"}
                    onCheckedChange={(on) => setTheme(on ? "dark" : "light")}
                    data-testid="switch-preview-theme"
                  />
                  <span className="text-xs text-muted-foreground">{theme}</span>
                </div>
              </div>
            </div>
            <div className="flex items-center justify-between gap-2 rounded-md border px-3 py-2">
              <div>
                <Label className="text-xs">Dirty on prop change</Label>
                <p className="text-[11px] text-muted-foreground">
                  Re-capture when mapped prop values drift from the last capture.
                </p>
              </div>
              <Switch
                checked={dirtyOnPropChange}
                onCheckedChange={setDirtyOnPropChange}
                data-testid="switch-dirty-on-prop-change"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Props map (componentKey: entryField)</Label>
              <textarea
                value={propsText}
                onChange={(e) => setPropsText(e.target.value)}
                className="w-full min-h-[100px] rounded-md border bg-background px-3 py-2 text-xs font-mono"
                data-testid="textarea-preview-props"
              />
              <p className="text-[11px] text-muted-foreground">
                Do not map the reserved <code className="font-mono">image</code> field (circular).
              </p>
            </div>
          </div>
          <DialogFooter className="flex-wrap gap-2">
            {preview?.component && (
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive"
                disabled={saving}
                onClick={() => save(true)}
                data-testid="button-clear-preview-config"
              >
                Clear
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={saving || !component.trim()}
              onClick={() => save(false)}
              data-testid="button-save-preview-config"
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
