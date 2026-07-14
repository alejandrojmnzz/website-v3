import { Button } from "@/components/ui/button";
import { AlertTriangle, Github } from "lucide-react";
import { useSyncOptional } from "@/contexts/SyncContext";

// Custom event to open the sync modal in DebugBubble
export const OPEN_SYNC_MODAL_EVENT = "open-sync-modal";

export type OpenSyncModalOptions = {
  /** Expand the Commit Queue section (pending local/remote diffs). */
  expandQueue?: boolean;
};

export function openSyncModal(options?: OpenSyncModalOptions) {
  window.dispatchEvent(new CustomEvent(OPEN_SYNC_MODAL_EVENT, { detail: options ?? {} }));
}

export function SyncConflictBanner() {
  const sync = useSyncOptional();
  
  if (!sync || !sync.isBehind || !sync.syncStatus?.syncEnabled) {
    return null;
  }

  return (
    <div 
      className="bg-destructive/10 border-b border-destructive/20 px-4 py-3"
      data-testid="sync-conflict-banner"
    >
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="p-1.5 rounded-full bg-destructive/20">
            <AlertTriangle className="h-4 w-4 text-destructive" />
          </div>
          <div>
            <p className="text-sm font-medium text-foreground">
              Remote repository has files that need to be synced
            </p>
            <p className="text-xs text-muted-foreground">
              Review and sync changes before editing.
            </p>
          </div>
        </div>
        
        <Button
          size="sm"
          onClick={() => openSyncModal()}
          data-testid="button-open-sync-modal"
        >
          <Github className="h-4 w-4 mr-1" />
          Open sync modal
        </Button>
      </div>
    </div>
  );
}
