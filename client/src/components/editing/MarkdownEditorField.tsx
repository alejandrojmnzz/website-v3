import { useState, useRef, useEffect } from "react";
import { FileCode, List, Maximize2, Minimize2, Pencil, Save, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface TocPreviewItem {
  text: string;
  level: number;
}

function stripInlineMarkdown(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/(\*|_)(.*?)\1/g, "$2")
    .replace(/~~(.*?)~~/g, "$1")
    .replace(/<\/?[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractTocFromMarkdown(markdown: string): TocPreviewItem[] {
  const lines = markdown.split("\n");
  const items: TocPreviewItem[] = [];
  let inCodeBlock = false;

  for (const line of lines) {
    if (line.trim().startsWith("```")) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) continue;

    const match = line.match(/^(#{1,3})\s+(.+)$/);
    if (match) {
      items.push({
        level: match[1].length,
        text: stripInlineMarkdown(match[2].trim()),
      });
    }
  }

  return items;
}

interface MarkdownEditorFieldProps {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  "data-testid"?: string;
}

export function MarkdownEditorField({
  value,
  onChange,
  label = "Content",
  "data-testid": testId,
}: MarkdownEditorFieldProps) {
  const [modalOpen, setModalOpen] = useState(false);

  const tocItems = extractTocFromMarkdown(value);
  const charCount = value.length;
  const wordCount = value.trim() ? value.trim().split(/\s+/).length : 0;

  const previewLines = value.split("\n").filter((l) => l.trim().length > 0).slice(0, 6);

  return (
    <>
      <div
        className="rounded-md border border-input bg-background"
        data-testid={testId || "markdown-editor-field"}
      >
        <div className="flex items-center justify-between gap-2 border-b border-input bg-muted/30 px-3 py-2">
          <div className="flex items-center gap-2">
            <FileCode className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">{label}</span>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setModalOpen(true)}
            data-testid="button-edit-markdown"
          >
            <Pencil className="mr-1.5 h-3.5 w-3.5" />
            Edit Markdown
          </Button>
        </div>

        <div className="px-3 py-3 space-y-3">
          {previewLines.length > 0 ? (
            <div className="space-y-1">
              {previewLines.map((line, i) => (
                <p
                  key={i}
                  className="truncate text-xs text-muted-foreground font-mono leading-relaxed"
                >
                  {line}
                </p>
              ))}
              {value.split("\n").filter((l) => l.trim()).length > 6 && (
                <p className="text-xs text-muted-foreground/60 italic">
                  ...and more
                </p>
              )}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground italic">No content yet</p>
          )}

          <div className="flex items-center gap-3 flex-wrap">
            <Badge variant="secondary" className="text-xs font-normal">
              {charCount.toLocaleString()} chars
            </Badge>
            <Badge variant="secondary" className="text-xs font-normal">
              {wordCount.toLocaleString()} words
            </Badge>
            {tocItems.length > 0 && (
              <Badge variant="secondary" className="text-xs font-normal">
                <List className="mr-1 h-3 w-3" />
                {tocItems.length} heading{tocItems.length !== 1 ? "s" : ""}
              </Badge>
            )}
          </div>

          {tocItems.length > 0 && (
            <div className="rounded-md border border-border bg-muted/20 p-2.5">
              <p className="mb-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Table of Contents
              </p>
              <ul className="space-y-0.5">
                {tocItems.map((item, i) => (
                  <li
                    key={i}
                    className="text-xs text-muted-foreground"
                    style={{ paddingLeft: `${(item.level - 1) * 12}px` }}
                  >
                    {item.text}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>

      <MarkdownEditorModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        value={value}
        onChange={onChange}
      />
    </>
  );
}

interface MarkdownEditorModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: string;
  onChange: (value: string) => void;
}

function MarkdownEditorModal({
  open,
  onOpenChange,
  value,
  onChange,
}: MarkdownEditorModalProps) {
  const [draft, setDraft] = useState(value);
  const [showPreview, setShowPreview] = useState(true);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open) {
      setDraft(value);
    }
  }, [open, value]);

  useEffect(() => {
    if (open && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [open]);

  const handleSave = () => {
    onChange(draft);
    onOpenChange(false);
  };

  const handleCancel = () => {
    onOpenChange(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "s") {
      e.preventDefault();
      handleSave();
    }
    if (e.key === "Escape") {
      e.preventDefault();
      handleCancel();
    }
  };

  const handleTabKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Tab") {
      e.preventDefault();
      const textarea = e.currentTarget;
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const newValue = draft.substring(0, start) + "  " + draft.substring(end);
      setDraft(newValue);
      requestAnimationFrame(() => {
        textarea.selectionStart = textarea.selectionEnd = start + 2;
      });
    }
  };

  const charCount = draft.length;
  const wordCount = draft.trim() ? draft.trim().split(/\s+/).length : 0;
  const hasChanges = draft !== value;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex flex-col p-0 gap-0"
        style={{ maxWidth: "95vw", width: "95vw", height: "90vh", maxHeight: "90vh" }}
        onKeyDown={handleKeyDown}
      >
        <DialogHeader className="flex-none border-b border-border px-4 py-3">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <DialogTitle className="flex items-center gap-2">
                <FileCode className="h-5 w-5" />
                Markdown Editor
              </DialogTitle>
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className="text-xs font-normal">
                  {charCount.toLocaleString()} chars
                </Badge>
                <Badge variant="secondary" className="text-xs font-normal">
                  {wordCount.toLocaleString()} words
                </Badge>
                {hasChanges && (
                  <Badge variant="outline" className="text-xs font-normal text-destructive border-destructive/40">
                    Unsaved changes
                  </Badge>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setShowPreview(!showPreview)}
                data-testid="button-toggle-preview"
              >
                {showPreview ? (
                  <>
                    <Minimize2 className="mr-1.5 h-3.5 w-3.5" />
                    Hide Preview
                  </>
                ) : (
                  <>
                    <Maximize2 className="mr-1.5 h-3.5 w-3.5" />
                    Show Preview
                  </>
                )}
              </Button>
            </div>
          </div>
        </DialogHeader>

        <div className="flex-1 flex min-h-0">
          <div className={cn("flex flex-col min-h-0", showPreview ? "w-1/2 border-r border-border" : "w-full")}>
            <div className="flex-none px-3 py-1.5 border-b border-border bg-muted/20">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Markdown
              </span>
            </div>
            <textarea
              ref={textareaRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={handleTabKey}
              className="flex-1 w-full resize-none bg-background p-4 font-mono text-sm outline-none"
              spellCheck={false}
              data-testid="textarea-markdown-editor"
            />
          </div>

          {showPreview && (
            <div className="flex w-1/2 flex-col min-h-0">
              <div className="flex-none px-3 py-1.5 border-b border-border bg-muted/20">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Preview
                </span>
              </div>
              <ScrollArea className="flex-1">
                <div className="p-6 prose-preview">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {draft}
                  </ReactMarkdown>
                </div>
              </ScrollArea>
            </div>
          )}
        </div>

        <DialogFooter className="flex-none border-t border-border px-4 py-3">
          <div className="flex w-full items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              Press Ctrl+S to save, Esc to cancel
            </p>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleCancel}
                data-testid="button-markdown-cancel"
              >
                <X className="mr-1.5 h-3.5 w-3.5" />
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={handleSave}
                data-testid="button-markdown-save"
              >
                <Save className="mr-1.5 h-3.5 w-3.5" />
                Save
              </Button>
            </div>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
