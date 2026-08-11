import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {AlertTriangle, ArrowLeft, ArrowRight, Check, ChevronDown, Clipboard, Code, Crosshair, FileText, Globe, Image, Info, LayoutGrid, Link as LinkIcon, Loader2, Play, RefreshCw, Save, Search, Sparkles, Stethoscope, Wrench, X} from "lucide-react";
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
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { apiFetch, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useFormatSitePath } from "@/hooks/useFormatSitePath";
import LeadsTab from "@/components/diagnostics/LeadsTab";
import {
  RedirectConflictResolverModal,
  parseRedirectConflict,
  useRedirectConflictResolver,
  type ValidatorIssue,
  type RedirectConflictInfo,
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

interface RunResult {
  summary: {
    total: number;
    passed: number;
    failed: number;
    warnings: number;
    duration: number;
  };
  validators: ValidatorResult[];
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
    details?: {
      path?: string;
      expected?: string;
      received?: string;
    };
  }>;
  score: { total: number; seo: number; schema: number; content: number };
}

type SeverityFilter = "all" | "errors" | "warnings";
type CategoryFilter = "all" | "seo" | "integrity" | "content" | "components" | "forms" | "performance" | "bindings";

function getScoreColorClass(score: number): string {
  if (score >= 80) return "text-chart-3";
  if (score >= 50) return "text-chart-2";
  return "text-destructive";
}

