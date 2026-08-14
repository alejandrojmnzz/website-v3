import { lazy, Suspense, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  DownloadCloud,
  FileText,
  Loader2,
  MoreVertical,
  UploadCloud,
} from "lucide-react";
import { Button } from "@/components/ui/button";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { getSessionHeaders } from "@/lib/sessionHeaders";
import { useToast } from "@/hooks/use-toast";

const SitesYmlViewerPanel = lazy(() => import("@/components/editing/SitesYmlViewerPanel"));
const SyncArtifactViewerPanel = lazy(
  () => import("@/components/editing/SyncArtifactViewerPanel"),
);

export type SyncArtifactKind =
  | "sync-state"
  | "sync-log"
  | "versioning-state"
  | "form-state"
  | "validation-cache"
  | "runtime-issues"
  | "sites-yml"
  | "user-store";

interface SyncArtifactMenuProps {
  kind: SyncArtifactKind;
  siteFolder?: string | null;
  label: string;
}

interface ArtifactActionResponse {
  success: boolean;
  message: string;
  gcsKey?: string;
  source?: "gcs" | "local";
  reason?: string;
}

const CONFIRM_KINDS = new Set<SyncArtifactKind>(["sync-state", "sync-log"]);

export default function SyncArtifactMenu({ kind, siteFolder, label }: SyncArtifactMenuProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [showViewer, setShowViewer] = useState(false);
  const [pendingAction, setPendingAction] = useState<"upload" | "download" | null>(null);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["/api/admin/gcs-sync-inventory"] });
    void queryClient.invalidateQueries({ queryKey: ["/api/admin/gcs-sync-status", "detail"] });
    if (kind === "sites-yml") {
      void queryClient.invalidateQueries({ queryKey: ["/api/site/info"] });
      void queryClient.invalidateQueries({ queryKey: ["/api/sites"] });
    }
    if (kind === "runtime-issues") {
      void queryClient.invalidateQueries({ queryKey: ["/api/admin/runtime-issues"] });
    }
  };

  const downloadMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/admin/gcs-sync-artifact/download", {
        method: "POST",
        headers: { ...getSessionHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ kind, siteFolder: siteFolder ?? null }),
      });
      const body = (await res.json()) as ArtifactActionResponse;
      if (!res.ok || !body.success) {
        throw new Error(body.reason || body.message || "Download failed.");
      }
      return body;
    },
    onSuccess: (body) => {
      toast({ title: "Downloaded from GCS", description: body.message });
      invalidate();
    },
    onError: (err) => {
      toast({
        variant: "destructive",
        title: "Download failed",
        description: err instanceof Error ? err.message : "Failed to download from GCS.",
      });
    },
  });

  const uploadMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/admin/gcs-sync-artifact/upload", {
        method: "POST",
        headers: { ...getSessionHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ kind, siteFolder: siteFolder ?? null }),
      });
      const body = (await res.json()) as ArtifactActionResponse;
      if (!res.ok || !body.success) {
        throw new Error(body.reason || body.message || "Upload failed.");
      }
      return body;
    },
    onSuccess: (body) => {
      toast({ title: "Uploaded to GCS", description: body.message });
      invalidate();
    },
    onError: (err) => {
      toast({
        variant: "destructive",
        title: "Upload failed",
        description: err instanceof Error ? err.message : "Failed to upload to GCS.",
      });
    },
  });

  const busy = downloadMutation.isPending || uploadMutation.isPending;

  const runAction = (action: "upload" | "download") => {
    if (CONFIRM_KINDS.has(kind)) {
      setPendingAction(action);
      return;
    }
    if (action === "upload") uploadMutation.mutate();
    else downloadMutation.mutate();
  };

  const confirmPending = () => {
    const action = pendingAction;
    setPendingAction(null);
    if (action === "upload") uploadMutation.mutate();
    else if (action === "download") downloadMutation.mutate();
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="icon"
            className="h-7 w-7"
            title={`${label} sync actions`}
            disabled={busy}
            data-testid={`button-sync-artifact-menu-${kind}`}
          >
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <MoreVertical className="h-3.5 w-3.5" />
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-48">
          <DropdownMenuItem
            onClick={() => setShowViewer(true)}
            disabled={busy}
            className="text-[13px]"
            data-testid={`menu-view-sync-artifact-${kind}`}
          >
            <FileText className="h-3.5 w-3.5 mr-2" />
            View
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => runAction("download")}
            disabled={busy}
            className="text-[13px]"
            data-testid={`menu-download-sync-artifact-${kind}`}
          >
            <DownloadCloud className="h-3.5 w-3.5 mr-2" />
            Download from GCS
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => runAction("upload")}
            disabled={busy}
            className="text-[13px]"
            data-testid={`menu-upload-sync-artifact-${kind}`}
          >
            <UploadCloud className="h-3.5 w-3.5 mr-2" />
            Upload to GCS
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog
        open={pendingAction !== null}
        onOpenChange={(open) => {
          if (!open) setPendingAction(null);
        }}
      >
        <AlertDialogContent data-testid="dialog-confirm-sync-artifact">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingAction === "upload" ? "Upload to GCS?" : "Download from GCS?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              This overwrites {pendingAction === "upload" ? "the cloud copy" : "the local copy"} of{" "}
              <span className="font-medium text-foreground">{label}</span>
              {siteFolder ? (
                <>
                  {" "}
                  for <span className="font-mono text-xs">{siteFolder}</span>
                </>
              ) : null}
              . Sync state and sync log are last-write-wins and can affect GitHub sync. Continue?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-sync-artifact-confirm">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmPending}
              data-testid="button-confirm-sync-artifact"
            >
              Continue
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {showViewer && (
        <Suspense fallback={null}>
          {kind === "sites-yml" ? (
            <SitesYmlViewerPanel onClose={() => setShowViewer(false)} />
          ) : (
            <SyncArtifactViewerPanel
              kind={kind}
              siteFolder={siteFolder}
              title={label}
              onClose={() => setShowViewer(false)}
            />
          )}
        </Suspense>
      )}
    </>
  );
}
