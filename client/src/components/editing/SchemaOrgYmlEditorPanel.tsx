import { useState, useEffect } from "react";
import { AlertTriangle, Loader2, Save, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { getDebugToken, resolveAuthorName } from "@/hooks/useDebugAuth";
import { getSessionHeaders } from "@/lib/sessionHeaders";
import YamlEditor from "./YamlEditor";

interface SchemaOrgYmlEditorPanelProps {
  onClose: () => void;
  onSaved?: () => void;
}

interface SchemaOrgYmlResponse {
  exists: boolean;
  path: string;
  content: string;
  error?: string;
}

export default function SchemaOrgYmlEditorPanel({ onClose, onSaved }: SchemaOrgYmlEditorPanelProps) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [filePath, setFilePath] = useState("schema-org.yml");
  const [originalContent, setOriginalContent] = useState("");
  const [content, setContent] = useState("");
  const [error, setError] = useState<string | null>(null);

  const hasChanges = content !== originalContent;

  useEffect(() => {
    const fetchFile = async () => {
      try {
        setLoading(true);
        setError(null);
        const res = await fetch("/api/admin/schema-org/yml", { headers: getSessionHeaders() });
        const data = (await res.json()) as SchemaOrgYmlResponse;
        if (!res.ok) {
          setError(data.error ?? "Could not load schema-org.yml");
          return;
        }
        setFilePath(data.path);
        setOriginalContent(data.content ?? "");
        setContent(data.content ?? "");
        if (!data.exists) {
          setError("schema-org.yml not found — saving will create it");
        }
      } catch {
        setError("Failed to load schema-org.yml");
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
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        ...getSessionHeaders(),
      };
      if (token && !headers.Authorization) headers.Authorization = `Token ${token}`;

      const res = await fetch("/api/admin/schema-org/yml", {
        method: "PUT",
        headers,
        body: JSON.stringify({ content, author }),
      });
      const data = await res.json().catch(() => ({ error: "Unknown error" }));
      if (!res.ok) {
        throw new Error(data.error || `Request failed with status ${res.status}`);
      }

      setOriginalContent(data.content ?? content);
      setContent(data.content ?? content);
      toast({ title: "schema-org.yml saved" });
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
      data-testid="schema-org-yml-editor-panel"
    >
      <div className="flex items-center justify-between p-4 border-b">
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold" data-testid="text-schema-org-yml-title">
            Edit schema-org.yml
          </h2>
          <p className="text-xs text-muted-foreground truncate mt-0.5" data-testid="text-schema-org-yml-path">
            {filePath}
          </p>
        </div>
        <Button variant="ghost" size="icon" onClick={handleClose} data-testid="button-close-schema-org-yml">
          <X className="h-4 w-4" />
        </Button>
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mr-2" />
          Loading…
        </div>
      ) : (
        <>
          {error && (
            <div className="mx-4 mt-4 flex items-start gap-2 rounded-md border border-border bg-muted/50 p-3 text-xs text-muted-foreground">
              <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <span data-testid="text-schema-org-yml-error">{error}</span>
            </div>
          )}
          <div className="flex-1 min-h-0">
            <YamlEditor
              value={content}
              onChange={setContent}
              className="h-full [&_.cm-editor]:h-full [&_.cm-scroller]:overflow-auto"
            />
          </div>
          <div className="p-4 border-t flex justify-end gap-2">
            <Button variant="outline" onClick={handleClose} data-testid="button-cancel-schema-org-yml">
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={saving || !hasChanges}
              data-testid="button-save-schema-org-yml"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <Save className="h-4 w-4 mr-1.5" />}
              Save
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
