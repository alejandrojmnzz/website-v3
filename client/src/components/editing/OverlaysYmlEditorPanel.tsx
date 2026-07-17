import { useState, useEffect } from "react";
import { AlertTriangle, Loader2, Save, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { getDebugToken, resolveAuthorName } from "@/hooks/useDebugAuth";
import YamlEditor from "./YamlEditor";

interface OverlaysYmlEditorPanelProps {
  onClose: () => void;
  onSaved?: () => void;
}

interface OverlaysYmlResponse {
  exists: boolean;
  path: string;
  content: string;
  error?: string;
}

export default function OverlaysYmlEditorPanel({ onClose, onSaved }: OverlaysYmlEditorPanelProps) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [filePath, setFilePath] = useState("overlays.yml");
  const [originalContent, setOriginalContent] = useState("");
  const [content, setContent] = useState("");
  const [error, setError] = useState<string | null>(null);

  const hasChanges = content !== originalContent;

  useEffect(() => {
    const fetchFile = async () => {
      try {
        setLoading(true);
        setError(null);
        const res = await fetch("/api/overlays/yml");
        const data = (await res.json()) as OverlaysYmlResponse;
        if (!res.ok) {
          setError(data.error ?? "Could not load overlays.yml");
          return;
        }
        if (!data.exists || data.content == null) {
          setError("overlays.yml not found");
          return;
        }
        setFilePath(data.path);
        setOriginalContent(data.content);
        setContent(data.content);
      } catch {
        setError("Failed to load overlays.yml");
      } finally {
        setLoading(false);
      }
    };

    void fetchFile();
  }, []);

  const handleSave = async () => {
    if (!hasChanges) {
      toast({ title: "No changes to save" });
      return;
    }

    setSaving(true);
    try {
      const token = getDebugToken();
      const author = await resolveAuthorName();
      const res = await fetch("/api/overlays/yml", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Token ${token}` } : {}),
        },
        body: JSON.stringify({ content, author }),
      });
      const data = await res.json().catch(() => ({ error: "Unknown error" }));
      if (!res.ok) {
        throw new Error(data.error || `Request failed with status ${res.status}`);
      }

      setOriginalContent(content);
      toast({ title: "overlays.yml saved" });
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
      const confirm = window.confirm("You have unsaved changes. Close without saving?");
      if (!confirm) return;
    }
    onClose();
  };

  return (
    <div
      className="fixed right-0 top-0 bottom-0 w-full sm:w-[520px] bg-background border-l shadow-xl z-[9999] flex flex-col"
      data-testid="overlays-yml-editor-panel"
    >
      <div className="flex items-center justify-between p-4 border-b">
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold" data-testid="text-overlays-yml-title">
            Edit overlays.yml
          </h2>
          <p className="text-xs text-muted-foreground truncate mt-0.5" data-testid="text-overlays-yml-path">
            {filePath}
          </p>
        </div>
        <Button size="icon" variant="ghost" onClick={handleClose} data-testid="button-close-overlays-yml-editor">
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex-1 min-h-0">
        {loading ? (
          <div className="flex items-center justify-center h-full" data-testid="loading-overlays-yml-editor">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 p-6" data-testid="error-overlays-yml-editor">
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
          <span className="text-xs text-amber-600 dark:text-amber-400" data-testid="text-overlays-yml-unsaved">
            Unsaved changes
          </span>
        )}
        <div className="flex items-center gap-2 ml-auto">
          <Button variant="outline" onClick={handleClose} data-testid="button-cancel-overlays-yml-editor">
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={!hasChanges || saving || !!error}
            data-testid="button-save-overlays-yml-editor"
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
