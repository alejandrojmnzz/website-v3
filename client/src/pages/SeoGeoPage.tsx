import { useEffect, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, ArrowLeft, Brain, Check, ChevronDown, Crosshair, Globe, Info, Loader2, Network, Star } from "lucide-react";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type {
  GscInspectEnqueueResponse,
  GscInspectMode,
  GscInspectionGetResponse,
  GscInspectionSummary,
  GscInspectQueueStats,
} from "@/lib/gscInspection";
import { gscInspectModeLabel } from "@/lib/gscInspection";
import { getSessionHeaders } from "@/lib/sessionHeaders";
import { getDebugToken, useDebugAuth } from "@/hooks/useDebugAuth";
import { useToast } from "@/hooks/use-toast";
import { apiRequestWithAuth, queryClient } from "@/lib/queryClient";

interface SeoOverview {
  intentDistribution: Record<string, Record<string, number>>;
  clusters: { pillarUrl: string; clusterSlugs: string[]; clusterCount: number; hubId?: string }[];
  orphanPages: { slug: string; contentType: string; intent: string; filePath: string }[];
  featureCoverage: Record<string, number>;
  faqCoverage: { slug: string; contentType: string; locale: string; faqCount: number }[];
  schemaCoverage: Record<string, number>;
  indexRebuilt?: boolean;
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
          {data.indexRebuilt && (
            <p
              className="mb-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-100"
              data-testid="banner-cluster-index-rebuilt"
            >
              Cluster index rebuilt from page SEO fields.
            </p>
          )}
          {data.clusters.length === 0 ? (
            <div className="text-center py-8" data-testid="clusters-empty">
              <Network className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
              <p className="text-sm text-muted-foreground">No pillar pages defined yet</p>
              <p className="text-xs text-muted-foreground mt-1">
                Set <code className="bg-muted px-1 rounded">seo.is_pillar</code> on the hub and{" "}
                <code className="bg-muted px-1 rounded">seo.pillar_path</code> on supporting pages
              </p>
            </div>
          ) : (
            <Accordion type="multiple">
              {data.clusters.map((cluster) => (
                <AccordionItem key={cluster.pillarUrl} value={cluster.pillarUrl} data-testid={`cluster-${cluster.pillarUrl}`}>
                  <AccordionTrigger className="text-xs py-2 hover:no-underline">
                    <div className="flex items-center gap-2 text-left">
                      <code className="text-xs bg-muted px-1.5 py-0.5 rounded text-foreground font-mono">{cluster.pillarUrl}</code>
                      <Badge variant="secondary">{cluster.clusterCount} page{cluster.clusterCount !== 1 ? "s" : ""}</Badge>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent>
                    <div className="flex flex-wrap gap-1.5 pt-1 pb-2">
                      {cluster.clusterSlugs.map((slug) => (
                        <Badge key={slug} variant="outline" className="text-xs font-mono" data-testid={`cluster-slug-${slug}`}>
                          {slug}
                        </Badge>
                      ))}
                    </div>
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-12 gap-6">
        <Card className="col-span-12 md:col-span-5">
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

        <Card className="col-span-12 md:col-span-7">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" />
              Orphan Pages
              {data.orphanPages.length > 0 && (
                <Badge variant="destructive">{data.orphanPages.length}</Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {data.orphanPages.length === 0 ? (
              <div className="text-center py-6" data-testid="orphans-empty">
                <Check className="h-6 w-6 mx-auto text-chart-3 mb-2" />
                <p className="text-sm text-muted-foreground">All pages are clustered</p>
              </div>
            ) : (
              <ScrollArea className="max-h-64">
                <div className="space-y-1.5" data-testid="orphan-pages-list">
                  {data.orphanPages.map((p, i) => (
                    <div key={`${p.slug}-${i}`} className="py-1.5 border-b border-border last:border-0" data-testid={`orphan-${p.slug}`}>
                      <span className="text-xs font-mono text-foreground block truncate">{p.slug}</span>
                      <div className="flex items-center gap-1 mt-1">
                        <Badge variant="outline" className="text-xs capitalize">{p.contentType}</Badge>
                        <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs ${INTENT_COLORS[p.intent] || INTENT_COLORS.unknown}`}>
                          {INTENT_LABELS[p.intent] || p.intent}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}
          </CardContent>
        </Card>
      </div>
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
