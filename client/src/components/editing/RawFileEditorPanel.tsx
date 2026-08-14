import { useState, useEffect } from "react";
import { AlertTriangle, ChevronDown, File, Loader2, Save, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  rawFileCaption,
  type RawFileExplainContext,
  type RawFileRole,
} from "@/lib/rawFileCaption";
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
import { useToast } from "@/hooks/use-toast";
import { getDebugToken, resolveAuthorName } from "@/hooks/useDebugAuth";
import { encodeHtmlValues } from "@shared/htmlEncoding";
import CodeMirror from "@uiw/react-codemirror";
import { yaml } from "@codemirror/lang-yaml";
import { oneDark } from "@codemirror/theme-one-dark";
import { validateYamlSections } from "@/lib/yamlSectionsValidator";

interface RawFileEditorPanelProps {
  contentType: string;
  slug: string;
  locale: string;
  variantSlug?: string;
  /** When true, YAML is view-only (no Save/Cancel footer). */
  readOnly?: boolean;
  onClose: () => void;
  onSaved?: () => void;
}

interface TabFile {
  id: string;
  path: string;
  originalContent: string;
  content: string;
  role?: RawFileRole;
  locale?: string;
}

function InlineCodeText({
  text,
  className,
  testId,
  as: Tag = "span",
}: {
  text: string;
  className?: string;
  testId?: string;
  as?: "p" | "span";
}) {
  const parts = text.split(/`([^`]+)`/);
  return (
    <Tag className={className} data-testid={testId}>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <code key={i} className="text-[11px] font-mono bg-muted px-1 py-0.5 rounded">
            {part}
          </code>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </Tag>
  );
}

interface PendingSave {
  filesToSave: { filePath: string; content: string }[];
  issues: string[];
}

export default function RawFileEditorPanel({ contentType, slug, locale, variantSlug, readOnly = false, onClose, onSaved }: RawFileEditorPanelProps) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [files, setFiles] = useState<TabFile[]>([]);
  const [activeFileId, setActiveFileId] = useState<string | null>(null);
  const [hasChanges, setHasChanges] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingSave, setPendingSave] = useState<PendingSave | null>(null);
  const [explainContext, setExplainContext] = useState<RawFileExplainContext | null>(null);
  const [showExplainAdvanced, setShowExplainAdvanced] = useState(false);

  useEffect(() => {
    const fetchFiles = async () => {
      try {
        setLoading(true);
        setError(null);
        const res = await fetch(`/api/content/raw-file?contentType=${contentType}&slug=${slug}&locale=${locale}${variantSlug ? `&variantSlug=${encodeURIComponent(variantSlug)}` : ""}`);
        if (!res.ok) {
          setError("Could not load YAML files");
          return;
        }
        const data = await res.json();
        if (!data.exists) {
          setError("No YAML files found for this content");
          return;
        }

        const nextFiles: TabFile[] = [];
        const localeEntries: { path: string; content: string; role?: RawFileRole; locale?: string }[] =
          Array.isArray(data.files.locales) && data.files.locales.length > 0
            ? data.files.locales
            : data.files.locale
              ? [data.files.locale]
              : [];

        for (const entry of localeEntries) {
          nextFiles.push({
            id: entry.path,
            path: entry.path,
            originalContent: entry.content,
            content: entry.content,
            role: entry.role,
            locale: entry.locale,
          });
        }
        if (data.files.common) {
          nextFiles.push({
            id: data.files.common.path,
            path: data.files.common.path,
            originalContent: data.files.common.content,
            content: data.files.common.content,
            role: data.files.common.role,
          });
        }

        if (data.context) {
          setExplainContext(data.context as RawFileExplainContext);
        } else {
          setExplainContext(null);
        }
        setShowExplainAdvanced(false);

        if (nextFiles.length === 0) {
          setError("No YAML files found for this content");
          return;
        }

        setFiles(nextFiles);
        setActiveFileId(nextFiles[0].id);
        setHasChanges(false);
      } catch {
        setError("Failed to load files");
      } finally {
        setLoading(false);
      }
    };
    fetchFiles();
  }, [contentType, slug, locale, variantSlug]);

  const handleChange = (value: string) => {
    if (readOnly || !activeFileId) return;
    setFiles((prev) =>
      prev.map((file) => (file.id === activeFileId ? { ...file, content: value } : file)),
    );
    setHasChanges(true);
  };

  const executeSave = async (filesToSave: { filePath: string; content: string }[]) => {
    setSaving(true);
    try {
      const token = getDebugToken();
      const author = await resolveAuthorName();

      for (const file of filesToSave) {
        const res = await fetch("/api/content/raw-file", {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Token ${token}` } : {}),
          },
          body: JSON.stringify(encodeHtmlValues({ ...file, author })),
        });
        if (!res.ok) {
          const errorData = await res.json().catch(() => ({ error: "Unknown error" }));
          throw new Error(errorData.error || `Request failed with status ${res.status}`);
        }
      }

      setFiles((prev) =>
        prev.map((file) => {
          const saved = filesToSave.find((f) => f.filePath === file.path);
          if (!saved) return file;
          return { ...file, originalContent: saved.content, content: saved.content };
        }),
      );
      setHasChanges(false);

      toast({ title: "YAML saved successfully" });
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

  const handleSave = async () => {
    const filesToSave = files
      .filter((file) => file.content !== file.originalContent)
      .map((file) => ({ filePath: file.path, content: file.content }));

    if (filesToSave.length === 0) {
      toast({ title: "No changes to save" });
      return;
    }

    const allIssues: string[] = [];
    for (const file of filesToSave) {
      const result = validateYamlSections(file.content);
      for (const issue of result.issues) {
        allIssues.push(`${file.filePath.split("/").pop()}: ${issue.message}`);
      }
    }

    if (allIssues.length > 0) {
      setPendingSave({ filesToSave, issues: allIssues });
      return;
    }

    await executeSave(filesToSave);
  };

  const handleConfirmSaveAnyway = async () => {
    if (!pendingSave) return;
    const pending = pendingSave.filesToSave;
    setPendingSave(null);
    await executeSave(pending);
  };

  const handleCancelSave = () => {
    setPendingSave(null);
  };

  const handleClose = () => {
    if (!readOnly && hasChanges) {
      const confirm = window.confirm("You have unsaved changes. Close without saving?");
      if (!confirm) return;
    }
    onClose();
  };

  const currentFile = files.find((file) => file.id === activeFileId) ?? null;
  const caption =
    currentFile && explainContext && currentFile.role
      ? rawFileCaption({
          role: currentFile.role,
          path: currentFile.path,
          fileLocale: currentFile.locale,
          context: explainContext,
        })
      : null;

  return (
    <>
      <div className="fixed right-0 top-0 bottom-0 w-full sm:w-[520px] bg-background border-l shadow-xl z-[9999] flex flex-col" data-testid="raw-file-editor-panel">
        <div className="p-4 border-b space-y-1.5">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <h2 className="font-semibold" data-testid="text-editor-title">
                {readOnly ? "View Raw YAML" : "Edit Raw YAML"}
              </h2>
              {currentFile && (
                <p className="text-xs text-muted-foreground truncate mt-0.5" data-testid="text-file-path">
                  {currentFile.path}
                </p>
              )}
            </div>
            <Button size="icon" variant="ghost" onClick={handleClose} data-testid="button-close-raw-editor">
              <X className="h-4 w-4" />
            </Button>
          </div>
          {caption && (
            <div className="space-y-1.5">
              <InlineCodeText
                as="p"
                text={caption.visible}
                className="text-xs text-muted-foreground leading-relaxed"
                testId="text-file-explain"
              />
              <button
                type="button"
                className="inline-flex items-center gap-1 text-xs text-violet-600 dark:text-violet-400 hover:underline"
                onClick={() => setShowExplainAdvanced((v) => !v)}
                data-testid="button-toggle-yaml-explain-advanced"
              >
                {showExplainAdvanced ? "Hide advanced details" : "Read more (advanced)"}
                <ChevronDown
                  className={`h-3.5 w-3.5 transition-transform ${showExplainAdvanced ? "rotate-180" : ""}`}
                />
              </button>
              {showExplainAdvanced && (
                <div
                  className="rounded-md border border-border bg-muted/40 p-3 space-y-2 text-xs text-muted-foreground"
                  data-testid="yaml-explain-advanced"
                >
                  <ul className="space-y-1.5">
                    {caption.advanced.map((item) => (
                      <li key={item.label}>
                        <span className="font-medium text-foreground">{item.label}: </span>
                        <InlineCodeText
                          text={item.text}
                          className="inline text-xs text-muted-foreground"
                        />
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>

        {files.length > 1 && (
          <div className="flex border-b overflow-x-auto">
            {files.map((file) => {
              const fileName = file.path.split("/").pop() || file.path;
              const isActive = file.id === activeFileId;
              return (
                <button
                  key={file.id}
                  type="button"
                  className={`flex-1 min-w-0 px-3 py-2 text-sm font-medium transition-colors whitespace-nowrap ${isActive ? "border-b-2 border-primary text-foreground" : "text-muted-foreground"}`}
                  onClick={() => setActiveFileId(file.id)}
                  data-testid={`tab-file-${fileName}`}
                >
                  <File className="h-3.5 w-3.5 inline mr-1.5" />
                  {fileName}
                </button>
              );
            })}
          </div>
        )}

        <div className="flex-1 min-h-0">
          {loading ? (
            <div className="flex items-center justify-center h-full" data-testid="loading-editor">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 p-6" data-testid="error-editor">
              <AlertTriangle className="h-8 w-8 text-destructive" />
              <p className="text-sm text-muted-foreground text-center">{error}</p>
            </div>
          ) : currentFile ? (
            <CodeMirror
              value={currentFile.content}
              height="100%"
              extensions={[yaml()]}
              theme={oneDark}
              onChange={handleChange}
              readOnly={readOnly}
              basicSetup={{
                lineNumbers: true,
                foldGutter: true,
                highlightActiveLine: !readOnly,
              }}
              className="h-full [&_.cm-editor]:h-full [&_.cm-scroller]:overflow-auto"
            />
          ) : (
            <div className="flex flex-col items-center justify-center h-full gap-3 p-6" data-testid="no-file">
              <p className="text-sm text-muted-foreground">No file available for this tab</p>
            </div>
          )}
        </div>

        {!readOnly && (
          <div className="flex items-center justify-between p-3 border-t gap-2">
            {hasChanges && (
              <span className="text-xs text-amber-600 dark:text-amber-400" data-testid="text-unsaved">
                Unsaved changes
              </span>
            )}
            <div className="flex items-center gap-2 ml-auto">
              <Button variant="outline" onClick={handleClose} data-testid="button-cancel-raw-editor">
                Cancel
              </Button>
              <Button onClick={handleSave} disabled={!hasChanges || saving} data-testid="button-save-raw-editor">
                {saving ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <Save className="h-4 w-4 mr-2" />
                )}
                Save
              </Button>
            </div>
          </div>
        )}
      </div>

      <AlertDialog open={pendingSave !== null} onOpenChange={(open) => { if (!open) handleCancelSave(); }}>
        <AlertDialogContent data-testid="dialog-yaml-validation">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Invalid sections structure
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>The YAML you are about to save has structural problems in the <code className="font-mono text-xs bg-muted px-1 py-0.5 rounded">sections</code> array. Saving a broken structure can corrupt the page.</p>
                <ul className="space-y-1" data-testid="list-yaml-issues">
                  {pendingSave?.issues.map((issue, i) => (
                    <li key={i} className="text-sm text-destructive flex gap-2">
                      <span className="shrink-0">•</span>
                      <span>{issue}</span>
                    </li>
                  ))}
                </ul>
                <p className="text-sm">Please fix the YAML before saving, or choose <strong>Save anyway</strong> if you know what you are doing.</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleCancelSave} data-testid="button-fix-yaml">
              Fix before saving
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmSaveAnyway}
              className="bg-destructive text-destructive-foreground"
              data-testid="button-save-anyway"
            >
              Save anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
