import { useEffect, useState } from "react";
import { AlertTriangle, Loader2, Save, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { getDebugToken } from "@/hooks/useDebugAuth";
import { getSessionHeaders } from "@/lib/sessionHeaders";
import YamlEditor from "./YamlEditor";

interface SitesYmlViewerPanelProps {
  onClose: () => void;
  onSaved?: () => void;
}

interface SitesYmlResponse {
  exists: boolean;
  content: string | null;
  error?: string;
}

export default function SitesYmlViewerPanel({ onClose, onSaved }: SitesYmlViewerPanelProps) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [originalContent, setOriginalContent] = useState("");
  const [content, setContent] = useState("");
  const [error, setError] = useState<string | null>(null);

  const hasChanges = content !== originalContent;

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
          setError("sites.yml not found");
          return;
        }
        setOriginalContent(data.content);
        setContent(data.content);
      } catch {
        setError("Failed to load sites.yml");
      } finally {
        setLoading(false);
      }
    };

    void fetchSitesYml();
  }, []);

  const handleSave = async () => {
    if (!hasChanges) {
      toast({ title: "No changes to save" });
      return;
    }

    setSaving(true);
    try {
      const token = getDebugToken();
      const res = await fetch("/api/admin/sites-yml", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          ...getSessionHeaders(),
          ...(token ? { Authorization: `Token ${token}` } : {}),
        },
        body: JSON.stringify({ content }),
      });
      const data = await res.json().catch(() => ({ error: "Unknown error" }));
      if (!res.ok) {
        throw new Error(data.error || `Request failed with status ${res.status}`);
      }

      setOriginalContent(content);
      toast({ title: "sites.yml saved" });
      onSaved?.();
    } catch (err) {
      toast({
        title: "Failed to save",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleClose = () => {
    if (hasChanges) {
      const confirmClose = window.confirm("You have unsaved changes. Close without saving?");
      if (!confirmClose) return;
    }
    onClose();
  };

  return (
    <div
      className="fixed right-0 top-0 bottom-0 w-full sm:w-[520px] bg-background border-l shadow-xl z-[9999] flex flex-col"
      data-testid="sites-yml-viewer-panel"
    >
      <div className="flex items-center justify-between p-4 border-b">
        <h2 className="font-semibold" data-testid="text-sites-yml-title">
          Edit sites.yml
        </h2>
        <Button size="icon" variant="ghost" onClick={handleClose} data-testid="button-close-sites-yml-viewer">
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
            onChange={setContent}
            className="h-full [&_.cm-editor]:h-full [&_.cm-scroller]:overflow-auto"
          />
        )}
      </div>

      <div className="flex items-center justify-between p-3 border-t gap-2">
        {hasChanges && (
          <span className="text-xs text-amber-600 dark:text-amber-400" data-testid="text-sites-yml-unsaved">
            Unsaved changes
          </span>
        )}
        <div className="flex items-center gap-2 ml-auto">
          <Button variant="outline" onClick={handleClose} data-testid="button-cancel-sites-yml-editor">
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={!hasChanges || saving || !!error}
            data-testid="button-save-sites-yml-editor"
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <Save className="h-4 w-4 mr-2" />
            )}
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}
