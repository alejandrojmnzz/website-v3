import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, ImageOff, Loader2, RefreshCw, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
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
import {
  captureComponentScreenshot,
  type CaptureJob,
} from "@/lib/componentScreenshotCapture";
import { useSerializedCaptureQueue } from "@/hooks/useSerializedCaptureQueue";
import { cn } from "@/lib/utils";

export interface ComponentPickerV2Selection {
  type: string;
  version: string;
  variant: string;
  exampleName: string;
}

export interface ComponentPickerV2Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (selection: ComponentPickerV2Selection) => void;
  initialType?: string;
  title?: string;
}

interface PrimaryExampleMeta {
  name: string;
  version: string;
  sourceMtime: number;
  sourceSize: number;
}

interface RegistryComponent {
  type: string;
  name: string;
  description: string;
  latestVersion: string;
  versions: string[];
  variants: string[];
  exampleCount: number;
  primaryExample?: PrimaryExampleMeta;
}

interface RegistryOverview {
  components: RegistryComponent[];
}

interface ScreenshotIndexEntry {
  url: string;
  stale: boolean;
  meta: {
    version: string;
    example: string;
    sourceMtime: number;
    sourceSize: number;
    capturedAt: string;
  } | null;
}

type ScreenshotIndex = Record<string, ScreenshotIndexEntry>;

interface ExampleMeta {
  name: string;
  description: string;
  yaml: string;
  variant?: string;
  sourceMtime?: number;
  sourceSize?: number;
}

interface ExamplesPickerPayload {
  version: string;
  examples: ExampleMeta[];
  index: Record<string, ScreenshotIndexEntry>;
}

const RESERVED = new Set(["common", "_common", "shared", "_shared", "utils", "_utils"]);

function jobKey(job: CaptureJob): string {
  return job.exampleKeyed ? `${job.type}::${job.example}` : job.type;
}

function groupExamplesByVariant(
  examples: ExampleMeta[],
): Array<{ variant: string; examples: ExampleMeta[] }> {
  const grouped = examples.reduce(
    (acc, ex) => {
      const variant = ex.variant || "default";
      if (!acc[variant]) acc[variant] = [];
      acc[variant].push(ex);
      return acc;
    },
    {} as Record<string, ExampleMeta[]>,
  );
  return Object.keys(grouped)
    .sort((a, b) => {
      if (a === "default") return -1;
      if (b === "default") return 1;
      return a.localeCompare(b);
    })
    .map((variant) => ({ variant, examples: grouped[variant]! }));
}

