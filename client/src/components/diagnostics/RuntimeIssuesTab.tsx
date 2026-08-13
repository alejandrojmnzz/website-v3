import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { IconAlertTriangle, IconInfoCircle, IconRefresh } from "@tabler/icons-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { apiFetch } from "@/lib/queryClient";

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
}

interface RuntimeIssuesResponse {
  site: string;
  updatedAt: number;
  totalCount: number;
  issues: RuntimeIssueRow[];
}

type SortKey = "count" | "lastSeen";
type SortDir = "asc" | "desc";

function formatTs(ts: number) {
  return new Date(ts).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function SortIcon({ col, sortKey, sortDir }: { col: SortKey; sortKey: SortKey; sortDir: SortDir }) {
  if (col !== sortKey) return <ArrowUpDown className="inline ml-1 opacity-40" size={12} />;
  return sortDir === "asc" ? (
    <ArrowUp className="inline ml-1" size={12} />
  ) : (
    <ArrowDown className="inline ml-1" size={12} />
  );
}

export default function RuntimeIssuesTab() {
  const [hideBots, setHideBots] = useState(true);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("count");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const { data, isLoading, refetch, isFetching, isError, error } = useQuery<RuntimeIssuesResponse>({
    queryKey: ["/api/admin/runtime-issues", hideBots],
    queryFn: async () => {
      const res = await apiFetch(`/api/admin/runtime-issues?hideBots=${hideBots ? "1" : "0"}`);
      if (!res.ok) throw new Error("Failed to fetch runtime issues");
      return res.json();
    },
    refetchInterval: 30_000,
  });

  const sortedIssues = useMemo(() => {
    const rows = data?.issues ?? [];
    return [...rows].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      const cmp = av - bv;
      if (cmp !== 0) return sortDir === "asc" ? cmp : -cmp;
      // Stable secondary: higher count, then newer lastSeen
      if (b.count !== a.count) return b.count - a.count;
      return b.lastSeen - a.lastSeen;
    });
  }, [data?.issues, sortKey, sortDir]);

  function toggleSort(col: SortKey) {
    if (col === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(col);
      setSortDir("desc");
    }
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
            Visitor-facing signals for this site (v1: public HTML 404s). Counts survive deploys via GCS
            (<code className="text-xs font-mono">{"{site}/sync/runtime-issues-state.json"}</code>). This is
            not the process Error Log and not Global Health content validation.
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
                <code>server/runtime-issues-store.ts</code> — in-memory rollups + local/GCS flush
              </li>
              <li>
                <code>shared/gcsKeys.ts</code> — <code>runtime-issues-state.json</code> site sync key
              </li>
              <li>
                <code>server/vite.ts</code> — records public HTML 404s only (skips <code>/api</code> and{" "}
                <code>/private</code>)
              </li>
              <li>Non-effects: does not change redirects; does not replace diagnostics validators</li>
            </ul>
          )}
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2" data-testid="toggle-hide-bots">
            <Switch id="hide-bots" checked={hideBots} onCheckedChange={setHideBots} />
            <Label htmlFor="hide-bots" className="text-sm">
              Hide likely bots
            </Label>
          </div>
          {data && (
            <Badge variant="secondary" data-testid="badge-runtime-total">
              {data.issues.length} paths · {data.totalCount} hits
            </Badge>
          )}
        </div>
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
      </div>

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
                    <TableCell className="font-mono text-xs max-w-[280px] truncate" title={issue.path}>
                      {issue.path}
                      {issue.likelyBot && (
                        <Badge variant="outline" className="ml-2 text-[10px]">
                          bot?
                        </Badge>
                      )}
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
          </CardContent>
        </Card>
      )}
    </div>
  );
}
