import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Image, ImageOff, Loader2, Pencil, RefreshCw, X } from "lucide-react";
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
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  ComponentPickerV2,
  type ComponentPickerV2Selection,
} from "@/components/editing/ComponentPickerV2";
import {
  collectMappablePropsFromSchema,
  type PreviewPropDef,
} from "@shared/entry-preview-props";

export interface ContentTypePreviewConfig {
  component: string;
  variant?: string;
  version?: string;
  theme?: "dark" | "light";
  widths?: number[];
  maxHeight?: number;
  dirty_on_prop_change?: boolean;
  /** Component data key (supports dotted paths like `left.heading`) → entry field name. */
  props?: Record<string, string>;
}

interface EntryPreviewStats {
  fromSource: number;
  generated: number;
  missing: number;
  dirty: number;
  failed: number;
  preview: boolean;
  captureReady?: boolean;
  captureReadyError?: string;
}

interface ComponentSchemaPayload {
  name?: string;
  props?: Record<string, PreviewPropDef>;
  /** Some schemas (e.g. ai_learning) use base_props instead of props. */
  base_props?: Record<string, PreviewPropDef>;
  variant_props?: Record<string, Record<string, PreviewPropDef>>;
}

interface ScreenshotIndexEntry {
  url: string;
  stale: boolean;
}

type ScreenshotIndex = Record<string, ScreenshotIndexEntry>;

interface RegistryOverview {
  components: Array<{ type: string; name: string }>;
}

const UNMAPPED = "__unmapped__";

function collectMappableProps(
  schema: ComponentSchemaPayload | undefined,
  variant: string,
): Array<{ key: string; required: boolean; description?: string }> {
  return collectMappablePropsFromSchema(schema, variant);
}