export function ComponentPickerV2({
  open,
  onOpenChange,
  onSelect,
  initialType,
  title = "Choose a component",
}: ComponentPickerV2Props) {
  const [step, setStep] = useState<"components" | "examples">("components");
  const [search, setSearch] = useState("");
  const [exampleSearch, setExampleSearch] = useState("");
  const [variantFilter, setVariantFilter] = useState<string>("all");
  const [selected, setSelected] = useState<RegistryComponent | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const rowRefs = useRef<Map<string, HTMLElement>>(new Map());
  const appliedInitialRef = useRef(false);

  const {
    enqueue,
    status: captureStatus,
    urls: localUrls,
    setUrls: setLocalUrls,
  } = useSerializedCaptureQueue<CaptureJob>({
    jobKey,
    run: captureComponentScreenshot,
    onSuccess: (job) => {
      if (job.exampleKeyed) {
        queryClient.invalidateQueries({
          queryKey: ["/api/private/component-screenshots", job.type, "examples"],
        });
      } else {
        queryClient.invalidateQueries({ queryKey: ["/api/private/component-screenshots"] });
      }
    },
  });

  const { data: registry, isLoading: registryLoading } = useQuery<RegistryOverview>({
    queryKey: ["/api/component-registry"],
    enabled: open,
  });

  const { data: screenshotIndex, isLoading: shotsLoading } = useQuery<ScreenshotIndex>({
    queryKey: ["/api/private/component-screenshots"],
    enabled: open,
  });

  const examplesQuery = useQuery<ExamplesPickerPayload>({
    queryKey: [
      "/api/private/component-screenshots",
      selected?.type,
      "examples",
      selected?.latestVersion,
    ],
    enabled: open && step === "examples" && !!selected,
    queryFn: async () => {
      const version = selected!.latestVersion;
      const res = await fetch(
        `/api/private/component-screenshots/${encodeURIComponent(selected!.type)}/examples?version=${encodeURIComponent(version)}`,
        { credentials: "include" },
      );
      if (!res.ok) throw new Error("Failed to load examples");
      return res.json();
    },
  });

  useEffect(() => {
    if (!open) {
      setStep("components");
      setSearch("");
      setExampleSearch("");
      setVariantFilter("all");
      setSelected(null);
      setAdvancedOpen(false);
      appliedInitialRef.current = false;
      return;
    }
    if (appliedInitialRef.current || !initialType || !registry?.components) return;
    const found = registry.components.find((c) => c.type === initialType);
    if (found && (found.exampleCount ?? 0) > 0) {
      setSelected(found);
      setStep("examples");
      appliedInitialRef.current = true;
    }
  }, [open, initialType, registry]);

  const components = useMemo(
    () => (registry?.components ?? []).filter((c) => !RESERVED.has(c.type.toLowerCase())),
    [registry],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return components;
    return components.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.type.toLowerCase().includes(q) ||
        (c.description || "").toLowerCase().includes(q),
    );
  }, [components, search]);

  const jobFor = useCallback((comp: RegistryComponent): CaptureJob | null => {
    if (!comp.primaryExample) return null;
    return {
      type: comp.type,
      version: comp.primaryExample.version || comp.latestVersion,
      example: comp.primaryExample.name,
      sourceMtime: comp.primaryExample.sourceMtime,
      sourceSize: comp.primaryExample.sourceSize,
    };
  }, []);

  const needsCapture = useCallback(
    (comp: RegistryComponent): boolean => {
      if (!comp.primaryExample) return false;
      const entry = screenshotIndex?.[comp.type];
      return !entry || entry.stale || !entry.url;
    },
    [screenshotIndex],
  );

  const thumbUrl = useCallback(
    (comp: RegistryComponent): string => {
      if (localUrls[comp.type]) return localUrls[comp.type];
      const entry = screenshotIndex?.[comp.type];
      if (entry?.url && !entry.stale) return entry.url;
      return "";
    },
    [localUrls, screenshotIndex],
  );

  useEffect(() => {
    if (!open || step !== "components" || !registry || !screenshotIndex) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const type = (entry.target as HTMLElement).dataset.componentType;
          if (!type) continue;
          const comp = components.find((c) => c.type === type);
          if (!comp || !needsCapture(comp) || (comp.exampleCount ?? 0) === 0) continue;
          const job = jobFor(comp);
          if (job) enqueue(job);
        }
      },
      { rootMargin: "200px 0px", threshold: 0.05 },
    );
    for (const el of rowRefs.current.values()) observer.observe(el);
    return () => observer.disconnect();
  }, [open, step, registry, screenshotIndex, components, needsCapture, jobFor, enqueue, filtered]);

  useEffect(() => {
    if (!open || step !== "examples" || !selected || !examplesQuery.data) return;
    const payload = examplesQuery.data;
    for (const ex of payload.examples) {
      const entry = payload.index[ex.name];
      const key = `${selected.type}::${ex.name}`;
      if (localUrls[key]) continue;
      if (entry?.url && !entry.stale) continue;
      if (ex.sourceMtime === undefined || ex.sourceSize === undefined) continue;
      enqueue(
        {
          type: selected.type,
          version: payload.version,
          example: ex.name,
          sourceMtime: ex.sourceMtime,
          sourceSize: ex.sourceSize,
          exampleKeyed: true,
        },
        false,
      );
    }
  }, [open, step, selected, examplesQuery.data, enqueue, localUrls]);

  const refreshOne = async (comp: RegistryComponent) => {
    const job = jobFor(comp);
    if (!job) return;
    try {
      await apiRequest("DELETE", `/api/private/component-screenshots/${encodeURIComponent(comp.type)}`);
    } catch {
      /* ignore */
    }
    setLocalUrls((prev) => {
      const next = { ...prev };
      delete next[comp.type];
      return next;
    });
    await queryClient.invalidateQueries({ queryKey: ["/api/private/component-screenshots"] });
    enqueue(job, true);
  };

  const refreshExampleShot = async (ex: ExampleMeta) => {
    if (!selected || !examplesQuery.data) return;
    if (ex.sourceMtime === undefined || ex.sourceSize === undefined) return;
    const key = `${selected.type}::${ex.name}`;
    try {
      await apiRequest(
        "DELETE",
        `/api/private/component-screenshots/${encodeURIComponent(selected.type)}?example=${encodeURIComponent(ex.name)}`,
      );
    } catch {
      /* ignore */
    }
    setLocalUrls((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    await queryClient.invalidateQueries({
      queryKey: ["/api/private/component-screenshots", selected.type, "examples"],
    });
    enqueue(
      {
        type: selected.type,
        version: examplesQuery.data.version,
        example: ex.name,
        sourceMtime: ex.sourceMtime,
        sourceSize: ex.sourceSize,
        exampleKeyed: true,
      },
      true,
    );
  };

  const exampleThumbUrl = (ex: ExampleMeta): string => {
    if (!selected) return "";
    const key = `${selected.type}::${ex.name}`;
    if (localUrls[key]) return localUrls[key];
    const entry = examplesQuery.data?.index[ex.name];
    if (entry?.url && !entry.stale) return entry.url;
    return "";
  };

  const filteredExamples = useMemo(() => {
    const list = examplesQuery.data?.examples ?? [];
    const q = exampleSearch.trim().toLowerCase();
    return list.filter((ex) => {
      if (variantFilter !== "all" && (ex.variant || "default") !== variantFilter) return false;
      if (!q) return true;
      return (
        ex.name.toLowerCase().includes(q) ||
        (ex.description || "").toLowerCase().includes(q)
      );
    });
  }, [examplesQuery.data, exampleSearch, variantFilter]);

  const variantOptions = useMemo(() => {
    const groups = groupExamplesByVariant(examplesQuery.data?.examples ?? []);
    return groups.map((g) => g.variant);
  }, [examplesQuery.data]);

  const pickComponent = (comp: RegistryComponent) => {
    if ((comp.exampleCount ?? 0) === 0) return;
    setSelected(comp);
    setExampleSearch("");
    setVariantFilter("all");
    setStep("examples");
  };

  const pickExample = (ex: ExampleMeta) => {
    if (!selected) return;
    onSelect({
      type: selected.type,
      version: examplesQuery.data?.version || selected.latestVersion,
      variant: ex.variant || "default",
      exampleName: ex.name,
    });
    onOpenChange(false);
  };

  const isLoading = registryLoading || shotsLoading;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-4xl max-h-[85vh] flex flex-col gap-0 p-0 overflow-hidden"
        data-testid="dialog-component-picker-v2"
      >
        <DialogHeader className="px-6 pt-6 pb-3 space-y-2 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            {step === "examples" && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0"
                onClick={() => {
                  setStep("components");
                  setSelected(null);
                }}
                data-testid="button-picker-v2-back"
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
            )}
            <DialogTitle className="text-left">
              {step === "components"
                ? title
                : `Examples — ${selected?.name || selected?.type || ""}`}
            </DialogTitle>
          </div>
          <DialogDescription className="text-left text-xs leading-relaxed">
            Select a component, then an example. This only selects — it does not add a section to the
            page. Cards with no examples show a red badge and cannot be selected.
          </DialogDescription>
          <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="text-[11px] text-primary hover:underline text-left"
                data-testid="button-picker-v2-read-more"
              >
                {advancedOpen ? "Hide advanced" : "Read more (advanced)"}
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent className="text-[11px] text-muted-foreground space-y-1 pt-1">
              <p>
                Picker:{" "}
                <code className="font-mono">client/src/components/editing/ComponentPickerV2.tsx</code>
              </p>
              <p>
                Screenshots: <code className="font-mono">server/component-screenshots.ts</code>
              </p>
              <p>
                Inserting sections still uses{" "}
                <code className="font-mono">ComponentPickerModal</code>.
              </p>
            </CollapsibleContent>
          </Collapsible>
        </DialogHeader>

        <div className="px-6 py-3 border-b border-border shrink-0 flex flex-wrap gap-2 items-center">
          {step === "components" ? (
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name, type, description…"
                className="pl-8 h-9 text-sm"
                data-testid="input-picker-v2-search"
              />
            </div>
          ) : (
            <>
              <div className="relative flex-1 min-w-[160px]">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  value={exampleSearch}
                  onChange={(e) => setExampleSearch(e.target.value)}
                  placeholder="Search examples…"
                  className="pl-8 h-9 text-sm"
                  data-testid="input-picker-v2-example-search"
                />
              </div>
              <Select value={variantFilter} onValueChange={setVariantFilter}>
                <SelectTrigger className="w-[160px] h-9 text-xs" data-testid="select-picker-v2-variant">
                  <SelectValue placeholder="Variant" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All variants</SelectItem>
                  {variantOptions.map((v) => (
                    <SelectItem key={v} value={v}>
                      {v}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 min-h-0">
          {step === "components" && (
            <>
              {isLoading ? (
                <div className="flex items-center justify-center py-16 text-muted-foreground text-sm gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading components…
                </div>
              ) : filtered.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-12">No components match</p>
              ) : (
                <div
                  className="picker-v2-masonry"
                  style={{ columnCount: 1, columnGap: "1rem" }}
                  data-testid="list-picker-v2-components"
                >
                  <style>{`
                    @media (min-width: 640px) {
                      [data-testid="list-picker-v2-components"] { column-count: 2 !important; }
                    }
                    @media (min-width: 1024px) {
                      [data-testid="list-picker-v2-components"] { column-count: 3 !important; }
                    }
                  `}</style>
                  {filtered.map((comp) => {
                    const noExamples = (comp.exampleCount ?? 0) === 0;
                    const url = thumbUrl(comp);
                    const status = captureStatus[comp.type] || "idle";
                    const showingSkeleton =
                      !url &&
                      !noExamples &&
                      (status === "queued" || status === "capturing" || needsCapture(comp));
                    return (
                      <div
                        key={comp.type}
                        ref={(el) => {
                          if (el) rowRefs.current.set(comp.type, el);
                          else rowRefs.current.delete(comp.type);
                        }}
                        data-component-type={comp.type}
                        className="mb-4 w-full max-w-full break-inside-avoid"
                      >
                        <div
                          className={cn(
                            "rounded-lg border border-border bg-card/40 overflow-hidden w-full",
                            noExamples
                              ? "opacity-70"
                              : "hover:bg-card/80 transition-colors cursor-pointer",
                          )}
                        >
                          <div className="group/shot grid min-w-0 isolate bg-muted">
                            <button
                              type="button"
                              className="col-start-1 row-start-1 block w-full min-w-0 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                              disabled={noExamples}
                              onClick={() => pickComponent(comp)}
                              data-testid={`button-picker-v2-comp-${comp.type}`}
                            >
                              {url ? (
                                <img
                                  src={url}
                                  alt=""
                                  className="w-full max-w-full h-auto block"
                                  loading="lazy"
                                />
                              ) : showingSkeleton ? (
                                <div className="w-full aspect-video flex items-center justify-center">
                                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                                </div>
                              ) : (
                                <div className="w-full aspect-video flex items-center justify-center">
                                  <ImageOff className="h-6 w-6 text-muted-foreground" />
                                </div>
                              )}
                            </button>
                            {!noExamples && (
                              <div className="col-start-1 row-start-1 z-10 flex w-full items-start justify-end self-stretch gap-1 p-2 pointer-events-none">
                                <Button
                                  type="button"
                                  variant="secondary"
                                  size="icon"
                                  className={cn(
                                    "h-8 w-8 shadow-md pointer-events-none",
                                    "bg-background/90 hover:bg-background border border-border/80 backdrop-blur-sm",
                                    "opacity-0 transition-opacity",
                                    "group-hover/shot:opacity-100 group-hover/shot:pointer-events-auto",
                                    "focus-visible:opacity-100 focus-visible:pointer-events-auto",
                                    status === "capturing" && "opacity-100 pointer-events-auto",
                                  )}
                                  title="Refresh screenshot"
                                  disabled={!comp.primaryExample || status === "capturing"}
                                  onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    void refreshOne(comp);
                                  }}
                                  data-testid={`button-picker-v2-refresh-${comp.type}`}
                                >
                                  <RefreshCw
                                    className={cn("h-4 w-4", status === "capturing" && "animate-spin")}
                                  />
                                </Button>
                              </div>
                            )}
                          </div>
                          <div className="p-3 space-y-1">
                            <div className="flex items-start gap-2">
                              <div className="min-w-0 flex-1">
                                <div className="font-medium text-sm leading-snug line-clamp-2">
                                  {comp.name}
                                </div>
                                <div className="text-xs text-muted-foreground font-mono truncate">
                                  {comp.type}
                                </div>
                              </div>
                              {noExamples && (
                                <Badge
                                  variant="destructive"
                                  className="shrink-0 text-[10px] gap-1"
                                  data-testid={`badge-picker-v2-no-examples-${comp.type}`}
                                >
                                  <AlertTriangle className="h-3 w-3" />
                                  No examples
                                </Badge>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}

          {step === "examples" && (
            <>
              {examplesQuery.isLoading ? (
                <div className="flex items-center justify-center py-16 text-muted-foreground text-sm gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading examples…
                </div>
              ) : filteredExamples.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-12">
                  No examples for this filter
                </p>
              ) : (
                <div
                  className="picker-v2-masonry"
                  style={{ columnCount: 1, columnGap: "1rem" }}
                  data-testid="list-picker-v2-examples"
                >
                  <style>{`
                    @media (min-width: 640px) {
                      [data-testid="list-picker-v2-examples"] { column-count: 2 !important; }
                    }
                    @media (min-width: 1024px) {
                      [data-testid="list-picker-v2-examples"] { column-count: 3 !important; }
                    }
                  `}</style>
                  {filteredExamples.map((ex) => {
                    const url = exampleThumbUrl(ex);
                    const key = selected ? `${selected.type}::${ex.name}` : ex.name;
                    const status = captureStatus[key] || "idle";
                    return (
                      <div key={ex.name} className="mb-4 w-full max-w-full break-inside-avoid">
                        <div className="rounded-lg border border-border bg-card/40 hover:bg-card/80 transition-colors overflow-hidden cursor-pointer">
                          <div className="group/shot grid min-w-0 isolate bg-muted">
                            <button
                              type="button"
                              className="col-start-1 row-start-1 block w-full min-w-0 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                              onClick={() => pickExample(ex)}
                              data-testid={`button-picker-v2-example-${ex.name}`}
                            >
                              {url ? (
                                <img
                                  src={url}
                                  alt=""
                                  className="w-full max-w-full h-auto block"
                                  loading="lazy"
                                />
                              ) : status === "queued" || status === "capturing" ? (
                                <div className="w-full aspect-video flex items-center justify-center">
                                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                                </div>
                              ) : (
                                <div className="w-full aspect-video flex items-center justify-center">
                                  <ImageOff className="h-6 w-6 text-muted-foreground" />
                                </div>
                              )}
                            </button>
                            <div className="col-start-1 row-start-1 z-10 flex w-full items-start justify-end self-stretch gap-1 p-2 pointer-events-none">
                              <Button
                                type="button"
                                variant="secondary"
                                size="icon"
                                className={cn(
                                  "h-8 w-8 shadow-md pointer-events-none",
                                  "bg-background/90 hover:bg-background border border-border/80 backdrop-blur-sm",
                                  "opacity-0 transition-opacity",
                                  "group-hover/shot:opacity-100 group-hover/shot:pointer-events-auto",
                                  "focus-visible:opacity-100 focus-visible:pointer-events-auto",
                                  status === "capturing" && "opacity-100 pointer-events-auto",
                                )}
                                title="Refresh screenshot"
                                disabled={
                                  ex.sourceMtime === undefined ||
                                  ex.sourceSize === undefined ||
                                  status === "capturing"
                                }
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  void refreshExampleShot(ex);
                                }}
                                data-testid={`button-picker-v2-refresh-example-${ex.name}`}
                              >
                                <RefreshCw
                                  className={cn("h-4 w-4", status === "capturing" && "animate-spin")}
                                />
                              </Button>
                            </div>
                          </div>
                          <div className="p-3 space-y-1">
                            <div className="font-medium text-sm leading-snug line-clamp-2">
                              {ex.name}
                            </div>
                            <Badge variant="secondary" className="text-[10px] font-mono">
                              {ex.variant || "default"}
                            </Badge>
                            {ex.description ? (
                              <p className="text-[11px] text-muted-foreground line-clamp-2">
                                {ex.description}
                              </p>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default ComponentPickerV2;