function getScoreCssVar(score: number): string {
  if (score >= 80) return "var(--chart-3)";
  if (score >= 50) return "var(--chart-2)";
  return "var(--destructive)";
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

function ScoreCircle({ label, score }: { label: string; score: number }) {
  const cssVar = getScoreCssVar(score);
  const deg = (score / 100) * 360;

  return (
    <div className="flex flex-col items-center gap-2" data-testid={`score-${label.toLowerCase()}`}>
      <div
        className="relative flex items-center justify-center rounded-full"
        style={{
          width: 72,
          height: 72,
          background: `conic-gradient(hsl(${cssVar}) ${deg}deg, hsl(${cssVar} / 0.2) ${deg}deg 360deg)`,
        }}
      >
        <div className="absolute inset-[6px] rounded-full bg-background flex items-center justify-center">
          <span className={`text-lg font-bold ${getScoreColorClass(score)}`}>{score}</span>
        </div>
      </div>
      <span className="text-xs text-muted-foreground font-medium">{label}</span>
    </div>
  );
}

function StatusBadge({ status }: { status: "passed" | "failed" | "warning" }) {
  if (status === "passed") {
    return (
      <Badge variant="secondary" className="gap-1" data-testid={`badge-status-${status}`}>
        <Check className="h-3 w-3" />
        Passed
      </Badge>
    );
  }
  if (status === "warning") {
    return (
      <Badge variant="outline" className="gap-1" data-testid={`badge-status-${status}`}>
        <AlertTriangle className="h-3 w-3" />
        Warning
      </Badge>
    );
  }
  return (
    <Badge variant="destructive" className="gap-1" data-testid={`badge-status-${status}`}>
      <X className="h-3 w-3" />
      Failed
    </Badge>
  );
}


function IssueRow({ issue, onResolve }: { issue: ValidatorIssue; onResolve?: (issue: ValidatorIssue) => void }) {
  const formatSitePath = useFormatSitePath();
  const conflict = parseRedirectConflict(issue);
  const navUrl = issue.fix?.type === "manual" && issue.fix?.url ? issue.fix.url : null;

  return (
    <div className="flex flex-wrap items-start gap-2 py-2 border-b last:border-b-0" data-testid={`issue-${issue.code}`}>
      <div className="flex-shrink-0 mt-0.5">
        {issue.type === "error" ? (
          <X className="h-4 w-4 text-destructive" />
        ) : (
          <AlertTriangle className="h-4 w-4 text-chart-2" />
        )}
      </div>
      <Badge variant="outline" className="text-xs font-mono">{issue.code}</Badge>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-foreground">{issue.message}</p>
        {issue.file && (
          <p className="text-xs text-muted-foreground mt-0.5 font-mono truncate" title={issue.file}>
            {formatSitePath(issue.file)}
          </p>
        )}
        {issue.suggestion && (
          <p className="text-xs text-muted-foreground mt-1 italic">{issue.suggestion}</p>
        )}
      </div>
      {navUrl && (
        <Button
          variant="outline"
          size="sm"
          className="flex-shrink-0 gap-1"
          asChild
          data-testid={`link-goto-section-${issue.code}`}
        >
          <a href={navUrl} target="_blank" rel="noopener noreferrer">
            <ArrowRight className="h-3.5 w-3.5" />
            Go to section
          </a>
        </Button>
      )}
      {conflict && onResolve && (
        <Button
          variant="outline"
          size="sm"
          className="flex-shrink-0 gap-1"
          onClick={() => onResolve(issue)}
          data-testid={`button-resolve-${issue.code}`}
        >
          <Wrench className="h-3.5 w-3.5" />
          Resolve
        </Button>
      )}
    </div>
  );
}

function LengthBar({ value, max, optimal }: { value: number; max: number; optimal: number }) {
  const pct = Math.min((value / max) * 100, 100);
  const isGood = value <= optimal && value > 0;
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${isGood ? "bg-chart-3" : value === 0 ? "bg-muted" : "bg-chart-2"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs text-muted-foreground tabular-nums">{value}/{max}</span>
    </div>
  );
}

function AiPromptDialog({
  open,
  onOpenChange,
  prompt,
  validatorName,
  isPending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  prompt: string | null;
  validatorName: string;
  isPending: boolean;
}) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    if (!prompt) return;
    navigator.clipboard.writeText(prompt).then(() => {
      setCopied(true);
      toast({ title: "Prompt copied", description: "Paste it into your LLM" });
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col gap-0 p-0">
        <DialogHeader className="px-6 pt-6 pb-4 border-b">
          <DialogTitle className="text-base font-semibold">
            AI Prompt — {validatorName}
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Copy this prompt and paste it into any LLM running locally.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-hidden flex flex-col">
          {isPending && (
            <div className="flex items-center justify-center py-16">
              <div className="text-center">
                <div className="inline-block h-6 w-6 animate-spin rounded-full border-4 border-solid border-current border-r-transparent" />
                <p className="mt-3 text-sm text-muted-foreground">Generating prompt…</p>
              </div>
            </div>
          )}
          {!isPending && prompt && (
            <ScrollArea className="flex-1 max-h-[60vh]">
              <pre className="p-4 text-xs font-mono text-foreground whitespace-pre-wrap break-words leading-relaxed bg-muted rounded-none">
                {prompt}
              </pre>
            </ScrollArea>
          )}
        </div>

        <DialogFooter className="px-6 py-4 border-t">
          <Button
            variant="outline"
            size="sm"
            onClick={handleCopy}
            disabled={!prompt || isPending}
            data-testid="button-copy-prompt"
          >
            {copied ? (
              <Check className="h-3.5 w-3.5" />
            ) : (
              <Clipboard className="h-3.5 w-3.5" />
            )}
            {copied ? "Copied!" : "Copy to clipboard"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ValidatorCard({
  v,
  runSingleMutation,
  openResolver,
  onOpenLeads,
}: {
  v: ValidatorResult;
  runSingleMutation: { mutate: (name: string) => void; isPending: boolean };
  openResolver?: (issue: ValidatorIssue) => void;
  onOpenLeads?: () => void;
}) {
  const [promptOpen, setPromptOpen] = useState(false);
  const [promptText, setPromptText] = useState<string | null>(null);
  const [fixPending, setFixPending] = useState<Record<string, boolean>>({});
  const [fixResult, setFixResult] = useState<Record<string, { ok: boolean; message: string } | null>>({});
  const [copiedCmd, setCopiedCmd] = useState<string | null>(null);
  const { toast } = useToast();

  const promptMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/validation/run.prompt", {
        validators: [v.name],
      });
      return (await res.json()) as { prompt: string; validatorNames: string[]; issueCount: number };
    },
    onSuccess: (data) => {
      setPromptText(data.prompt);
    },
    onError: (err) => {
      toast({
        title: "Failed to generate prompt",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    },
  });

  const allIssues = [...v.errors, ...v.warnings];
  const hasIssues = allIssues.length > 0;

  const apiFixes = (() => {
    const map = new Map<string, { label: string; count: number }>();
    for (const issue of allIssues) {
      if (issue.fix?.type === "api" && issue.fix.fixerName) {
        const existing = map.get(issue.fix.fixerName);
        if (existing) { existing.count++; }
        else { map.set(issue.fix.fixerName, { label: issue.fix.label, count: 1 }); }
      }
    }
    return Array.from(map.entries()).map(([name, { label, count }]) => ({ name, label, count }));
  })();

  const scriptFixes = (() => {
    const map = new Map<string, { label: string; command: string; count: number }>();
    for (const issue of allIssues) {
      if (issue.fix?.type === "script" && issue.fix.command) {
        const key = issue.fix.command;
        const existing = map.get(key);
        if (existing) { existing.count++; }
        else { map.set(key, { label: issue.fix.label, command: key, count: 1 }); }
      }
    }
    return Array.from(map.values());
  })();

  const fixSummary = (() => {
    let auto = 0, needPrompt = 0, script = 0, manual = 0;
    for (const issue of allIssues) {
      if (!issue.fix || issue.fix.type === "manual") manual++;
      else if (issue.fix.type === "api") auto++;
      else if (issue.fix.type === "llm") needPrompt++;
      else if (issue.fix.type === "script") script++;
    }
    return { auto, needPrompt, script, manual };
  })();

  const hasFixHints = allIssues.some((i) => i.fix && i.fix.type !== "manual");

  async function handleApiFix(fixerName: string) {
    setFixPending((p) => ({ ...p, [fixerName]: true }));
    setFixResult((r) => ({ ...r, [fixerName]: null }));
    try {
      const res = await apiRequest("POST", `/api/validation/fix/${fixerName}`, {});
      const data = await res.json() as { ok: boolean; message: string; details?: Record<string, unknown> };
      setFixResult((r) => ({ ...r, [fixerName]: { ok: data.ok, message: data.message } }));
      if (data.ok) {
        setTimeout(() => runSingleMutation.mutate(v.name), 500);
      }
    } catch (err) {
      setFixResult((r) => ({
        ...r,
        [fixerName]: { ok: false, message: err instanceof Error ? err.message : "Unknown error" },
      }));
    } finally {
      setFixPending((p) => ({ ...p, [fixerName]: false }));
    }
  }

  function handleCopyCmd(cmd: string) {
    navigator.clipboard.writeText(cmd).then(() => {
      setCopiedCmd(cmd);
      setTimeout(() => setCopiedCmd(null), 2000);
    });
  }

  function handleOpenPrompt() {
    setPromptText(null);
    setPromptOpen(true);
    promptMutation.mutate();
  }

  return (
    <>
      <Card style={{ borderRadius: "0.8rem" }} data-testid={`card-validator-${v.name}`}>
        <CardHeader className="flex flex-row items-start justify-between gap-2 pb-2">
          <div className="flex-1 min-w-0">
            <CardTitle className="text-sm font-semibold truncate">{v.name}</CardTitle>
            <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{v.description}</p>
          </div>
          <StatusBadge status={v.status} />
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            {v.errors.length > 0 && (
              <span className="flex items-center gap-1">
                <X className="h-3 w-3 text-destructive" />
                {v.errors.length} error{v.errors.length !== 1 ? "s" : ""}
              </span>
            )}
            {v.warnings.length > 0 && (
              <span className="flex items-center gap-1">
                <AlertTriangle className="h-3 w-3 text-chart-2" />
                {v.warnings.length} warning{v.warnings.length !== 1 ? "s" : ""}
              </span>
            )}
            <span>{v.duration}ms</span>
          </div>

          {v.name === "forms" && onOpenLeads && (
            <button
              onClick={onOpenLeads}
              className="flex items-center gap-1 text-xs text-primary hover:underline"
              data-testid="button-forms-view-all-sections"
            >
              View all diagnosed form sections in the Leads tab
              <ArrowRight className="h-3 w-3" />
            </button>
          )}

          {hasIssues && hasFixHints && (
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs" data-testid={`fix-summary-${v.name}`}>
              {fixSummary.auto > 0 && (
                <span className="text-chart-3 font-medium">{fixSummary.auto} auto-fixable</span>
              )}
              {fixSummary.script > 0 && (
                <span className="text-muted-foreground">{fixSummary.script} script</span>
              )}
              {fixSummary.needPrompt > 0 && (
                <span className="text-chart-2">{fixSummary.needPrompt} need prompt</span>
              )}
              {fixSummary.manual > 0 && (
                <span className="text-muted-foreground">{fixSummary.manual} manual</span>
              )}
            </div>
          )}

          {hasIssues && (
            <Accordion type="single" collapsible>
              <AccordionItem value="issues" className="border-0">
                <AccordionTrigger className="py-2 text-xs" data-testid={`trigger-issues-${v.name}`}>
                  View Issues ({v.errors.length + v.warnings.length})
                </AccordionTrigger>
                <AccordionContent className="text-sm">
                  <div className="max-h-64 overflow-y-auto space-y-0">
                    {v.errors.map((e, i) => (
                      <IssueRow
                        key={`e-${i}`}
                        issue={e}
                        onResolve={v.name === "redirects" ? openResolver : undefined}
                      />
                    ))}
                    {v.warnings.map((w, i) => (
                      <IssueRow
                        key={`w-${i}`}
                        issue={w}
                        onResolve={v.name === "redirects" ? openResolver : undefined}
                      />
                    ))}
                  </div>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          )}

          {apiFixes.length > 0 && (
            <div className="space-y-2" data-testid={`api-fixes-${v.name}`}>
              {apiFixes.map(({ name, label, count }) => (
                <div key={name} className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleApiFix(name)}
                    disabled={fixPending[name] || runSingleMutation.isPending}
                    data-testid={`button-fix-${name}`}
                  >
                    {fixPending[name] ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Wrench className="h-3.5 w-3.5" />
                    )}
                    {label}
                    <Badge variant="secondary" className="ml-1 text-xs">{count}</Badge>
                  </Button>
                  {fixResult[name] && (
                    <span
                      className={`text-xs ${fixResult[name]!.ok ? "text-chart-3" : "text-destructive"}`}
                      data-testid={`fix-result-${name}`}
                    >
                      {fixResult[name]!.message}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}

          {scriptFixes.length > 0 && (
            <div className="space-y-2" data-testid={`script-fixes-${v.name}`}>
              {scriptFixes.map(({ label, command, count }) => (
                <details key={command} className="text-xs group">
                  <summary
                    className="cursor-pointer flex items-center gap-1 text-muted-foreground hover:text-foreground select-none"
                    data-testid={`summary-script-${v.name}`}
                  >
                    <Code className="h-3.5 w-3.5" />
                    {label}
                    <Badge variant="secondary" className="ml-1">{count}</Badge>
                  </summary>
                  <div className="mt-2 flex items-start gap-2">
                    <code className="flex-1 p-2 bg-muted rounded text-xs font-mono break-all leading-relaxed">
                      {command}
                    </code>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => handleCopyCmd(command)}
                      data-testid={`button-copy-cmd-${v.name}`}
                    >
                      {copiedCmd === command ? (
                        <Check className="h-3.5 w-3.5 text-chart-3" />
                      ) : (
                        <Clipboard className="h-3.5 w-3.5" />
                      )}
                    </Button>
                  </div>
                  <p className="mt-1 text-muted-foreground">Run this command from your terminal.</p>
                </details>
              ))}
            </div>
          )}

          <div className="flex justify-end gap-2">
            {hasIssues && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleOpenPrompt}
                data-testid={`button-ai-prompt-${v.name}`}
              >
                <Sparkles className="h-3.5 w-3.5" />
                AI Prompt
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => runSingleMutation.mutate(v.name)}
              disabled={runSingleMutation.isPending}
              data-testid={`button-run-${v.name}`}
            >
              <Play className="h-3.5 w-3.5" />
              Run
            </Button>
          </div>
        </CardContent>
      </Card>

      <AiPromptDialog
        open={promptOpen}
        onOpenChange={setPromptOpen}
        prompt={promptText}
        validatorName={v.name}
        isPending={promptMutation.isPending}
      />
    </>
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
};

async function pollDiagnosticsJob(jobId: string, onProgress?: (p: { processed: number; total: number; status: string }) => void): Promise<JobPollResponse> {
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
      });
      const waitMs = Math.max(1, data.retry_after_seconds ?? 5) * 1000;
      await new Promise((r) => setTimeout(r, waitMs));
      continue;
    }
    return data;
  }
}

