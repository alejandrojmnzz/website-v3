import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, ChevronDown, Filter, Github, Loader2, RefreshCw, Search, Server, Trash2, User, Webhook, X } from "lucide-react";
import {
  IconCloudUpload,
  IconCloudDownload,
  IconCheck,
  IconAlertTriangle,
  IconFilePlus,
  IconPencil,
  IconMinus,
  IconGitCommit,
} from "@tabler/icons-react";
import { useState, useEffect, useRef } from "react";
import { Link } from "wouter";
import { SitemapSearch } from "@/components/menus/SitemapSearch";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { apiRequest } from "@/lib/queryClient";

const CATEGORIES = [
  "RESTART",
  "RECONCILE",
  "WEBHOOK",
  "AUTO-PULL",
  "COMMIT",
  "CONFLICT",
  "ERROR",
  "EDIT",
] as const;

type Category = (typeof CATEGORIES)[number];

interface SyncInfo {
  instanceId: string;
  replitCheckpoint: string;
  githubCommit: string | null;
  repoUrl: string | null;
  env: string;
  pid: number;
  webhook: {
    active: boolean;
    id?: number;
    url?: string;
    createdAt?: string;
  };
  recentLog: string[];
}

interface SyncLogEntry {
  ts: string;
  category: string;
  message: string;
  person?: string;
  meta?: Record<string, unknown>;
}

interface ParsedEntry {
  ts: string;
  timeOnly: string;
  dateOnly: string;
  category: string;
  message: string;
  person?: string;
  meta?: Record<string, unknown>;
}

function toParseEntry(entry: SyncLogEntry): ParsedEntry {
  const date = new Date(entry.ts);
  const isValidDate = !isNaN(date.getTime());
  const timeOnly = isValidDate
    ? date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
    : entry.ts;
  const dateOnly = isValidDate
    ? date.toLocaleDateString(undefined, { year: 'numeric', month: '2-digit', day: '2-digit' })
    : "";
  return { ts: entry.ts, timeOnly, dateOnly, category: entry.category, message: entry.message, person: entry.person, meta: entry.meta };
}

