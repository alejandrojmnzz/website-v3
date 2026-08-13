import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {AlertTriangle, ArrowLeft, ArrowRight, Check, ChevronDown, Crosshair, FileText, Globe, Image, Info, LayoutGrid, Link as LinkIcon, Loader2, Play, RefreshCw, Save, Search, Stethoscope, Trash2, Wrench, X} from "lucide-react";
import { IconChartBar } from "@tabler/icons-react";
import { useState, useRef, useEffect } from "react";
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
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
import { MetricsAccessGate } from "@/components/MetricsAccessGate";
import LeadsTab from "@/components/diagnostics/LeadsTab";
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

type SeverityFilter = "all" | "errors" | "warnings";
type CategoryFilter = "all" | "seo" | "integrity" | "content" | "components" | "forms" | "performance" | "bindings";

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
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>("all");
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all");
  const [validatorFilter, setValidatorFilter] = useState<string>("all");
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

  const categories: { key: CategoryFilter; label: string }[] = [
    { key: "all", label: "All" },
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
    if (severityFilter === "errors" && issue.severity !== "error") return false;
    if (severityFilter === "warnings" && issue.severity !== "warning") return false;
    if (categoryFilter !== "all" && issue.category !== categoryFilter) return false;
    if (validatorFilter !== "all" && (issue.validator || "unknown") !== validatorFilter) return false;
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
            <code className="text-xs">validation-cache.json</code>. Filters narrow that store; there is no
            separate run-results issue list. Refresh / Hard refresh / Re-run validator update the store via a{" "}
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
            <div className="flex flex-wrap gap-1">
              {(["all", "errors", "warnings"] as SeverityFilter[]).map((s) => (
                <Button
                  key={s}
                  variant={severityFilter === s ? "default" : "outline"}
                  size="sm"
                  onClick={() => setSeverityFilter(s)}
                  className="toggle-elevate"
                  data-testid={`button-severity-${s}`}
                >
                  {s.charAt(0).toUpperCase() + s.slice(1)}
                </Button>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap gap-1">
            {categories.map((c) => (
              <Button
                key={c.key}
                variant={categoryFilter === c.key ? "default" : "outline"}
                size="sm"
                onClick={() => setCategoryFilter(c.key)}
                className="toggle-elevate"
                data-testid={`button-category-${c.key}`}
              >
                {c.label}
              </Button>
            ))}
          </div>
          {validatorNamesInCache.length > 0 && (
            <div className="flex flex-wrap gap-1">
              <Button
                variant={validatorFilter === "all" ? "default" : "outline"}
                size="sm"
                onClick={() => setValidatorFilter("all")}
                className="toggle-elevate"
                data-testid="button-validator-all"
              >
                All validators
              </Button>
              {validatorNamesInCache.map((name) => (
                <Button
                  key={name}
                  variant={validatorFilter === name ? "default" : "outline"}
                  size="sm"
                  onClick={() => setValidatorFilter(name)}
                  className="toggle-elevate"
                  data-testid={`button-validator-${name}`}
                >
                  {name}
                </Button>
              ))}
            </div>
          )}
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

function PageAnalysisTab() {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedUrl, setSelectedUrl] = useState<string | null>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const { data: pagesData, isLoading: pagesLoading } = useQuery<{ pages: PageSummary[]; total: number }>({
    queryKey: ["/api/diagnostics/pages"],
  });

  const { data: pageDiag, isLoading: diagLoading } = useQuery<PageDiagnostics>({
    queryKey: [`/api/diagnostics/page?url=${encodeURIComponent(selectedUrl || "")}`],
    enabled: !!selectedUrl,
  });

  const groupedPages = (() => {
    if (!pagesData?.pages) return {};
    const filtered = pagesData.pages.filter(
      (p) =>
        p.url.toLowerCase().includes(searchTerm.toLowerCase()) ||
        p.title.toLowerCase().includes(searchTerm.toLowerCase())
    );
    const groups: Record<string, PageSummary[]> = {};
    for (const p of filtered) {
      const key = p.contentType || "other";
      if (!groups[key]) groups[key] = [];
      groups[key].push(p);
    }
    return groups;
  })();

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <label className="text-sm font-medium text-foreground">Select a page to analyze</label>
        <div className="relative max-w-lg" ref={dropdownRef}>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search pages..."
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setDropdownOpen(true);
              }}
              onFocus={() => setDropdownOpen(true)}
              className="pl-10"
              data-testid="input-search-pages"
            />
          </div>
          {dropdownOpen && pagesData && (
            <Card
              className="absolute z-50 top-full mt-1 w-full shadow-lg"
              style={{ borderRadius: "0.8rem" }}
            >
              <ScrollArea className="max-h-72">
                <div className="p-2">
                  {Object.entries(groupedPages).map(([type, pages]) => (
                    <div key={type}>
                      <p className="text-xs font-semibold text-muted-foreground uppercase px-2 py-1.5">{type}</p>
                      {pages.map((page) => (
                        <button
                          key={page.url}
                          className="w-full text-left px-2 py-1.5 rounded-md text-sm hover-elevate flex items-center justify-between gap-2"
                          onClick={() => {
                            setSelectedUrl(page.url);
                            setSearchTerm(page.title || page.url);
                            setDropdownOpen(false);
                          }}
                          data-testid={`option-page-${page.url}`}
                        >
                          <div className="flex-1 min-w-0">
                            <p className="truncate text-foreground">{page.title || page.url}</p>
                            <p className="text-xs text-muted-foreground truncate">{page.url}</p>
                          </div>
                          <div className="flex flex-wrap gap-1">
                            {page.hasMeta && <Badge variant="secondary" className="text-xs">Meta</Badge>}
                            {page.hasSchema && <Badge variant="secondary" className="text-xs">Schema</Badge>}
                          </div>
                        </button>
                      ))}
                    </div>
                  ))}
                  {Object.keys(groupedPages).length === 0 && (
                    <p className="text-sm text-muted-foreground text-center py-4">No pages found</p>
                  )}
                </div>
              </ScrollArea>
            </Card>
          )}
        </div>
      </div>

      {pagesLoading && (
        <div className="flex items-center justify-center py-16">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-current border-r-transparent" />
        </div>
      )}

      {diagLoading && selectedUrl && (
        <div className="flex items-center justify-center py-16">
          <div className="text-center">
            <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-current border-r-transparent" />
            <p className="mt-4 text-muted-foreground">Loading page diagnostics...</p>
          </div>
        </div>
      )}

      {pageDiag && !diagLoading && (
        <div className="space-y-6">
          <div>
            <h3 className="text-lg font-semibold text-foreground" data-testid="text-page-title">{pageDiag.title}</h3>
            <a
              href={pageDiag.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-muted-foreground font-mono hover:text-primary transition-colors"
              data-testid="link-page-url"
            >{pageDiag.url}</a>
          </div>

          <p className="text-sm text-muted-foreground max-w-2xl">
            One shared validation store. Global Health lists every cached issue; the page DebugBubble
            shows issues targeting that entry (including redirects/media). Saving re-checks local rules;
            redirect conflicts refresh when redirect config changes or you run Redirects here. Results
            persist until that area is re-validated — there is no health score %.
          </p>

          <div className="flex flex-wrap items-center gap-4" data-testid="issue-count-dashboard">
            <div className="rounded-lg border border-border px-4 py-3">
              <p className="text-2xl font-bold text-destructive" data-testid="text-page-error-count">
                {pageDiag.issues?.filter((i) => i.type === "error").length ?? 0}
              </p>
              <p className="text-xs text-muted-foreground">Errors</p>
            </div>
            <div className="rounded-lg border border-border px-4 py-3">
              <p className="text-2xl font-bold text-chart-2" data-testid="text-page-warning-count">
                {pageDiag.issues?.filter((i) => i.type === "warning").length ?? 0}
              </p>
              <p className="text-xs text-muted-foreground">Warnings</p>
            </div>
            {pageDiag.dirty && (
              <Badge variant="secondary" data-testid="badge-page-dirty">May be outdated</Badge>
            )}
          </div>

          {pageDiag.issues && pageDiag.issues.length > 0 && (
            <Card style={{ borderRadius: "0.8rem" }} data-testid="card-page-store-issues">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Store issues for this entry</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 max-h-64 overflow-auto">
                {pageDiag.issues.map((issue, i) => (
                  <div key={`${issue.code}-${i}`} className="text-xs border-b border-border/60 pb-2">
                    <span className={issue.type === "error" ? "text-destructive font-medium" : "text-chart-2 font-medium"}>
                      {issue.type}
                    </span>
                    {" · "}
                    <span className="text-muted-foreground">{issue.validator || "unknown"}</span>
                    {" · "}
                    <code>{issue.code}</code>
                    <div className="text-foreground mt-0.5">{issue.message}</div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}


          {pageDiag.schemaValidation && !pageDiag.schemaValidation.valid && (
            <Card style={{ borderRadius: "0.8rem" }} data-testid="card-schema-validation">
              <CardHeader className="flex flex-row items-center gap-2 pb-2">
                <AlertTriangle className="h-4 w-4 text-destructive" />
                <CardTitle className="text-sm text-destructive">Schema Validation Errors</CardTitle>
                <Badge variant="destructive" className="ml-auto text-xs">
                  {pageDiag.schemaValidation.errors.length} {pageDiag.schemaValidation.errors.length === 1 ? "error" : "errors"}
                </Badge>
                <InfoPopover testId="info-schema-validation">
                  <p>The page's raw YAML is validated against its content-type's structure definition. Errors here mean the content does not match what the renderer expects.</p>
                  <p>Each error includes a <strong className="text-foreground">code</strong>, the offending <strong className="text-foreground">path</strong> within the YAML, and what was expected vs. what was received.</p>
                  <p>Structural validation errors can prevent the page from rendering correctly in production.</p>
                </InfoPopover>
              </CardHeader>
              <CardContent className="space-y-2">
                <p className="text-xs text-muted-foreground mb-2">These errors prevent the page from rendering. The YAML content does not match the expected schema.</p>
                {pageDiag.schemaValidation.errors.map((err, i) => (
                  <div key={i} className="p-3 rounded-md bg-destructive/10 border border-destructive/30 text-sm" data-testid={`schema-error-${i}`}>
                    <div className="font-mono font-medium text-destructive text-xs">{err.code}</div>
                    <div className="mt-1 text-foreground">
                      {err.path && <span className="font-mono text-muted-foreground">{err.path}: </span>}
                      {err.message}
                    </div>
                    {err.expected && (
                      <div className="mt-1 text-xs text-muted-foreground">
                        Expected: <span className="font-mono">{err.expected}</span>
                        {err.received && (<> | Received: <span className="font-mono">{err.received}</span></>)}
                      </div>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {pageDiag.issues && pageDiag.issues.length > 0 && (
            <Card style={{ borderRadius: "0.8rem" }} data-testid="card-issues">
              <CardHeader className="flex flex-row items-center gap-2 pb-2">
                <AlertTriangle className="h-4 w-4 text-muted-foreground" />
                <CardTitle className="text-sm">Issues</CardTitle>
                <InfoPopover testId="info-issues">
                  <p><strong className="text-foreground">Errors</strong> (red) indicate problems that likely break something — for example a missing required field or an invalid reference.</p>
                  <p><strong className="text-foreground">Warnings</strong> (amber) are non-blocking but should be addressed. Common codes include <code className="bg-muted px-1 rounded text-foreground">MISSING_PAGE_TITLE</code>, <code className="bg-muted px-1 rounded text-foreground">MISSING_DESCRIPTION</code>, and <code className="bg-muted px-1 rounded text-foreground">ORPHAN_PAGE</code>.</p>
                  <p>Issues are raised by content validators that run against the merged YAML for this page.</p>
                </InfoPopover>
              </CardHeader>
              <CardContent className="space-y-2">
                {pageDiag.issues.filter(i => i.type === "error").map((issue, i) => (
                  <div key={`e-${i}`} className="p-2 rounded-md bg-destructive/10 border border-destructive/30 text-sm" data-testid={`issue-error-${i}`}>
                    <span className="font-mono text-xs text-destructive">{issue.code}</span>
                    <span className="ml-2 text-foreground">{issue.message}</span>
                  </div>
                ))}
                {pageDiag.issues.filter(i => i.type === "warning").map((issue, i) => (
                  <div key={`w-${i}`} className="p-2 rounded-md bg-amber-500/10 border border-amber-500/30 text-sm" data-testid={`issue-warning-${i}`}>
                    <span className="font-mono text-xs text-amber-700 dark:text-amber-300">{issue.code}</span>
                    <span className="ml-2 text-foreground">{issue.message}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          <Card style={{ borderRadius: "0.8rem" }} data-testid="card-meta">
            <CardHeader className="flex flex-row items-center gap-2 pb-2">
              <FileText className="h-4 w-4 text-muted-foreground" />
              <CardTitle className="text-sm">Meta Information</CardTitle>
              <InfoPopover testId="info-meta">
                <p>Reads from the <code className="bg-muted px-1 rounded text-foreground">meta:</code> block of the page's YAML.</p>
                <p><strong className="text-foreground">page_title</strong> — shown in browser tabs and search results. Optimal: 30–60 characters (+30 pts to SEO).</p>
                <p><strong className="text-foreground">description</strong> — the meta description shown in search snippets and social previews. Optimal: 70–160 characters (+30 pts to SEO).</p>
                <p><strong className="text-foreground">og_image</strong> — the image displayed when this page is shared on social media (+10 pts).</p>
                <p><strong className="text-foreground">canonical_url</strong> — tells search engines which URL is authoritative, preventing duplicate-content penalties (+10 pts).</p>
                <p><strong className="text-foreground">robots</strong> — controls crawler directives, e.g. <code className="bg-muted px-1 rounded text-foreground">noindex</code>.</p>
              </InfoPopover>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium text-muted-foreground">Page Title</span>
                  </div>
                  <p className="text-sm text-foreground mb-1 break-all">{pageDiag.meta.page_title || "Not set"}</p>
                  <LengthBar value={pageDiag.meta.titleLength} max={70} optimal={60} />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium text-muted-foreground">Description</span>
                  </div>
                  <p className="text-sm text-foreground mb-1 break-all">{pageDiag.meta.description || "Not set"}</p>
                  <LengthBar value={pageDiag.meta.descriptionLength} max={160} optimal={155} />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <span className="text-xs font-medium text-muted-foreground">OG Image</span>
                    <p className="text-sm text-foreground break-all mt-0.5">{pageDiag.meta.og_image || "Not set"}</p>
                  </div>
                  <div>
                    <span className="text-xs font-medium text-muted-foreground">Canonical URL</span>
                    <p className="text-sm text-foreground break-all mt-0.5">{pageDiag.meta.canonical_url || "Not set"}</p>
                  </div>
                  <div>
                    <span className="text-xs font-medium text-muted-foreground">Robots</span>
                    <p className="text-sm text-foreground mt-0.5">{pageDiag.meta.robots || "Not set"}</p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card style={{ borderRadius: "0.8rem" }} data-testid="card-schema">
            <CardHeader className="flex flex-row items-center gap-2 pb-2">
              <Code className="h-4 w-4 text-muted-foreground" />
              <CardTitle className="text-sm">Schema / JSON-LD</CardTitle>
              <InfoPopover testId="info-schema">
                <p>Schema.org structured data helps search engines and AI assistants understand page content beyond plain text.</p>
                <p>Emission is <strong className="text-foreground">section-driven</strong>: leading <code className="bg-muted px-1 rounded text-foreground">schema_org</code> sections plus FAQ, Article, and Breadcrumb contributors. Site Organization/Website templates live in <code className="bg-muted px-1 rounded text-foreground">schema-org.yml</code>. WebSite/Organization belong on the home page as <code className="bg-muted px-1 rounded text-foreground">schema_org</code> sections; elsewhere they are page-local. Legacy <code className="bg-muted px-1 rounded text-foreground">schema.include</code> is ignored.</p>
                <p>If the page has FAQ sections, a <code className="bg-muted px-1 rounded text-foreground">FAQPage</code> schema should also be present to unlock rich results. Any <code className="bg-muted px-1 rounded text-foreground">todo</code> placeholder in a schema field is flagged and penalises the Schema score.</p>
                <p>The JSON-LD preview shows the fully resolved objects that will be rendered.</p>
              </InfoPopover>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted-foreground">Configured:</span>
                {pageDiag.schema.configured ? (
                  <Badge variant="secondary" className="gap-1">
                    <Check className="h-3 w-3" /> Yes
                  </Badge>
                ) : (
                  <Badge variant="destructive" className="gap-1">
                    <X className="h-3 w-3" /> No
                  </Badge>
                )}
              </div>
              {(pageDiag.schema.sources?.length ?? 0) > 0 && (
                <div>
                  <span className="text-xs text-muted-foreground">Section sources:</span>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {pageDiag.schema.sources!.map((src) => (
                      <Badge key={src} variant="secondary" className="text-xs">{src}</Badge>
                    ))}
                  </div>
                </div>
              )}
              {pageDiag.schema.includes.length > 0 && (
                <div>
                  <span className="text-xs text-muted-foreground">schema_org types:</span>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {pageDiag.schema.includes.map((inc) => (
                      <Badge key={inc} variant="outline" className="text-xs">{inc}</Badge>
                    ))}
                  </div>
                </div>
              )}
              {pageDiag.schema.renderedJsonLd.length > 0 && (
                <div>
                  <span className="text-xs text-muted-foreground">JSON-LD Preview:</span>
                  <div className="mt-1 rounded-md bg-muted p-3 overflow-x-auto">
                    <pre className="text-xs font-mono text-foreground whitespace-pre">
                      {JSON.stringify(pageDiag.schema.renderedJsonLd, null, 2)}
                    </pre>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card style={{ borderRadius: "0.8rem" }} data-testid="card-sections">
            <CardHeader className="flex flex-row items-center gap-2 pb-2">
              <LayoutGrid className="h-4 w-4 text-muted-foreground" />
              <CardTitle className="text-sm">Sections</CardTitle>
              <InfoPopover testId="info-sections">
                <p>Content blocks defined in the YAML <code className="bg-muted px-1 rounded text-foreground">sections:</code> array. Each block is rendered as a UI component.</p>
                <p>Every section should have a <code className="bg-muted px-1 rounded text-foreground">type</code> field (e.g. <code className="bg-muted px-1 rounded text-foreground">hero</code>, <code className="bg-muted px-1 rounded text-foreground">features_grid</code>, <code className="bg-muted px-1 rounded text-foreground">faq</code>, <code className="bg-muted px-1 rounded text-foreground">pricing</code>). Having sections earns +25 pts and all being typed earns another +20 pts toward the Content score.</p>
                <p><strong className="text-foreground">FAQ sections</strong> are especially important: they improve AI search engine coverage and make the page eligible for a FAQPage schema, which can unlock rich results in Google and AI assistants.</p>
              </InfoPopover>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <span className="text-muted-foreground">Count: <strong className="text-foreground">{pageDiag.sections.count}</strong></span>
                <span className="text-muted-foreground">
                  FAQ: {pageDiag.sections.hasFaq ? (
                    <Badge variant="secondary" className="ml-1 text-xs"><Check className="h-3 w-3" /></Badge>
                  ) : (
                    <Badge variant="outline" className="ml-1 text-xs"><X className="h-3 w-3" /></Badge>
                  )}
                </span>
              </div>
              {pageDiag.sections.types.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {pageDiag.sections.types.map((t) => (
                    <Badge key={t} variant="outline" className="text-xs">{t}</Badge>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card style={{ borderRadius: "0.8rem" }} data-testid="card-images">
            <CardHeader className="flex flex-row items-center gap-2 pb-2">
              <Image className="h-4 w-4 text-muted-foreground" />
              <CardTitle className="text-sm">Images</CardTitle>
              <InfoPopover testId="info-images">
                <p>Scans every <code className="bg-muted px-1 rounded text-foreground">image_id</code> and <code className="bg-muted px-1 rounded text-foreground">image</code> key anywhere in the page's merged YAML content and collects the referenced IDs.</p>
                <p><strong className="text-foreground">Green badge</strong> — image is registered in the media registry and the file exists on disk.</p>
                <p><strong className="text-foreground">Red badge</strong> — image is either missing from the registry or the physical file cannot be found. This will produce broken images in production.</p>
                <p>If any images are missing, <strong className="text-foreground">20 points</strong> are deducted from the Content score.</p>
              </InfoPopover>
            </CardHeader>
            <CardContent className="space-y-2">
              {pageDiag.images.referencedIds.length === 0 && (
                <p className="text-sm text-muted-foreground">No images referenced</p>
              )}
              {pageDiag.images.referencedIds.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {pageDiag.images.referencedIds.map((id) => {
                    const missingReg = pageDiag.images.missingFromRegistry.includes(id);
                    const missingDisk = pageDiag.images.missingFromDisk.includes(id);
                    const isMissing = missingReg || missingDisk;
                    const badge = (
                      <Badge
                        key={id}
                        variant={isMissing ? "destructive" : "secondary"}
                        className={`text-xs font-mono gap-1${isMissing ? " cursor-pointer" : " no-default-hover-elevate"}`}
                        data-testid={`badge-image-${id}`}
                      >
                        {isMissing ? <X className="h-3 w-3" /> : <Check className="h-3 w-3" />}
                        {id}
                      </Badge>
                    );
                    if (!isMissing) return badge;
                    return (
                      <Popover key={id}>
                        <PopoverTrigger asChild>{badge}</PopoverTrigger>
                        <PopoverContent align="start" className="w-64 space-y-2 p-3">
                          <p className="text-xs font-medium text-foreground">Why is this image missing?</p>
                          <ul className="text-xs text-muted-foreground space-y-1 list-disc list-inside">
                            {missingReg && <li>Not found in the media registry</li>}
                            {missingDisk && <li>File not found on disk</li>}
                          </ul>
                        </PopoverContent>
                      </Popover>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card style={{ borderRadius: "0.8rem" }} data-testid="card-translations">
              <CardHeader className="flex flex-row items-center gap-2 pb-2">
                <Globe className="h-4 w-4 text-muted-foreground" />
                <CardTitle className="text-sm">Translations</CardTitle>
                <InfoPopover testId="info-translations">
                  <p>Detects the companion locale file for this page. 4Geeks content is published in <strong className="text-foreground">English (en)</strong> and <strong className="text-foreground">Spanish (es)</strong>.</p>
                  <p>If a counterpart locale file exists, it is linked here so you can quickly jump to its diagnostics. Having a translation file earns <strong className="text-foreground">+20 points</strong> toward the Content score.</p>
                  <p>Available locales are shown as badges. A page with only one locale is missing an opportunity to reach a wider audience.</p>
                </InfoPopover>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="flex flex-wrap gap-2">
                  {pageDiag.translations.availableLocales.map((loc) => (
                    <Badge key={loc} variant="secondary" className="gap-1">
                      <Check className="h-3 w-3" />
                      {loc.toUpperCase()}
                    </Badge>
                  ))}
                </div>
                {pageDiag.translations.counterpartUrl && (
                  <Link href={`/private/diagnostics?url=${encodeURIComponent(pageDiag.translations.counterpartUrl)}`}>
                    <span className="text-sm text-primary flex items-center gap-1 cursor-pointer">
                      <ArrowRight className="h-3.5 w-3.5" />
                      {pageDiag.translations.counterpartUrl}
                    </span>
                  </Link>
                )}
              </CardContent>
            </Card>

            <Card style={{ borderRadius: "0.8rem" }} data-testid="card-redirects">
              <CardHeader className="flex flex-row items-center gap-2 pb-2">
                <LinkIcon className="h-4 w-4 text-muted-foreground" />
                <CardTitle className="text-sm">Incoming Redirects</CardTitle>
                <InfoPopover testId="info-redirects">
                  <p>Lists all redirect rules in the repository whose destination points to this page's URL.</p>
                  <p>These are 301/302 redirects configured in the redirects file — useful for auditing legacy URL migrations and ensuring old links still lead here.</p>
                  <p>Having no incoming redirects is not a problem; this section is purely informational and does not affect any score.</p>
                </InfoPopover>
              </CardHeader>
              <CardContent>
                {pageDiag.redirects.incomingRedirects.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No incoming redirects</p>
                ) : (
                  <div className="space-y-1">
                    {pageDiag.redirects.incomingRedirects.map((r) => (
                      <p key={r} className="text-sm font-mono text-foreground">{r}</p>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {!selectedUrl && !pagesLoading && (
        <Card style={{ borderRadius: "0.8rem" }}>
          <CardContent className="p-8 text-center">
            <Search className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <p className="text-muted-foreground">Select a page above to view its diagnostics</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default function DiagnosticsPage() {
  const [activeTab, setActiveTab] = useState("global-health");
  return (
    <MetricsAccessGate>
    <div className="min-h-screen bg-background">
      <div className="max-w-7xl mx-auto px-4 py-6">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
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
              <Link href="/private/diagnostics/seo-geo">
                <Button variant="outline" size="sm" data-testid="button-seo-geo">
                  <Crosshair className="h-3.5 w-3.5" />
                  SEO &amp; GEO
                </Button>
              </Link>
              <Link href="/private/tracking">
                <Button variant="outline" size="sm" data-testid="button-tracking">
                  <IconChartBar className="h-3.5 w-3.5" />
                  Tracking
                </Button>
              </Link>
              <TabsList data-testid="tabs-diagnostics">
                <TabsTrigger value="global-health" data-testid="tab-global-health">Global Health</TabsTrigger>
                <TabsTrigger value="page-analysis" data-testid="tab-page-analysis">Page Analysis</TabsTrigger>
                <TabsTrigger value="leads" data-testid="tab-leads">Leads</TabsTrigger>
              </TabsList>
            </div>
          </div>
          <TabsContent value="global-health">
            <GlobalHealthTab onOpenLeads={() => setActiveTab("leads")} />
          </TabsContent>
          <TabsContent value="page-analysis">
            <PageAnalysisTab />
          </TabsContent>
          <TabsContent value="leads">
            <LeadsTab />
          </TabsContent>
        </Tabs>
      </div>
    </div>
    </MetricsAccessGate>
  );
}
