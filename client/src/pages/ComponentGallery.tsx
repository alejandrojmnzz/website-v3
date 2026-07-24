import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { GitFork, ImageOff, Loader2, RefreshCw, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  captureComponentScreenshot,
  type CaptureJob,
} from "@/lib/componentScreenshotCapture";
import { useSerializedCaptureQueue } from "@/hooks/useSerializedCaptureQueue";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import type {
  ComponentInsightsData,
  ComponentUsageStat,
} from "@shared/schema";

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

interface InsightsStatus {
  generatedAt: string | null;
  dirty: boolean;
  dirtySince: string | null;
  nextRebuildAt: string | null;
  status: "idle" | "scheduled" | "running";
  debounceMs: number;
}

function jobKey(job: CaptureJob): string {
  return job.exampleKeyed ? `${job.type}::${job.example}` : job.type;
}

function useNoIndex() {
  useEffect(() => {
    const meta = document.createElement("meta");
    meta.name = "robots";
    meta.content = "noindex, nofollow";
    document.head.appendChild(meta);
    return () => {
      document.head.removeChild(meta);
    };
  }, []);
}

function formatVariantLabel(variant: string): string {
  return variant
    .replace(/([A-Z])/g, " $1")
    .replace(/[-_]/g, " ")
    .replace(/^./, (str) => str.toUpperCase())
    .trim();
}

function emptyUsage(): ComponentUsageStat {
  return { totalUses: 0, pageCount: 0, variants: [], byContentType: [] };
}

