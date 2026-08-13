import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {AlertTriangle, ArrowLeft, Brain, Check, ChevronDown, Crosshair, Globe, Info, Loader2, Play, RefreshCw, Save, Search, Stethoscope, Trash2, Users, Wrench, X} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiFetch, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useFormatSitePath } from "@/hooks/useFormatSitePath";
import { useDebugAuth } from "@/hooks/useDebugAuth";
import { useIsMobile } from "@/hooks/use-mobile";
import { MetricsAccessGate } from "@/components/MetricsAccessGate";
import LeadsTab from "@/components/diagnostics/LeadsTab";
import RuntimeIssuesTab from "@/components/diagnostics/RuntimeIssuesTab";
import { DiagnosticsSeoPanel, DiagnosticsGeoPanel } from "@/components/diagnostics/DiagnosticsSeoGeoPanels";
import { SitemapSearch } from "@/components/menus/SitemapSearch";
import {
  RedirectConflictResolverModal,
  parseRedirectConflict,
  useRedirectConflictResolver,
  type ValidatorIssue,
} from "@/components/RedirectConflictResolver";

interface ValidatorResult {
  name: string;
  description: string;
  status: "passed" | "failed" | "warning";
  errors: ValidatorIssue[];
  warnings: ValidatorIssue[];
  duration: number;
  category?: string;
  artifacts?: Record<string, unknown>;
}

interface PageSummary {
  url: string;
  title: string;
  locale: string;
  contentType: string;
  slug: string;
  filePath: string;
  hasMeta: boolean;
  hasSchema: boolean;
}

interface PageDiagnostics {
  url: string;
  contentType: string;
  slug: string;
  locale: string;
  filePath: string;
  title: string;
  meta: {
    page_title: string;
    titleLength: number;
    description: string;
    descriptionLength: number;
    og_image: string;
    canonical_url: string;
    robots: string;
  };
  schema: {
    configured: boolean;
    includes: string[];
    sources?: string[];
    renderedJsonLd: object[];
    htmlPreview: string;
  };
  sections: { count: number; types: string[]; hasFaq: boolean };
  images: {
    referencedIds: string[];
    missingFromRegistry: string[];
    missingFromDisk: string[];
  };
  translations: {
    locale: string;
    availableLocales: string[];
    counterpartUrl: string | null;
  };
  redirects: { incomingRedirects: string[] };
  emptyFields: string[];
  schemaValidation?: {
    valid: boolean;
    errors: Array<{
      path: string;
      code: string;
      message: string;
      expected?: string;
      received?: string;
    }>;
  };
  issues?: Array<{
    type: "error" | "warning" | "info";
    code: string;
    message: string;
    category?: string;
    validator?: string;
    details?: {
      path?: string;
      expected?: string;
      received?: string;
    };
  }>;
  /** @deprecated Removed from API — use issues from the shared store. */
  score?: { total: number; seo: number; schema: number; content: number };
  dirty?: boolean;
  entryKey?: string;
  education?: { summary: string };
}

type SeverityFilter = "error" | "warning";

function normalizeIssuePath(urlOrPath: string): string {
  let raw = (urlOrPath || "").split("#")[0].split("?")[0].trim();
  if (!raw) return "";
  try {
    if (/^https?:\/\//i.test(raw)) raw = new URL(raw).pathname || "";
  } catch {
    /* keep */
  }
  if (raw.length > 1 && raw.endsWith("/")) raw = raw.slice(0, -1);
  return raw;
}
type CategoryFilter = "all" | "seo" | "integrity" | "content" | "components" | "forms" | "performance" | "bindings";

/** Tiny count pill pinned to the top-right of a filter trigger. */
function FilterCornerBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span
      className="pointer-events-none absolute -right-1.5 -top-1.5 z-10 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-none text-primary-foreground ring-2 ring-background"
      aria-hidden
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}

function InfoPopover({ children, testId }: { children: React.ReactNode; testId?: string }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="ml-auto h-5 w-5 shrink-0"
          data-testid={testId ?? "button-info-popover"}
        >
          <Info className="h-3.5 w-3.5 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 space-y-2 text-sm text-muted-foreground">
        {children}
      </PopoverContent>
    </Popover>
  );
}


type CachedIssueRow = {
  url: string;
  severity: "error" | "warning";
  code: string;
  message: string;
  validator?: string;
  category?: string;
  lastFullRunAt?: string;
  suggestion?: string;
  file?: string;
};

type JobStartResponse = {
  status: string;
  job_id?: string;
  retry_after_seconds?: number;
  message?: string;
  code?: string;
  validators?: ValidatorResult[];
  issuesBySlug?: Record<string, unknown>;
  scope?: { processed?: number; total?: number; staleUrlCount?: number; urlCount?: number };
};

type JobLogLine = {
  t: number;
  level: string;
  text: string;
};