export function EntryPreviewCard({
  contentType,
  preview,
  fieldMapping,
}: {
  contentType: string;
  preview: ContentTypePreviewConfig | null | undefined;
  fieldMapping?: Record<string, string | { source: string; default: string }> | null;
}) {
  const { toast } = useToast();
  const [confirmRetryOpen, setConfirmRetryOpen] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const [component, setComponent] = useState(preview?.component || "");
  const [variant, setVariant] = useState(preview?.variant || "");
  const [version, setVersion] = useState(preview?.version || "");
  const [theme, setTheme] = useState<"dark" | "light">(preview?.theme || "dark");
  const [dirtyOnPropChange, setDirtyOnPropChange] = useState(!!preview?.dirty_on_prop_change);
  const [propsMap, setPropsMap] = useState<Record<string, string>>(preview?.props || {});
  const [mappingDirty, setMappingDirty] = useState(false);
  const [baselineKey, setBaselineKey] = useState(
    `${preview?.component || ""}::${preview?.variant || ""}`,
  );
  /** Skip draft reset when reopening config after picker (select or cancel). */
  const skipPreviewSyncRef = useRef(false);

  const { data, isLoading, refetch, isFetching } = useQuery<EntryPreviewStats>({
    queryKey: ["/api/content-types", contentType, "entry-previews", "stats"],
    queryFn: () =>
      fetch(`/api/content-types/${encodeURIComponent(contentType)}/entry-previews/stats`).then((r) =>
        r.json(),
      ),
  });

  const { data: registry } = useQuery<RegistryOverview>({
    queryKey: ["/api/component-registry"],
  });

  const { data: screenshotIndex } = useQuery<ScreenshotIndex>({
    queryKey: ["/api/private/component-screenshots"],
  });

  const schemaVersion = version || "1.0";
  const { data: schema } = useQuery<ComponentSchemaPayload>({
    queryKey: ["/api/component-registry", component, schemaVersion, "schema"],
    enabled: !!component && configOpen,
    queryFn: async () => {
      const res = await fetch(
        `/api/component-registry/${encodeURIComponent(component)}/${encodeURIComponent(schemaVersion)}/schema`,
      );
      if (!res.ok) throw new Error("Schema not found");
      return res.json();
    },
  });

  const retryMutation = useMutation({
    mutationFn: () =>
      apiRequest(
        "POST",
        `/api/content-types/${encodeURIComponent(contentType)}/entry-previews/retry-failed`,
        {},
      ).then((r) => r.json()),
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

  useEffect(() => {
    if (!configOpen) return;
    if (skipPreviewSyncRef.current) {
      skipPreviewSyncRef.current = false;
      return;
    }
    setComponent(preview?.component || "");
    setVariant(preview?.variant || "");
    setVersion(preview?.version || "");
    setTheme(preview?.theme || "dark");
    setDirtyOnPropChange(!!preview?.dirty_on_prop_change);
    setPropsMap(preview?.props || {});
    setBaselineKey(`${preview?.component || ""}::${preview?.variant || ""}`);
    setMappingDirty(false);
  }, [configOpen, preview]);

  const mappableProps = useMemo(
    () => collectMappableProps(schema, variant || "default"),
    [schema, variant],
  );

  const fieldOptions = useMemo(() => {
    const keys: string[] = [];
    if (fieldMapping) {
      for (const k of Object.keys(fieldMapping)) {
        if (k.startsWith("_") || k === "image") continue;
        keys.push(k);
      }
    }
    keys.sort();
    return keys;
  }, [fieldMapping]);

  const requiredUnmapped = useMemo(() => {
    return mappableProps.filter((p) => p.required && !propsMap[p.key]?.trim());
  }, [mappableProps, propsMap]);

  const mappedCount = useMemo(
    () => Object.values(propsMap).filter((v) => typeof v === "string" && v.trim()).length,
    [propsMap],
  );

  /** Ready to save / capture: has mappable fields, all required mapped, ≥1 mapping. */
  const mappingsReady =
    !!component.trim() &&
    !!schema &&
    mappableProps.length > 0 &&
    requiredUnmapped.length === 0 &&
    mappedCount > 0;

  const incompatibleComponent = !!component.trim() && !!schema && mappableProps.length === 0;

  // Allow cancel when component has no mappable fields (user must pick another); otherwise
  // block dismiss after a component change until required mappings are done.
  const canDismiss =
    !mappingDirty ||
    mappingsReady ||
    incompatibleComponent ||
    !component.trim();
  const canSave = mappingsReady;

  const componentDisplayName =
    registry?.components.find((c) => c.type === component)?.name || component;
  const thumbUrl =
    component && screenshotIndex?.[component]?.url && !screenshotIndex[component].stale
      ? screenshotIndex[component].url
      : "";

  const openPicker = () => {
    skipPreviewSyncRef.current = true;
    setConfigOpen(false);
    // Allow dialog exit animation before opening picker (no nested dialogs)
    window.setTimeout(() => setPickerOpen(true), 150);
  };

  const handlePickerOpenChange = (open: boolean) => {
    setPickerOpen(open);
    if (!open) {
      // Preserve draft (picker cancel) or selection (onSelect already applied)
      skipPreviewSyncRef.current = true;
      window.setTimeout(() => setConfigOpen(true), 150);
    }
  };

  const handlePickerSelect = (sel: ComponentPickerV2Selection) => {
    const nextKey = `${sel.type}::${sel.variant}`;
    const changed = nextKey !== baselineKey;
    setComponent(sel.type);
    setVariant(sel.variant);
    setVersion(sel.version);
    if (changed) {
      setPropsMap({});
      setMappingDirty(true);
      setBaselineKey(nextKey);
    }
    // pickExample also calls onOpenChange(false); that path reopens config
    // with skipPreviewSyncRef so this selection is not wiped by the preview sync.
    skipPreviewSyncRef.current = true;
    setPickerOpen(false);
  };

  const setPropMapping = (compKey: string, entryField: string) => {
    setPropsMap((prev) => {
      const next = { ...prev };
      if (!entryField || entryField === UNMAPPED) delete next[compKey];
      else next[compKey] = entryField;
      return next;
    });
  };

  const requestCloseConfig = (nextOpen: boolean) => {
    if (!nextOpen && !canDismiss) {
      toast({
        title: "Finish property mappings",
        description:
          "Map every required property (and at least one field) before closing, or clear the component.",
        variant: "destructive",
      });
      return;
    }
    setConfigOpen(nextOpen);
  };

  const save = async (clear = false) => {
    if (!clear && !canSave) {
      toast({
        title: incompatibleComponent
          ? "Component not compatible"
          : "Finish property mappings",
        description: incompatibleComponent
          ? "This component has no simple fields to map. Pick a different component."
          : requiredUnmapped.length > 0
            ? `Map required properties: ${requiredUnmapped.map((p) => p.key).join(", ")}`
            : "Map at least one component property to a content-type field before saving.",
        variant: "destructive",
      });
      return;
    }
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
              props: propsMap,
            },
          };
      const res = await apiRequest(
        "PUT",
        `/api/content-types/${encodeURIComponent(contentType)}/config`,
        body,
      );
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
      queryClient.invalidateQueries({
        queryKey: ["/api/content-types", contentType, "entry-previews", "stats"],
      });
      setMappingDirty(false);
      setConfigOpen(false);
    } catch {
      toast({ title: "Failed to save preview config", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const hasPreview = !!preview?.component;

  return (
    <>
      <Card data-testid="card-entry-preview">
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">OG Preview</CardTitle>
          <div className="flex items-center gap-1">
            {hasPreview && (
              <Button
                size="icon"
                variant="ghost"
                onClick={() => refetch()}
                disabled={isFetching}
                data-testid="button-refresh-entry-preview-stats"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
              </Button>
            )}
            <Image className="h-4 w-4 text-muted-foreground" />
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-xs text-muted-foreground leading-relaxed">
            {hasPreview
              ? `${preview.component}${preview.variant ? ` / ${preview.variant}` : ""} — screenshots for admin thumbnails and og:image when the reserved image field is empty.`
              : "Configure a component to generate OG / list thumbnails when image is empty."}
          </p>

          {hasPreview && (
            <div className="space-y-1">
              {isLoading ? (
                <p className="text-sm font-medium">...</p>
              ) : data?.captureReady === false ? (
                <p
                  className="text-xs text-destructive leading-relaxed"
                  data-testid="text-entry-preview-not-ready"
                >
                  {data.captureReadyError ||
                    "Preview mappings incomplete — captures are paused until you fix the config."}
                </p>
              ) : (
                <>
                  <p className="text-sm font-medium" data-testid="text-entry-preview-stats">
                    {data?.generated ?? 0} gen · {data?.fromSource ?? 0} source · {data?.missing ?? 0}{" "}
                    missing
                  </p>
                  <div className="flex flex-wrap gap-2 text-xs">
                    {(data?.dirty ?? 0) > 0 && (
                      <Badge variant="secondary" data-testid="badge-entry-preview-dirty">
                        {data!.dirty} dirty
                      </Badge>
                    )}
                    {(data?.failed ?? 0) > 0 && (
                      <button
                        type="button"
                        className="text-destructive hover:underline"
                        onClick={() => setConfirmRetryOpen(true)}
                        data-testid="button-retry-failed-entry-previews"
                      >
                        {data!.failed} failed — Retry
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          <button
            type="button"
            className="text-xs text-primary hover:underline"
            onClick={() => setConfigOpen(true)}
            data-testid="button-edit-entry-preview-config"
          >
            {hasPreview ? "Edit preview config" : "Configure preview"}
          </button>
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

      <Dialog open={configOpen} onOpenChange={requestCloseConfig}>
        <DialogContent
          className="sm:max-w-lg max-h-[85vh] overflow-y-auto"
          onPointerDownOutside={(e) => {
            if (!canDismiss) e.preventDefault();
          }}
          onEscapeKeyDown={(e) => {
            if (!canDismiss) e.preventDefault();
          }}
        >
          <DialogHeader>
            <DialogTitle>Entry preview component</DialogTitle>
            <DialogDescription>
              Map component fields (including nested paths like{" "}
              <code className="font-mono text-[10px]">left.heading</code>) to content-type fields.
              Required top-level props and at least one mapping are needed before saving.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Summary card */}
            {component ? (
              <div
                className="flex items-stretch gap-3 rounded-lg border border-border overflow-hidden"
                data-testid="card-preview-component-summary"
              >
                <div className="w-28 shrink-0 bg-muted flex items-center justify-center">
                  {thumbUrl ? (
                    <img src={thumbUrl} alt="" className="w-full h-full object-cover max-h-24" />
                  ) : (
                    <ImageOff className="h-6 w-6 text-muted-foreground" />
                  )}
                </div>
                <div className="flex-1 min-w-0 py-2 pr-2 flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{componentDisplayName}</p>
                    <p className="text-[11px] text-muted-foreground font-mono truncate">
                      {component}
                      {variant ? ` / ${variant}` : ""}
                      {version ? ` @ ${version}` : ""}
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 shrink-0"
                    onClick={openPicker}
                    data-testid="button-edit-preview-component"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={openPicker}
                className="w-full rounded-lg border border-dashed border-border px-4 py-6 text-sm text-muted-foreground hover:bg-muted/40 transition-colors"
                data-testid="button-choose-preview-component"
              >
                Choose a component for OG / list thumbnails
              </button>
            )}

            <div className="flex items-center justify-between gap-2 rounded-md border px-3 py-2">
              <div>
                <Label className="text-xs">Theme</Label>
                <p className="text-[11px] text-muted-foreground">Capture theme for screenshots</p>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  checked={theme === "dark"}
                  onCheckedChange={(on) => setTheme(on ? "dark" : "light")}
                  data-testid="switch-preview-theme"
                />
                <span className="text-xs text-muted-foreground">{theme}</span>
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

            {component && (
              <div className="space-y-2">
                <div className="flex items-baseline justify-between gap-2">
                  <Label className="text-xs">Property mappings</Label>
                  <p className="text-[10px] text-muted-foreground shrink-0">
                    <span className="text-destructive font-medium">Required</span> must be mapped · others optional
                  </p>
                </div>
                {mappingDirty && requiredUnmapped.length > 0 && (
                  <p className="text-[11px] text-destructive" data-testid="text-mapping-required">
                    Required unmapped: {requiredUnmapped.map((p) => p.key).join(", ")}
                  </p>
                )}
                {!mappingsReady &&
                  !!schema &&
                  mappableProps.length > 0 &&
                  requiredUnmapped.length === 0 &&
                  mappedCount === 0 && (
                    <p className="text-[11px] text-destructive" data-testid="text-mapping-at-least-one">
                      Map at least one property before saving.
                    </p>
                  )}
                {mappableProps.length === 0 ? (
                  <p className="text-[11px] text-destructive" data-testid="text-mapping-incompatible">
                    {schema
                      ? "No simple fields to map for this variant (including nested paths like left.heading). Arrays are still skipped — pick another component."
                      : "Loading schema…"}
                  </p>
                ) : (
                  <div className="space-y-2" data-testid="list-preview-prop-mappings">
                    {mappableProps.map((prop) => {
                      const mapped = !!propsMap[prop.key]?.trim();
                      return (
                        <div key={prop.key} className="flex items-center gap-2">
                          <div className="w-[40%] min-w-0">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <p className="text-xs font-mono truncate" title={prop.key}>
                                {prop.key}
                              </p>
                              {prop.required ? (
                                <Badge
                                  variant="outline"
                                  className="h-4 shrink-0 px-1 text-[9px] font-medium text-destructive border-destructive/40"
                                  data-testid={`badge-preview-prop-required-${prop.key}`}
                                >
                                  Required
                                </Badge>
                              ) : null}
                            </div>
                            {prop.description ? (
                              <p className="text-[10px] text-muted-foreground line-clamp-1">
                                {prop.description}
                              </p>
                            ) : null}
                          </div>
                          <Select
                            value={propsMap[prop.key] || UNMAPPED}
                            onValueChange={(v) => setPropMapping(prop.key, v)}
                          >
                            <SelectTrigger
                              className="flex-1 h-9 text-xs font-mono"
                              data-testid={`select-preview-prop-${prop.key}`}
                            >
                              <SelectValue placeholder="Content field" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value={UNMAPPED} className="text-xs text-muted-foreground">
                                — not mapped —
                              </SelectItem>
                              {fieldOptions.map((f) => (
                                <SelectItem key={f} value={f} className="text-xs font-mono">
                                  {f}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {!prop.required ? (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
                              disabled={!mapped}
                              title={mapped ? "Clear mapping" : "Not mapped"}
                              onClick={() => setPropMapping(prop.key, UNMAPPED)}
                              data-testid={`button-clear-preview-prop-${prop.key}`}
                            >
                              <X className="h-3.5 w-3.5" />
                            </Button>
                          ) : (
                            <span className="w-8 shrink-0" aria-hidden />
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
                <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
                  <CollapsibleTrigger asChild>
                    <button type="button" className="text-[11px] text-primary hover:underline">
                      {advancedOpen ? "Hide advanced" : "Read more (advanced)"}
                    </button>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="text-[11px] text-muted-foreground space-y-1 pt-1">
                    <p>
                      Schema:{" "}
                      <code className="font-mono">
                        component-registry/{component || "{type}"}/{schemaVersion}/schema
                      </code>
                    </p>
                    <p>
                      Picker:{" "}
                      <code className="font-mono">
                        client/src/components/editing/ComponentPickerV2.tsx
                      </code>
                    </p>
                    <p>Do not map the reserved image field (circular).</p>
                  </CollapsibleContent>
                </Collapsible>
              </div>
            )}
          </div>

          <DialogFooter className="flex-wrap gap-2">
            {preview?.component && (
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive"
                disabled={saving || !canDismiss}
                onClick={() => save(true)}
                data-testid="button-clear-preview-config"
              >
                Clear
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              disabled={!canDismiss}
              onClick={() => requestCloseConfig(false)}
              data-testid="button-cancel-preview-config"
            >
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={saving || !canSave}
              onClick={() => save(false)}
              data-testid="button-save-preview-config"
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ComponentPickerV2
        open={pickerOpen}
        onOpenChange={handlePickerOpenChange}
        onSelect={handlePickerSelect}
        initialType={component || undefined}
        title="Choose preview component"
      />
    </>
  );
}