function renderMessageWithLinks(message: string, repoUrl: string | null | undefined) {
  if (!repoUrl) return message;
  const cleanRepoUrl = repoUrl.replace(/\.git$/, '');
  const parts = message.split(/\b([0-9a-f]{7})\b/);
  if (parts.length === 1) return message;
  return parts.map((part, i) => {
    if (i % 2 === 1 && /^[0-9a-f]{7}$/.test(part)) {
      return (
        <a
          key={i}
          href={`${cleanRepoUrl}/commit/${part}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary hover:underline font-semibold"
          data-testid={`link-commit-sha-${part}`}
        >
          {part}
        </a>
      );
    }
    return part;
  });
}

function getCategoryColor(cat: string): string {
  switch (cat) {
    case "RESTART":
      return "text-blue-600 dark:text-blue-400";
    case "RECONCILE":
      return "text-purple-600 dark:text-purple-400";
    case "WEBHOOK":
      return "text-cyan-600 dark:text-cyan-400";
    case "AUTO-PULL":
      return "text-green-600 dark:text-green-400";
    case "COMMIT":
      return "text-emerald-600 dark:text-emerald-400";
    case "CONFLICT":
      return "text-amber-600 dark:text-amber-400";
    case "ERROR":
      return "text-red-600 dark:text-red-400";
    case "EDIT":
      return "text-indigo-600 dark:text-indigo-400";
    default:
      return "text-muted-foreground";
  }
}

function getCategoryBadgeVariant(cat: string): "default" | "secondary" | "destructive" | "outline" {
  switch (cat) {
    case "ERROR":
    case "CONFLICT":
      return "destructive";
    default:
      return "secondary";
  }
}

interface SitemapEntry {
  loc: string;
  label: string;
}

function extractPath(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.pathname;
  } catch {
    return url;
  }
}

export default function SyncLogPage() {
  const initialSearch = useRef(
    new URLSearchParams(window.location.search).get("search") || ""
  );
  const [search, setSearch] = useState(initialSearch.current);
  const [sitemapPage, setSitemapPage] = useState("");
  const [activeCategories, setActiveCategories] = useState<Set<Category>>(
    new Set([])
  );
  const [activePersons, setActivePersons] = useState<Set<string>>(new Set([]));
  const qc = useQueryClient();

  const { data: sitemapUrls = [] } = useQuery<SitemapEntry[]>({
    queryKey: ["/api/sitemap-urls"],
    queryFn: async () => {
      const res = await fetch("/api/sitemap-urls");
      if (!res.ok) throw new Error("Failed to load sitemap URLs");
      return res.json();
    },
  });

  const initialFillDone = useRef(false);

  useEffect(() => {
    if (initialFillDone.current || !initialSearch.current || sitemapUrls.length === 0) return;
    initialFillDone.current = true;

    const slug = initialSearch.current;
    const LOCALE_PREFIXES = new Set(["en", "es", "us"]);

    const match = sitemapUrls.find((entry) => {
      const pathname = extractPath(entry.loc);
      const parts = pathname.split("/").filter(Boolean);
      const contentParts =
        parts.length > 0 && LOCALE_PREFIXES.has(parts[0]) ? parts.slice(1) : parts;
      return contentParts[contentParts.length - 1] === slug;
    });

    if (match) {
      setSitemapPage(extractPath(match.loc));
    }
  }, [sitemapUrls]);

  const clearMutation = useMutation({
    mutationFn: (mode: "all" | "2days") => apiRequest("DELETE", `/api/github/sync-log?mode=${mode}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/github/sync-log"] });
      qc.invalidateQueries({ queryKey: ["/api/github/sync-info"] });
    },
  });

  const [webhookRetryOpen, setWebhookRetryOpen] = useState(false);
  const [webhookRetryResult, setWebhookRetryResult] = useState<{ success: boolean; message: string } | null>(null);
  const [cleanupResult, setCleanupResult] = useState<{ deleted: number; ids: number[] } | null>(null);

  const webhookSetupMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/github/webhook/setup").then(r => r.json()),
    onSuccess: (data) => {
      setWebhookRetryResult(data);
      qc.invalidateQueries({ queryKey: ["/api/github/sync-info"] });
    },
    onError: (err: any) => {
      setWebhookRetryResult({ success: false, message: err.message || "Request failed" });
    },
  });

  const cleanupMutation = useMutation({
    mutationFn: () => apiRequest("DELETE", "/api/github/webhook/duplicates").then(r => r.json()),
    onSuccess: (data) => {
      setCleanupResult({ deleted: data.deleted, ids: data.ids });
    },
    onError: (err: any) => {
      setCleanupResult({ deleted: -1, ids: [] });
    },
  });

  const [forcePushOpen, setForcePushOpen] = useState(false);
  const [forcePullOpen, setForcePullOpen] = useState(false);
  const [pushStarted, setPushStarted] = useState(false);
  const [pullStarted, setPullStarted] = useState(false);

  const startPushMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/github/content/push-all").then(r => r.json()),
    onSuccess: () => {
      setPushStarted(true);
      qc.invalidateQueries({ queryKey: ["/api/github/push-all-status"] });
    },
  });

  const startPullMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/github/content/pull-all").then(r => r.json()),
    onSuccess: () => {
      setPullStarted(true);
      qc.invalidateQueries({ queryKey: ["/api/github/pull-all-status"] });
    },
  });

  const { data: pullStatus } = useQuery<{
    running: boolean;
    total: number;
    pulled: number;
    errors: string[];
    startedAt: number | null;
    doneAt: number | null;
    success: boolean | null;
    commitSha: string | null;
  } | null>({
    queryKey: ["/api/github/pull-all-status"],
    enabled: forcePullOpen || pullStarted,
    queryFn: async () => {
      const res = await fetch("/api/github/pull-all-status");
      if (res.status === 404) return null;
      if (!res.ok) throw new Error("Status check failed");
      return res.json();
    },
    refetchInterval: (query) => {
      const d = query.state.data;
      if (!d) return 800;
      if (d.running) return 800;
      return false;
    },
    staleTime: 0,
  });

  const { data: pushStatus } = useQuery<{
    runId: string;
    running: boolean;
    phase: "diffing" | "uploading" | "committing" | "done";
    total: number;
    processed: number;
    created: number;
    updated: number;
    skipped: number;
    failed: number;
    errors: string[];
    commitSha?: string;
    repoUrl?: string;
    startedAt: number;
    completedAt?: number;
  } | null>({
    queryKey: ["/api/github/push-all-status"],
    enabled: forcePushOpen || pushStarted,
    queryFn: async () => {
      const res = await fetch("/api/github/push-all-status");
      if (res.status === 404) return null;
      if (!res.ok) throw new Error("Status check failed");
      return res.json();
    },
    refetchInterval: (query) => {
      const d = query.state.data;
      if (!d) return 800;
      if (d.running) return 800;
      return false;
    },
    staleTime: 0,
  });

  const {
    data: logData,
    isLoading: logLoading,
    refetch: refetchLog,
  } = useQuery<{ entries: SyncLogEntry[] }>({
    queryKey: ["/api/github/sync-log"],
    queryFn: async () => {
      const res = await fetch("/api/github/sync-log");
      return res.json();
    },
    refetchInterval: 15000,
  });

  const { data: syncInfo } = useQuery<SyncInfo>({
    queryKey: ["/api/github/sync-info"],
    refetchInterval: 30000,
  });

  const entries = (() => {
    if (!logData?.entries) return [];
    return logData.entries.map(toParseEntry);
  })();

  const uniquePersons = (() => {
    const persons = new Set<string>();
    for (const e of entries) {
      if (e.person) persons.add(e.person);
    }
    return Array.from(persons).sort();
  })();

  const filtered = entries.filter((e) => {
    if (activeCategories.size > 0 && !activeCategories.has(e.category as Category)) return false;
    if (activePersons.size > 0 && e.person && !activePersons.has(e.person)) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        e.message.toLowerCase().includes(q) ||
        e.category.toLowerCase().includes(q) ||
        (e.person || "").toLowerCase().includes(q) ||
        e.ts.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const categoryCounts = (() => {
    const counts: Record<string, number> = {};
    for (const e of entries) {
      counts[e.category] = (counts[e.category] || 0) + 1;
    }
    return counts;
  })();

  const toggleCategory = (cat: Category) => {
    setActiveCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) {
        next.delete(cat);
      } else {
        next.add(cat);
      }
      return next;
    });
  };

  const selectOnly = (cat: Category) => {
    setActiveCategories(new Set([cat]));
  };

  const selectAll = () => {
    setActiveCategories(new Set(CATEGORIES));
  };

  return (
    <>
    <div className="min-h-screen bg-background">
      <div className="max-w-6xl mx-auto px-4 py-6 space-y-4">
        <div className="space-y-1">
          <div className="flex items-center gap-3 flex-wrap">
            <Link href="/private/diagnostics">
              <Button variant="ghost" size="icon" data-testid="button-back-from-sync-log">
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </Link>
            <div className="flex items-center gap-2">
              <Github className="h-5 w-5" />
              <h1 className="text-xl font-semibold" data-testid="text-sync-log-title">
                GitHub Sync Log
              </h1>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => refetchLog()}
                disabled={logLoading}
                data-testid="button-refresh-sync-log"
              >
                <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${logLoading ? "animate-spin" : ""}`} />
                Refresh
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" data-testid="button-sync-github">
                    <IconCloudUpload className="h-3.5 w-3.5 mr-1.5" />
                    Push / Pull
                    <ChevronDown className="h-3 w-3 ml-1" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => { setPushResult(null); setForcePushOpen(true); }} data-testid="button-force-push">
                    <IconCloudUpload className="h-4 w-4 mr-2" />
                    Force Push
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setForcePullOpen(true)} data-testid="button-force-pull">
                    <IconCloudDownload className="h-4 w-4 mr-2" />
                    Force Pull
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" disabled={clearMutation.isPending} data-testid="button-clear-sync-log">
                    <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                    Clear
                    <ChevronDown className="h-3 w-3 ml-1" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => clearMutation.mutate("2days")} data-testid="button-clear-2days">
                    Clear older than 2 days
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => clearMutation.mutate("all")} className="text-destructive" data-testid="button-clear-all">
                    Clear all
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
          {syncInfo && (
            <div className="flex items-center gap-3 text-sm text-muted-foreground pl-1">
              <span className="flex items-center gap-1.5">
                <Server className="h-3.5 w-3.5" />
                <code className="text-xs bg-muted px-1.5 py-0.5 rounded" data-testid="text-instance-id">
                  {syncInfo.instanceId} · checkpoint {syncInfo.replitCheckpoint}
                  {syncInfo.githubCommit && (
                    <>
                      {" · "}
                      {syncInfo.repoUrl ? (
                        <a
                          href={`${syncInfo.repoUrl}/commit/${syncInfo.githubCommit}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="underline hover:text-foreground"
                          data-testid="link-github-commit"
                        >
                          gh:{syncInfo.githubCommit}
                        </a>
                      ) : (
                        <>gh:{syncInfo.githubCommit}</>
                      )}
                    </>
                  )}
                </code>
              </span>
              <span className="flex items-center gap-1.5">
                <Webhook className="h-3.5 w-3.5" />
                {syncInfo.webhook.active ? (
                  <button
                    className="flex items-center gap-1 text-green-600 dark:text-green-400 hover:underline"
                    onClick={() => { setWebhookRetryResult(null); setWebhookRetryOpen(true); }}
                    data-testid="button-webhook-active"
                  >
                    <Check className="h-3 w-3" />
                    Active
                  </button>
                ) : (
                  <button
                    className="flex items-center gap-1 text-amber-600 dark:text-amber-400 hover:underline"
                    onClick={() => { setWebhookRetryResult(null); setWebhookRetryOpen(true); }}
                    data-testid="button-webhook-inactive"
                  >
                    <X className="h-3 w-3" />
                    Inactive
                  </button>
                )}
              </span>
            </div>
          )}
        </div>

        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <Filter className="h-3.5 w-3.5" />
                <span>Filter:</span>
              </div>
              {CATEGORIES.map((cat) => (
                <Badge
                  key={cat}
                  variant={activeCategories.has(cat) ? getCategoryBadgeVariant(cat) : "outline"}
                  className={`cursor-pointer select-none ${!activeCategories.has(cat) ? "opacity-50" : ""}`}
                  onClick={() => toggleCategory(cat)}
                  onDoubleClick={() => selectOnly(cat)}
                  data-testid={`badge-filter-${cat.toLowerCase()}`}
                >
                  {cat}
                  {categoryCounts[cat] ? (
                    <span className="ml-1 opacity-70">({categoryCounts[cat]})</span>
                  ) : null}
                </Badge>
              ))}
              {activeCategories.size > 0 && (
                <button
                  onClick={() => setActiveCategories(new Set([]))}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors underline"
                  data-testid="button-clear-filters"
                >
                  Clear filters
                </button>
              )}
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <User className="h-3.5 w-3.5" />
                <span>Person:</span>
              </div>
              {uniquePersons.length === 0 ? (
                <span className="text-xs text-muted-foreground italic">No authors recorded yet</span>
              ) : (
                <>
                  {uniquePersons.map((person) => {
                    const slug = person.toLowerCase().replace(/\s+/g, "-");
                    const isActive = activePersons.has(person);
                    return (
                      <Badge
                        key={person}
                        variant={isActive ? "secondary" : "outline"}
                        className={`cursor-pointer select-none ${!isActive ? "opacity-50" : ""}`}
                        onClick={() => {
                          setActivePersons((prev) => {
                            const next = new Set(prev);
                            if (next.has(person)) next.delete(person);
                            else next.add(person);
                            return next;
                          });
                        }}
                        onDoubleClick={() => setActivePersons(new Set([person]))}
                        data-testid={`badge-person-${slug}`}
                      >
                        {person}
                      </Badge>
                    );
                  })}
                  {activePersons.size > 0 && (
                    <button
                      onClick={() => setActivePersons(new Set([]))}
                      className="text-xs text-muted-foreground hover:text-foreground transition-colors underline"
                      data-testid="button-clear-person-filters"
                    >
                      Clear
                    </button>
                  )}
                </>
              )}
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <Search className="h-3.5 w-3.5" />
                <span>Page:</span>
              </div>
              <SitemapSearch
                value={sitemapPage}
                onChange={(url) => {
                  setSitemapPage(url);
                  if (url) {
                    const LOCALE_PREFIXES = new Set(["en", "es", "us"]);
                    const parts = url.split("/").filter(Boolean);
                    const contentParts = parts.length > 0 && LOCALE_PREFIXES.has(parts[0]) ? parts.slice(1) : parts;
                    setSearch(contentParts[contentParts.length - 1] || "");
                  } else {
                    setSearch("");
                  }
                }}
                placeholder="Pick a page..."
                testId="sitemap-search-sync-log"
              />
              {sitemapPage && (
                <button
                  onClick={() => { setSitemapPage(""); setSearch(""); }}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors underline"
                  data-testid="button-clear-page-filter"
                >
                  Clear
                </button>
              )}
            </div>

            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by page slug, message, date..."
                value={search}
                onChange={(e) => { setSearch(e.target.value); setSitemapPage(""); }}
                className="pl-9"
                data-testid="input-search-sync-log"
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-0">
            <div className="flex items-center justify-between px-4 py-2 border-b">
              <span className="text-sm text-muted-foreground" data-testid="text-entry-count">
                {filtered.length} of {entries.length} entries
              </span>
              <span className="text-xs text-muted-foreground">
                Auto-refreshes every 15s
              </span>
            </div>

            {logLoading && entries.length === 0 ? (
              <div className="flex items-center justify-center py-12">
                <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground" data-testid="text-no-entries">
                <span className="text-sm">
                  {entries.length === 0
                    ? "No sync log entries yet"
                    : "No entries match current filters"}
                </span>
              </div>
            ) : (
              <ScrollArea className="h-[calc(100vh-320px)]">
                <div className="font-mono text-xs">
                  {filtered
                    .slice()
                    .reverse()
                    .map((entry, i) => (
                      <div
                        key={i}
                        className={`flex gap-3 px-4 py-1.5 border-b border-border/50 ${
                          entry.category === "ERROR"
                            ? "bg-red-50/50 dark:bg-red-950/20"
                            : entry.category === "CONFLICT"
                              ? "bg-amber-50/50 dark:bg-amber-950/20"
                              : entry.category === "EDIT"
                                ? "bg-indigo-50/30 dark:bg-indigo-950/10"
                                : ""
                        }`}
                        data-testid={`log-entry-${i}`}
                      >
                        <span className="text-muted-foreground shrink-0 tabular-nums w-[68px]">
                          {entry.timeOnly}
                        </span>
                        <span className="text-muted-foreground shrink-0 tabular-nums w-[80px]">
                          {entry.dateOnly}
                        </span>
                        <span
                          className={`shrink-0 w-[90px] font-semibold ${getCategoryColor(entry.category)}`}
                        >
                          [{entry.category}]
                        </span>
                        {entry.person && (
                          <span className="text-muted-foreground shrink-0 flex items-center gap-1">
                            <User className="h-3 w-3" />
                            {entry.person}
                          </span>
                        )}
                        <span className="text-foreground break-all">
                          {renderMessageWithLinks(entry.message, syncInfo?.repoUrl)}
                        </span>
                      </div>
                    ))}
                </div>
              </ScrollArea>
            )}
          </CardContent>
        </Card>
      </div>
    </div>

    {/* Force Push Modal */}
    <Dialog open={forcePushOpen} onOpenChange={(open) => { if (!open) setForcePushOpen(false); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {pushStatus?.phase === "done" ? (
              pushStatus.errors.length > 0
                ? <IconAlertTriangle className="h-5 w-5 text-destructive" />
                : <IconCheck className="h-5 w-5 text-primary" />
            ) : pushStatus?.running ? (
              <IconCloudUpload className="h-5 w-5 animate-pulse" />
            ) : (
              <IconCloudUpload className="h-5 w-5" />
            )}
            {pushStatus?.phase === "done"
              ? pushStatus.errors.length > 0 ? "Push completed with errors" : "Push complete"
              : pushStatus?.running ? "Pushing to GitHub…"
              : "Force Push to GitHub"}
          </DialogTitle>

          {/* Pre-start description — only shown before a push is running */}
          {!pushStatus?.running && pushStatus?.phase !== "done" && (
            <DialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>This will sync all local content files to the GitHub repository.</p>
                <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                  <li><span className="font-medium text-foreground">Local always wins</span> — if a file differs, the local version overwrites GitHub.</li>
                  <li><span className="font-medium text-foreground">Skips unchanged files</span> — only files with a different SHA are uploaded.</li>
                  <li><span className="font-medium text-foreground">Single commit</span> — all changes land in one commit using the Git Trees API.</li>
                  <li>Files deleted locally are <span className="font-medium text-foreground">not</span> removed from GitHub.</li>
                </ul>
              </div>
            </DialogDescription>
          )}
        </DialogHeader>

        {/* Live progress — shown while running */}
        {pushStatus?.running && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {pushStatus.phase === "diffing" && "Comparing local files with GitHub…"}
              {pushStatus.phase === "uploading" && (
                pushStatus.total > 0
                  ? `Uploading files… ${pushStatus.processed} of ${pushStatus.total}`
                  : "Uploading files…"
              )}
              {pushStatus.phase === "committing" && "Creating commit…"}
            </p>
            <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full bg-primary transition-all duration-300"
                style={{
                  width: pushStatus.total > 0
                    ? `${Math.round((pushStatus.processed / pushStatus.total) * 100)}%`
                    : pushStatus.phase === "diffing" ? "10%" : "95%",
                }}
              />
            </div>
            {pushStatus.total > 0 && (
              <p className="text-xs text-muted-foreground text-right">
                {pushStatus.processed} / {pushStatus.total} files
              </p>
            )}
          </div>
        )}

        {/* Completion stat grid */}
        {pushStatus?.phase === "done" && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="flex items-center gap-2 p-2.5 rounded-md bg-muted/50">
                <IconFilePlus size={16} className="text-primary shrink-0" />
                <div>
                  <p className="font-medium">{pushStatus.created}</p>
                  <p className="text-xs text-muted-foreground">Created</p>
                </div>
              </div>
              <div className="flex items-center gap-2 p-2.5 rounded-md bg-muted/50">
                <IconPencil size={16} className="text-primary shrink-0" />
                <div>
                  <p className="font-medium">{pushStatus.updated}</p>
                  <p className="text-xs text-muted-foreground">Updated</p>
                </div>
              </div>
              <div className="flex items-center gap-2 p-2.5 rounded-md bg-muted/50">
                <IconMinus size={16} className="text-muted-foreground shrink-0" />
                <div>
                  <p className="font-medium">{pushStatus.skipped}</p>
                  <p className="text-xs text-muted-foreground">Unchanged</p>
                </div>
              </div>
              <div className="flex items-center gap-2 p-2.5 rounded-md bg-muted/50">
                <IconAlertTriangle size={16} className={pushStatus.failed > 0 ? "text-destructive shrink-0" : "text-muted-foreground shrink-0"} />
                <div>
                  <p className={`font-medium ${pushStatus.failed > 0 ? "text-destructive" : ""}`}>{pushStatus.failed}</p>
                  <p className="text-xs text-muted-foreground">Errors</p>
                </div>
              </div>
            </div>

            {pushStatus.commitSha && (() => {
              const repoUrl = (pushStatus.repoUrl || syncInfo?.repoUrl || "").replace(/\.git$/, "");
              return (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <IconGitCommit size={14} className="shrink-0" />
                  {repoUrl ? (
                    <a
                      href={`${repoUrl}/commit/${pushStatus.commitSha}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono hover:underline text-foreground"
                      data-testid="link-push-commit-sha"
                    >
                      {pushStatus.commitSha.slice(0, 7)}
                    </a>
                  ) : (
                    <span className="font-mono">{pushStatus.commitSha.slice(0, 7)}</span>
                  )}
                </div>
              );
            })()}

            {pushStatus.errors.length > 0 && (
              <div className="rounded-md bg-destructive/10 border border-destructive/20 p-2.5 space-y-1 max-h-28 overflow-y-auto">
                {pushStatus.errors.slice(0, 5).map((e, i) => (
                  <p key={i} className="text-xs font-mono text-destructive break-all">{e}</p>
                ))}
                {pushStatus.errors.length > 5 && (
                  <p className="text-xs text-muted-foreground">…and {pushStatus.errors.length - 5} more</p>
                )}
              </div>
            )}
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="outline"
            onClick={() => setForcePushOpen(false)}
            disabled={pushStatus?.running}
            data-testid="button-cancel-force-push"
          >
            {pushStatus?.phase === "done" ? "Close" : pushStatus?.running ? "Running…" : "Cancel"}
          </Button>
          {(!pushStatus || pushStatus.phase === "done") && !pushStatus?.running && (
            <Button
              onClick={() => startPushMutation.mutate()}
              disabled={startPushMutation.isPending || pushStatus?.running}
              data-testid="button-start-force-push"
            >
              {startPushMutation.isPending
                ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Starting…</>
                : <><IconCloudUpload className="h-4 w-4 mr-2" />{pushStatus?.phase === "done" ? "Push Again" : "Start Push"}</>
              }
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>

    {/* Force Pull Modal */}
    <Dialog open={forcePullOpen} onOpenChange={(open) => { if (!open && !pullStatus?.running) { setForcePullOpen(false); } }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {pullStatus?.doneAt != null ? (
              (pullStatus.errors?.length ?? 0) > 0
                ? <IconAlertTriangle className="h-5 w-5 text-destructive" />
                : <IconCheck className="h-5 w-5 text-primary" />
            ) : pullStatus?.running ? (
              <IconCloudDownload className="h-5 w-5 animate-pulse" />
            ) : (
              <IconCloudDownload className="h-5 w-5" />
            )}
            {pullStatus?.doneAt != null
              ? (pullStatus.errors?.length ?? 0) > 0 ? "Pull completed with errors" : "Pull complete"
              : pullStatus?.running ? "Pulling from GitHub…"
              : "Force Pull from GitHub"}
          </DialogTitle>

          {/* Pre-start description — only shown before a pull is running */}
          {!pullStatus?.running && pullStatus?.doneAt == null && (
            <DialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>This will overwrite local content files with whatever is currently on GitHub.</p>
                <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                  <li><span className="font-medium text-foreground">GitHub always wins</span> — local edits not yet committed to GitHub will be lost.</li>
                  <li><span className="font-medium text-foreground">Downloads all files</span> — every file in the content folder is re-fetched from the remote.</li>
                  <li>Use this to recover from a corrupted local state or after manual GitHub edits.</li>
                </ul>
              </div>
            </DialogDescription>
          )}
        </DialogHeader>

        {/* Live progress — shown while running */}
        {pullStatus?.running && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {pullStatus.total > 0
                ? `Downloading files… ${pullStatus.pulled} of ${pullStatus.total}`
                : "Fetching file list from GitHub…"}
            </p>
            <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full bg-primary transition-all duration-300"
                style={{
                  width: pullStatus.total > 0
                    ? `${Math.round((pullStatus.pulled / pullStatus.total) * 100)}%`
                    : "10%",
                }}
              />
            </div>
            {pullStatus.total > 0 && (
              <p className="text-xs text-muted-foreground text-right">
                {pullStatus.pulled} / {pullStatus.total} files
              </p>
            )}
          </div>
        )}

        {/* Completion stat grid */}
        {pullStatus?.doneAt != null && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="flex items-center gap-2 p-2.5 rounded-md bg-muted/50">
                <IconCloudDownload size={16} className="text-primary shrink-0" />
                <div>
                  <p className="font-medium">{pullStatus.pulled}</p>
                  <p className="text-xs text-muted-foreground">Downloaded</p>
                </div>
              </div>
              <div className="flex items-center gap-2 p-2.5 rounded-md bg-muted/50">
                <IconMinus size={16} className="text-muted-foreground shrink-0" />
                <div>
                  <p className="font-medium">{(pullStatus.total ?? 0) - (pullStatus.pulled ?? 0) - (pullStatus.errors?.length ?? 0)}</p>
                  <p className="text-xs text-muted-foreground">Skipped</p>
                </div>
              </div>
              <div className="flex items-center gap-2 p-2.5 rounded-md bg-muted/50 col-span-2">
                <IconAlertTriangle size={16} className={(pullStatus.errors?.length ?? 0) > 0 ? "text-destructive shrink-0" : "text-muted-foreground shrink-0"} />
                <div>
                  <p className={`font-medium ${(pullStatus.errors?.length ?? 0) > 0 ? "text-destructive" : ""}`}>{pullStatus.errors?.length ?? 0}</p>
                  <p className="text-xs text-muted-foreground">Errors</p>
                </div>
              </div>
            </div>

            {(pullStatus.errors?.length ?? 0) > 0 && (
              <div className="rounded-md bg-destructive/10 border border-destructive/20 p-2.5 space-y-1 max-h-28 overflow-y-auto">
                {(pullStatus.errors ?? []).slice(0, 5).map((e, i) => (
                  <p key={i} className="text-xs font-mono text-destructive break-all">{e}</p>
                ))}
                {(pullStatus.errors?.length ?? 0) > 5 && (
                  <p className="text-xs text-muted-foreground">…and {(pullStatus.errors?.length ?? 0) - 5} more</p>
                )}
              </div>
            )}
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="outline"
            onClick={() => setForcePullOpen(false)}
            disabled={pullStatus?.running}
            data-testid="button-close-force-pull"
          >
            {pullStatus?.doneAt != null ? "Close" : pullStatus?.running ? "Running…" : "Cancel"}
          </Button>
          {(!pullStatus || pullStatus.doneAt != null) && !pullStatus?.running && (
            <Button
              variant="destructive"
              onClick={() => startPullMutation.mutate()}
              disabled={startPullMutation.isPending || pullStatus?.running}
              data-testid="button-start-force-pull"
            >
              {startPullMutation.isPending
                ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Starting…</>
                : <><IconCloudDownload className="h-4 w-4 mr-2" />{pullStatus?.doneAt != null ? "Pull Again" : "Start Pull"}</>
              }
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog open={webhookRetryOpen} onOpenChange={(open) => { if (!open) { setWebhookRetryOpen(false); setWebhookRetryResult(null); setCleanupResult(null); } }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{syncInfo?.webhook.active ? "Webhook Active" : "Webhook Inactive"}</DialogTitle>
          <DialogDescription asChild>
            <div>
              {syncInfo?.webhook.active
                ? "The GitHub webhook is registered and receiving events. Changes pushed to GitHub are automatically synced to this app."
                : <>
                    The GitHub webhook is not currently registered. Without it, changes pushed to GitHub won't be automatically pulled into this app.{" "}
                    {syncInfo?.repoUrl && (
                      <a
                        href={`${syncInfo.repoUrl}/settings/hooks`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline text-foreground hover:text-foreground/80"
                        data-testid="link-github-webhooks"
                      >
                        View webhooks on GitHub
                      </a>
                    )}{" "}
                    Click retry to attempt registration now.
                  </>
              }
            </div>
          </DialogDescription>
        </DialogHeader>

        {syncInfo?.webhook.active && (
          <div className="space-y-2 text-sm">
            <div className="flex items-center gap-2 p-3 rounded-md bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-900">
              <Check className="h-4 w-4 text-green-600 dark:text-green-400 flex-shrink-0" />
              <span className="text-green-700 dark:text-green-300 font-medium">Webhook #{syncInfo.webhook.id} is active</span>
            </div>
            <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-muted-foreground px-1">
              <span className="font-medium text-foreground">URL</span>
              <code className="text-xs bg-muted px-1.5 py-0.5 rounded break-all">{syncInfo.webhook.url}</code>
              {syncInfo.webhook.createdAt && (
                <>
                  <span className="font-medium text-foreground">Registered</span>
                  <span className="text-xs">{new Date(syncInfo.webhook.createdAt).toLocaleString()}</span>
                </>
              )}
            </div>
            {cleanupResult !== null && (
              <div className="flex items-center gap-2 p-2.5 rounded-md bg-muted border text-xs text-muted-foreground">
                <Check className="h-3.5 w-3.5 flex-shrink-0 text-green-600 dark:text-green-400" />
                {cleanupResult.deleted === 0
                  ? "No duplicate webhooks found — already clean."
                  : `Deleted ${cleanupResult.deleted} duplicate webhook${cleanupResult.deleted !== 1 ? "s" : ""} (#${cleanupResult.ids.join(", #")}).`
                }
              </div>
            )}
          </div>
        )}

        {!syncInfo?.webhook.active && webhookRetryResult ? (
          <div className={`flex items-start gap-2 p-3 rounded-md border text-sm ${webhookRetryResult.success ? "bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-900" : "bg-destructive/10 border-destructive/20"}`}>
            {webhookRetryResult.success
              ? <Check className="h-4 w-4 text-green-600 dark:text-green-400 flex-shrink-0 mt-0.5" />
              : <X className="h-4 w-4 text-destructive flex-shrink-0 mt-0.5" />
            }
            <p className={webhookRetryResult.success ? "text-green-700 dark:text-green-300" : "text-destructive"}>
              {webhookRetryResult.message}
            </p>
          </div>
        ) : null}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="outline"
            onClick={() => { setWebhookRetryOpen(false); setWebhookRetryResult(null); }}
            data-testid="button-close-webhook-retry"
          >
            {syncInfo?.webhook.active || webhookRetryResult ? "Close" : "Cancel"}
          </Button>
          {syncInfo?.webhook.active && cleanupResult === null && (
            <Button
              variant="outline"
              onClick={() => cleanupMutation.mutate()}
              disabled={cleanupMutation.isPending}
              data-testid="button-cleanup-webhooks"
              className="text-destructive border-destructive/40 hover:border-destructive"
            >
              {cleanupMutation.isPending
                ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Deleting...</>
                : <><Trash2 className="h-4 w-4 mr-2" />Delete inactive webhooks</>
              }
            </Button>
          )}
          {!syncInfo?.webhook.active && !webhookRetryResult?.success && (
            <Button
              onClick={() => webhookSetupMutation.mutate()}
              disabled={webhookSetupMutation.isPending}
              data-testid="button-retry-webhook"
            >
              {webhookSetupMutation.isPending
                ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Retrying...</>
                : <><Webhook className="h-4 w-4 mr-2" />Retry</>
              }
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}