function groupExamplesByVariant(examples: ExampleMeta[]): Array<{ variant: string; examples: ExampleMeta[] }> {
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

export default function ComponentGallery() {
  useNoIndex();
  const [, setLocation] = useLocation();

  const [search, setSearch] = useState("");
  const [unusedOnly, setUnusedOnly] = useState(false);
  const [usageModalType, setUsageModalType] = useState<string | null>(null);
  const [forkType, setForkType] = useState<string | null>(null);
  const rowRefs = useRef<Map<string, HTMLElement>>(new Map());
  const forkedEnqueueRef = useRef<string | null>(null);

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
  });

  const { data: screenshotIndex, isLoading: shotsLoading } = useQuery<ScreenshotIndex>({
    queryKey: ["/api/private/component-screenshots"],
  });

  const statusQuery = useQuery<InsightsStatus>({
    queryKey: ["/api/private/component-insights/status"],
    refetchInterval: (q) => {
      const st = q.state.data?.status;
      if (st === "running" || st === "scheduled") return 2000;
      return 15000;
    },
  });

  const insightsStatus = statusQuery.data;

  const { data: insights, isError: insightsMissing } = useQuery<ComponentInsightsData>({
    queryKey: ["/api/private/component-insights"],
    retry: false,
    refetchInterval: (q) => {
      if (!q.state.data?.global?.usageByType) return 3000;
      const st = insightsStatus?.status;
      if (st === "running" || st === "scheduled") return 3000;
      return false;
    },
  });

  const forkComp = forkType
    ? registry?.components.find((c) => c.type === forkType) ?? null
    : null;

  const forkExamplesQuery = useQuery<ExamplesPickerPayload>({
    queryKey: [
      "/api/private/component-screenshots",
      forkType,
      "examples",
      forkComp?.latestVersion,
    ],
    enabled: !!forkType && !!forkComp,
    queryFn: async () => {
      const version = forkComp!.latestVersion;
      const res = await fetch(
        `/api/private/component-screenshots/${encodeURIComponent(forkType!)}/examples?version=${encodeURIComponent(version)}`,
        { credentials: "include" },
      );
      if (!res.ok) throw new Error("Failed to load examples");
      return res.json();
    },
  });

  const usageByType = insights?.global?.usageByType ?? {};
  const insightsReady = !!insights?.global?.usageByType;

  const components = registry?.components ?? [];

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return components.filter((c) => {
      if (unusedOnly) {
        const uses = usageByType[c.type]?.totalUses ?? 0;
        if (uses > 0) return false;
      }
      if (!q) return true;
      return (
        c.name.toLowerCase().includes(q) ||
        c.type.toLowerCase().includes(q) ||
        c.description.toLowerCase().includes(q) ||
        c.variants.some((v) => v.toLowerCase().includes(q))
      );
    });
  }, [components, search, unusedOnly, usageByType]);

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
      if (!entry || entry.stale || !entry.url) return true;
      return false;
    },
    [screenshotIndex],
  );

  useEffect(() => {
    if (!registry || !screenshotIndex) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const type = (entry.target as HTMLElement).dataset.componentType;
          if (!type) continue;
          const comp = components.find((c) => c.type === type);
          if (!comp || !needsCapture(comp)) continue;
          const job = jobFor(comp);
          if (job) enqueue(job);
        }
      },
      { rootMargin: "200px 0px", threshold: 0.05 },
    );

    for (const el of rowRefs.current.values()) {
      observer.observe(el);
    }

    return () => observer.disconnect();
  }, [registry, screenshotIndex, components, needsCapture, jobFor, enqueue, filtered]);

  // Lazy auto-capture missing example shots when the fork picker opens
  useEffect(() => {
    if (!forkType || !forkComp || !forkExamplesQuery.data) return;
    const payload = forkExamplesQuery.data;
    const enqueueToken = `${forkType}:${payload.version}:${payload.examples.map((e) => e.name).join(",")}`;
    if (forkedEnqueueRef.current === enqueueToken) return;
    forkedEnqueueRef.current = enqueueToken;

    for (const ex of payload.examples) {
      const entry = payload.index[ex.name];
      const key = `${forkType}::${ex.name}`;
      if (localUrls[key]) continue;
      if (entry?.url && !entry.stale) continue;
      if (ex.sourceMtime === undefined || ex.sourceSize === undefined) continue;
      enqueue(
        {
          type: forkType,
          version: payload.version,
          example: ex.name,
          sourceMtime: ex.sourceMtime,
          sourceSize: ex.sourceSize,
          exampleKeyed: true,
        },
        false,
      );
    }
  }, [forkType, forkComp, forkExamplesQuery.data, enqueue, localUrls]);

  useEffect(() => {
    if (!forkType) forkedEnqueueRef.current = null;
  }, [forkType]);

  const refreshMissing = () => {
    for (const comp of filtered) {
      if (!needsCapture(comp) && captureStatus[comp.type] !== "failed") continue;
      const job = jobFor(comp);
      if (job) enqueue(job, true);
    }
  };

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
    if (!forkType || !forkExamplesQuery.data) return;
    const version = forkExamplesQuery.data.version;
    if (ex.sourceMtime === undefined || ex.sourceSize === undefined) return;
    const key = `${forkType}::${ex.name}`;
    try {
      await apiRequest(
        "DELETE",
        `/api/private/component-screenshots/${encodeURIComponent(forkType)}?example=${encodeURIComponent(ex.name)}`,
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
      queryKey: ["/api/private/component-screenshots", forkType, "examples"],
    });
    enqueue(
      {
        type: forkType,
        version,
        example: ex.name,
        sourceMtime: ex.sourceMtime,
        sourceSize: ex.sourceSize,
        exampleKeyed: true,
      },
      true,
    );
  };

  const thumbUrl = (comp: RegistryComponent): string | null => {
    if (localUrls[comp.type]) return localUrls[comp.type];
    const entry = screenshotIndex?.[comp.type];
    if (entry?.url && !entry.stale) return entry.url;
    return null;
  };

  const exampleThumbUrl = (exampleName: string): string | null => {
    if (!forkType) return null;
    const key = `${forkType}::${exampleName}`;
    if (localUrls[key]) return localUrls[key];
    const entry = forkExamplesQuery.data?.index[exampleName];
    if (entry?.url && !entry.stale) return entry.url;
    // Reuse gallery primary shot while keyed capture is pending
    if (forkComp?.primaryExample?.name === exampleName) {
      if (localUrls[forkType]) return localUrls[forkType];
      const primary = screenshotIndex?.[forkType];
      if (primary?.url && !primary.stale) return primary.url;
    }
    return null;
  };

  const badgeVariantsFor = (comp: RegistryComponent): Array<{ key: string; count: number | null }> => {
    const usage = usageByType[comp.type];
    const countMap = new Map((usage?.variants ?? []).map((v) => [v.variant, v.count]));
    const keys = new Set<string>(["default", ...comp.variants]);
    if (usage) {
      for (const v of usage.variants) keys.add(v.variant);
    }
    return Array.from(keys).map((key) => ({
      key,
      count: insightsReady ? (countMap.get(key) ?? 0) : null,
    }));
  };

  const usageModalComp = usageModalType
    ? components.find((c) => c.type === usageModalType)
    : null;
  const usageModalStat: ComponentUsageStat =
    usageModalType && usageByType[usageModalType]
      ? usageByType[usageModalType]!
      : emptyUsage();

  const isLoading = registryLoading || shotsLoading;
  const rebuilding =
    !insightsReady &&
    (insightsMissing ||
      insightsStatus?.status === "running" ||
      insightsStatus?.status === "scheduled" ||
      !insightsStatus?.generatedAt);

  const forkGroups = useMemo(
    () => groupExamplesByVariant(forkExamplesQuery.data?.examples ?? []),
    [forkExamplesQuery.data?.examples],
  );

  const openExampleInShowcase = (type: string, exampleName: string) => {
    setForkType(null);
    setLocation(
      `/private/component-showcase/${encodeURIComponent(type)}?example=${encodeURIComponent(exampleName)}`,
    );
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <main className="container mx-auto px-4 py-8">
        <div className="max-w-6xl mx-auto space-y-6">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight" data-testid="heading-component-gallery">
              Component Gallery ({components.length} total)
            </h1>
            <p className="text-sm text-muted-foreground">
              Cached screenshots at their natural aspect ratio. Click a card to open the showcase
              editor, or fork to browse all examples.
            </p>
            <p className="text-xs text-muted-foreground" data-testid="text-insights-timing">
              Last rebuild:{" "}
              {insightsStatus?.generatedAt
                ? new Date(insightsStatus.generatedAt).toLocaleString()
                : "—"}
              {" · "}
              Next:{" "}
              {insightsStatus?.status === "running"
                ? "in progress…"
                : insightsStatus?.nextRebuildAt
                  ? new Date(insightsStatus.nextRebuildAt).toLocaleString()
                  : insightsStatus?.dirty
                    ? "scheduled"
                    : "Up to date"}
            </p>
          </div>

          {rebuilding && (
            <div
              className="rounded-lg border border-border bg-muted/40 px-4 py-3.5"
              role="status"
              aria-live="polite"
              data-testid="banner-insights-rebuilding"
            >
              <div className="flex gap-3 items-start">
                <div className="mt-0.5 shrink-0 rounded-full bg-background/80 p-1.5 border border-border/60">
                  <Loader2
                    className="h-4 w-4 animate-spin text-muted-foreground"
                    aria-hidden
                  />
                </div>
                <div className="min-w-0 flex-1 space-y-1.5">
                  <p className="font-medium text-sm leading-snug">
                    {insightsStatus?.status === "scheduled"
                      ? "Usage scan scheduled…"
                      : "Scanning pages for component usage…"}
                  </p>
                  <p className="text-muted-foreground text-xs leading-relaxed">
                    Counting each section&apos;s type and variant across pages, shared templates, and
                    overlays. Browse freely — badge counts and the unused filter update when this
                    finishes.
                  </p>
                  {insightsStatus?.nextRebuildAt && insightsStatus.status === "scheduled" && (
                    <p className="text-[11px] text-muted-foreground/80 font-mono">
                      Starts{" "}
                      {new Date(insightsStatus.nextRebuildAt).toLocaleTimeString()}
                    </p>
                  )}
                </div>
              </div>
              <div
                className="mt-3 h-1 w-full rounded-full bg-border/60 overflow-hidden"
                aria-hidden
              >
                <div
                  className={cn(
                    "h-full w-1/3 rounded-full bg-muted-foreground/45",
                    insightsStatus?.status === "scheduled"
                      ? "animate-pulse w-full opacity-40"
                      : "animate-gallery-scan",
                  )}
                />
              </div>
            </div>
          )}

          <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search components…"
                className="pl-9"
                data-testid="input-gallery-search"
              />
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Switch
                id="unused-only"
                checked={unusedOnly}
                onCheckedChange={setUnusedOnly}
                data-testid="switch-unused-only"
              />
              <Label htmlFor="unused-only" className="text-sm whitespace-nowrap">
                Unused only
              </Label>
            </div>
            <Button
              variant="outline"
              onClick={refreshMissing}
              disabled={isLoading}
              data-testid="button-refresh-missing"
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              Refresh missing
            </Button>
          </div>

          {isLoading ? (
            <div
              className="gallery-masonry"
              style={{ columnCount: 1, columnGap: "1rem" }}
              data-testid="list-component-gallery-skeleton"
            >
              <style>{`
                @media (min-width: 640px) {
                  [data-testid="list-component-gallery-skeleton"] { column-count: 2 !important; }
                }
                @media (min-width: 1024px) {
                  [data-testid="list-component-gallery-skeleton"] { column-count: 3 !important; }
                }
              `}</style>
              {Array.from({ length: 9 }).map((_, i) => (
                <div
                  key={i}
                  className="mb-4 w-full max-w-full break-inside-avoid rounded-lg border border-border bg-card/40 animate-pulse overflow-hidden"
                >
                  <div
                    className="w-full max-w-full bg-muted"
                    style={{ aspectRatio: i % 3 === 0 ? "16/9" : i % 3 === 1 ? "4/5" : "1/1" }}
                  />
                  <div className="p-3 space-y-2">
                    <div className="h-4 w-2/3 bg-muted rounded" />
                    <div className="h-3 w-1/3 bg-muted rounded" />
                  </div>
                </div>
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-12">No components found</p>
          ) : (
            <div
              className="gallery-masonry"
              style={{ columnCount: 1, columnGap: "1rem" }}
              data-testid="list-component-gallery"
            >
              <style>{`
                @media (min-width: 640px) {
                  [data-testid="list-component-gallery"] { column-count: 2 !important; }
                }
                @media (min-width: 1024px) {
                  [data-testid="list-component-gallery"] { column-count: 3 !important; }
                }
              `}</style>
              {filtered.map((comp) => {
                const url = thumbUrl(comp);
                const status = captureStatus[comp.type] || "idle";
                const showingSkeleton =
                  !url && (status === "queued" || status === "capturing" || needsCapture(comp));
                const usage = usageByType[comp.type] ?? emptyUsage();
                const badges = badgeVariantsFor(comp);
                const showcaseHref = `/private/component-showcase/${encodeURIComponent(comp.type)}`;
                const canFork = (comp.exampleCount ?? 0) > 1;

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
                    <div className="rounded-lg border border-border bg-card/40 hover:bg-card/80 transition-colors overflow-hidden w-full max-w-full min-w-0">
                      <div className="group/shot grid min-w-0 isolate">
                        <Link
                          href={showcaseHref}
                          className="col-start-1 row-start-1 block bg-muted min-w-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                          data-testid={`link-gallery-shot-${comp.type}`}
                        >
                          {url ? (
                            <img
                              src={url}
                              alt={`${comp.name} preview`}
                              className="w-full max-w-full h-auto block"
                              loading="lazy"
                            />
                          ) : showingSkeleton ? (
                            <div className="w-full aspect-video flex items-center justify-center bg-muted animate-pulse">
                              <RefreshCw
                                className={cn(
                                  "h-5 w-5 text-muted-foreground",
                                  status === "capturing" && "animate-spin",
                                )}
                              />
                            </div>
                          ) : (
                            <div className="w-full aspect-video flex items-center justify-center bg-muted">
                              <ImageOff className="h-5 w-5 text-muted-foreground" />
                            </div>
                          )}
                        </Link>
                        <div className="col-start-1 row-start-1 z-10 flex w-full items-start justify-end self-stretch gap-1 p-2 pointer-events-none">
                          {canFork ? (
                            <Button
                              type="button"
                              variant="secondary"
                              size="icon"
                              className={cn(
                                "h-8 w-8 shadow-md",
                                "bg-background/90 hover:bg-background border border-border/80 backdrop-blur-sm",
                                "opacity-0 transition-opacity",
                                "group-hover/shot:opacity-100 group-hover/shot:pointer-events-auto",
                                "focus-visible:opacity-100 focus-visible:pointer-events-auto",
                              )}
                              title="Browse examples"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                setForkType(comp.type);
                              }}
                              data-testid={`button-fork-${comp.type}`}
                            >
                              <GitFork className="h-4 w-4" />
                            </Button>
                          ) : null}
                          <Button
                            type="button"
                            variant="secondary"
                            size="icon"
                            className={cn(
                              "h-8 w-8 shadow-md",
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
                            data-testid={`button-refresh-shot-${comp.type}`}
                          >
                            <RefreshCw
                              className={cn("h-4 w-4", status === "capturing" && "animate-spin")}
                            />
                          </Button>
                        </div>
                      </div>

                      <div className="p-3 space-y-2">
                        <div className="flex items-start gap-2">
                          <Link
                            href={showcaseHref}
                            className="min-w-0 flex-1 space-y-0.5"
                            data-testid={`link-gallery-${comp.type}`}
                          >
                            <div className="font-medium text-foreground text-sm leading-snug line-clamp-2">
                              {comp.name}
                            </div>
                            <div className="text-xs text-muted-foreground font-mono truncate">
                              {comp.type}
                            </div>
                          </Link>
                          {insightsReady ? (
                            <button
                              type="button"
                              className="shrink-0 text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline pt-0.5"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                setUsageModalType(comp.type);
                              }}
                              data-testid={`button-usage-${comp.type}`}
                            >
                              {usage.totalUses} use{usage.totalUses === 1 ? "" : "s"}
                            </button>
                          ) : null}
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {badges.map(({ key, count }) => (
                            <Badge key={key} variant="secondary" className="text-xs font-normal">
                              {formatVariantLabel(key)}
                              {count !== null ? ` · ${count}` : ""}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </main>

      <Dialog
        open={!!usageModalType}
        onOpenChange={(open) => {
          if (!open) setUsageModalType(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {usageModalComp?.name ?? usageModalType} usage
            </DialogTitle>
            <DialogDescription className="font-mono text-xs">
              {usageModalType}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 text-sm">
            <p>
              <span className="font-medium">{usageModalStat.totalUses}</span> uses across{" "}
              <span className="font-medium">{usageModalStat.pageCount}</span> pages
            </p>
            <div>
              <h4 className="text-xs font-medium text-muted-foreground mb-2">Content types</h4>
              {usageModalStat.byContentType.length === 0 ? (
                <p className="text-muted-foreground text-xs">No content-type usage recorded.</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {usageModalStat.byContentType.map((ct) => (
                    <Badge key={ct.contentType} variant="outline" className="text-xs font-normal">
                      {ct.contentType} · {ct.count}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
            <div>
              <h4 className="text-xs font-medium text-muted-foreground mb-2">Variants</h4>
              {usageModalStat.variants.length === 0 ? (
                <p className="text-muted-foreground text-xs">No variant usage recorded.</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {usageModalStat.variants.map((v) => (
                    <Badge key={v.variant} variant="secondary" className="text-xs font-normal">
                      {formatVariantLabel(v.variant)} · {v.count}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!forkType}
        onOpenChange={(open) => {
          if (!open) setForkType(null);
        }}
      >
        <DialogContent
          className="sm:max-w-4xl max-h-[85vh] overflow-y-auto bg-background"
          data-testid="dialog-fork-examples"
        >
          <DialogHeader>
            <DialogTitle>{forkComp?.name ?? forkType}</DialogTitle>
            <DialogDescription className="space-y-1">
              <span className="font-mono text-xs block">{forkType}</span>
              <span className="text-xs text-muted-foreground">
                {(forkExamplesQuery.data?.examples.length ?? forkComp?.exampleCount ?? 0)} example
                {(forkExamplesQuery.data?.examples.length ?? forkComp?.exampleCount ?? 0) === 1
                  ? ""
                  : "s"}
                {" · "}
                {forkGroups.length} variant{forkGroups.length === 1 ? "" : "s"}
                {" — click one to open in showcase"}
              </span>
            </DialogDescription>
          </DialogHeader>

          {forkExamplesQuery.isLoading ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin mr-2" />
              Loading examples…
            </div>
          ) : forkExamplesQuery.isError ? (
            <p className="text-sm text-destructive py-8 text-center">Failed to load examples</p>
          ) : forkGroups.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">No examples found</p>
          ) : (
            <div className="space-y-6">
              {forkGroups.map(({ variant, examples }) => (
                <div key={variant} className="space-y-3">
                  <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {formatVariantLabel(variant)}
                    <span className="ml-2 font-normal normal-case tracking-normal">
                      · {examples.length}
                    </span>
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {examples.map((ex) => {
                      const key = forkType ? `${forkType}::${ex.name}` : ex.name;
                      const url = exampleThumbUrl(ex.name);
                      const status = captureStatus[key] || "idle";
                      const capturing = status === "queued" || status === "capturing";

                      return (
                        <div
                          key={ex.name}
                          className="group/ex rounded-lg border border-primary/30 bg-primary/5 overflow-hidden ring-1 ring-primary/20"
                          data-testid={`card-fork-example-${ex.name}`}
                        >
                          <div className="relative">
                            <button
                              type="button"
                              className="block w-full text-left bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                              onClick={() => {
                                if (forkType) openExampleInShowcase(forkType, ex.name);
                              }}
                              data-testid={`button-open-example-${ex.name}`}
                            >
                              {url ? (
                                <img
                                  src={url}
                                  alt={`${ex.name} preview`}
                                  className="w-full h-auto block"
                                  loading="lazy"
                                />
                              ) : (
                                <div className="w-full aspect-video flex flex-col items-center justify-center gap-2 bg-muted/80 px-3">
                                  {capturing ? (
                                    <RefreshCw className="h-5 w-5 text-muted-foreground animate-spin" />
                                  ) : (
                                    <ImageOff className="h-5 w-5 text-muted-foreground" />
                                  )}
                                  <span className="text-xs text-muted-foreground text-center line-clamp-2">
                                    {ex.name}
                                  </span>
                                </div>
                              )}
                            </button>
                            <Button
                              type="button"
                              variant="secondary"
                              size="icon"
                              className={cn(
                                "absolute top-2 right-2 h-7 w-7 shadow-md",
                                "bg-background/90 hover:bg-background border border-border/80",
                                "opacity-0 group-hover/ex:opacity-100 focus-visible:opacity-100 transition-opacity",
                                status === "capturing" && "opacity-100",
                              )}
                              title="Refresh example screenshot"
                              disabled={status === "capturing"}
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                void refreshExampleShot(ex);
                              }}
                              data-testid={`button-refresh-example-${ex.name}`}
                            >
                              <RefreshCw
                                className={cn("h-3.5 w-3.5", status === "capturing" && "animate-spin")}
                              />
                            </Button>
                          </div>
                          <button
                            type="button"
                            className="w-full p-2.5 text-left space-y-1 hover:bg-primary/10 transition-colors"
                            onClick={() => {
                              if (forkType) openExampleInShowcase(forkType, ex.name);
                            }}
                          >
                            <div className="text-sm font-medium text-foreground line-clamp-2">
                              {ex.name}
                            </div>
                            <Badge variant="secondary" className="text-xs font-normal">
                              {formatVariantLabel(ex.variant || "default")}
                            </Badge>
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
