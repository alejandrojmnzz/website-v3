import { useEffect, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, ArrowLeft, Bot, BotOff, Brain, Check, ChevronDown, Crosshair, ExternalLink, FileText, Globe, Info, Loader2, Network, Plus, Star, Trash2 } from "lucide-react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import type {
  GscInspectEnqueueResponse,
  GscInspectMode,
  GscInspectionGetResponse,
  GscInspectionRecord,
  GscInspectionSummary,
  GscInspectQueueStats,
} from "@/lib/gscInspection";
import { gscHeadline, gscInspectModeLabel } from "@/lib/gscInspection";
import { getSessionHeaders } from "@/lib/sessionHeaders";
import { getDebugToken, resolveAuthorName, useDebugAuth } from "@/hooks/useDebugAuth";
import { useToast } from "@/hooks/use-toast";
import { apiRequestWithAuth, queryClient } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { deslugifyLabel } from "@shared/relation-field";
import { formatSitePath } from "@shared/formatSitePath";
import { SitemapSearch } from "@/components/menus/SitemapSearch";
import type { SitemapSearchEntry } from "@/lib/sitemapSearch";
import { useMutation } from "@tanstack/react-query";

function lastPathSegment(pillarUrl: string): string {
  return pillarUrl.replace(/\/+$/, "").split("/").filter(Boolean).pop() || "";
}

function clusterListLabel(keyword: string | null | undefined, pillarUrl: string): string {
  const kw = typeof keyword === "string" ? keyword.trim() : "";
  if (kw) return deslugifyLabel(kw);
  const seg = lastPathSegment(pillarUrl);
  return seg ? deslugifyLabel(seg) : "Untitled cluster";
}

function clusterCountBadgeClass(count: number): string | undefined {
  if (count <= 0) return "border-transparent bg-status-busy/15 text-status-busy";
  if (count <= 2) return "border-transparent bg-status-away/15 text-status-away";
  return undefined;
}

