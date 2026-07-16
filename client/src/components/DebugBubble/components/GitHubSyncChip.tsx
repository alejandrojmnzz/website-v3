import { AlertTriangle, Check, CloudDownload, Github, RefreshCw } from "lucide-react";
import { useLocation } from "wouter";
import { cn } from "@/lib/utils";
import type { GitHubSyncStatus } from "../types";

export interface GitHubSyncChipProps {
  className?: string;
  githubSyncStatus: GitHubSyncStatus | null;
  syncStatusLoading: boolean;
  refreshSyncStatus: () => void;
  fetchPendingChanges: () => void;
  setCommitModalOpen: (v: boolean) => void;
}

function GitHubStatusBadge({
  status,
  behindBy,
  aheadBy,
}: {
  status: GitHubSyncStatus["status"];
  behindBy?: number;
  aheadBy?: number;
}) {
  if (status === "in-sync") {
    return (
      <span className="text-[10px] text-chart-3 flex items-center gap-0.5 truncate">
        <Check className="h-3 w-3 shrink-0" />
        In sync
      </span>
    );
  }
  if (status === "behind") {
    return (
      <span className="text-[10px] text-amber-600 dark:text-amber-400 flex items-center gap-0.5 truncate">
        <CloudDownload className="h-3 w-3 shrink-0" />
        {behindBy} behind
      </span>
    );
  }
  if (status === "ahead") {
    return (
      <span className="text-[10px] text-primary flex items-center gap-0.5 truncate">
        {aheadBy} ahead
      </span>
    );
  }
  if (status === "diverged") {
    return (
      <span className="text-[10px] text-destructive flex items-center gap-0.5 truncate">
        <AlertTriangle className="h-3 w-3 shrink-0" />
        Diverged
      </span>
    );
  }
  if (status === "invalid-credentials") {
    return (
      <span className="text-[10px] text-destructive flex items-center gap-0.5 truncate font-medium">
        <AlertTriangle className="h-3 w-3 shrink-0" />
        Invalid
      </span>
    );
  }
  if (status === "not-configured") {
    return <span className="text-[10px] text-muted-foreground truncate">Not configured</span>;
  }
  if (status === "unknown") {
    return (
      <span className="text-[10px] text-amber-600 dark:text-amber-400 truncate" title="Could not compare local and remote commits">
        Check failed
      </span>
    );
  }
  return null;
}

export function GitHubSyncChip({
  className,
  githubSyncStatus,
  syncStatusLoading,
  refreshSyncStatus,
  fetchPendingChanges,
  setCommitModalOpen,
}: GitHubSyncChipProps) {
  const [, navigate] = useLocation();

  return (
    <div
      className={cn(
        "flex items-center justify-between gap-1 min-w-0 px-2 py-2 rounded-md text-sm hover-elevate",
        className,
      )}
      data-testid="chip-github-sync"
    >
      <button
        type="button"
        onClick={() => navigate("/private/repository-sync")}
        className="flex items-center gap-1.5 min-w-0 flex-1 text-left"
        title="Open repository sync log"
        data-testid="link-repository-sync"
      >
        <Github className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        {githubSyncStatus && !githubSyncStatus.syncEnabled && (
          <span className="text-[10px] px-1 py-0 rounded bg-muted text-muted-foreground font-medium shrink-0">
            Off
          </span>
        )}
      </button>
      <div className="flex items-center gap-0.5 shrink-0">
        <button
          type="button"
          onClick={() => navigate("/private/repository-sync")}
          className="flex items-center gap-1 cursor-pointer"
          title="Open repository sync"
          data-testid="button-sync-status-popover"
        >
          {syncStatusLoading ? (
            <RefreshCw className="h-3 w-3 animate-spin text-muted-foreground" />
          ) : githubSyncStatus ? (
            <GitHubStatusBadge
              status={githubSyncStatus.status}
              behindBy={githubSyncStatus.behindBy}
              aheadBy={githubSyncStatus.aheadBy}
            />
          ) : (
            <span className="text-[10px] text-muted-foreground">--</span>
          )}
        </button>
        <button
          onClick={refreshSyncStatus}
          disabled={syncStatusLoading}
          className="p-0.5 rounded hover-elevate disabled:opacity-50"
          data-testid="button-refresh-sync-status"
          title="Refresh sync status"
        >
          <RefreshCw className={cn("h-3 w-3", syncStatusLoading && "animate-spin")} />
        </button>
        {githubSyncStatus?.syncEnabled && (
          <button
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              fetchPendingChanges();
              setCommitModalOpen(true);
            }}
            className="p-0.5 rounded hover-elevate"
            data-testid="button-open-sync-modal"
            title="Manage file sync"
          >
            <CloudDownload className="h-3 w-3" />
          </button>
        )}
      </div>
    </div>
  );
}
