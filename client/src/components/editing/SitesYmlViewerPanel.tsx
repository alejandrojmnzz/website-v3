import { useEffect, useState } from "react";
import { AlertTriangle, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getSessionHeaders } from "@/lib/sessionHeaders";
import YamlEditor from "./YamlEditor";

interface SitesYmlViewerPanelProps {
  onClose: () => void;
}

interface SitesYmlResponse {
  exists: boolean;
  path: string;
  content: string | null;
  error?: string;
}

export default function SitesYmlViewerPanel({ onClose }: SitesYmlViewerPanelProps) {
  const [loading, setLoading] = useState(true);
  const [content, setContent] = useState("");
  const [filePath, setFilePath] = useState("sites.yml");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchSitesYml = async () => {
      try {
        setLoading(true);
        setError(null);
        const res = await fetch("/api/admin/sites-yml", { headers: getSessionHeaders() });
        const data = (await res.json()) as SitesYmlResponse;
        if (!res.ok) {
          setError(data.error ?? "Could not load sites.yml");
          return;
        }
        if (!data.exists || data.content == null) {
          setError("sites.yml not found at project root");
          return;
        }
        setFilePath(data.path);
        setContent(data.content);
      } catch {
        setError("Failed to load sites.yml");
      } finally {
        setLoading(false);
      }
    };

    void fetchSitesYml();
  }, []);

  return (
    <div
      className="fixed right-0 top-0 bottom-0 w-full sm:w-[520px] bg-background border-l shadow-xl z-[9999] flex flex-col"
      data-testid="sites-yml-viewer-panel"
    >
      <div className="flex items-center justify-between p-4 border-b">
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold" data-testid="text-sites-yml-title">
            sites.yml
          </h2>
          <p className="text-xs text-muted-foreground truncate mt-0.5" data-testid="text-sites-yml-path">
            {filePath}
          </p>
        </div>
        <Button size="icon" variant="ghost" onClick={onClose} data-testid="button-close-sites-yml-viewer">
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex-1 min-h-0">
        {loading ? (
          <div className="flex items-center justify-center h-full" data-testid="loading-sites-yml-viewer">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 p-6" data-testid="error-sites-yml-viewer">
            <AlertTriangle className="h-8 w-8 text-destructive" />
            <p className="text-sm text-muted-foreground text-center">{error}</p>
          </div>
        ) : (
          <YamlEditor
            value={content}
            readOnly
            highlightActiveLine={false}
            className="h-full [&_.cm-editor]:h-full [&_.cm-scroller]:overflow-auto"
          />
        )}
      </div>
    </div>
  );
}