function ClusterMapHelp() {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  return (
    <div className="mb-3 space-y-1.5" data-testid="cluster-map-help">
      <p className="text-xs text-muted-foreground leading-relaxed">
        Clusters group a hub page and its supporting pages. Stats below cover content types with{" "}
        <strong className="font-medium text-foreground">SEO monitoring</strong> enabled in content-type
        settings. Assign members via <code className="font-mono text-[10px]">seo.pillar_path</code> on locale YAML.
      </p>
      <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
        <CollapsibleTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="px-0 h-auto text-xs"
            data-testid="button-cluster-map-read-more"
          >
            {advancedOpen ? "Hide advanced details" : "Read more (advanced)"}
            <ChevronDown
              className={`h-3.5 w-3.5 ml-1 transition-transform ${advancedOpen ? "rotate-180" : ""}`}
            />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-1 space-y-1 text-xs text-muted-foreground">
          <p>
            Hub = <code className="font-mono text-[10px]">seo.is_pillar</code> on the locale YAML.
            Members set <code className="font-mono text-[10px]">seo.pillar_path</code> to that hub URL.
            Missing or empty path = gap (counted in stats).{" "}
            <code className="font-mono text-[10px]">pillar_path: null</code> = intentional opt-out.
          </p>
          <p>
            Monitoring is configured per content type in{" "}
            <code className="font-mono text-[10px]">content-types.yml</code> (
            <code className="font-mono text-[10px]">seo_monitoring.enabled</code>; omitted = off). DB-backed
            types can map <code className="font-mono text-[10px]">seo_main_keyword</code> /{" "}
            <code className="font-mono text-[10px]">seo_pillar_path</code> in field_mapping; locale YAML wins.
          </p>
          <p className="font-mono">{"{contentRoot}/seo-index.json"}</p>
          <p className="font-mono">server/seo-index.ts</p>
          <p className="font-mono">server/seo-monitoring.ts</p>
          <p className="font-mono">server/content-types.ts</p>
          <p className="font-mono">client/src/components/editing/MappingFieldsTab.tsx</p>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

const TWO_WEEKS_MS = 14 * 24 * 60 * 60 * 1000;

function isSitemapLastmodStale(lastmod: string | null | undefined, nowMs = Date.now()): boolean {
  if (!lastmod) return false;
  const day = lastmod.split("T")[0];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const then = Date.parse(`${day}T00:00:00.000Z`);
  if (!Number.isFinite(then)) return false;
  return nowMs - then > TWO_WEEKS_MS;
}

type ClusterMember = {
  id: string;
  slug: string;
  contentType: string;
  locale: string;
  path: string;
  keyword?: string | null;
  lastmod?: string | null;
  updated_at?: string | null;
};

type ClusterEntryInfo = {
  title: string | null;
  page_title: string | null;
  description: string | null;
  path: string;
  contentType: string;
  slug: string;
  locale: string;
  main_keyword: string | null;
  is_pillar: boolean;
  pillar_path: string | null;
  file: string | null;
  lastmod?: string | null;
  updated_at?: string | null;
  gscStatus?: {
    configured: boolean;
    record: GscInspectionRecord | null;
    stale: boolean;
  };
};

type ClusterDiagnosticsResult = {
  hubId: string;
  pillarUrl: string;
  scanStatus: "ok" | "render_failed";
  missingLinks: { memberPath: string; memberSlug: string; memberId: string }[];
  scannedAt: string;
  fromCache?: boolean;
};

function invalidateClusterQueries(hubId?: string) {
  void queryClient.invalidateQueries({ queryKey: ["/api/seo/overview"] });
  if (hubId) {
    void queryClient.invalidateQueries({ queryKey: ["/api/seo/cluster-diagnostics", hubId] });
  }
}

type ClusterBucketCounts = {
  unclustered: number;
  partiallySet: number;
  brokenRefs: number;
  optedOut: number;
  clustered: number;
  hub: number;
};

type ClusterHealth = {
  emptyHubCount: number;
  stats: ClusterBucketCounts;
  byContentType: Record<string, ClusterBucketCounts>;
  byLocale: Record<string, ClusterBucketCounts>;
};

type BrokenClusterRefRow = {
  slug: string;
  contentType: string;
  locale: string;
  path: string;
  pillar_path: string;
  filePath: string;
  main_keyword: string | null;
  reason: "hub_not_found" | "hub_not_pillar";
};

type SeoIndexWarningRow = {
  code: string;
  entry?: string;
  pillar_path?: string;
  message?: string;
};

function ClusterHealthPanel({ health }: { health: ClusterHealth }) {
  const { stats } = health;
  return (
    <div className="mb-4 space-y-3" data-testid="cluster-health-stats">
      <div className="flex flex-wrap gap-2">
        <Badge variant="secondary" className="tabular-nums" data-testid="stat-unclustered">
          Unclustered {stats.unclustered}
        </Badge>
        <Badge variant="secondary" className="tabular-nums" data-testid="stat-partially-set">
          Partially set {stats.partiallySet}
        </Badge>
        <Badge
          variant={stats.brokenRefs > 0 ? "destructive" : "secondary"}
          className="tabular-nums"
          data-testid="stat-broken-refs"
        >
          Broken refs {stats.brokenRefs}
        </Badge>
        <Badge variant="outline" className="tabular-nums" data-testid="stat-empty-hubs">
          Empty hubs {health.emptyHubCount}
        </Badge>
        <Badge variant="outline" className="tabular-nums" data-testid="stat-clustered">
          Clustered {stats.clustered}
        </Badge>
      </div>
      {Object.keys(health.byContentType).length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="text-muted-foreground border-b">
                <th className="text-left py-1 pr-2 font-medium">Type</th>
                <th className="text-right py-1 px-1">Uncl.</th>
                <th className="text-right py-1 px-1">Partial</th>
                <th className="text-right py-1 px-1">Broken</th>
                <th className="text-right py-1 pl-1">Clustered</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(health.byContentType)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([ct, row]) => (
                  <tr key={ct} className="border-b border-border/50" data-testid={`cluster-health-type-${ct}`}>
                    <td className="py-1 pr-2 capitalize">{ct}</td>
                    <td className="text-right py-1 px-1 tabular-nums">{row.unclustered}</td>
                    <td className="text-right py-1 px-1 tabular-nums">{row.partiallySet}</td>
                    <td className="text-right py-1 px-1 tabular-nums">{row.brokenRefs}</td>
                    <td className="text-right py-1 pl-1 tabular-nums">{row.clustered + row.hub}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

function BrokenClusterRefsPanel({
  refs,
  clusters,
}: {
  refs: BrokenClusterRefRow[];
  clusters: {
    pillarUrl: string;
    hubId?: string;
    keyword?: string | null;
    locale?: string;
  }[];
}) {
  if (refs.length === 0) return null;
  return (
    <div className="mb-4 rounded-md border border-destructive/30 bg-destructive/5 p-3" data-testid="broken-cluster-refs-list">
      <p className="text-xs font-medium text-foreground mb-2">Broken cluster references</p>
      <ul className="space-y-2">
        {refs.map((row) => (
          <li key={`${row.contentType}-${row.slug}-${row.locale}`} className="text-xs">
            <span className="font-mono text-foreground">{row.slug}</span>
            <span className="text-muted-foreground"> · {row.contentType} · {row.locale.toUpperCase()}</span>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {row.reason === "hub_not_pillar"
                ? "Target URL is live but not marked as a pillar hub."
                : "Target hub URL was not found."}
              {row.pillar_path ? (
                <>
                  {" "}
                  <code className="font-mono">{row.pillar_path}</code>
                </>
              ) : null}
            </p>
            <OrphanAssignButton
              orphan={{ slug: row.slug, contentType: row.contentType, locale: row.locale }}
              clusters={clusters}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

function IndexWarningsPanel({ warnings }: { warnings: SeoIndexWarningRow[] }) {
  const [open, setOpen] = useState(false);
  if (!warnings.length) return null;
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="mb-4">
      <CollapsibleTrigger asChild>
        <Button variant="outline" size="sm" className="h-7 text-xs w-full justify-between" data-testid="button-index-warnings">
          Index warnings
          <Badge variant="secondary">{warnings.length}</Badge>
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-2 space-y-1.5" data-testid="index-warnings-list">
        {warnings.map((w, i) => (
          <p key={`${w.code}-${w.entry ?? i}`} className="text-[11px] text-muted-foreground">
            <span className="font-mono text-foreground">{w.code}</span>
            {w.entry ? ` · ${w.entry}` : ""}
            {w.message ? ` — ${w.message}` : ""}
          </p>
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
}

async function putSeoPillarPath(opts: {
  contentType: string;
  slug: string;
  locale: string;
  pillarPath: string;
}): Promise<void> {
  const token = getDebugToken();
  const author = await resolveAuthorName();
  const res = await fetch(
    `/api/content-types/${encodeURIComponent(opts.contentType)}/field-overrides/${encodeURIComponent(opts.slug)}`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        ...getSessionHeaders(),
        ...(token ? { Authorization: `Token ${token}` } : {}),
      },
      body: JSON.stringify({
        locale: opts.locale,
        fields: { "seo.pillar_path": opts.pillarPath },
        author: author || undefined,
      }),
    },
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const message = (err as { error?: string }).error || "Failed to update cluster";
    if (message.toLowerCase().includes("locale file not found") || message.includes("seo_file_missing")) {
      throw new Error("This entry has no locale YAML — open it in the editor first.");
    }
    throw new Error(message);
  }
}

type GscIndexChipState = "indexed" | "not-indexed" | "unknown" | "stale" | "not-configured" | "error";

function gscIndexChipLabel(gscStatus: ClusterEntryInfo["gscStatus"]): string {
  if (!gscStatus?.configured) return "GSC not configured";
  if (!gscStatus.record) return "Unknown";
  if (gscStatus.stale) return "Stale";
  const headline = gscHeadline(gscStatus.record);
  if (headline === "Indexed") return "Indexed";
  if (headline === "Never checked") return "Unknown";
  return headline;
}

function gscIndexChipState(gscStatus: ClusterEntryInfo["gscStatus"]): GscIndexChipState {
  if (!gscStatus?.configured) return "not-configured";
  if (!gscStatus.record) return "unknown";
  if (gscStatus.stale) return "stale";
  const headline = gscHeadline(gscStatus.record);
  if (headline === "Indexed") return "indexed";
  if (headline === "Not indexed") return "not-indexed";
  if (headline === "Error") return "error";
  return "unknown";
}

function gscIndexChipClass(state: GscIndexChipState): string {
  if (state === "indexed") return "border-transparent bg-emerald-500/15 text-emerald-600 dark:text-emerald-400";
  if (state === "not-indexed") return "border-transparent bg-amber-500/15 text-amber-600 dark:text-amber-400";
  if (state === "error") return "border-transparent bg-destructive/15 text-destructive";
  if (state === "stale") return "border-transparent bg-muted text-muted-foreground";
  if (state === "not-configured") return "border-transparent bg-muted text-muted-foreground opacity-60";
  return "border-transparent bg-muted text-muted-foreground";
}

function GscIndexChipIcon({ state }: { state: GscIndexChipState }) {
  const className = "h-3 w-3";
  if (state === "indexed") return <Bot className={className} aria-hidden />;
  if (state === "not-indexed" || state === "error") return <BotOff className={className} aria-hidden />;
  return <Bot className={className} aria-hidden />;
}

function formatLastmodAgo(lastmod: string, now = new Date()): string {
  const day = lastmod.split("T")[0];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return lastmod;
  const then = Date.parse(`${day}T00:00:00.000Z`);
  if (!Number.isFinite(then)) return lastmod;
  const nowDay = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const days = Math.round((nowDay - then) / (24 * 60 * 60 * 1000));
  if (days <= 0) return "today";
  if (days === 1) return "1 day ago";
  if (days < 14) return `${days} days ago`;
  const weeks = Math.floor(days / 7);
  if (days < 60) return weeks === 1 ? "1 week ago" : `${weeks} weeks ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return months === 1 ? "1 month ago" : `${months} months ago`;
  const years = Math.floor(days / 365);
  return years === 1 ? "1 year ago" : `${years} years ago`;
}

function ClusterMemberLastmod({ lastmod, prefix }: { lastmod: string; prefix?: string }) {
  const stale = isSitemapLastmodStale(lastmod);
  const day = lastmod.split("T")[0];
  return (
    <span
      className={cn(
        "text-xs font-normal shrink-0 whitespace-nowrap",
        stale ? "text-amber-500 dark:text-amber-400" : "text-foreground",
      )}
      title={stale ? `Sitemap lastmod ${day} from editorial updated_at — older than 2 weeks` : `Sitemap lastmod ${day} from editorial updated_at`}
      data-testid="text-cluster-slug-lastmod"
    >
      {prefix}
      {formatLastmodAgo(lastmod)}
    </span>
  );
}

function ClusterGscIndexChip({
  entryPath,
  gscStatus,
  gscConfigured,
}: {
  entryPath: string;
  gscStatus?: ClusterEntryInfo["gscStatus"];
  gscConfigured?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const configured = gscStatus?.configured ?? gscConfigured ?? false;
  const resolvedStatus = gscStatus ?? { configured, record: null, stale: true };
  const label = gscIndexChipLabel(resolvedStatus);
  const state = gscIndexChipState(resolvedStatus);
  const inspectMutation = useMutation({
    mutationFn: async () => {
      const token = getDebugToken();
      const res = await fetch("/api/debug/gsc-inspection", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getSessionHeaders(),
          ...(token ? { Authorization: `Token ${token}` } : {}),
        },
        body: JSON.stringify({ urls: [entryPath], force: true }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof body.error === "string" ? body.error : "Inspect failed");
      }
      return body;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["/api/debug/gsc-inspection"] });
      void queryClient.invalidateQueries({ queryKey: ["/api/seo/entry"] });
    },
  });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex items-center justify-center rounded-md border h-5 w-5 shrink-0",
            gscIndexChipClass(state),
          )}
          disabled={!entryPath}
          data-testid="chip-cluster-gsc-index"
          title={label}
          aria-label={`Google index status: ${label}`}
          onClick={(e) => e.stopPropagation()}
        >
          <GscIndexChipIcon state={state} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-64 space-y-2 bg-popover text-popover-foreground"
        onClick={(e) => e.stopPropagation()}
      >
        {!configured ? (
          <p className="text-xs text-muted-foreground">
            Search Console is not configured. Set credentials and site URL in settings.
          </p>
        ) : (
          <>
            <p className="text-xs text-foreground">
              {gscStatus?.record?.inspectedAt
                ? `Last checked ${new Date(gscStatus.record.inspectedAt).toLocaleString()}`
                : "This URL has not been inspected yet."}
            </p>
            {gscStatus?.record?.coverageState ? (
              <p className="text-[11px] text-muted-foreground">{gscStatus.record.coverageState}</p>
            ) : null}
            <Button
              size="sm"
              variant="secondary"
              className="w-full"
              disabled={!entryPath || inspectMutation.isPending}
              onClick={() => inspectMutation.mutate()}
              data-testid="button-cluster-check-google"
            >
              {inspectMutation.isPending ? (
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              ) : null}
              Check Google
            </Button>
            {inspectMutation.isError ? (
              <p className="text-[11px] text-destructive">
                {inspectMutation.error instanceof Error
                  ? inspectMutation.error.message
                  : "Inspect failed"}
              </p>
            ) : null}
            <p className="text-[10px] text-muted-foreground">
              Re-inspects via Search Console. For bulk scans use Inspect URLs above.
            </p>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}

function ClusterMissingLinksPanel({ hubId }: { hubId: string }) {
  const { data, isLoading, isError } = useQuery<ClusterDiagnosticsResult>({
    queryKey: ["/api/seo/cluster-diagnostics", hubId],
    queryFn: async () => {
      const token = getDebugToken();
      const params = new URLSearchParams({ hubId });
      const res = await fetch(`/api/seo/cluster-diagnostics?${params}`, {
        credentials: "include",
        headers: {
          ...getSessionHeaders(),
          ...(token ? { Authorization: `Token ${token}` } : {}),
        },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error || "Diagnostics failed");
      }
      return res.json();
    },
    staleTime: 60_000,
  });

  if (isLoading) {
    return (
      <p className="text-[11px] text-muted-foreground pb-2 flex items-center gap-1.5" data-testid="cluster-links-scanning">
        <Loader2 className="h-3 w-3 animate-spin" />
        Scanning hub…
      </p>
    );
  }

  if (isError || data?.scanStatus === "render_failed") {
    return (
      <p className="text-[11px] text-muted-foreground pb-2" data-testid="cluster-links-scan-failed">
        Could not render the hub page for link scan. Try again after visiting the hub publicly.
      </p>
    );
  }

  if (!data?.missingLinks.length) return null;

  return (
    <div className="pb-2" data-testid="cluster-missing-links">
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-md border border-transparent bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-600 dark:text-amber-400"
            data-testid="badge-cluster-missing-links"
          >
            <AlertTriangle className="h-3 w-3" />
            {data.missingLinks.length} missing hub link{data.missingLinks.length !== 1 ? "s" : ""}
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72 bg-popover text-popover-foreground">
          <p className="text-xs text-muted-foreground mb-2">
            These members were not found as rendered <code className="font-mono text-[10px]">&lt;a href&gt;</code> on
            the hub (nav/footer links count).
          </p>
          <ul className="space-y-1 text-xs">
            {data.missingLinks.map((m) => (
              <li key={m.memberId} className="font-mono truncate" title={m.memberPath}>
                {deslugifyLabel(m.memberSlug)}
              </li>
            ))}
          </ul>
        </PopoverContent>
      </Popover>
    </div>
  );
}

type ClusterPickerTarget = {
  contentType: string;
  slug: string;
  locale: string;
  pillar_path?: string | null;
  is_pillar?: boolean;
};

function ClusterMemberAssignFlow({
  hubPillarUrl,
  hubLabel,
  locale,
  excludePaths,
  excludeIds,
  onAssigned,
  trigger,
}: {
  hubPillarUrl: string;
  hubLabel?: string;
  locale: string;
  excludePaths: string[];
  excludeIds: string[];
  onAssigned: () => void;
  trigger: ReactNode;
}) {
  const { toast } = useToast();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pending, setPending] = useState<{
    entry: SitemapSearchEntry;
    previousPillar: string | null;
    previousLabel: string;
  } | null>(null);
  const [saving, setSaving] = useState(false);

  const assignEntry = async (target: ClusterPickerTarget) => {
    setSaving(true);
    try {
      await putSeoPillarPath({
        contentType: target.contentType,
        slug: target.slug,
        locale: target.locale,
        pillarPath: hubPillarUrl,
      });
      toast({
        title: "Cluster updated",
        description: "Pending Cloud Sync — locale YAML was updated.",
      });
      onAssigned();
      setPickerOpen(false);
      setPending(null);
    } catch (err) {
      toast({
        title: "Could not add to cluster",
        description: err instanceof Error ? err.message : "Update failed",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleSelectEntry = async (entry: SitemapSearchEntry) => {
    const contentType = entry.content_type?.trim();
    const slug = entry.slug?.trim();
    const entryLocale = entry.locale?.trim();
    if (!contentType || !slug || !entryLocale) {
      toast({
        title: "Missing entry metadata",
        description: "Pick a page with content type, slug, and locale — not URL alone.",
        variant: "destructive",
      });
      return;
    }

    try {
      const params = new URLSearchParams({ locale: entryLocale });
      const res = await fetch(
        `/api/seo/entry/${encodeURIComponent(contentType)}/${encodeURIComponent(slug)}?${params}`,
        { credentials: "include", headers: getSessionHeaders() },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error || "Could not load entry");
      }
      const info = (await res.json()) as ClusterEntryInfo;
      if (info.is_pillar) {
        toast({
          title: "Hub pages cannot be members",
          description: "That page is itself a pillar hub.",
          variant: "destructive",
        });
        return;
      }
      const prev = info.pillar_path?.trim() || null;
      if (prev && prev !== hubPillarUrl) {
        setPending({
          entry,
          previousPillar: prev,
          previousLabel: prev,
        });
        return;
      }
      await assignEntry({
        contentType,
        slug,
        locale: entryLocale,
        pillar_path: prev,
        is_pillar: info.is_pillar,
      });
    } catch (err) {
      toast({
        title: "Could not add to cluster",
        description: err instanceof Error ? err.message : "Preflight failed",
        variant: "destructive",
      });
    }
  };

  return (
    <>
      <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
        <PopoverTrigger asChild>{trigger}</PopoverTrigger>
        <PopoverContent align="start" className="w-80 p-0 bg-popover" sideOffset={4}>
          <SitemapSearch
            embedded
            value=""
            onChange={() => {}}
            locale={locale}
            showLocaleFilter={false}
            excludePaths={excludePaths}
            excludeIds={excludeIds}
            hideCustomUrl
            onSelectEntry={handleSelectEntry}
            onClose={() => setPickerOpen(false)}
            testId="cluster-add-page"
          />
        </PopoverContent>
      </Popover>

      <AlertDialog open={!!pending} onOpenChange={(v) => !v && setPending(null)}>
        <AlertDialogContent data-testid="dialog-cluster-replace-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>Move to this cluster?</AlertDialogTitle>
            <AlertDialogDescription>
              This page currently belongs to another cluster ({pending?.previousLabel}). Adding it
              to {hubLabel || "this hub"} will replace that assignment.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={saving || !pending}
              onClick={(e) => {
                e.preventDefault();
                if (!pending?.entry.content_type || !pending.entry.slug || !pending.entry.locale) return;
                void assignEntry({
                  contentType: pending.entry.content_type,
                  slug: pending.entry.slug,
                  locale: pending.entry.locale,
                });
              }}
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Move page"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function ClusterMemberRow({
  member,
  hubPillarUrl,
  hubId,
  gscConfigured,
}: {
  member: ClusterMember;
  hubPillarUrl: string;
  hubId: string;
  gscConfigured?: boolean;
}) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [removing, setRemoving] = useState(false);
  const { data, isLoading, isError, error } = useQuery<ClusterEntryInfo>({
    queryKey: ["/api/seo/entry", member.contentType, member.slug, member.locale],
    enabled: open && !!member.contentType && !!member.slug,
    staleTime: 60_000,
    queryFn: async () => {
      const params = new URLSearchParams({ locale: member.locale || "en" });
      const res = await fetch(
        `/api/seo/entry/${encodeURIComponent(member.contentType)}/${encodeURIComponent(member.slug)}?${params}`,
        { credentials: "include", headers: getSessionHeaders() },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error || "Failed to load entry");
      }
      return res.json();
    },
  });

  const href = data?.path || member.path;
  const heading =
    data?.title || data?.page_title || deslugifyLabel(member.slug);
  const lastmod = data?.lastmod || member.lastmod || null;

  const handleRemove = async () => {
    setRemoving(true);
    try {
      await putSeoPillarPath({
        contentType: member.contentType,
        slug: member.slug,
        locale: member.locale,
        pillarPath: "",
      });
      toast({
        title: "Removed from cluster",
        description: "Pending Cloud Sync — seo.pillar_path was cleared.",
      });
      invalidateClusterQueries(hubId);
      setRemoveOpen(false);
      setOpen(false);
    } catch (err) {
      toast({
        title: "Could not remove",
        description: err instanceof Error ? err.message : "Update failed",
        variant: "destructive",
      });
    } finally {
      setRemoving(false);
    }
  };

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <div
          className="flex w-full items-center gap-2 py-1.5 hover:bg-muted/50 rounded-sm px-1 -mx-1 group"
          data-testid={`cluster-slug-${member.slug}`}
        >
          <PopoverTrigger asChild>
            <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left">
              <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="text-xs font-medium text-foreground min-w-0 flex-1 truncate">
                {deslugifyLabel(member.slug)}
              </span>
              {lastmod ? <ClusterMemberLastmod lastmod={lastmod} prefix="Last published " /> : null}
              {href ? (
                <ClusterGscIndexChip
                  entryPath={href}
                  gscStatus={data?.gscStatus}
                  gscConfigured={gscConfigured}
                />
              ) : null}
            </button>
          </PopoverTrigger>
          <button
            type="button"
            className="shrink-0 p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-opacity"
            aria-label="Remove from cluster"
            data-testid={`button-cluster-remove-${member.slug}`}
            onClick={() => setRemoveOpen(true)}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
        <PopoverContent
          align="start"
          className="w-80 space-y-3 bg-popover text-popover-foreground"
          data-testid={`popover-cluster-entry-${member.slug}`}
        >
          {isLoading ? (
            <div className="space-y-2" data-testid="cluster-entry-loading">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-2/3" />
            </div>
          ) : isError ? (
            <p className="text-xs text-destructive" data-testid="cluster-entry-error">
              {error instanceof Error ? error.message : "Could not load this entry."}
            </p>
          ) : (
            <div className="space-y-2">
              <div>
                <p className="text-sm font-medium text-foreground leading-snug" data-testid="text-cluster-entry-title">
                  {heading}
                </p>
                {data?.description ? (
                  <p className="text-xs text-muted-foreground mt-1 line-clamp-3">{data.description}</p>
                ) : null}
              </div>
              <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-xs">
                <dt className="text-muted-foreground">Type</dt>
                <dd className="text-foreground truncate">{data?.contentType || member.contentType}</dd>
                <dt className="text-muted-foreground">Locale</dt>
                <dd className="text-foreground uppercase">{data?.locale || member.locale}</dd>
                {(data?.main_keyword || member.keyword) && (
                  <>
                    <dt className="text-muted-foreground">Keyword</dt>
                    <dd className="text-foreground truncate">{data?.main_keyword || member.keyword}</dd>
                  </>
                )}
                {href ? (
                  <>
                    <dt className="text-muted-foreground">Path</dt>
                    <dd className="text-foreground font-mono truncate" title={href}>{href}</dd>
                  </>
                ) : null}
                {lastmod ? (
                  <>
                    <dt className="text-muted-foreground">Lastmod</dt>
                    <dd>
                      <ClusterMemberLastmod lastmod={lastmod} />
                    </dd>
                  </>
                ) : null}
                {href ? (
                  <>
                    <dt className="text-muted-foreground">Google</dt>
                    <dd>
                      <ClusterGscIndexChip
                        entryPath={href}
                        gscStatus={data?.gscStatus}
                        gscConfigured={gscConfigured}
                      />
                    </dd>
                  </>
                ) : null}
              </dl>
              {data?.is_pillar ? (
                <Badge variant="secondary" className="text-[10px]">Pillar</Badge>
              ) : null}
              {data?.file ? (
                <p className="text-[11px] text-muted-foreground font-mono truncate" title={data.file}>
                  {formatSitePath(data.file)}
                </p>
              ) : null}
            </div>
          )}
          {href ? (
            <Button asChild size="sm" className="w-full" data-testid={`button-cluster-entry-url-${member.slug}`}>
              <a href={href} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-3.5 w-3.5" />
                Open page
              </a>
            </Button>
          ) : (
            <Button size="sm" className="w-full" disabled data-testid={`button-cluster-entry-url-${member.slug}`}>
              <ExternalLink className="h-3.5 w-3.5" />
              Open page
            </Button>
          )}
        </PopoverContent>
      </Popover>

      <AlertDialog open={removeOpen} onOpenChange={setRemoveOpen}>
        <AlertDialogContent data-testid={`dialog-cluster-remove-${member.slug}`}>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove from cluster?</AlertDialogTitle>
            <AlertDialogDescription>
              This page will no longer belong to this cluster. Its{" "}
              <code className="font-mono text-xs">seo.pillar_path</code> field will be cleared.
              Internal links between the hub and this page are not changed automatically.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removing}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={removing}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(e) => {
                e.preventDefault();
                void handleRemove();
              }}
            >
              {removing ? <Loader2 className="h-4 w-4 animate-spin" /> : "Remove"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function OrphanAssignButton({
  orphan,
  clusters,
}: {
  orphan: { slug: string; contentType: string; locale?: string };
  clusters: SeoOverview["clusters"];
}) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const locale = orphan.locale || "en";
  const hubs = clusters.filter((c) => (c.locale || "en") === locale);

  const assignToHub = async (pillarUrl: string) => {
    if (!orphan.contentType || !orphan.slug) {
      toast({
        title: "Missing entry metadata",
        description: "This orphan row is missing content type or slug.",
        variant: "destructive",
      });
      return;
    }
    setSaving(true);
    try {
      await putSeoPillarPath({
        contentType: orphan.contentType,
        slug: orphan.slug,
        locale,
        pillarPath: pillarUrl,
      });
      toast({
        title: "Assigned to cluster",
        description: "Pending Cloud Sync — seo.pillar_path was updated.",
      });
      invalidateClusterQueries();
      setOpen(false);
    } catch (err) {
      toast({
        title: "Could not assign cluster",
        description: err instanceof Error ? err.message : "Update failed",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="h-6 text-[10px] mt-1"
        onClick={() => setOpen(true)}
        data-testid={`button-orphan-assign-${orphan.slug}`}
      >
        Assign to cluster
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm bg-background text-foreground" data-testid={`dialog-orphan-assign-${orphan.slug}`}>
          <DialogHeader>
            <DialogTitle>Assign to cluster</DialogTitle>
            <DialogDescription>
              Pick a hub ({locale.toUpperCase()}) for{" "}
              <span className="font-medium text-foreground">{deslugifyLabel(orphan.slug)}</span>.
            </DialogDescription>
          </DialogHeader>
          {hubs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No pillar hubs found for this locale.</p>
          ) : (
            <ScrollArea className="max-h-56">
              <div className="space-y-1 pr-2">
                {hubs.map((hub) => (
                  <button
                    key={hub.hubId || hub.pillarUrl}
                    type="button"
                    disabled={saving}
                    className="w-full text-left rounded-md border border-border px-2 py-1.5 text-xs hover:bg-muted/50 disabled:opacity-50"
                    onClick={() => void assignToHub(hub.pillarUrl)}
                    data-testid={`orphan-hub-option-${hub.hubId || hub.pillarUrl}`}
                  >
                    <span className="font-medium block">
                      {clusterListLabel(hub.keyword, hub.pillarUrl)}
                    </span>
                    <span className="font-mono text-[10px] text-muted-foreground truncate block">
                      {hub.pillarUrl}
                    </span>
                  </button>
                ))}
              </div>
            </ScrollArea>
          )}
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)} disabled={saving}>
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

interface SeoOverview {
  intentDistribution: Record<string, Record<string, number>>;
  clusters: {
    pillarUrl: string;
    clusterSlugs: string[];
    clusterCount: number;
    hubId?: string;
    keyword?: string | null;
    locale?: string;
    members?: ClusterMember[];
  }[];
  clusterHealth?: ClusterHealth;
  brokenClusterRefs?: BrokenClusterRefRow[];
  indexWarnings?: SeoIndexWarningRow[];
  orphanPages: {
    slug: string;
    contentType: string;
    intent: string;
    filePath: string;
    locale?: string;
    pillar_path?: string;
    reason?: BrokenClusterRefRow["reason"];
  }[];
  featureCoverage: Record<string, number>;
  faqCoverage: { slug: string; contentType: string; locale: string; faqCount: number }[];
  schemaCoverage: Record<string, number>;
  totals: {
    totalPages: number;
    withPillar: number;
    withIntent: number;
    withFocusFeatures: number;
    withFaq: number;
    withSchema: number;
    withKeyword?: number;
  };
}

interface BrandContext {
  brand?: { name?: string; tagline?: string; mission?: string };
  voice?: { tone?: string; style?: string; personality?: string };
  key_differentiators?: string[];
  forbidden_phrases?: { phrase: string; reason: string }[];
  target_audience?: {
    primary?: { description?: string; age_range?: string; motivations?: string[]; concerns?: string[] };
  };
}

const INTENT_LABELS: Record<string, string> = {
  awareness: "Awareness",
  consideration: "Consideration",
  decision: "Decision",
  "post-enrollment": "Post-Enroll",
  unknown: "Unknown",
};

const INTENT_COLORS: Record<string, string> = {
  awareness: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  consideration: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  decision: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  "post-enrollment": "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
  unknown: "bg-muted text-muted-foreground",
};

const ALL_INTENTS = ["awareness", "consideration", "decision", "post-enrollment"];
const ALL_FEATURES: Record<string, string> = {
  mentorship: "1-on-1 Mentorship",
  job_guarantee: "Job Guarantee",
  flexible_schedule: "Flexible Schedule",
  financing: "Financing & ISA",
  community: "Alumni Community",
  portfolio: "Real Portfolio",
  career_support: "Career Support",
  multilingual: "Multilingual",
};

function StatCard({
  label,
  value,
  total,
  icon,
  warning,
  notice,
  subline,
  testId,
  dual = false,
}: {
  label: string;
  value: number;
  total?: number;
  icon?: ReactNode;
  warning?: string;
  notice?: string;
  subline?: string;
  testId?: string;
  dual?: boolean;
}) {
  const pct = total && total > 0 ? Math.round((value / total) * 100) : null;
  const slug = testId ?? `stat-card-${label.toLowerCase().replace(/\s+/g, "-")}`;
  return (
    <Card data-testid={slug}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            {dual && total != null ? (
              <p className="text-2xl font-bold text-foreground tabular-nums">
                {value}
                <span className="text-muted-foreground font-medium text-lg"> / {total}</span>
              </p>
            ) : (
              <p className="text-2xl font-bold text-foreground tabular-nums">{value}</p>
            )}
            <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
            {warning ? (
              <Badge variant="destructive" className="mt-1 text-[10px]" data-testid={`${slug}-warning`}>
                {warning}
              </Badge>
            ) : null}
            {notice ? (
              <Badge variant="secondary" className="mt-1 text-[10px]" data-testid={`${slug}-notice`}>
                {notice}
              </Badge>
            ) : null}
            {subline ? (
              <p className="text-[11px] text-muted-foreground mt-1">{subline}</p>
            ) : null}
          </div>
          <div className="flex flex-col items-end gap-1">
            {icon && <span className="text-muted-foreground">{icon}</span>}
            {pct !== null && (
              <span className="text-xs text-muted-foreground">{pct}%</span>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function LoadingSection() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-6 w-48" />
      <Skeleton className="h-32 w-full" />
      <Skeleton className="h-32 w-full" />
    </div>
  );
}

const GSC_INSPECT_MAX_PER_JOB = 2000;
const GSC_INSPECT_INTERVAL_SEC = 1.5;

function gscInspectJobSize(count: number): number {
  return Math.min(Math.max(0, count), GSC_INSPECT_MAX_PER_JOB);
}

function gscInspectDurationLabel(count: number): string {
  const sec = Math.ceil(gscInspectJobSize(count) * GSC_INSPECT_INTERVAL_SEC);
  if (sec < 60) return `~${sec}s`;
  const min = Math.ceil(sec / 60);
  return `~${min} min`;
}

function SearchConsoleCoverageCard({
  configured,
  summary,
}: {
  configured?: boolean;
  summary?: GscInspectionSummary;
}) {
  const [openList, setOpenList] = useState<string | undefined>(undefined);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [mode, setMode] = useState<GscInspectMode>("never");
  const [starting, setStarting] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const { toast } = useToast();
  const { hasCapability } = useDebugAuth();
  const canEdit = hasCapability("seo_edit");
  const types = summary ? Object.keys(summary.byContentType).sort() : [];
  const inspected = summary?.inspected ?? 0;
  const neverChecked = summary?.neverChecked ?? 0;
  const staleCount = summary?.stale ?? 0;
  const sitemapCount = summary?.sitemapCount ?? 0;
  const wasRunning = useRef(false);

  const { data: queue } = useQuery<GscInspectQueueStats>({
    queryKey: ["/api/debug/gsc-inspection/queue"],
    queryFn: async () => {
      const token = getDebugToken();
      const res = await fetch("/api/debug/gsc-inspection/queue", {
        headers: {
          ...getSessionHeaders(),
          ...(token ? { Authorization: `Token ${token}` } : {}),
        },
      });
      if (!res.ok) throw new Error("Failed to load inspect queue");
      return res.json() as Promise<GscInspectQueueStats>;
    },
    enabled: configured === true,
    staleTime: 0,
    refetchInterval: (q) => (q.state.data?.running ? 1500 : false),
  });

  useEffect(() => {
    if (queue?.running) {
      wasRunning.current = true;
      return;
    }
    if (wasRunning.current) {
      wasRunning.current = false;
      void queryClient.invalidateQueries({ queryKey: ["/api/debug/gsc-inspection"] });
    }
  }, [queue?.running]);

  useEffect(() => {
    if (!queue?.running) return;
    const id = window.setInterval(() => {
      void queryClient.invalidateQueries({ queryKey: ["/api/debug/gsc-inspection"] });
    }, 4000);
    return () => window.clearInterval(id);
  }, [queue?.running]);

  const running = Boolean(queue?.running);
  const processed = (queue?.completed ?? 0) + (queue?.failed ?? 0);
  const totalQueued = queue?.queued ?? 0;
  const progressPct = totalQueued > 0 ? Math.min(100, Math.round((processed / totalQueued) * 100)) : 0;
  const neverJob = gscInspectJobSize(neverChecked);
  const staleJob = gscInspectJobSize(staleCount);
  const allJob = gscInspectJobSize(sitemapCount);
  const selectedCount = mode === "never" ? neverJob : mode === "stale" ? staleJob : allJob;
  const inspectDisabled = !configured || running;

  async function startInspect() {
    if (inspectDisabled || starting || selectedCount === 0) return;
    setStarting(true);
    try {
      const res = await apiRequestWithAuth("POST", "/api/debug/gsc-inspection/enqueue", { mode });
      const body = (await res.json()) as GscInspectEnqueueResponse;
      queryClient.setQueryData(["/api/debug/gsc-inspection/queue"], body.queue);
      setDialogOpen(false);
      if (body.queued === 0) {
        toast({
          title: "Nothing to inspect",
          description:
            mode === "never"
              ? "Every public sitemap URL already has a cache row. Use Stale to refresh rows older than 7 days, or All to recrawl."
              : mode === "stale"
                ? "No public sitemap URLs are missing or older than 7 days. Use All to recrawl everything."
                : "No public sitemap URLs to inspect.",
        });
        return;
      }
      toast({
        title: "Inspect URLs started",
        description: body.capped
          ? `Queued the first ${body.queued} URLs (cap ${GSC_INSPECT_MAX_PER_JOB}).`
          : `Queued ${body.queued} URLs in the background.`,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      const already = message.includes("inspect_already_running") || message.startsWith("409:");
      toast({
        title: already ? "Inspect already running" : "Could not start inspect",
        description: already
          ? "Wait for the current job to finish. Test connection and Crawlers still work."
          : message,
        variant: "destructive",
      });
      void queryClient.invalidateQueries({ queryKey: ["/api/debug/gsc-inspection/queue"] });
    } finally {
      setStarting(false);
    }
  }

  return (
    <Card data-testid="card-search-console-coverage">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Globe className="h-4 w-4" />
            Search Console coverage
          </CardTitle>
          {canEdit ? (
            <Button
              size="sm"
              variant="secondary"
              className="shrink-0"
              disabled={inspectDisabled}
              onClick={() => {
                setMode(neverChecked > 0 ? "never" : staleCount > 0 ? "stale" : "all");
                setDialogOpen(true);
              }}
              data-testid="button-gsc-inspect-urls"
            >
              {running ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                  Inspecting
                </>
              ) : (
                "Inspect URLs"
              )}
            </Button>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Inspect URLs walks the sitemap in the background (one Google call at a time, process-wide, ~1.5s
          apart, max {GSC_INSPECT_MAX_PER_JOB}). It does not re-index and does not freeze the site. Cached
          results are not a live crawl. Production restarts load the sidecar from GCS, then{" "}
          <code className="font-mono text-[10px]">.cache</code> — they still do not call Google. The inspect
          queue is process-local and is not stored in GCS.{" "}
          <Link href="/private/settings/seo/search-console" className="underline underline-offset-2 hover:text-foreground">
            SEO/GEO → Search Console
          </Link>
        </p>
        <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="px-0 h-auto text-xs" data-testid="button-gsc-inspect-read-more">
              Read more (advanced)
              <ChevronDown className={`h-3.5 w-3.5 ml-1 transition-transform ${advancedOpen ? "rotate-180" : ""}`} />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-1 space-y-1 text-xs text-muted-foreground">
            <p>
              Never inspected = no cache row yet (use after a mid-run redeploy). Stale = no row or inspected
              more than 7 days ago. All = every sitemap URL, including the last hour. A permission error stops
              the job. Restart drops the queue — Never inspected continues missing rows. Single-page inspect
              (Test connection / Crawlers) still works during a run. Disabled until property +
              GCS_CREDENTIALS_JSON are set. Dual write in production: local disk, then GCS after ~30s.
            </p>
            <p className="font-mono">server/gsc-inspect-queue.ts</p>
            <p className="font-mono">server/gsc-url-inspection.ts</p>
            <p className="font-mono">shared/gcsKeys.ts</p>
            <p className="font-mono">.cache/{"{site}"}/gsc-url-inspection.json</p>
            <p className="font-mono">{"{site}"}/sync/gsc-url-inspection.json</p>
          </CollapsibleContent>
        </Collapsible>
        {configured === true && !running ? (
          <p className="text-xs text-muted-foreground" data-testid="text-gsc-inspect-restart-hint">
            If a run was interrupted by restart, use Never inspected.
          </p>
        ) : null}
        {queue?.aborted === "permission_denied" && !running ? (
          <p className="text-xs text-destructive" data-testid="text-gsc-inspect-aborted">
            Inspect stopped: Search Console permission denied. Rows already written were kept. Fix the role on{" "}
            <Link href="/private/settings/seo/search-console" className="underline underline-offset-2">
              SEO/GEO → Search Console
            </Link>{" "}
            (role-not-set), then start again.
          </p>
        ) : null}
        {running && queue ? (
          <div className="space-y-1.5" data-testid="progress-gsc-inspect-queue">
            <Progress value={progressPct} className="h-2" />
            <p className="text-xs text-muted-foreground tabular-nums">
              {processed} of {totalQueued} done
              {queue.failed > 0 ? ` · ${queue.failed} failed` : ""}
              {queue.active ? ` · inspecting ${queue.active}` : ""}
              {queue.mode ? ` · ${gscInspectModeLabel(queue.mode)}` : ""}
            </p>
          </div>
        ) : null}
        {configured === false ? (
          <p className="text-sm text-muted-foreground" data-testid="text-gsc-unconfigured">
            Search Console is not configured. Save a property in SEO/GEO → Search Console, set GCS_CREDENTIALS_JSON, and add that service account on the Search Console property.
          </p>
        ) : !summary || inspected === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="text-gsc-empty-sidecar">
            No URLs inspected yet. Use Inspect URLs, check a page from diagnostics, or Test connection in settings.
          </p>
        ) : null}
        {configured !== false && summary ? (
          <>
            <div className="flex flex-wrap gap-2 text-xs" data-testid="gsc-funnel">
              <Badge variant="secondary">In sitemap {summary.sitemapCount}</Badge>
              <Badge variant="secondary">Inspected {summary.inspected}</Badge>
              <Badge variant="secondary">Indexed {summary.indexed}</Badge>
              <Badge variant="secondary">Not indexed {summary.notIndexed}</Badge>
              <Badge variant="secondary">Errors {summary.errors}</Badge>
              <Badge variant="outline">Never checked {summary.neverChecked}</Badge>
            </div>
            {types.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-xs" data-testid="gsc-coverage-table">
                  <thead>
                    <tr>
                      <th className="text-left py-2 pr-4 text-muted-foreground font-medium">Content Type</th>
                      <th className="text-center py-2 px-2 text-muted-foreground font-medium">In sitemap</th>
                      <th className="text-center py-2 px-2 text-muted-foreground font-medium">Inspected</th>
                      <th className="text-center py-2 px-2 text-muted-foreground font-medium">Indexed</th>
                      <th className="text-center py-2 px-2 text-muted-foreground font-medium">Not indexed</th>
                      <th className="text-center py-2 px-2 text-muted-foreground font-medium">Never checked</th>
                    </tr>
                  </thead>
                  <tbody>
                    {types.map((ct) => {
                      const row = summary.byContentType[ct];
                      return (
                        <tr key={ct} className="border-t border-border">
                          <td className="py-2 pr-4 font-medium text-foreground capitalize">{ct}</td>
                          <td className="py-2 px-2 text-center tabular-nums">{row.inSitemap}</td>
                          <td className="py-2 px-2 text-center tabular-nums">{row.inspected}</td>
                          <td className="py-2 px-2 text-center tabular-nums">{row.indexed}</td>
                          <td className="py-2 px-2 text-center tabular-nums">{row.notIndexed}</td>
                          <td className="py-2 px-2 text-center tabular-nums">{row.neverChecked}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {(summary.exceptions.notIndexed.length > 0 || summary.exceptions.canonicalMismatch.length > 0) && (
              <Accordion type="single" collapsible value={openList} onValueChange={setOpenList}>
                {summary.exceptions.notIndexed.length > 0 && (
                  <AccordionItem value="not-indexed">
                    <AccordionTrigger className="text-xs">Not indexed ({summary.exceptions.notIndexed.length})</AccordionTrigger>
                    <AccordionContent>
                      <ul className="space-y-1">
                        {summary.exceptions.notIndexed.map((row) => (
                          <li key={row.loc} className="text-xs font-mono truncate text-muted-foreground" title={row.loc}>
                            {row.loc}
                            {row.coverageState ? ` — ${row.coverageState}` : ""}
                          </li>
                        ))}
                      </ul>
                    </AccordionContent>
                  </AccordionItem>
                )}
                {summary.exceptions.canonicalMismatch.length > 0 && (
                  <AccordionItem value="canonical">
                    <AccordionTrigger className="text-xs">
                      Canonical mismatch ({summary.exceptions.canonicalMismatch.length})
                    </AccordionTrigger>
                    <AccordionContent>
                      <ul className="space-y-1">
                        {summary.exceptions.canonicalMismatch.map((row) => (
                          <li key={row.loc} className="text-xs font-mono truncate text-muted-foreground" title={row.loc}>
                            {row.loc} → {row.googleCanonical}
                          </li>
                        ))}
                      </ul>
                    </AccordionContent>
                  </AccordionItem>
                )}
              </Accordion>
            )}
          </>
        ) : null}
      </CardContent>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md bg-background text-foreground" data-testid="dialog-gsc-inspect-urls">
          <DialogHeader>
            <DialogTitle>Inspect URLs</DialogTitle>
            <DialogDescription>
              One Google call at a time (~1.5s apart), max {GSC_INSPECT_MAX_PER_JOB} per job. Does not request
              indexing. Never inspected = no cache row. Stale = no row or older than 7 days. All retries
              everything, including the last hour.
            </DialogDescription>
          </DialogHeader>
          <RadioGroup
            value={mode}
            onValueChange={(v) => setMode(v as GscInspectMode)}
            className="space-y-3"
            data-testid="radio-gsc-inspect-mode"
          >
            <div className="flex items-start space-x-2">
              <RadioGroupItem value="never" id="gsc-inspect-never" className="mt-0.5" />
              <Label htmlFor="gsc-inspect-never" className="font-normal cursor-pointer space-y-0.5">
                <span className="block text-foreground">Never inspected</span>
                <span className="block text-xs text-muted-foreground">
                  {neverChecked} public sitemap URL{neverChecked === 1 ? "" : "s"} with no cache row
                  {neverChecked > GSC_INSPECT_MAX_PER_JOB
                    ? ` · this job will inspect the first ${GSC_INSPECT_MAX_PER_JOB} (${gscInspectDurationLabel(neverChecked)})`
                    : neverChecked > 0
                      ? ` · ${gscInspectDurationLabel(neverChecked)}`
                      : ""}
                  .
                </span>
              </Label>
            </div>
            <div className="flex items-start space-x-2">
              <RadioGroupItem value="stale" id="gsc-inspect-stale" className="mt-0.5" />
              <Label htmlFor="gsc-inspect-stale" className="font-normal cursor-pointer space-y-0.5">
                <span className="block text-foreground">Stale (older than 7 days)</span>
                <span className="block text-xs text-muted-foreground">
                  {staleCount} public sitemap URL{staleCount === 1 ? "" : "s"} with no cache row or inspected more
                  than 7 days ago
                  {staleCount > GSC_INSPECT_MAX_PER_JOB
                    ? ` · this job will inspect the first ${GSC_INSPECT_MAX_PER_JOB} (${gscInspectDurationLabel(staleCount)})`
                    : staleCount > 0
                      ? ` · ${gscInspectDurationLabel(staleCount)}`
                      : ""}
                  .
                </span>
              </Label>
            </div>
            <div className="flex items-start space-x-2">
              <RadioGroupItem value="all" id="gsc-inspect-all" className="mt-0.5" />
              <Label htmlFor="gsc-inspect-all" className="font-normal cursor-pointer space-y-0.5">
                <span className="block text-foreground">All</span>
                <span className="block text-xs text-muted-foreground">
                  {sitemapCount} public sitemap URL{sitemapCount === 1 ? "" : "s"}, including previous errors
                  {sitemapCount > GSC_INSPECT_MAX_PER_JOB
                    ? ` · this job will inspect the first ${GSC_INSPECT_MAX_PER_JOB} (${gscInspectDurationLabel(sitemapCount)})`
                    : sitemapCount > 0
                      ? ` · ${gscInspectDurationLabel(sitemapCount)}`
                      : ""}
                  .
                </span>
              </Label>
            </div>
          </RadioGroup>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={starting || selectedCount === 0 || inspectDisabled}
              onClick={() => void startInspect()}
              data-testid="button-gsc-inspect-start"
            >
              {starting ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : null}
              Start inspect
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

export function SeoTab({ data }: { data: SeoOverview }) {
  const contentTypes = Object.keys(data.intentDistribution);
  const { data: gsc } = useQuery<GscInspectionGetResponse>({
    queryKey: ["/api/debug/gsc-inspection"],
    queryFn: async () => {
      const token = getDebugToken();
      const res = await fetch("/api/debug/gsc-inspection", {
        headers: {
          ...getSessionHeaders(),
          ...(token ? { Authorization: `Token ${token}` } : {}),
        },
      });
      if (!res.ok) throw new Error("Failed to load Search Console summary");
      return res.json() as Promise<GscInspectionGetResponse>;
    },
  });
  const summary = gsc?.summary;
  const withKeyword = data.totals.withKeyword ?? 0;
  const keywordedNotClustered = Math.max(0, withKeyword - data.totals.withPillar);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3" data-testid="seo-totals-grid">
        <StatCard
          label="Total vs Indexed pages"
          value={summary?.indexed ?? 0}
          total={data.totals.totalPages}
          dual
          icon={<Network className="h-4 w-4" />}
          warning={summary && summary.notOnSitemap > 0 ? `${summary.notOnSitemap} not on sitemap` : undefined}
          subline={
            summary
              ? `${summary.indexed} indexed · ${summary.notIndexed} not indexed · ${summary.neverChecked} never checked`
              : undefined
          }
          testId="stat-card-total-vs-indexed-pages"
        />
        <StatCard label="With funnel stage" value={data.totals.withIntent} total={data.totals.totalPages} icon={<Crosshair className="h-4 w-4" />} />
        <StatCard
          label="Keyworded vs Clustered"
          value={data.totals.withPillar}
          total={withKeyword}
          dual
          icon={<Network className="h-4 w-4" />}
          notice={keywordedNotClustered > 0 ? `${keywordedNotClustered} keyworded, not clustered` : undefined}
          testId="stat-card-keyworded-vs-clustered"
        />
        <StatCard label="Focus Features" value={data.totals.withFocusFeatures} total={data.totals.totalPages} icon={<Star className="h-4 w-4" />} />
      </div>

      <SearchConsoleCoverageCard configured={gsc?.configured} summary={summary} />

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Crosshair className="h-4 w-4" />
            Funnel stage distribution
          </CardTitle>
        </CardHeader>
        <CardContent>
          {contentTypes.length === 0 ? (
            <p className="text-sm text-muted-foreground">No funnel stage data found</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs" data-testid="intent-distribution-table">
                <thead>
                  <tr>
                    <th className="text-left py-2 pr-4 text-muted-foreground font-medium">Content Type</th>
                    {ALL_INTENTS.map((intent) => (
                      <th key={intent} className="text-center py-2 px-2 text-muted-foreground font-medium">
                        {INTENT_LABELS[intent]}
                      </th>
                    ))}
                    <th className="text-center py-2 px-2 text-muted-foreground font-medium">Unknown</th>
                  </tr>
                </thead>
                <tbody>
                  {contentTypes.map((ct) => (
                    <tr key={ct} className="border-t border-border" data-testid={`intent-row-${ct}`}>
                      <td className="py-2 pr-4 font-medium text-foreground capitalize">{ct}</td>
                      {[...ALL_INTENTS, "unknown"].map((intent) => {
                        const count = data.intentDistribution[ct]?.[intent] || 0;
                        return (
                          <td key={intent} className="py-2 px-2 text-center" data-testid={`intent-cell-${ct}-${intent}`}>
                            {count > 0 ? (
                              <span className={`inline-flex items-center justify-center px-2 py-0.5 rounded text-xs font-medium ${INTENT_COLORS[intent]}`}>
                                {count}
                              </span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Network className="h-4 w-4" />
            Cluster Map
            <Badge variant="secondary">{data.clusters.length} pillar{data.clusters.length !== 1 ? "s" : ""}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ClusterMapHelp />
          {data.clusterHealth ? <ClusterHealthPanel health={data.clusterHealth} /> : null}
          {data.brokenClusterRefs && data.brokenClusterRefs.length > 0 ? (
            <BrokenClusterRefsPanel refs={data.brokenClusterRefs} clusters={data.clusters} />
          ) : null}
          <IndexWarningsPanel warnings={data.indexWarnings ?? []} />
          {data.clusters.length === 0 ? (
            <div className="text-center py-8" data-testid="clusters-empty">
              <Network className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
              <p className="text-sm text-muted-foreground">No clusters yet</p>
              <p className="text-xs text-muted-foreground mt-1">
                Open a page and use the SEO Meta tab: mark the hub as a pillar, then point
                supporting pages at that hub.
              </p>
            </div>
          ) : (
            <Accordion type="multiple">
              {[...data.clusters]
                .sort((a, b) => {
                  if (a.clusterCount === 0 && b.clusterCount !== 0) return -1;
                  if (b.clusterCount === 0 && a.clusterCount !== 0) return 1;
                  return clusterListLabel(a.keyword, a.pillarUrl).localeCompare(
                    clusterListLabel(b.keyword, b.pillarUrl),
                    undefined,
                    { sensitivity: "base" },
                  );
                })
                .map((cluster) => {
                  const hubId = cluster.hubId || cluster.pillarUrl;
                  const hubLocale = cluster.locale || "en";
                  const members =
                    cluster.members && cluster.members.length > 0
                      ? cluster.members
                      : cluster.clusterSlugs.map((slug) => ({
                          id: slug,
                          slug,
                          contentType: "",
                          locale: hubLocale,
                          path: "",
                        }));
                  const excludePaths = [
                    cluster.pillarUrl,
                    ...members.map((m) => m.path).filter(Boolean),
                  ];
                  const excludeIds = members.map((m) => m.id).filter(Boolean);

                  return (
                  <AccordionItem
                    key={hubId}
                    value={hubId}
                    data-testid={`cluster-${cluster.pillarUrl}`}
                  >
                    <AccordionTrigger className="text-xs py-2 hover:no-underline">
                      <div className="flex items-center gap-2 text-left">
                        <Network className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <span className="text-xs font-medium text-foreground">
                          {clusterListLabel(cluster.keyword, cluster.pillarUrl)}
                        </span>
                        <Badge variant="secondary" className={clusterCountBadgeClass(cluster.clusterCount)}>
                          {cluster.clusterCount} page{cluster.clusterCount !== 1 ? "s" : ""}
                        </Badge>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent className="text-xs">
                      <p
                        className="text-[11px] text-muted-foreground font-mono pb-2"
                        data-testid={`cluster-path-${cluster.pillarUrl}`}
                      >
                        {cluster.pillarUrl}
                      </p>
                      {hubId ? <ClusterMissingLinksPanel hubId={hubId} /> : null}
                      <div className="divide-y divide-border" data-testid="cluster-members-list">
                        {members.map((member) => (
                          <ClusterMemberRow
                            key={member.id}
                            member={member}
                            hubPillarUrl={cluster.pillarUrl}
                            hubId={hubId}
                            gscConfigured={gsc?.configured}
                          />
                        ))}
                      </div>
                      <div className="pt-2">
                        <ClusterMemberAssignFlow
                          hubPillarUrl={cluster.pillarUrl}
                          hubLabel={clusterListLabel(cluster.keyword, cluster.pillarUrl)}
                          locale={hubLocale}
                          excludePaths={excludePaths}
                          excludeIds={excludeIds}
                          onAssigned={() => invalidateClusterQueries(hubId)}
                          trigger={
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2 text-xs"
                              data-testid={`button-cluster-add-page-${hubId}`}
                            >
                              <Plus className="h-3.5 w-3.5 mr-1" />
                              Add page
                            </Button>
                          }
                        />
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                  );
                })}
            </Accordion>
          )}
        </CardContent>
      </Card>

      <Card className="col-span-12">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Star className="h-4 w-4" />
              Focus Feature Coverage
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2" data-testid="feature-coverage-list">
              {Object.entries(ALL_FEATURES).map(([key, label]) => {
                const count = data.featureCoverage[key] || 0;
                return (
                  <div key={key} className="flex items-center justify-between gap-2" data-testid={`feature-row-${key}`}>
                    <span className={`text-xs ${count === 0 ? "text-muted-foreground" : "text-foreground"}`}>{label}</span>
                    <Badge variant={count === 0 ? "outline" : "secondary"} className="text-xs tabular-nums">
                      {count}
                    </Badge>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
    </div>
  );
}

export function GeoTab({ data, brand }: { data: SeoOverview; brand: BrandContext | null }) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3" data-testid="geo-totals-grid">
        <StatCard label="Total Pages" value={data.totals.totalPages} icon={<Globe className="h-4 w-4" />} />
        <StatCard label="With FAQ" value={data.totals.withFaq} total={data.totals.totalPages} icon={<Brain className="h-4 w-4" />} />
        <StatCard label="With Schema" value={data.totals.withSchema} total={data.totals.totalPages} icon={<Info className="h-4 w-4" />} />
      </div>

      {brand && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Brain className="h-4 w-4" />
              Brand Context
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {brand.brand && (
              <div data-testid="brand-identity">
                <p className="text-base font-semibold text-foreground">{brand.brand.name}</p>
                {brand.brand.tagline && (
                  <p className="text-sm text-muted-foreground italic mt-0.5">"{brand.brand.tagline}"</p>
                )}
                {brand.brand.mission && (
                  <p className="text-xs text-muted-foreground mt-1">{brand.brand.mission}</p>
                )}
              </div>
            )}

            {brand.key_differentiators && brand.key_differentiators.length > 0 && (
              <div data-testid="brand-differentiators">
                <p className="text-xs font-medium text-foreground mb-1.5">Key Differentiators</p>
                <div className="flex flex-wrap gap-1.5">
                  {brand.key_differentiators.map((d, i) => (
                    <Badge key={i} variant="secondary" className="text-xs">{d}</Badge>
                  ))}
                </div>
              </div>
            )}

            {brand.forbidden_phrases && brand.forbidden_phrases.length > 0 && (
              <div data-testid="brand-forbidden">
                <p className="text-xs font-medium text-foreground mb-1.5">Forbidden Phrases</p>
                <div className="flex flex-wrap gap-1.5">
                  {brand.forbidden_phrases.map((fp, i) => (
                    <Badge
                      key={i}
                      variant="outline"
                      className="text-xs text-destructive border-destructive/30"
                      title={fp.reason}
                      data-testid={`forbidden-${fp.phrase.replace(/\s+/g, "-")}`}
                    >
                      {fp.phrase}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {brand.target_audience?.primary && (
              <div data-testid="brand-audience">
                <p className="text-xs font-medium text-foreground mb-1.5">Primary Audience</p>
                <p className="text-xs text-muted-foreground">{brand.target_audience.primary.description}</p>
                {brand.target_audience.primary.concerns && (
                  <div className="mt-1.5">
                    <p className="text-xs text-muted-foreground font-medium">Common concerns:</p>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {brand.target_audience.primary.concerns.map((c, i) => (
                        <Badge key={i} variant="outline" className="text-xs">{c}</Badge>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Brain className="h-4 w-4" />
              FAQ Coverage
              <Badge variant="secondary">{data.faqCoverage.length} pages</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {data.faqCoverage.length === 0 ? (
              <div className="text-center py-6" data-testid="faq-empty">
                <p className="text-sm text-muted-foreground">No FAQ sections found</p>
                <p className="text-xs text-muted-foreground mt-1">Add <code className="bg-muted px-1 rounded">type: faq</code> sections to improve AI search coverage</p>
              </div>
            ) : (
              <ScrollArea className="max-h-64">
                <div className="space-y-1.5" data-testid="faq-coverage-list">
                  {data.faqCoverage.map((f, i) => (
                    <div key={`${f.slug}-${f.locale}-${i}`} className="flex items-center justify-between gap-2 py-1 border-b border-border last:border-0" data-testid={`faq-${f.slug}-${f.locale}`}>
                      <div className="min-w-0">
                        <span className="text-xs font-mono text-foreground truncate block">{f.slug}</span>
                        <span className="text-xs text-muted-foreground">{f.locale} · {f.contentType}</span>
                      </div>
                      <Badge variant="secondary" className="text-xs shrink-0">{f.faqCount} FAQ{f.faqCount !== 1 ? "s" : ""}</Badge>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Info className="h-4 w-4" />
              Schema.org Distribution
            </CardTitle>
          </CardHeader>
          <CardContent>
            {Object.keys(data.schemaCoverage).length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">No schema types found</p>
            ) : (
              <div className="flex flex-wrap gap-2" data-testid="schema-distribution">
                {Object.entries(data.schemaCoverage)
                  .sort(([, a], [, b]) => b - a)
                  .map(([schemaType, count]) => (
                    <div key={schemaType} className="flex items-center gap-1.5" data-testid={`schema-type-${schemaType}`}>
                      <Badge variant="secondary" className="text-xs font-mono">{schemaType}</Badge>
                      <span className="text-xs text-muted-foreground">{count}</span>
                    </div>
                  ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default function SeoGeoPage() {
  const { data: overview, isLoading: overviewLoading } = useQuery<SeoOverview>({
    queryKey: ["/api/seo/overview"],
  });

  const { data: brandRaw, isLoading: brandLoading } = useQuery<BrandContext>({
    queryKey: ["/api/brand-context"],
  });

  const brand = brandRaw && !("error" in brandRaw) ? brandRaw : null;

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-7xl mx-auto px-4 py-6">
        <Tabs defaultValue="seo">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
            <div className="flex items-center gap-3">
              <Link href="/private/diagnostics">
                <Button variant="ghost" size="icon" data-testid="button-back-diagnostics">
                  <ArrowLeft className="h-5 w-5" />
                </Button>
              </Link>
              <div className="flex items-center gap-2">
                <Crosshair className="h-5 w-5 text-primary" />
                <h1 className="text-lg font-semibold text-foreground" data-testid="text-seo-geo-title">
                  SEO &amp; GEO
                </h1>
              </div>
            </div>
            <TabsList data-testid="tabs-seo-geo">
              <TabsTrigger value="seo" data-testid="tab-seo">SEO</TabsTrigger>
              <TabsTrigger value="geo" data-testid="tab-geo">GEO</TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="seo">
            {overviewLoading ? (
              <LoadingSection />
            ) : overview ? (
              <SeoTab data={overview} />
            ) : (
              <p className="text-muted-foreground text-sm text-center py-12">Failed to load SEO data</p>
            )}
          </TabsContent>

          <TabsContent value="geo">
            {overviewLoading || brandLoading ? (
              <LoadingSection />
            ) : overview ? (
              <GeoTab data={overview} brand={brand} />
            ) : (
              <p className="text-muted-foreground text-sm text-center py-12">Failed to load GEO data</p>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
