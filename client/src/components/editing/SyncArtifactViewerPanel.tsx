import { useEffect, useState } from "react";
import { AlertTriangle, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getSessionHeaders } from "@/lib/sessionHeaders";
import { toContentFileRef } from "@shared/formatSitePath";

interface SyncArtifactViewerPanelProps {
  kind: string;
  siteFolder?: string | null;
  title: string;
  onClose: () => void;
}

interface ArtifactContentResponse {
  success: boolean;
  exists: boolean;
  path: string;
  content: string | null;
  contentType?: string;
  error?: string;
  truncated?: boolean;
  byteSize?: number;
  previewLimit?: number;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function displayArtifactPath(absolutePath: string, siteFolder?: string | null): string {
  const ref = toContentFileRef(absolutePath, {
    contentFolder: siteFolder ?? undefined,
    knownSiteFolders: siteFolder ? [siteFolder] : [],
  });
  if (ref.startsWith("/") || /^[A-Za-z]:/.test(ref)) {
    const parts = ref.split("/").filter(Boolean);
    return parts[parts.length - 1] ?? ref;
  }
  return ref;
}

export default function SyncArtifactViewerPanel({
  kind,
  siteFolder,
  title,
  onClose,
}: SyncArtifactViewerPanelProps) {
  const [loading, setLoading] = useState(true);
  const [content, setContent] = useState("");
  const [filePath, setFilePath] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [byteSize, setByteSize] = useState<number | null>(null);
  const [previewLimit, setPreviewLimit] = useState<number | null>(null);

  useEffect(() => {
    const fetchContent = async () => {
      try {
        setLoading(true);
        setError(null);
        setTruncated(false);
        setByteSize(null);
        setPreviewLimit(null);
        const params = new URLSearchParams({ kind });
        if (siteFolder) params.set("siteFolder", siteFolder);
        const res = await fetch(`/api/admin/gcs-sync-artifact/content?${params}`, {
          headers: getSessionHeaders(),
        });
        const data = (await res.json()) as ArtifactContentResponse;
        if (!res.ok || !data.success) {
          setError(data.error ?? "Could not load artifact content");
          return;
        }
        if (!data.exists || data.content == null) {
          setError(data.error ?? "Local file not found");
          setFilePath(data.path || "");
          return;
        }
        setFilePath(data.path);
        setContent(data.content);
        setTruncated(Boolean(data.truncated));
        setByteSize(typeof data.byteSize === "number" ? data.byteSize : null);
        setPreviewLimit(typeof data.previewLimit === "number" ? data.previewLimit : null);
      } catch {
        setError("Failed to load artifact content");
      } finally {
        setLoading(false);
      }
    };

    void fetchContent();
  }, [kind, siteFolder]);

  return (
    <div
      className="fixed right-0 top-0 bottom-0 w-full sm:w-[520px] bg-background border-l shadow-xl z-[9999] flex flex-col"
      data-testid="sync-artifact-viewer-panel"
    >
      <div className="flex items-center justify-between p-4 border-b">
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold" data-testid="text-sync-artifact-title">
            {title}
          </h2>
          <p
            className="text-xs text-muted-foreground mt-0.5 overflow-hidden whitespace-nowrap text-right"
            title={filePath || undefined}
            data-testid="text-sync-artifact-path"
          >
            {filePath ? displayArtifactPath(filePath, siteFolder) : "—"}
          </p>
        </div>
        <Button
          size="icon"
          variant="ghost"
          onClick={onClose}
          data-testid="button-close-sync-artifact-viewer"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      {truncated && (
        <div
          className="px-4 py-2 border-b bg-muted/40 text-xs text-muted-foreground"
          data-testid="sync-artifact-truncated-banner"
        >
          Showing the first {previewLimit != null ? formatBytes(previewLimit) : "512 KB"}
          {byteSize != null ? ` of ${formatBytes(byteSize)}` : ""}. Upload and download still use the
          full file.
        </div>
      )}

      <div className="flex-1 min-h-0">
        {loading ? (
          <div
            className="flex items-center justify-center h-full"
            data-testid="loading-sync-artifact-viewer"
          >
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div
            className="flex flex-col items-center justify-center h-full gap-3 p-6"
            data-testid="error-sync-artifact-viewer"
          >
            <AlertTriangle className="h-8 w-8 text-destructive" />
            <p className="text-sm text-muted-foreground text-center">{error}</p>
          </div>
        ) : (
          <pre
            className="h-full overflow-auto p-4 text-xs font-mono whitespace-pre-wrap break-words bg-muted/30"
            data-testid="sync-artifact-content"
          >
            {content}
          </pre>
        )}
      </div>
    </div>
  );
}