type JobPollResponse = {
  status: string;
  job_id?: string;
  processed?: number;
  total?: number;
  retry_after_seconds?: number;
  validators?: ValidatorResult[];
  error?: string;
  message?: string;
  code?: string;
  summary?: { errorCount: number; warningCount: number };
  log?: JobLogLine[];
};

type JobPanelState = {
  jobId: string;
  label?: string;
  status: string;
  processed: number;
  total: number;
  log: JobLogLine[];
  running: boolean;
};

const ISSUE_DISPLAY_CAP = 200;

async function pollDiagnosticsJob(
  jobId: string,
  onProgress?: (p: {
    processed: number;
    total: number;
    status: string;
    log: JobLogLine[];
  }) => void,
): Promise<JobPollResponse> {
  for (;;) {
    const res = await apiFetch(`/api/validation/diagnostics-jobs/${encodeURIComponent(jobId)}`, {
      credentials: "include",
    });
    const data = (await res.json()) as JobPollResponse;
    if (res.status === 404 || data.status === "not_found") {
      return { ...data, status: "not_found" };
    }
    if (!res.ok) {
      throw new Error(data.message || data.error || `Job poll failed (${res.status})`);
    }
    if (data.status === "queued" || data.status === "running") {
      onProgress?.({
        processed: data.processed ?? 0,
        total: data.total ?? 0,
        status: data.status,
        log: data.log ?? [],
      });
      const waitMs = Math.max(1, data.retry_after_seconds ?? 5) * 1000;
      await new Promise((r) => setTimeout(r, waitMs));
      continue;
    }
    return data;
  }
}

function cacheRowToValidatorIssue(row: CachedIssueRow): ValidatorIssue {
  return {
    type: row.severity === "error" ? "error" : "warning",
    code: row.code,
    message: row.message,
    ...(row.file ? { file: row.file } : {}),
    ...(row.suggestion ? { suggestion: row.suggestion } : {}),
  };
}

