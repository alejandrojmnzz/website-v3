import { useCallback, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
import { ArrowDown, ArrowUp, ArrowUpDown, X } from "lucide-react";
import { IconAlertTriangle, IconDownload, IconInfoCircle, IconRefresh, IconTrash } from "@tabler/icons-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import type { ByHour } from "@shared/runtime-issues";

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
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const queryClient = useQueryClient();

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
        <CardContent className="p-4 space-y-2 text-sm text-muted-foreground">
          <p className="text-foreground font-medium flex items-center gap-2">
            <IconInfoCircle className="h-4 w-4 shrink-0" />
            How runtime issues work
          </p>
          <p>
            Missing URLs that people, Google, LLMs, or social previews tried to open. File probes, SEO
            scrapers, and <code className="text-xs font-mono">curl</code> are discarded. File 404s from
            a 4Geeks referrer are kept (broken internal or old assets). Count is hits in the selected{" "}
            <strong>7 or 30 days in your timezone</strong> ({tz}) — the CSV uses the same window.
            Badges are crawler vs SERP click vs LLM vs social on the same path (one row; tag sums can
            exceed Count). Reset wipes the stored log including GCS.
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
                <code>server/vite.ts</code> — records public HTML 404s only (skips <code>/api</code> and{" "}
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
                <code>client/src/components/diagnostics/runtime-issues-csv.ts</code> — CSV from the same
                filtered rows
              </li>
              <li>
                Non-effects: does not add redirects; not Search Console; Google <code>q=</code> is
                stripped; does not change public 404 HTML; last-write-wins can undercount across
                instances
              </li>
            </ul>
          )}
        </CardContent>
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

      {data && data.issues.length > 0 && (
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
                    <TableCell className="font-mono text-xs max-w-[320px]" title={issue.path}>
                      <span className="truncate block">{issue.path}</span>
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
                    <TableCell className="text-xs text-muted-foreground max-w-[180px] truncate" title={issue.sampleReferrer}>
                      {issue.sampleReferrer || "—"}
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