function runResultFromValidators(validatorsList: ValidatorResult[]): RunResult {
  const passed = validatorsList.filter((v) => v.status === "passed").length;
  const failed = validatorsList.filter((v) => v.status === "failed").length;
  const warnings = validatorsList.filter((v) => v.status === "warning").length;
  return {
    summary: {
      total: validatorsList.length,
      passed,
      failed,
      warnings,
      duration: validatorsList.reduce((s, v) => s + (v.duration || 0), 0),
    },
    validators: validatorsList,
  };
}

function GlobalHealthTab({ onOpenLeads }: { onOpenLeads?: () => void }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const formatSitePath = useFormatSitePath();
  const [search, setSearch] = useState("");
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>("all");
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all");
  const [results, setResults] = useState<RunResult | null>(null);
  const [lastRun, setLastRun] = useState<Date | null>(null);
  const [jobBanner, setJobBanner] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const { resolveModalOpen, setResolveModalOpen, activeConflict, openResolver } = useRedirectConflictResolver();

  const { data: cacheIssuesData, refetch: refetchCacheIssues } = useQuery<{ issues: CachedIssueRow[] }>({
    queryKey: ["/api/validation/cache-issues"],
  });
  const cacheIssues = cacheIssuesData?.issues ?? [];

  const startJobMutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
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
      setJobBanner(`Job ${data.job_id}: queued…`);
      const final = await pollDiagnosticsJob(data.job_id, (p) => {
        setJobBanner(`Job ${data.job_id}: ${p.status} (${p.processed}/${p.total})`);
      });
      if (final.status === "failed" || final.status === "not_found") {
        throw new Error(final.error || final.message || `Job ${final.status}`);
      }
      return { kind: "completed" as const, data: final };
    },
    onSuccess: (outcome) => {
      setJobBanner(null);
      void refetchCacheIssues();
      void queryClient.invalidateQueries({ queryKey: ["/api/validation/cache-summary"] });
      if (outcome.kind === "cached") {
        toast({ title: "Cache fresh", description: "No stale URLs — showing cached diagnostics." });
        setLastRun(new Date());
        return;
      }
      const list = outcome.data.validators ?? [];
      if (list.length > 0) {
        setResults(runResultFromValidators(list));
      }
      setLastRun(new Date());
      toast({ title: "Diagnostics completed", description: outcome.data.summary
        ? `${outcome.data.summary.errorCount} errors, ${outcome.data.summary.warningCount} warnings`
        : "Cache updated." });
    },
    onError: (err) => {
      setJobBanner(null);
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
        return { validators: [] as ValidatorResult[] };
      }
      if (!data.job_id) throw new Error("Missing job_id");
      setJobBanner(`Validator ${name}: running…`);
      const final = await pollDiagnosticsJob(data.job_id, (p) => {
        setJobBanner(`${name}: ${p.status} (${p.processed}/${p.total})`);
      });
      setJobBanner(null);
      if (final.status === "failed" || final.status === "not_found") {
        throw new Error(final.error || final.message || `Job ${final.status}`);
      }
      return { validators: final.validators ?? [] };
    },
    onSuccess: (data) => {
      void refetchCacheIssues();
      if (!data.validators.length) return;
      if (!results) {
        setResults(runResultFromValidators(data.validators));
        setLastRun(new Date());
        return;
      }
      const updated = { ...results };
      for (const v of data.validators) {
        const idx = updated.validators.findIndex((x) => x.name === v.name);
        if (idx >= 0) updated.validators[idx] = v;
        else updated.validators.push(v);
      }
      setResults(runResultFromValidators(updated.validators));
      setLastRun(new Date());
    },
    onError: (err) => {
      setJobBanner(null);
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
      return (await res.json()) as { ok: boolean; path: string; timestamp: string; summary: RunResult["summary"] };
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

  const filteredValidators = (() => {
    if (!results) return [];
    return results.validators.filter((v) => {
      if (search && !v.name.toLowerCase().includes(search.toLowerCase()) && !v.description.toLowerCase().includes(search.toLowerCase())) {
        return false;
      }
      if (severityFilter === "errors" && v.status !== "failed") return false;
      if (severityFilter === "warnings" && v.status !== "warning") return false;
      if (categoryFilter !== "all") {
        if (v.category !== categoryFilter) return false;
      }
      return true;
    });
  })();

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

  const jobPending = startJobMutation.isPending || runSingleMutation.isPending;

  return (
    <div className="space-y-6">
      <Card style={{ borderRadius: "0.8rem" }} data-testid="diagnostics-how-it-works">
        <CardContent className="p-4 space-y-2 text-sm text-muted-foreground">
          <p className="text-foreground font-medium">How diagnostics work</p>
          <p>
            Results live in <code className="text-xs">validation-cache.json</code> (shared with agents).
            <strong className="text-foreground font-medium"> Refresh stale</strong> only recomputes URLs
            whose <code className="text-xs">lastFullRunAt</code> is older than 24h.
            <strong className="text-foreground font-medium"> Hard refresh</strong> recomputes everything in scope.
            Single-validator runs merge by validator name and do not mark a URL fully fresh.
            One background job runs at a time per site. Lighthouse/PageSpeed is not part of this dashboard — use external tools.
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
              <li><code>server/services/diagnosticsJobService.ts</code> — job runner</li>
              <li><code>{"{contentRoot}/validation-cache.json"}</code> — issue cache (GCS <code>{"{site}/sync/validation-cache.json"}</code> in prod)</li>
              <li><code>{"{contentRoot}/.cache/diagnostics-jobs/"}</code> — recent job envelopes</li>
              <li>API: <code>POST/GET /api/validation/diagnostics-jobs</code>, <code>GET /api/validation/cache-issues</code></li>
            </ul>
          )}
        </CardContent>
      </Card>

      {jobBanner && (
        <div
          className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-foreground flex items-center gap-2"
          data-testid="diagnostics-job-banner"
        >
          <Loader2 className="h-4 w-4 animate-spin shrink-0" />
          {jobBanner}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-foreground" data-testid="text-global-health-title">
            Content Diagnostics
          </h2>
          {lastRun && (
            <p className="text-xs text-muted-foreground mt-1" data-testid="text-last-run">
              Last run: {lastRun.toLocaleTimeString()}
            </p>
          )}
        </div>
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
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {cacheIssues.length > 0 && (
        <Card style={{ borderRadius: "0.8rem" }} data-testid="cached-issues-panel">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Cached issues ({cacheIssues.length})</CardTitle>
          </CardHeader>
          <CardContent className="max-h-64 overflow-auto space-y-2">
            {cacheIssues.slice(0, 100).map((issue, idx) => (
              <div key={`${issue.url}-${issue.code}-${idx}`} className="text-xs border-b border-border/60 pb-2">
                <span className={issue.severity === "error" ? "text-destructive font-medium" : "text-chart-2 font-medium"}>
                  {issue.severity}
                </span>
                {" · "}
                <span className="text-muted-foreground">{issue.validator || "unknown"}</span>
                {" · "}
                <code>{issue.code}</code>
                <div className="text-foreground mt-0.5">{issue.message}</div>
                <div className="text-muted-foreground">{issue.url}</div>
              </div>
            ))}
            {cacheIssues.length > 100 && (
              <p className="text-xs text-muted-foreground">Showing first 100 of {cacheIssues.length}</p>
            )}
          </CardContent>
        </Card>
      )}

      {results && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3" data-testid="summary-bar">
          <Card style={{ borderRadius: "0.8rem" }}>
            <CardContent className="p-4 text-center">
              <p className="text-2xl font-bold text-foreground">{results.summary.total}</p>
              <p className="text-xs text-muted-foreground">Total</p>
            </CardContent>
          </Card>
          <Card style={{ borderRadius: "0.8rem" }}>
            <CardContent className="p-4 text-center">
              <p className="text-2xl font-bold text-chart-3">{results.summary.passed}</p>
              <p className="text-xs text-muted-foreground">Passed</p>
            </CardContent>
          </Card>
          <Card style={{ borderRadius: "0.8rem" }}>
            <CardContent className="p-4 text-center">
              <p className="text-2xl font-bold text-chart-2">{results.summary.warnings}</p>
              <p className="text-xs text-muted-foreground">Warnings</p>
            </CardContent>
          </Card>
          <Card style={{ borderRadius: "0.8rem" }}>
            <CardContent className="p-4 text-center">
              <p className="text-2xl font-bold text-destructive">{results.summary.failed}</p>
              <p className="text-xs text-muted-foreground">Failed</p>
            </CardContent>
          </Card>
        </div>
      )}

      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search validators..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10"
              data-testid="input-search-validators"
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
      </div>

      {jobPending && !results && (
        <div className="flex items-center justify-center py-16">
          <div className="text-center">
            <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-current border-r-transparent" />
            <p className="mt-4 text-muted-foreground">Running diagnostics job…</p>
          </div>
        </div>
      )}

      {!results && !jobPending && cacheIssues.length === 0 && (
        <Card style={{ borderRadius: "0.8rem" }}>
          <CardContent className="p-8 text-center">
            <Stethoscope className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <p className="text-muted-foreground mb-4">
              No cached diagnostics yet — run Refresh stale or Hard refresh.
            </p>
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
          </CardContent>
        </Card>
      )}

      {results && (
        <div className="grid grid-cols-1 gap-4">
          {filteredValidators.map((v) => (
            <ValidatorCard
              key={v.name}
              v={v}
              runSingleMutation={runSingleMutation}
              openResolver={openResolver}
              onOpenLeads={onOpenLeads}
            />
          ))}
        </div>
      )}

      {results && filteredValidators.length === 0 && (
        <div className="text-center py-12">
          <p className="text-muted-foreground" data-testid="text-no-validators">No validators match your filters</p>
        </div>
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

          <div className="flex flex-wrap items-center justify-start gap-6" data-testid="score-dashboard">
            <ScoreCircle label="Total" score={pageDiag.score.total} />
            <ScoreCircle label="SEO" score={pageDiag.score.seo} />
            <ScoreCircle label="Schema" score={pageDiag.score.schema} />
            <ScoreCircle label="Content" score={pageDiag.score.content} />
            <InfoPopover testId="info-scores">
              <p><strong className="text-foreground">Total</strong> is the simple average of the three sub-scores.</p>
              <p><strong className="text-foreground">SEO</strong> (max 80 pts): page_title present (+20), title 30–60 chars (+10), description present (+20), description 70–160 chars (+10), og_image set (+10), canonical_url set (+10).</p>
              <p><strong className="text-foreground">Schema</strong> (max 110 pts): section-driven schema emission — schema_org section or rendered JSON-LD (+30), valid parsed schemas (+20), schema has name (+15) and description (+15), no "todo" placeholders (+10), FAQPage schema present when FAQ sections exist (+10), content-type / hero Course companion requirements satisfied or N/A (+10).</p>
              <p><strong className="text-foreground">Content</strong> (max 85 pts): has sections (+25), all sections typed (+20), counterpart locale exists (+20), all images resolve (+20).</p>
            </InfoPopover>
          </div>


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
                <p>Emission is <strong className="text-foreground">section-driven</strong>: leading <code className="bg-muted px-1 rounded text-foreground">schema_org</code> sections plus FAQ, Article, and Breadcrumb contributors. Site Organization/Website templates live in <code className="bg-muted px-1 rounded text-foreground">schema-org.yml</code>; page WebSite/Organization sections are page-local.</p>
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
  );
}