function GlobalHealthTab({ onOpenLeads }: { onOpenLeads?: () => void }) {
  void onOpenLeads;
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { canMutateMetrics } = useDebugAuth();
  const formatSitePath = useFormatSitePath();
  const [search, setSearch] = useState("");
  const [pagePathFilter, setPagePathFilter] = useState("");
  const [pageFilterOpen, setPageFilterOpen] = useState(false);
  const [severityFilters, setSeverityFilters] = useState<SeverityFilter[]>([]);
  const [categoryFilters, setCategoryFilters] = useState<Exclude<CategoryFilter, "all">[]>([]);
  const [validatorFilters, setValidatorFilters] = useState<string[]>([]);
  const [rerunValidator, setRerunValidator] = useState<string>("");
  const [lastRun, setLastRun] = useState<Date | null>(null);
  const [jobPanel, setJobPanel] = useState<JobPanelState | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [clearCacheOpen, setClearCacheOpen] = useState(false);
  const jobLogScrollRef = useRef<HTMLDivElement>(null);
  const hideJobPanelTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { resolveModalOpen, setResolveModalOpen, activeConflict, openResolver } = useRedirectConflictResolver();

  useEffect(() => {
    const el = jobLogScrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [jobPanel?.log.length, jobPanel?.jobId]);

  useEffect(() => {
    return () => {
      if (hideJobPanelTimer.current) clearTimeout(hideJobPanelTimer.current);
    };
  }, []);

  const scheduleHideJobPanel = () => {
    if (hideJobPanelTimer.current) clearTimeout(hideJobPanelTimer.current);
    hideJobPanelTimer.current = setTimeout(() => setJobPanel(null), 3000);
  };

  const { data: cacheIssuesData, refetch: refetchCacheIssues } = useQuery<{ issues: CachedIssueRow[] }>({
    queryKey: ["/api/validation/cache-issues"],
  });
  const cacheIssues = cacheIssuesData?.issues ?? [];

  const { data: validatorsData } = useQuery<{
    validators: Array<{ name: string; description?: string; category?: string }>;
  }>({
    queryKey: ["/api/validation/validators"],
  });
  const availableValidators = validatorsData?.validators ?? [];

  const startJobMutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      if (hideJobPanelTimer.current) clearTimeout(hideJobPanelTimer.current);
      const res = await apiFetch("/api/validation/diagnostics-jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        credentials: "include",
      });
      const data = (await res.json()) as JobStartResponse;
      if (res.status === 409 || data.status === "busy") {
        throw new Error(data.message || "Another diagnostics job is already running for this site.");
      }
      if (!res.ok) {
        throw new Error((data as { message?: string }).message || "Failed to start diagnostics job");
      }
      if (data.status === "cached") {
        return { kind: "cached" as const, data };
      }
      if (!data.job_id) {
        throw new Error("Missing job_id from diagnostics-jobs");
      }
      const jobId = data.job_id;
      setJobPanel({
        jobId,
        status: "queued",
        processed: 0,
        total: 0,
        log: [],
        running: true,
      });
      const final = await pollDiagnosticsJob(jobId, (p) => {
        setJobPanel({
          jobId,
          status: p.status,
          processed: p.processed,
          total: p.total,
          log: p.log,
          running: true,
        });
      });
      setJobPanel({
        jobId,
        status: final.status,
        processed: final.processed ?? 0,
        total: final.total ?? 0,
        log: final.log ?? [],
        running: false,
      });
      if (final.status === "failed" || final.status === "not_found") {
        throw new Error(final.error || final.message || `Job ${final.status}`);
      }
      return { kind: "completed" as const, data: final };
    },
    onSuccess: (outcome) => {
      scheduleHideJobPanel();
      void refetchCacheIssues();
      void queryClient.invalidateQueries({ queryKey: ["/api/validation/cache-summary"] });
      if (outcome.kind === "cached") {
        toast({ title: "Cache fresh", description: "No stale URLs — showing cached diagnostics." });
        setLastRun(new Date());
        return;
      }
      setLastRun(new Date());
      toast({
        title: "Diagnostics completed",
        description: outcome.data.summary
          ? `${outcome.data.summary.errorCount} errors, ${outcome.data.summary.warningCount} warnings`
          : "Cache updated.",
      });
    },
    onError: (err) => {
      setJobPanel((prev) =>
        prev
          ? {
              ...prev,
              running: false,
              status: "failed",
              log: [
                ...prev.log,
                {
                  t: Date.now(),
                  level: "error",
                  text: err instanceof Error ? err.message : "Unknown error",
                },
              ],
            }
          : prev,
      );
      scheduleHideJobPanel();
      toast({
        title: "Diagnostics failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    },
  });

  const runAllMutation = {
    isPending: startJobMutation.isPending,
    mutate: (freshness: "max_age" | "hard" = "max_age") => {
      startJobMutation.mutate({
        freshness,
        max_age_seconds: 86400,
        include_artifacts: true,
      });
    },
  };

  const runSingleMutation = useMutation({
    mutationFn: async (name: string) => {
      if (hideJobPanelTimer.current) clearTimeout(hideJobPanelTimer.current);
      const res = await apiFetch("/api/validation/diagnostics-jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          validators: [name],
          include_artifacts: true,
          freshness: "hard",
        }),
        credentials: "include",
      });
      const data = (await res.json()) as JobStartResponse;
      if (res.status === 409 || data.status === "busy") {
        throw new Error(data.message || "Another diagnostics job is already running.");
      }
      if (!res.ok) {
        throw new Error((data as { message?: string }).message || "Failed to start job");
      }
      if (data.status === "cached") {
        return { name };
      }
      if (!data.job_id) throw new Error("Missing job_id");
      const jobId = data.job_id;
      setJobPanel({
        jobId,
        label: name,
        status: "queued",
        processed: 0,
        total: 0,
        log: [],
        running: true,
      });
      const final = await pollDiagnosticsJob(jobId, (p) => {
        setJobPanel({
          jobId,
          label: name,
          status: p.status,
          processed: p.processed,
          total: p.total,
          log: p.log,
          running: true,
        });
      });
      setJobPanel({
        jobId,
        label: name,
        status: final.status,
        processed: final.processed ?? 0,
        total: final.total ?? 0,
        log: final.log ?? [],
        running: false,
      });
      if (final.status === "failed" || final.status === "not_found") {
        throw new Error(final.error || final.message || `Job ${final.status}`);
      }
      return { name };
    },
    onSuccess: (data) => {
      scheduleHideJobPanel();
      void refetchCacheIssues();
      void queryClient.invalidateQueries({ queryKey: ["/api/validation/cache-summary"] });
      setLastRun(new Date());
      toast({
        title: "Validator finished",
        description: `Updated cache for ${data.name}.`,
      });
    },
    onError: (err) => {
      setJobPanel((prev) =>
        prev
          ? {
              ...prev,
              running: false,
              status: "failed",
              log: [
                ...prev.log,
                {
                  t: Date.now(),
                  level: "error",
                  text: err instanceof Error ? err.message : "Unknown error",
                },
              ],
            }
          : prev,
      );
      scheduleHideJobPanel();
      toast({
        title: "Validator run failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    },
  });

  const saveReportMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/validation/save-report", {});
      return (await res.json()) as { ok: boolean; path: string; timestamp: string };
    },
    onSuccess: (data) => {
      toast({
        title: "Report saved",
        description: formatSitePath(data.path),
      });
    },
    onError: (err) => {
      toast({
        title: "Failed to save report",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    },
  });

  const clearCacheMutation = useMutation({
    mutationFn: async () => {
      const res = await apiFetch("/api/validation/clear-cache", {
        method: "POST",
        credentials: "include",
      });
      const data = (await res.json()) as { success?: boolean; message?: string; error?: string };
      if (res.status === 409) {
        throw new Error(data.message || "Diagnostics job is running — wait before clearing.");
      }
      if (!res.ok || data.success === false) {
        throw new Error(data.message || data.error || "Failed to clear validation cache");
      }
      return data;
    },
    onSuccess: () => {
      setClearCacheOpen(false);
      setLastRun(null);
      void refetchCacheIssues();
      void queryClient.invalidateQueries({ queryKey: ["/api/validation/cache-summary"] });
      void queryClient.invalidateQueries({ queryKey: ["/api/validation/cache-issues"] });
      toast({
        title: "Validation cache cleared",
        description: "Run Refresh stale or Hard refresh to rebuild diagnostics.",
      });
    },
    onError: (err) => {
      toast({
        title: "Failed to clear cache",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    },
  });

  const severityOptions: { key: SeverityFilter; label: string }[] = [
    { key: "error", label: "Errors" },
    { key: "warning", label: "Warnings" },
  ];

  const scopeCategories: { key: Exclude<CategoryFilter, "all">; label: string }[] = [
    { key: "seo", label: "SEO" },
    { key: "integrity", label: "Integrity" },
    { key: "content", label: "Content" },
    { key: "components", label: "Components" },
    { key: "forms", label: "Forms" },
    { key: "bindings", label: "Bindings" },
    { key: "performance", label: "Performance" },
  ];

  const validatorNamesInCache = Array.from(
    new Set(cacheIssues.map((i) => i.validator).filter(Boolean) as string[]),
  ).sort();

  const filteredIssues = cacheIssues.filter((issue) => {
    if (
      severityFilters.length > 0 &&
      !severityFilters.includes(issue.severity as SeverityFilter)
    ) {
      return false;
    }
    if (
      categoryFilters.length > 0 &&
      !categoryFilters.includes((issue.category || "unknown") as Exclude<CategoryFilter, "all">)
    ) {
      return false;
    }
    if (
      validatorFilters.length > 0 &&
      !validatorFilters.includes(issue.validator || "unknown")
    ) {
      return false;
    }
    if (pagePathFilter) {
      const want = normalizeIssuePath(pagePathFilter);
      const got = normalizeIssuePath(issue.url || "");
      // Blank-URL rows (templates/overlays/site-wide) must not match any page filter.
      // Avoid endsWith("") — every string ends with "" in JS.
      if (!want) {
        /* no-op */
      } else if (!got) {
        return false;
      } else if (got !== want && !got.endsWith(want) && !want.endsWith(got)) {
        return false;
      }
    }
    if (search) {
      const q = search.toLowerCase();
      const hay = [issue.message, issue.code, issue.url, issue.validator, issue.category]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const filteredSummary = {
    errors: filteredIssues.filter((i) => i.severity === "error").length,
    warnings: filteredIssues.filter((i) => i.severity === "warning").length,
    urls: new Set(filteredIssues.map((i) => i.url).filter(Boolean)).size,
  };

  const jobPending = startJobMutation.isPending || runSingleMutation.isPending || clearCacheMutation.isPending;
  const displayedIssues = filteredIssues.slice(0, ISSUE_DISPLAY_CAP);

  const rerunOptions = (() => {
    const names = new Set<string>();
    for (const v of availableValidators) {
      if (v.name && v.name !== "lighthouse") names.add(v.name);
    }
    for (const n of validatorNamesInCache) names.add(n);
    return Array.from(names).sort();
  })();

  return (
    <div className="space-y-6">
      <Card style={{ borderRadius: "0.8rem" }} data-testid="diagnostics-how-it-works">
        <CardContent className="p-4 space-y-2 text-sm text-muted-foreground">
          <p className="text-foreground font-medium">How diagnostics work</p>
          <p>
            Global Health shows one shared issue store in{" "}
            <code className="text-xs">validation-cache.json</code>. Use{" "}
            <strong className="text-foreground font-medium">Page or URL</strong> to filter by sitemap page;
            open the live page + DebugBubble for in-context fixes (Page Analysis tab removed).
            Refresh / Hard refresh / Re-run validator update the store via a{" "}
            <strong className="text-foreground font-medium">background worker</strong>; the job panel shows
            milestones (fixed height, scrolls). Cached issues refresh when the job finishes. Delete cache
            wipes the store until the next refresh. One job runs at a time per site.
          </p>
          <button
            type="button"
            className="text-xs text-primary underline-offset-2 hover:underline"
            onClick={() => setShowAdvanced((v) => !v)}
            data-testid="button-diagnostics-read-more"
          >
            {showAdvanced ? "Hide advanced" : "Read more (advanced)"}
          </button>
          {showAdvanced && (
            <ul className="list-disc pl-5 text-xs space-y-1">
              <li><code>server/services/diagnosticsJobService.ts</code> — parent job orchestration + IPC</li>
              <li><code>scripts/validation/diagnostics-worker.ts</code> — forked worker that runs validators</li>
              <li><code>{"{contentRoot}/validation-cache.json"}</code> — issue cache (GCS <code>{"{site}/sync/validation-cache.json"}</code> in prod)</li>
              <li><code>{"{contentRoot}/.cache/diagnostics-jobs/"}</code> — job envelopes + results files</li>
              <li>API: <code>POST/GET /api/validation/diagnostics-jobs</code>, <code>GET /api/validation/cache-issues</code></li>
            </ul>
          )}
        </CardContent>
      </Card>

      {jobPanel && (
        <div
          className="rounded-lg border border-border overflow-hidden"
          data-testid="diagnostics-job-banner"
        >
          <div className="flex items-center gap-2 px-4 py-2.5 text-sm text-foreground bg-muted/40 border-b border-border">
            {jobPanel.running ? (
              <Loader2 className="h-4 w-4 animate-spin shrink-0" />
            ) : jobPanel.status === "failed" || jobPanel.status === "not_found" ? (
              <AlertTriangle className="h-4 w-4 text-destructive shrink-0" />
            ) : (
              <Check className="h-4 w-4 text-chart-2 shrink-0" />
            )}
            <span className="truncate">
              {jobPanel.label ? `${jobPanel.label}: ` : "Job "}
              {jobPanel.jobId}: {jobPanel.status}
              {jobPanel.total > 0 ? ` (${jobPanel.processed}/${jobPanel.total})` : ""}
            </span>
          </div>
          <div
            ref={jobLogScrollRef}
            className="bg-zinc-950 text-zinc-100 font-mono text-xs max-h-48 overflow-y-auto px-3 py-2 space-y-0.5"
            data-testid="diagnostics-job-log"
          >
            {jobPanel.log.length === 0 ? (
              <div className="text-zinc-500">Waiting for worker output…</div>
            ) : (
              jobPanel.log.map((line, i) => (
                <div
                  key={`${line.t}-${i}`}
                  className={
                    line.level === "error"
                      ? "text-red-400"
                      : line.level === "warn"
                        ? "text-amber-300"
                        : "text-zinc-200"
                  }
                >
                  <span className="text-zinc-500 mr-2">
                    {new Date(line.t).toLocaleTimeString()}
                  </span>
                  {line.text}
                </div>
              ))
            )}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-foreground" data-testid="text-global-health-title">
            Content Diagnostics
          </h2>
          <p className="text-sm text-muted-foreground mt-1 max-w-xl">
            Shared validation store for the whole site. Page bubbles show the same issues filtered to each entry.
          </p>
          {lastRun && (
            <p className="text-xs text-muted-foreground mt-1" data-testid="text-last-run">
              Last run: {lastRun.toLocaleTimeString()}
            </p>
          )}
        </div>
        {canMutateMetrics && (
          <div className="flex flex-wrap items-center gap-2">
            <Select value={rerunValidator || undefined} onValueChange={setRerunValidator}>
              <SelectTrigger className="w-[180px]" data-testid="select-rerun-validator">
                <SelectValue placeholder="Re-run validator…" />
              </SelectTrigger>
              <SelectContent>
                {rerunOptions.map((name) => (
                  <SelectItem key={name} value={name}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              disabled={!rerunValidator || jobPending}
              onClick={() => rerunValidator && runSingleMutation.mutate(rerunValidator)}
              data-testid="button-rerun-validator"
            >
              {runSingleMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Play className="h-4 w-4" />
              )}
              Run
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  disabled={jobPending || saveReportMutation.isPending}
                  data-testid="button-run-all"
                >
                  {jobPending || saveReportMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4" />
                  )}
                  {jobPending ? "Running..." : saveReportMutation.isPending ? "Saving..." : "Refresh"}
                  <ChevronDown className="h-3 w-3 ml-1" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onClick={() => runAllMutation.mutate("max_age")}
                  data-testid="menu-item-refresh-stale"
                >
                  <RefreshCw className="h-4 w-4" />
                  Refresh stale
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => runAllMutation.mutate("hard")}
                  data-testid="menu-item-hard-refresh"
                >
                  <Play className="h-4 w-4" />
                  Hard refresh
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => saveReportMutation.mutate()}
                  data-testid="menu-item-save-report"
                >
                  <Save className="h-4 w-4" />
                  Save JSON report
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onClick={() => setClearCacheOpen(true)}
                  data-testid="menu-item-delete-cache"
                >
                  <Trash2 className="h-4 w-4" />
                  Delete cache
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>

      <Dialog open={clearCacheOpen} onOpenChange={setClearCacheOpen}>
        <DialogContent data-testid="dialog-delete-validation-cache">
          <DialogHeader>
            <DialogTitle>Delete validation cache?</DialogTitle>
            <DialogDescription>
              This clears all stored diagnostics issues and run metadata in{" "}
              <code className="text-xs">validation-cache.json</code> for this site.
              Cached issues will disappear until you run Refresh stale or Hard refresh again.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setClearCacheOpen(false)}
              disabled={clearCacheMutation.isPending}
              data-testid="button-cancel-delete-cache"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => clearCacheMutation.mutate()}
              disabled={clearCacheMutation.isPending}
              data-testid="button-confirm-delete-cache"
            >
              {clearCacheMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
              Delete cache
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {cacheIssues.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3" data-testid="cache-summary-bar">
          <Card style={{ borderRadius: "0.8rem" }}>
            <CardContent className="p-4 text-center">
              <p className="text-2xl font-bold text-destructive">{filteredSummary.errors}</p>
              <p className="text-xs text-muted-foreground">Errors</p>
            </CardContent>
          </Card>
          <Card style={{ borderRadius: "0.8rem" }}>
            <CardContent className="p-4 text-center">
              <p className="text-2xl font-bold text-chart-2">{filteredSummary.warnings}</p>
              <p className="text-xs text-muted-foreground">Warnings</p>
            </CardContent>
          </Card>
          <Card style={{ borderRadius: "0.8rem" }}>
            <CardContent className="p-4 text-center">
              <p className="text-2xl font-bold text-foreground">{filteredSummary.urls}</p>
              <p className="text-xs text-muted-foreground">Unique URLs</p>
            </CardContent>
          </Card>
        </div>
      )}

      {cacheIssues.length > 0 && (
        <div className="space-y-3" data-testid="cache-issue-filters">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[200px] max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search issues…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-10"
                data-testid="input-search-issues"
              />
            </div>
            <div className="flex flex-wrap items-center gap-1" data-testid="page-path-filter">
              <Popover open={pageFilterOpen} onOpenChange={setPageFilterOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="relative toggle-elevate max-w-[280px]"
                    title={pagePathFilter || undefined}
                    data-testid="button-page-url-filter"
                  >
                    <span className="truncate">Page or URL</span>
                    <ChevronDown className="ml-1 h-3.5 w-3.5 opacity-70 shrink-0" />
                    <FilterCornerBadge count={pagePathFilter ? 1 : 0} />
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-80 p-0">
                  <div className="flex items-center justify-between gap-2 px-3 pt-3 pb-2">
                    <p className="text-xs font-medium text-muted-foreground truncate" title={pagePathFilter || undefined}>
                      {pagePathFilter
                        ? `Filtering: ${pagePathFilter}`
                        : "Filter issues by page or custom URL"}
                    </p>
                    {pagePathFilter && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs shrink-0"
                        onClick={() => setPagePathFilter("")}
                        data-testid="button-clear-page-filter"
                      >
                        Clear
                      </Button>
                    )}
                  </div>
                  <SitemapSearch
                    embedded
                    value={pagePathFilter}
                    onChange={(value) => setPagePathFilter(normalizeIssuePath(value))}
                    onClose={() => setPageFilterOpen(false)}
                    placeholder="Filter by page…"
                    testId="sitemap-page-filter"
                  />
                </PopoverContent>
              </Popover>
            </div>
            <div className="flex flex-wrap items-center gap-1">
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="relative toggle-elevate"
                    data-testid="button-severity-filter"
                  >
                    Severity
                    <ChevronDown className="ml-1 h-3.5 w-3.5 opacity-70" />
                    <FilterCornerBadge count={severityFilters.length} />
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-72 p-3 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-medium text-muted-foreground">
                      Toggle severity to filter issues
                    </p>
                    {severityFilters.length > 0 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs"
                        onClick={() => setSeverityFilters([])}
                        data-testid="button-severity-clear"
                      >
                        Clear
                      </Button>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1.5" data-testid="severity-tag-cloud">
                    {severityOptions.map((s) => {
                      const active = severityFilters.includes(s.key);
                      return (
                        <Button
                          key={s.key}
                          variant={active ? "default" : "outline"}
                          size="sm"
                          className="h-7 toggle-elevate"
                          onClick={() => {
                            setSeverityFilters((prev) =>
                              prev.includes(s.key)
                                ? prev.filter((v) => v !== s.key)
                                : [...prev, s.key],
                            );
                          }}
                          data-testid={`button-severity-${s.key}`}
                        >
                          {s.label}
                        </Button>
                      );
                    })}
                  </div>
                </PopoverContent>
              </Popover>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="relative toggle-elevate"
                    data-testid="button-scope-filter"
                  >
                    Error scope
                    <ChevronDown className="ml-1 h-3.5 w-3.5 opacity-70" />
                    <FilterCornerBadge count={categoryFilters.length} />
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-80 p-3 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-medium text-muted-foreground">
                      Toggle scopes to filter issues
                    </p>
                    {categoryFilters.length > 0 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs"
                        onClick={() => setCategoryFilters([])}
                        data-testid="button-scope-clear"
                      >
                        Clear
                      </Button>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1.5" data-testid="scope-tag-cloud">
                    {scopeCategories.map((c) => {
                      const active = categoryFilters.includes(c.key);
                      return (
                        <Button
                          key={c.key}
                          variant={active ? "default" : "outline"}
                          size="sm"
                          className="h-7 toggle-elevate"
                          onClick={() => {
                            setCategoryFilters((prev) =>
                              prev.includes(c.key)
                                ? prev.filter((v) => v !== c.key)
                                : [...prev, c.key],
                            );
                          }}
                          data-testid={`button-category-${c.key}`}
                        >
                          {c.label}
                        </Button>
                      );
                    })}
                  </div>
                </PopoverContent>
              </Popover>
              {validatorNamesInCache.length > 0 && (
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className="relative toggle-elevate"
                      data-testid="button-validator-filter"
                    >
                      Validators
                      <ChevronDown className="ml-1 h-3.5 w-3.5 opacity-70" />
                      <FilterCornerBadge count={validatorFilters.length} />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent align="start" className="w-80 p-3 space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-medium text-muted-foreground">
                        Toggle validators to filter issues
                      </p>
                      {validatorFilters.length > 0 && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs"
                          onClick={() => setValidatorFilters([])}
                          data-testid="button-validator-clear"
                        >
                          Clear
                        </Button>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1.5" data-testid="validator-tag-cloud">
                      {validatorNamesInCache.map((name) => {
                        const active = validatorFilters.includes(name);
                        return (
                          <Button
                            key={name}
                            variant={active ? "default" : "outline"}
                            size="sm"
                            className="h-7 toggle-elevate"
                            onClick={() => {
                              setValidatorFilters((prev) =>
                                prev.includes(name)
                                  ? prev.filter((v) => v !== name)
                                  : [...prev, name],
                              );
                            }}
                            data-testid={`button-validator-${name}`}
                          >
                            {name}
                          </Button>
                        );
                      })}
                    </div>
                  </PopoverContent>
                </Popover>
              )}
            </div>
          </div>
        </div>
      )}

      {jobPending && cacheIssues.length === 0 && (
        <div className="flex items-center justify-center py-16">
          <div className="text-center">
            <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-current border-r-transparent" />
            <p className="mt-4 text-muted-foreground">Running diagnostics job…</p>
          </div>
        </div>
      )}

      {!jobPending && cacheIssues.length === 0 && (
        <Card style={{ borderRadius: "0.8rem" }}>
          <CardContent className="p-8 text-center">
            <Stethoscope className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <p className="text-muted-foreground mb-4">
              {canMutateMetrics
                ? "No cached diagnostics yet — run Refresh stale or Hard refresh."
                : "No cached diagnostics yet. Ask a Webmaster (or staff with edit access) to run a refresh."}
            </p>
            {canMutateMetrics && (
              <div className="flex flex-wrap justify-center gap-2">
                <Button
                  onClick={() => runAllMutation.mutate("max_age")}
                  data-testid="button-run-all-empty"
                >
                  <RefreshCw className="h-4 w-4" />
                  Refresh stale
                </Button>
                <Button
                  variant="outline"
                  onClick={() => runAllMutation.mutate("hard")}
                  data-testid="button-hard-refresh-empty"
                >
                  <Play className="h-4 w-4" />
                  Hard refresh
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {cacheIssues.length > 0 && (
        <Card style={{ borderRadius: "0.8rem" }} data-testid="cached-issues-panel">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              Cached issues ({filteredIssues.length}
              {filteredIssues.length !== cacheIssues.length ? ` of ${cacheIssues.length}` : ""})
            </CardTitle>
          </CardHeader>
          <CardContent className="max-h-[32rem] overflow-auto space-y-2">
            {displayedIssues.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center" data-testid="text-no-issues-match">
                No issues match your filters
              </p>
            ) : (
              displayedIssues.map((issue, idx) => {
                const asValidatorIssue = cacheRowToValidatorIssue(issue);
                const conflict = parseRedirectConflict(asValidatorIssue);
                return (
                  <div
                    key={`${issue.url}-${issue.code}-${issue.validator}-${idx}`}
                    className="text-xs border-b border-border/60 pb-2"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={
                          issue.severity === "error"
                            ? "text-destructive font-medium"
                            : "text-chart-2 font-medium"
                        }
                      >
                        {issue.severity}
                      </span>
                      <span className="text-muted-foreground">{issue.validator || "unknown"}</span>
                      {issue.category && (
                        <Badge variant="outline" className="text-[10px]">
                          {issue.category}
                        </Badge>
                      )}
                      <code>{issue.code}</code>
                      {conflict && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 gap-1 ml-auto"
                          onClick={() => openResolver(asValidatorIssue)}
                          data-testid={`button-resolve-cache-${issue.code}-${idx}`}
                        >
                          <Wrench className="h-3.5 w-3.5" />
                          Resolve
                        </Button>
                      )}
                    </div>
                    <div className="text-foreground mt-0.5">{issue.message}</div>
                    {issue.suggestion && (
                      <div className="text-muted-foreground italic mt-0.5">{issue.suggestion}</div>
                    )}
                    {issue.url && <div className="text-muted-foreground">{issue.url}</div>}
                    {issue.file && (
                      <div className="text-muted-foreground font-mono truncate" title={issue.file}>
                        {formatSitePath(issue.file)}
                      </div>
                    )}
                  </div>
                );
              })
            )}
            {filteredIssues.length > ISSUE_DISPLAY_CAP && (
              <p className="text-xs text-muted-foreground">
                Showing first {ISSUE_DISPLAY_CAP} of {filteredIssues.length}
              </p>
            )}
          </CardContent>
        </Card>
      )}

      <RedirectConflictResolverModal
        open={resolveModalOpen}
        onOpenChange={setResolveModalOpen}
        conflict={activeConflict}
        onResolved={() => {
          runSingleMutation.mutate("redirects");
        }}
      />
    </div>
  );
}


const DIAGNOSTICS_TABS: {
  id: "global-health" | "leads" | "runtime-issues" | "seo" | "geo";
  label: string;
  href: string;
  Icon: LucideIcon;
}[] = [
  { id: "global-health", label: "Global", href: "/private/diagnostics", Icon: Globe },
  { id: "leads", label: "Leads", href: "/private/diagnostics/leads", Icon: Users },
  { id: "runtime-issues", label: "Runtime", href: "/private/diagnostics/runtime-issues", Icon: AlertTriangle },
  { id: "seo", label: "SEO", href: "/private/diagnostics/seo", Icon: Crosshair },
  { id: "geo", label: "GEO", href: "/private/diagnostics/geo", Icon: Brain },
];

type DiagnosticsTabId = (typeof DIAGNOSTICS_TABS)[number]["id"];

function resolveDiagnosticsTab(pathname: string): DiagnosticsTabId {
  if (pathname.endsWith("/leads")) return "leads";
  if (pathname.endsWith("/runtime-issues")) return "runtime-issues";
  if (pathname.endsWith("/seo")) return "seo";
  if (pathname.endsWith("/geo")) return "geo";
  if (pathname.endsWith("/global-health")) return "global-health";
  return "global-health";
}

function tabHref(id: DiagnosticsTabId): string {
  return DIAGNOSTICS_TABS.find((t) => t.id === id)?.href ?? "/private/diagnostics";
}

export default function DiagnosticsPage() {
  const [pathname, setLocation] = useLocation();
  const isMobile = useIsMobile();
  const activeTab = resolveDiagnosticsTab(pathname);

  const onTabChange = (next: string) => {
    const id = next as DiagnosticsTabId;
    setLocation(tabHref(id));
  };

  return (
    <MetricsAccessGate>
      <div className="min-h-screen bg-background">
        <div className="max-w-7xl mx-auto px-4 py-6">
          <Tabs value={activeTab} onValueChange={onTabChange}>
            <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
              <div className="flex items-center gap-3">
                <Link href="/">
                  <Button variant="ghost" size="icon" data-testid="button-back-home">
                    <ArrowLeft className="h-5 w-5" />
                  </Button>
                </Link>
                <div className="flex items-center gap-2">
                  <Stethoscope className="h-5 w-5 text-primary" />
                  <h1 className="text-lg font-semibold text-foreground" data-testid="text-diagnostics-title">
                    Diagnostics
                  </h1>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {isMobile ? (
                  <Select value={activeTab} onValueChange={onTabChange}>
                    <SelectTrigger className="w-[200px]" data-testid="select-diagnostics-tab">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {DIAGNOSTICS_TABS.map((t) => (
                        <SelectItem key={t.id} value={t.id} data-testid={`select-tab-${t.id}`}>
                          <span className="inline-flex items-center gap-2">
                            <t.Icon className="h-3.5 w-3.5" />
                            {t.label}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <TabsList data-testid="tabs-diagnostics" className="flex flex-wrap h-auto gap-1">
                    {DIAGNOSTICS_TABS.map((t) => (
                      <TabsTrigger key={t.id} value={t.id} data-testid={`tab-${t.id}`} className="gap-1.5">
                        <t.Icon className="h-3.5 w-3.5" />
                        {t.label}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                )}
              </div>
            </div>
            <TabsContent value="global-health">
              <GlobalHealthTab onOpenLeads={() => setLocation("/private/diagnostics/leads")} />
            </TabsContent>
            <TabsContent value="leads">
              <LeadsTab />
            </TabsContent>
            <TabsContent value="runtime-issues">
              <RuntimeIssuesTab />
            </TabsContent>
            <TabsContent value="seo">
              <DiagnosticsSeoPanel />
            </TabsContent>
            <TabsContent value="geo">
              <DiagnosticsGeoPanel />
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </MetricsAccessGate>
  );
}
