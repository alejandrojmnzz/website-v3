import { useCallback, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronDown,
  CircleCheck,
  Copy,
  ExternalLink,
  Link as LinkIcon,
  Loader2,
  Route,
  TestTube,
  X,
} from "lucide-react";
import { IconAlertTriangle, IconDownload, IconInfoCircle, IconRefresh, IconTrash } from "@tabler/icons-react";
import { AddRedirectDialog } from "@/components/editing/AddRedirectDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
import { apiFetch } from "@/lib/queryClient";
import {
  FILTER_ALL,
  SOURCE_FILTER_TAGS,
  applyRuntimeIssueView,
  deviceLabel,
  isRuntimeIssueFiltersActive,
  sortDevices,
  sourceLabel,
  uniqueSorted,
  windowedSourceTags,
  type RuntimeIssueFilters,
} from "./runtime-issues-filters";
import { downloadRuntimeIssuesCsv } from "./runtime-issues-csv";
import {
  parseRuntimeIssueSearch,
  serializeRuntimeIssueSearch,
  type RuntimeIssueViewState,
} from "./runtime-issues-url";
import type { ByHour, RuntimeIssueProbe } from "@shared/runtime-issues";
import { isRuntimeIssueProbeSuccess } from "@shared/runtime-issues";

interface RuntimeIssueRow {
  fingerprint: string;
  kind: string;
  path: string;
  locale: string;
  count: number;
  firstSeen: number;
  lastSeen: number;
  sampleReferrer?: string;
  uaBucket?: string;
  hostname?: string;
  likelyBot?: boolean;
  sources?: string[];
  byHour?: ByHour;
  count30?: number;
  lastProbe?: RuntimeIssueProbe;
}

interface RuntimeIssuesResponse {
  site: string;
  updatedAt: number;
  totalCount: number;
  issues: RuntimeIssueRow[];
}

function formatTs(ts: number) {
  return new Date(ts).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function publicPathHref(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) return "/";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

function isLocalHost(host: string): boolean {
  const hostname = host.replace(/^https?:\/\//i, "").split("/")[0].split(":")[0];
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "0.0.0.0" || hostname === "::1";
}

function fullPublicUrl(relativePath: string, hostname?: string): string {
  if (/^https?:\/\//i.test(relativePath)) return relativePath;
  const host = hostname?.trim();
  if (host && !isLocalHost(host)) {
    const origin = host.includes("://") ? host.replace(/\/$/, "") : `https://${host.replace(/\/$/, "")}`;
    return `${origin}${relativePath}`;
  }
  if (typeof window !== "undefined") return `${window.location.origin}${relativePath}`;
  return relativePath;
}

function referrerRelativePath(referrer: string): string | undefined {
  const trimmed = referrer.trim();
  try {
    if (/^https?:\/\//i.test(trimmed)) {
      const pathname = new URL(trimmed).pathname;
      return pathname || "/";
    }
  } catch {
    // fall through
  }
  if (trimmed.startsWith("/")) return trimmed;
  return undefined;
}

function referrerFullUrl(referrer: string): string {
  const trimmed = referrer.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return fullPublicUrl(publicPathHref(trimmed));
}

function useCopyToast() {
  const { toast } = useToast();
  return async (label: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: `${label} copied` });
    } catch {
      toast({ title: "Copy failed", variant: "destructive" });
    }
  };
}

function probeFailureToast(status: RuntimeIssueProbe["status"] | undefined): string {
  switch (status) {
    case "broken_redirect":
      return "Redirect found but the destination is missing or still a 404.";
    case "mismatch":
      return "Redirect index and live HTTP disagree for this URL.";
    case "loop":
      return "Redirect cycle detected.";
    default:
      return "Still a 404 — no matching redirect or live page.";
  }
}

function probeSourceLabel(probe: RuntimeIssueProbe): string {
  if (probe.status === "page") return "It now resolves as a live page.";
  if (probe.matchType === "canonical") {
    return "A canonical URL match sends visitors to the destination below (not a custom YAML redirect).";
  }
  if (probe.destination && /^https?:\/\//i.test(probe.destination)) {
    return "External destination (fetched):";
  }
  return "A redirect is implemented. Destination:";
}

