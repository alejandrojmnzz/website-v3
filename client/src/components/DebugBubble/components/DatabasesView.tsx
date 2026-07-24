import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Database, ExternalLink, MoreVertical, Plus, RefreshCw, Settings } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import type { MenuView } from "../types";
import { StatusCountBadge } from "./StatusCountBadge";
import { reloadDatabaseList } from "@/lib/reloadDatabaseList";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface DatabaseSummary {
  name: string;
  label: string;
  description: string | null;
  source_type: string;
  field_count: number;
  cache_item_count: number | null;
  cache_fetched_at: string | null;
  cache_file_size_bytes: number;
  error_count: number;
  error_summary?: string;
}

interface DatabasesViewProps {
  setMenuView: (v: MenuView) => void;
}

function formatRelativeTime(isoString: string): string {
  const diffMs = Date.now() - new Date(isoString).getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function DatabasesView({ setMenuView }: DatabasesViewProps) {
  const { toast } = useToast();
  const [refreshing, setRefreshing] = useState(false);
  const { data, isLoading } = useQuery<DatabaseSummary[]>({
    queryKey: ["/api/databases"],
    refetchInterval: 30_000,
  });

  const totalFileSize = data && data.length > 0 ? data[0].cache_file_size_bytes : null;

  const handleRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      const { count } = await reloadDatabaseList();
      toast({
        title: "Databases refreshed",
        description: `${count} database${count !== 1 ? "s" : ""} loaded from disk`,
      });
    } catch (err) {
      toast({
        title: "Refresh failed",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <>
      <div className="px-3 py-2 border-b">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setMenuView("main")}
              className="p-1 rounded-md hover-elevate"
              data-testid="button-back-to-main-databases"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            <div>
              <h3 className="font-semibold text-sm">Databases</h3>
              <p className="text-xs text-muted-foreground">
                {data
                  ? `${data.length} database${data.length !== 1 ? "s" : ""}${totalFileSize ? ` · ${formatFileSize(totalFileSize)} cache` : ""}`
                  : "Loading..."}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={handleRefresh}
              disabled={refreshing}
              className="p-1.5 rounded hover-elevate disabled:opacity-50"
              title="Refresh databases"
              data-testid="button-refresh-databases"
            >
              <RefreshCw
                className={cn("h-4 w-4 text-muted-foreground", refreshing && "animate-spin")}
              />
            </button>
            <a
              href="/private/databases?create=true"
              className="p-1.5 rounded hover-elevate"
              title="Create Database"
              data-testid="link-create-database"
            >
              <Plus className="h-4 w-4 text-muted-foreground" />
            </a>
            <a
              href="/private/databases"
              className="p-1.5 rounded hover-elevate"
              title="Open Databases Page"
              data-testid="link-databases-page"
            >
              <ExternalLink className="h-4 w-4 text-muted-foreground" />
            </a>
          </div>
        </div>
      </div>

      <div className="overflow-y-auto overflow-x-hidden max-h-[280px]">
        <div className="p-2 space-y-1">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : !data || data.length === 0 ? (
            <div className="text-center py-8 text-sm text-muted-foreground">
              No databases configured
            </div>
          ) : (
            data.map((db) => (
              <div
                key={db.name}
                className="group flex items-center gap-1 px-3 py-2 rounded-md text-sm hover-elevate"
                data-testid={`row-database-${db.name}`}
              >
                <a
                  href={`/private/databases/${db.name}`}
                  className="flex items-center gap-3 flex-1 min-w-0 cursor-pointer"
                  data-testid={`link-database-${db.name}`}
                >
                  <Database className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{db.label}</div>
                    <div className="text-xs text-muted-foreground truncate">
                      {db.cache_item_count !== null && db.cache_fetched_at ? (
                        <span data-testid={`text-cache-info-${db.name}`}>
                          {db.cache_item_count} items · {formatRelativeTime(db.cache_fetched_at)}
                        </span>
                      ) : db.description ? (
                        db.description
                      ) : (
                        `${db.source_type} · ${db.field_count} fields`
                      )}
                    </div>
                  </div>
                </a>
                {db.error_count > 0 && (
                  <StatusCountBadge
                    errorCount={db.error_count}
                    errorsOnly
                    onClick={() => {
                      window.location.href = `/private/databases/${db.name}`;
                    }}
                    testId={`badge-database-error-${db.name}`}
                    title={db.error_summary ?? `${db.error_count} error${db.error_count !== 1 ? "s" : ""} — click to view`}
                  />
                )}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      className="p-1 rounded flex-shrink-0"
                      data-testid={`button-database-menu-${db.name}`}
                    >
                      <MoreVertical className="h-3.5 w-3.5 text-muted-foreground" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="z-[10001]">
                    <DropdownMenuItem asChild>
                      <a href={`/private/databases/${db.name}`} data-testid={`link-manage-database-${db.name}`}>
                        <Settings className="h-4 w-4 mr-2" />
                        Manage Database
                      </a>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            ))
          )}
        </div>
      </div>
    </>
  );
}