function RuntimeIssueProbeControl({
  issue,
  hostname,
  probing,
  onTest,
}: {
  issue: RuntimeIssueRow;
  hostname?: string;
  probing: boolean;
  onTest: () => void;
}) {
  const probe = issue.lastProbe;
  const resolved = isRuntimeIssueProbeSuccess(probe?.status);
  const destination = probe?.destination;
  const destHref = destination ? publicPathHref(destination) : undefined;
  const destFull = destHref ? fullPublicUrl(destHref, hostname) : undefined;

  if (probing) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-6 px-1.5 text-xs shrink-0"
        disabled
        data-testid={`button-runtime-issue-testing-${issue.fingerprint}`}
      >
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Test
      </Button>
    );
  }

  if (!resolved) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-6 px-1.5 text-xs shrink-0"
        onClick={onTest}
        data-testid={`button-runtime-issue-test-${issue.fingerprint}`}
      >
        <TestTube className="h-3.5 w-3.5" />
        Test
      </Button>
    );
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 w-6 p-0 shrink-0 text-status-online"
          aria-label="Probe passed"
          data-testid={`button-runtime-issue-resolved-${issue.fingerprint}`}
        >
          <CircleCheck className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 space-y-2 text-sm" data-testid={`popover-runtime-issue-resolved-${issue.fingerprint}`}>
        <p className="font-medium text-foreground">This URL no longer 404s.</p>
        <p className="text-muted-foreground">{probeSourceLabel(probe)}</p>
        {destination ? (
          <p className="font-mono text-xs break-all">
            {destHref ? (
              <a
                href={destHref}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline"
              >
                {destination}
              </a>
            ) : (
              destination
            )}
          </p>
        ) : null}
        {probe.chained && probe.hops && probe.hops.length > 1 ? (
          <p className="text-xs text-muted-foreground">
            <Badge variant="outline" className="text-[10px] mr-1">
              Chained
            </Badge>
            {probe.hops.join(" → ")}
          </p>
        ) : null}
        {issue.lastSeen > probe.at ? (
          <p className="text-xs text-muted-foreground">
            404 hits were still recorded after this test ({formatTs(issue.lastSeen)}).
          </p>
        ) : null}
        {probe.at ? (
          <p className="text-xs text-muted-foreground">Last tested {formatTs(probe.at)}</p>
        ) : null}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7"
          onClick={onTest}
          data-testid={`button-runtime-issue-test-again-${issue.fingerprint}`}
        >
          Test again
        </Button>
        {destFull ? (
          <p className="text-[10px] text-muted-foreground break-all">{destFull}</p>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

function RuntimeIssuePathMenu({
  path,
  hostname,
  fingerprint,
  onAddRedirect,
}: {
  path: string;
  hostname?: string;
  fingerprint: string;
  onAddRedirect: (path: string, fingerprint: string) => void;
}) {
  const copy = useCopyToast();
  const relative = publicPathHref(path);
  const full = fullPublicUrl(relative, hostname);

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="truncate max-w-full text-left text-primary hover:underline"
          title={path}
          data-testid={`button-runtime-issue-path-${fingerprint}`}
        >
          {path}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuItem
          onClick={() => void copy("Full link", full)}
          data-testid={`menu-runtime-issue-copy-full-${fingerprint}`}
        >
          <Copy className="h-4 w-4" />
          Copy full link
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => void copy("Relative path", relative)}
          data-testid={`menu-runtime-issue-copy-relative-${fingerprint}`}
        >
          <LinkIcon className="h-4 w-4" />
          Copy relative path
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => onAddRedirect(path, fingerprint)}
          data-testid={`menu-runtime-issue-add-redirect-${fingerprint}`}
        >
          <Route className="h-4 w-4" />
          Add redirect
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <a
            href={relative}
            target="_blank"
            rel="noopener noreferrer"
            data-testid={`menu-runtime-issue-open-${fingerprint}`}
          >
            <ExternalLink className="h-4 w-4" />
            Open in a new tab
          </a>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function RuntimeIssueReferrerMenu({
  referrer,
  fingerprint,
}: {
  referrer?: string;
  fingerprint: string;
}) {
  const copy = useCopyToast();
  const value = referrer?.trim();
  if (!value) return <span>—</span>;

  const relative = referrerRelativePath(value);
  const full = referrerFullUrl(value);
  const showRelative = Boolean(relative && relative !== "/");

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="truncate max-w-full text-left text-primary hover:underline"
          title={value}
          data-testid={`button-runtime-issue-referrer-${fingerprint}`}
        >
          {value}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuItem
          onClick={() => void copy("Full link", full)}
          data-testid={`menu-runtime-issue-referrer-copy-full-${fingerprint}`}
        >
          <Copy className="h-4 w-4" />
          Copy full link
        </DropdownMenuItem>
        {showRelative && relative ? (
          <DropdownMenuItem
            onClick={() => void copy("Relative path", relative)}
            data-testid={`menu-runtime-issue-referrer-copy-relative-${fingerprint}`}
          >
            <LinkIcon className="h-4 w-4" />
            Copy relative path
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <a
            href={full}
            target="_blank"
            rel="noopener noreferrer"
            data-testid={`menu-runtime-issue-referrer-open-${fingerprint}`}
          >
            <ExternalLink className="h-4 w-4" />
            Open in a new tab
          </a>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SortIcon({
  col,
  sortKey,
  sortDir,
}: {
  col: RuntimeIssueViewState["sortKey"];
  sortKey: RuntimeIssueViewState["sortKey"];
  sortDir: RuntimeIssueViewState["sortDir"];
}) {
  if (col !== sortKey) return <ArrowUpDown className="inline ml-1 opacity-40" size={12} />;
  return sortDir === "asc" ? (
    <ArrowUp className="inline ml-1" size={12} />
  ) : (
    <ArrowDown className="inline ml-1" size={12} />
  );
}

export default function RuntimeIssuesTab() {
  const [pathname, setLocation] = useLocation();
  const searchString = useSearch();
  const [howItWorksOpen, setHowItWorksOpen] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [redirectFrom, setRedirectFrom] = useState<{ path: string; fingerprint: string } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [probingIds, setProbingIds] = useState<Set<string>>(new Set());
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const view = useMemo(() => parseRuntimeIssueSearch(searchString), [searchString]);
  const { hideBots, filters, sortKey, sortDir } = view;
  const {
    pathQuery,
    referrerQuery,
    locale: localeFilter,
    device: deviceFilter,
    pagesOnly,
    windowDays,
    tz,
    source: sourceFilter,
  } = filters;

  const writeView = useCallback(
    (next: RuntimeIssueViewState) => {
      const qs = serializeRuntimeIssueSearch(next, searchString);
      const pathOnly = pathname.split("?")[0];
      setLocation(qs ? `${pathOnly}?${qs}` : pathOnly, { replace: true });
    },
    [pathname, searchString, setLocation],
  );

  const patchView = useCallback(
    (patch: Partial<Pick<RuntimeIssueViewState, "hideBots" | "sortKey" | "sortDir">>) => {
      writeView({ ...view, ...patch });
    },
    [view, writeView],
  );

  const patchFilters = useCallback(
    (patch: Partial<RuntimeIssueFilters>) => {
      writeView({ ...view, filters: { ...view.filters, ...patch } });
    },
    [view, writeView],
  );

  const { data, isLoading, refetch, isFetching, isError, error } = useQuery<RuntimeIssuesResponse>({
    queryKey: ["/api/admin/runtime-issues", hideBots],
    queryFn: async () => {
      const res = await apiFetch(`/api/admin/runtime-issues?hideBots=${hideBots ? "1" : "0"}`);
      if (!res.ok) throw new Error("Failed to fetch runtime issues");
      return res.json();
    },
    refetchInterval: 30_000,
  });

  const resetMutation = useMutation({
    mutationFn: async () => {
      const res = await apiFetch("/api/admin/runtime-issues/reset", { method: "POST" });
      if (!res.ok) throw new Error("Failed to reset 404 log");
      return res.json();
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["/api/admin/runtime-issues"] });
      setResetOpen(false);
    },
  });

  function applyProbedIssue(issue: RuntimeIssueRow) {
    queryClient.setQueryData<RuntimeIssuesResponse>(["/api/admin/runtime-issues", hideBots], (prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        issues: prev.issues.map((row) => (row.fingerprint === issue.fingerprint ? { ...row, ...issue } : row)),
      };
    });
  }

  const probeMutation = useMutation({
    mutationFn: async (fingerprint: string) => {
      const res = await apiFetch("/api/admin/runtime-issues/probe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fingerprint }),
      });
      if (!res.ok) throw new Error("Failed to test URL");
      return res.json() as Promise<{ issue: RuntimeIssueRow }>;
    },
    onMutate: (fingerprint) => {
      setProbingIds((prev) => new Set(prev).add(fingerprint));
    },
    onSuccess: (data) => {
      if (data.issue) applyProbedIssue(data.issue);
      if (!isRuntimeIssueProbeSuccess(data.issue?.lastProbe?.status)) {
        toast({
          title: "Still unresolved",
          description: probeFailureToast(data.issue?.lastProbe?.status),
          variant: "destructive",
        });
      }
    },
    onError: (err) => {
      toast({
        title: "Test failed",
        description: err instanceof Error ? err.message : "Failed to test URL",
        variant: "destructive",
      });
    },
    onSettled: (_data, _err, fingerprint) => {
      setProbingIds((prev) => {
        const next = new Set(prev);
        next.delete(fingerprint);
        return next;
      });
      void queryClient.invalidateQueries({ queryKey: ["/api/admin/runtime-issues"] });
    },
  });

  const bulkProbeMutation = useMutation({
    mutationFn: async (fingerprints: string[]) => {
      const res = await apiFetch("/api/admin/runtime-issues/probe-bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fingerprints }),
      });
      if (!res.ok) throw new Error("Failed to retest selected URLs");
      return res.json() as Promise<{ updated: string[]; failed: Array<{ fingerprint: string; error: string }> }>;
    },
    onMutate: (fingerprints) => {
      setProbingIds(new Set(fingerprints));
    },
    onSuccess: (data) => {
      const failedCount = data.failed?.length ?? 0;
      toast({
        title: "Retest finished",
        description:
          failedCount > 0
            ? `${data.updated.length} updated, ${failedCount} failed.`
            : `${data.updated.length} URL${data.updated.length === 1 ? "" : "s"} retested.`,
      });
      setSelected(new Set());
    },
    onError: (err) => {
      toast({
        title: "Bulk retest failed",
        description: err instanceof Error ? err.message : "Failed to retest",
        variant: "destructive",
      });
    },
    onSettled: () => {
      setProbingIds(new Set());
      void queryClient.invalidateQueries({ queryKey: ["/api/admin/runtime-issues"] });
    },
  });

  const issues = data?.issues ?? [];
  const filtersActive = isRuntimeIssueFiltersActive(filters);

  const locales = useMemo(() => {
    const set = uniqueSorted(issues.map((i) => i.locale));
    if (localeFilter !== FILTER_ALL && !set.includes(localeFilter)) set.push(localeFilter);
    return set;
  }, [issues, localeFilter]);

  const devices = useMemo(() => {
    const set = sortDevices(issues.map((i) => i.uaBucket || "unknown"));
    if (deviceFilter !== FILTER_ALL && !set.includes(deviceFilter) && ["desktop", "mobile", "unknown"].includes(deviceFilter)) {
      set.push(deviceFilter);
    }
    return set;
  }, [issues, deviceFilter]);

  const sortedIssues = useMemo(
    () => applyRuntimeIssueView(issues, filters, sortKey, sortDir),
    [issues, filters, sortKey, sortDir],
  );

  const visibleFingerprints = useMemo(
    () => sortedIssues.map((issue) => issue.fingerprint),
    [sortedIssues],
  );
  const allVisibleSelected =
    visibleFingerprints.length > 0 && visibleFingerprints.every((fp) => selected.has(fp));
  const someVisibleSelected = visibleFingerprints.some((fp) => selected.has(fp));
  const bulkMode = selected.size > 0;

  function toggleSelected(fingerprint: string, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(fingerprint);
      else next.delete(fingerprint);
      return next;
    });
  }

  function toggleSelectAllVisible(checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) {
        for (const fp of visibleFingerprints) next.add(fp);
      } else {
        for (const fp of visibleFingerprints) next.delete(fp);
      }
      return next;
    });
  }

  const filteredHitCount = useMemo(
    () => sortedIssues.reduce((sum, issue) => sum + issue.count, 0),
    [sortedIssues],
  );

  const badgeUsesFilteredCounts =
    filtersActive || (pagesOnly && sortedIssues.length !== issues.length);

  function clearFilters() {
    patchFilters({
      pathQuery: "",
      referrerQuery: "",
      locale: FILTER_ALL,
      device: FILTER_ALL,
      source: FILTER_ALL,
      windowDays: 30,
    });
  }

  function toggleSort(col: RuntimeIssueViewState["sortKey"]) {
    if (col === sortKey) {
      patchView({ sortDir: sortDir === "asc" ? "desc" : "asc" });
    } else {
      writeView({ ...view, sortKey: col, sortDir: "desc" });
    }
  }

  function downloadCsv() {
    if (!data) return;
    const fromUrl = parseRuntimeIssueSearch(searchString);
    downloadRuntimeIssuesCsv(
      data.site,
      applyRuntimeIssueView(data.issues, fromUrl.filters, fromUrl.sortKey, fromUrl.sortDir).map((row) => ({
        ...row,
        windowDays: fromUrl.filters.windowDays,
        tz: fromUrl.filters.tz,
      })),
      { windowDays: fromUrl.filters.windowDays, tz: fromUrl.filters.tz },
    );
  }

  return (
    <div className="space-y-6" data-testid="runtime-issues-tab">
      <Card style={{ borderRadius: "0.8rem" }} data-testid="runtime-issues-how-it-works">
        <Collapsible open={howItWorksOpen} onOpenChange={setHowItWorksOpen}>
          <CardContent className="p-4 space-y-2 text-sm text-muted-foreground">
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="flex w-full items-center gap-2 text-foreground font-medium text-left"
                aria-expanded={howItWorksOpen}
                data-testid="button-runtime-issues-how-it-works"
              >
                <IconInfoCircle className="h-4 w-4 shrink-0" />
                <span className="flex-1">How runtime issues work</span>
                <ChevronDown
                  className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${howItWorksOpen ? "rotate-180" : ""}`}
                />
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-2">
              <p>
                HTTP 404s from this site’s content index (the same catalog as Redirects / Test a URL) —
                missing URLs that people, Google, LLMs, or social previews tried to open. A row is not
                “the page failed to paint”: the SPA may still render chrome or even an article if the
                client loaded by slug. File probes, SEO scrapers, and{" "}
                <code className="text-xs font-mono">curl</code> are discarded. File 404s from a 4Geeks
                referrer are kept (broken internal or old assets). Count is hits in the selected{" "}
                <strong>7 or 30 days in your timezone</strong> ({tz}) — the CSV uses the same window.
                Badges are crawler vs SERP click vs LLM vs social on the same path (one row; tag sums can
                exceed Count). Click a path or referrer to copy the URL or open it in a new tab (paths also
                offer Add redirect). Test (and bulk Retest) walks this server’s redirects then HTTP-follows
                until they stop. A green check means <code className="text-xs font-mono">status</code> is{" "}
                <code className="text-xs font-mono">page</code> or <code className="text-xs font-mono">redirect</code> —
                not a 404, and the final URL is a real page or a fetched external URL. CSV{" "}
                <code className="text-xs font-mono">status</code> empty = never tested;{" "}
                <code className="text-xs font-mono">not_found</code> = tested, still broken. This table is
                public 404s only (not server exceptions). Reset wipes the stored log including GCS.{" "}
                <code className="text-xs font-mono">/es/blog</code> is a <strong>page</strong> (slug{" "}
                <code className="text-xs font-mono">blog</code>); post URLs follow the blog type{" "}
                <code className="text-xs font-mono">url_pattern</code>.
              </p>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-0 text-xs"
                onClick={() => setShowAdvanced((v) => !v)}
                data-testid="button-runtime-issues-read-more"
              >
                {showAdvanced ? "Hide advanced" : "Read more (advanced)"}
              </Button>
              {showAdvanced && (
                <ul className="list-disc pl-5 space-y-1 text-xs">
                  <li>
                    <code>shared/runtime-issues.ts</code> — classify hits, hard-drop probes/scrapers, UTC hour
                    buckets, timezone window sums
                  </li>
                  <li>
                    <code>server/runtime-issues-store.ts</code> — in-memory rollups + local/GCS flush
                  </li>
                  <li>
                    <code>server/public-html-status.ts</code> — 200/404 from{" "}
                    <code>res.locals.site.contentIndex</code> (not the global singleton);{" "}
                    <code>server/vite.ts</code> records public HTML 404s only (skips <code>/api</code> and{" "}
                    <code>/private</code>)
                  </li>
                  <li>
                    <code>client/src/components/diagnostics/runtime-issues-url.ts</code> — parse/serialize
                    query params (window, tz, source, pages-only)
                  </li>
                  <li>
                    <code>client/src/components/diagnostics/runtime-issues-filters.ts</code> — table and CSV
                    share one view (path contains, window, source)
                  </li>
                  <li>
                    <code>server/runtime-issues-probe.ts</code> — index walk + HTTP follow; destination check
                    shared with Redirects → Test a URL (<code>queryEntries</code> for DB slugs)
                  </li>
                  <li>
                    <code>POST /api/admin/runtime-issues/probe</code> and{" "}
                    <code>POST /api/admin/runtime-issues/probe-bulk</code> — save <code>lastProbe</code> on the
                    404 row
                  </li>
                  <li>
                    <code>client/src/components/diagnostics/runtime-issues-csv.ts</code> — CSV from the same
                    filtered rows; appended <code>status</code>, <code>destination</code>, <code>chained</code>,{" "}
                    <code>http_status</code>, <code>last_test_at</code>
                  </li>
                  <li>
                    Non-effects: does not auto-create redirects (use Add redirect on a row); not Search
                    Console; Google <code>q=</code> is stripped; does not change public 404 HTML;
                    last-write-wins can undercount across instances and can drop a probe; existing GCS rows
                    are not rewritten (reset or wait 30-day TTL); does not HTTP-hit{" "}
                    <code>issue.hostname</code> / production from local; does not remove the row
                  </li>
                </ul>
              )}
            </CollapsibleContent>
          </CardContent>
        </Collapsible>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2" data-testid="toggle-hide-bots">
            <Switch id="hide-bots" checked={hideBots} onCheckedChange={(checked) => patchView({ hideBots: checked })} />
            <Label htmlFor="hide-bots" className="text-sm">
              Hide scrapers
            </Label>
          </div>
          <div className="flex items-center gap-2" data-testid="toggle-pages-only">
            <Switch id="pages-only" checked={pagesOnly} onCheckedChange={(checked) => patchFilters({ pagesOnly: checked })} />
            <Label htmlFor="pages-only" className="text-sm">
              Pages only
            </Label>
          </div>
          {data && (
            <Badge variant="secondary" data-testid="badge-runtime-total">
              {badgeUsesFilteredCounts
                ? `${sortedIssues.length} of ${issues.length} paths · ${filteredHitCount} hits`
                : `${data.issues.length} paths · ${filteredHitCount} hits`}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={downloadCsv}
            disabled={sortedIssues.length === 0}
            data-testid="button-download-runtime-issues-csv"
          >
            <IconDownload className="h-4 w-4 mr-1.5" />
            CSV
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
            data-testid="button-refresh-runtime-issues"
          >
            <IconRefresh className={`h-4 w-4 mr-1.5 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setResetOpen(true)}
            data-testid="button-reset-runtime-issues"
          >
            <IconTrash className="h-4 w-4 mr-1.5" />
            Reset 404 log
          </Button>
        </div>
      </div>

      {data && data.issues.length > 0 && bulkMode && (
        <div className="flex flex-wrap items-center gap-3" data-testid="runtime-issues-bulk-bar">
          <span className="text-sm" data-testid="runtime-issues-bulk-count">
            {selected.size} selected
          </span>
          <Button
            variant="outline"
            size="sm"
            className="h-8"
            onClick={() => setSelected(new Set())}
            data-testid="button-runtime-bulk-clear"
          >
            <X className="h-3.5 w-3.5 mr-1" />
            Clear
          </Button>
          <Button
            size="sm"
            className="h-8"
            disabled={bulkProbeMutation.isPending || selected.size === 0}
            onClick={() => bulkProbeMutation.mutate(Array.from(selected))}
            data-testid="button-runtime-bulk-retest"
          >
            {bulkProbeMutation.isPending ? (
              <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
            ) : (
              <TestTube className="h-3.5 w-3.5 mr-1.5" />
            )}
            Retest for resolution
          </Button>
        </div>
      )}

      {data && data.issues.length > 0 && !bulkMode && (
        <div className="flex flex-wrap items-end gap-3" data-testid="runtime-issues-filters">
          <div className="space-y-1">
            <Label htmlFor="runtime-path-filter" className="text-xs text-muted-foreground">
              Path
            </Label>
            <Input
              id="runtime-path-filter"
              value={pathQuery}
              onChange={(e) => patchFilters({ pathQuery: e.target.value })}
              placeholder="Contains…"
              className="h-8 w-48 text-sm"
              data-testid="input-runtime-path-filter"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="runtime-window-filter" className="text-xs text-muted-foreground">
              Window ({tz})
            </Label>
            <Select
              value={String(windowDays)}
              onValueChange={(value) => patchFilters({ windowDays: value === "7" ? 7 : 30 })}
            >
              <SelectTrigger
                id="runtime-window-filter"
                className="h-8 w-44 text-sm"
                data-testid="select-runtime-window-filter"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7">Last 7 days</SelectItem>
                <SelectItem value="30">Last 30 days</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="runtime-source-filter" className="text-xs text-muted-foreground">
              Source
            </Label>
            <Select value={sourceFilter} onValueChange={(source) => patchFilters({ source })}>
              <SelectTrigger
                id="runtime-source-filter"
                className="h-8 w-48 text-sm"
                data-testid="select-runtime-source-filter"
              >
                <SelectValue placeholder="All sources" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={FILTER_ALL}>All sources</SelectItem>
                {SOURCE_FILTER_TAGS.map((tag) => (
                  <SelectItem key={tag} value={tag} data-testid={`option-runtime-source-${tag}`}>
                    {sourceLabel(tag)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="runtime-referrer-filter" className="text-xs text-muted-foreground">
              Referrer
            </Label>
            <Input
              id="runtime-referrer-filter"
              value={referrerQuery}
              onChange={(e) => patchFilters({ referrerQuery: e.target.value })}
              placeholder="Contains…"
              className="h-8 w-48 text-sm"
              data-testid="input-runtime-referrer-filter"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="runtime-locale-filter" className="text-xs text-muted-foreground">
              Locale
            </Label>
            <Select value={localeFilter} onValueChange={(locale) => patchFilters({ locale })}>
              <SelectTrigger
                id="runtime-locale-filter"
                className="h-8 w-36 text-sm"
                data-testid="select-runtime-locale-filter"
              >
                <SelectValue placeholder="All locales" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={FILTER_ALL}>All locales</SelectItem>
                {locales.map((locale) => (
                  <SelectItem key={locale} value={locale} data-testid={`option-runtime-locale-${locale}`}>
                    {locale}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="runtime-device-filter" className="text-xs text-muted-foreground">
              Device
            </Label>
            <Select value={deviceFilter} onValueChange={(device) => patchFilters({ device })}>
              <SelectTrigger
                id="runtime-device-filter"
                className="h-8 w-40 text-sm"
                data-testid="select-runtime-device-filter"
              >
                <SelectValue placeholder="All devices" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={FILTER_ALL}>All devices</SelectItem>
                {devices.map((device) => (
                  <SelectItem key={device} value={device} data-testid={`option-runtime-device-${device}`}>
                    {deviceLabel(device)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {filtersActive && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8"
              onClick={clearFilters}
              data-testid="button-clear-runtime-filters"
            >
              <X className="h-3.5 w-3.5 mr-1" />
              Clear
            </Button>
          )}
        </div>
      )}

      {isLoading && (
        <div className="flex justify-center py-16">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-current border-r-transparent" />
        </div>
      )}

      {!isLoading && isError && (
        <Card style={{ borderRadius: "0.8rem" }}>
          <CardContent className="p-8 text-center text-destructive text-sm" data-testid="runtime-issues-error">
            <IconAlertTriangle className="h-8 w-8 mx-auto mb-3 opacity-50" />
            {error instanceof Error ? error.message : "Failed to load runtime issues"}
          </CardContent>
        </Card>
      )}

      {!isLoading && !isError && (!data || data.issues.length === 0) && (
        <Card style={{ borderRadius: "0.8rem" }}>
          <CardContent className="p-8 text-center text-muted-foreground text-sm">
            <IconAlertTriangle className="h-8 w-8 mx-auto mb-3 opacity-50" />
            No runtime issues recorded for this site yet.
          </CardContent>
        </Card>
      )}

      {!isError && data && data.issues.length > 0 && (
        <Card style={{ borderRadius: "0.8rem" }}>
          <CardContent className="p-0 overflow-x-auto">
            {sortedIssues.length === 0 ? (
              <div
                className="p-8 text-center text-muted-foreground text-sm"
                data-testid="runtime-issues-empty-filters"
              >
                No runtime issues match the current filters.
              </div>
            ) : (
              <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10 pr-0">
                    <Checkbox
                      checked={allVisibleSelected ? true : someVisibleSelected ? "indeterminate" : false}
                      onCheckedChange={(checked) => toggleSelectAllVisible(checked === true)}
                      aria-label="Select all visible issues"
                      data-testid="checkbox-runtime-select-all"
                    />
                  </TableHead>
                  <TableHead>Path</TableHead>
                  <TableHead>Locale</TableHead>
                  <TableHead className="text-right">
                    <button
                      type="button"
                      className="inline-flex items-center justify-end w-full hover:text-foreground"
                      onClick={() => toggleSort("count")}
                      data-testid="sort-runtime-count"
                    >
                      Count
                      <SortIcon col="count" sortKey={sortKey} sortDir={sortDir} />
                    </button>
                  </TableHead>
                  <TableHead>
                    <button
                      type="button"
                      className="inline-flex items-center hover:text-foreground"
                      onClick={() => toggleSort("lastSeen")}
                      data-testid="sort-runtime-last-seen"
                    >
                      Last seen
                      <SortIcon col="lastSeen" sortKey={sortKey} sortDir={sortDir} />
                    </button>
                  </TableHead>
                  <TableHead>Referrer</TableHead>
                  <TableHead>UA</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedIssues.map((issue) => (
                  <TableRow key={issue.fingerprint} data-testid={`runtime-issue-${issue.fingerprint}`}>
                    <TableCell className="w-10 pr-0">
                      <Checkbox
                        checked={selected.has(issue.fingerprint)}
                        onCheckedChange={(checked) => toggleSelected(issue.fingerprint, checked === true)}
                        aria-label={`Select ${issue.path}`}
                        data-testid={`checkbox-runtime-issue-${issue.fingerprint}`}
                      />
                    </TableCell>
                    <TableCell className="font-mono text-xs max-w-[320px]">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <div className="min-w-0">
                          <RuntimeIssuePathMenu
                            path={issue.path}
                            hostname={issue.hostname}
                            fingerprint={issue.fingerprint}
                            onAddRedirect={(path, fingerprint) => setRedirectFrom({ path, fingerprint })}
                          />
                        </div>
                        <RuntimeIssueProbeControl
                          issue={issue}
                          hostname={issue.hostname}
                          probing={probingIds.has(issue.fingerprint)}
                          onTest={() => probeMutation.mutate(issue.fingerprint)}
                        />
                      </div>
                      <span className="flex flex-wrap gap-1 mt-1">
                        {windowedSourceTags(issue, filters).map((tag) => (
                          <Badge key={tag} variant="outline" className="text-[10px]">
                            {sourceLabel(tag)}
                          </Badge>
                        ))}
                      </span>
                    </TableCell>
                    <TableCell className="text-xs">{issue.locale}</TableCell>
                    <TableCell className="text-right font-medium">{issue.count}</TableCell>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                      {formatTs(issue.lastSeen)}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground max-w-[180px]">
                      <div className="min-w-0">
                        <RuntimeIssueReferrerMenu
                          referrer={issue.sampleReferrer}
                          fingerprint={issue.fingerprint}
                        />
                      </div>
                    </TableCell>
                    <TableCell className="text-xs">{issue.uaBucket || "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            )}
          </CardContent>
        </Card>
      )}

      <AddRedirectDialog
        key={redirectFrom?.fingerprint ?? "closed"}
        open={!!redirectFrom}
        onOpenChange={(open) => {
          if (!open) setRedirectFrom(null);
        }}
        initialFrom={redirectFrom?.path ?? ""}
        onSuccess={() => {
          if (redirectFrom) probeMutation.mutate(redirectFrom.fingerprint);
        }}
      />

      <AlertDialog open={resetOpen} onOpenChange={setResetOpen}>
        <AlertDialogContent data-testid="dialog-reset-runtime-issues">
          <AlertDialogHeader>
            <AlertDialogTitle>Reset 404 log?</AlertDialogTitle>
            <AlertDialogDescription>
              Deletes all stored 404s for this site, including GCS. Not undoable.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-reset-runtime-issues">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                resetMutation.mutate();
              }}
              data-testid="button-confirm-reset-runtime-issues"
            >
              {resetMutation.isPending ? "Resetting…" : "Reset"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
