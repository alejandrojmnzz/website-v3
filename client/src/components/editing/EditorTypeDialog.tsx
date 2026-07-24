import { useEffect, useState } from "react";
import { Check, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type EditorHint = {
  type?: string;
  options?: (string | { value: string; label: string })[];
  populate_options?: boolean;
  allow_custom_values?: boolean;
  cache_images?: boolean;
  description?: string;
};

export type EditorTypeDialogProps = {
  open: boolean;
  fieldName: string | null;
  initialHint?: EditorHint;
  /** When true, type select is locked to image (DB image-cache mode). */
  lockImageType?: boolean;
  onClose: () => void;
  onApply: (hint: EditorHint) => void;
};

export function EditorTypeDialog({
  open,
  fieldName,
  initialHint,
  lockImageType = false,
  onClose,
  onApply,
}: EditorTypeDialogProps) {
  const [type, setType] = useState("text");
  const [options, setOptions] = useState<{ value: string; label: string }[]>([]);
  const [newOption, setNewOption] = useState("");
  const [populateOptions, setPopulateOptions] = useState(false);
  const [allowCustom, setAllowCustom] = useState(false);
  const [description, setDescription] = useState("");

  useEffect(() => {
    if (!open) return;
    const hint = initialHint || {};
    setType(lockImageType || hint.cache_images ? "image" : hint.type || "text");
    setOptions(
      (hint.options || []).map((opt) =>
        typeof opt === "string" ? { value: opt, label: "" } : opt,
      ),
    );
    setNewOption("");
    setPopulateOptions(hint.populate_options ?? false);
    setAllowCustom(hint.allow_custom_values ?? false);
    setDescription(hint.description || "");
  }, [open, fieldName, initialHint, lockImageType]);

  const addOptions = () => {
    const existingValues = new Set(options.map((o) => o.value));
    const newOpts = newOption
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && !existingValues.has(s))
      .map((v) => ({ value: v, label: "" }));
    if (newOpts.length === 0) return;
    setOptions((prev) => [...prev, ...newOpts]);
    setNewOption("");
  };

  const handleApply = () => {
    const resolvedType = lockImageType ? "image" : type;
    const hint: EditorHint = { type: resolvedType };
    if (description.trim()) hint.description = description.trim();
    if (resolvedType === "select" || resolvedType === "tags") {
      if (options.length > 0) {
        hint.options = options.map((o) => (o.label.trim() ? o : o.value));
      }
      if (populateOptions) hint.populate_options = true;
      if (allowCustom) hint.allow_custom_values = true;
    }
    if (initialHint?.cache_images) hint.cache_images = true;
    onApply(hint);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Editor Type for "{fieldName}"</DialogTitle>
          <DialogDescription>
            Choose how this field renders in the item editor.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label className="text-xs">Field type</Label>
            <Select
              value={lockImageType ? "image" : type}
              onValueChange={setType}
              disabled={lockImageType}
            >
              <SelectTrigger className="text-sm" data-testid="select-hint-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="text">text — single-line input</SelectItem>
                <SelectItem value="textarea">textarea — multi-line</SelectItem>
                <SelectItem value="markdown">markdown — editor with preview</SelectItem>
                <SelectItem value="number">number — numeric</SelectItem>
                <SelectItem value="boolean">boolean — toggle</SelectItem>
                <SelectItem value="date">date — date only</SelectItem>
                <SelectItem value="datetime">datetime — date + time (UTC or naive)</SelectItem>
                <SelectItem value="image">image — URL with preview + cache status</SelectItem>
                <SelectItem value="select">select — dropdown</SelectItem>
                <SelectItem value="tags">multi select — multi-value</SelectItem>
              </SelectContent>
            </Select>
            {lockImageType && (
              <p className="text-[11px] text-muted-foreground">
                Editor type is locked to image while image caching is enabled.
              </p>
            )}
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Description (shown as hint in editor)</Label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. Choose the programming language for this course"
              className="w-full text-sm px-3 py-1.5 rounded-md border bg-background focus:outline-none focus:ring-1 focus:ring-ring"
              data-testid="input-hint-description"
            />
          </div>
          {(type === "select" || type === "tags") && !lockImageType && (
            <div className="space-y-2">
              <Label className="text-xs">Options</Label>
              <div className="flex gap-2 items-start">
                <Textarea
                  value={newOption}
                  onChange={(e) => setNewOption(e.target.value)}
                  placeholder="One or more comma separated values. E.g: one, two, three"
                  className="text-sm flex-1 resize-none"
                  rows={2}
                  data-testid="textarea-hint-bulk-input"
                />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={addOptions}
                  disabled={!newOption.trim()}
                  data-testid="button-add-hint-options-bulk"
                >
                  <Plus className="h-3.5 w-3.5 mr-1" />
                  {newOption.split(",").filter((s) => s.trim().length > 0).length > 1
                    ? "Add multiple"
                    : "Add"}
                </Button>
              </div>
              {options.length > 0 && (
                <div className="border rounded-md divide-y max-h-48 overflow-y-auto">
                  {options.map((opt, idx) => (
                    <div key={idx} className="flex items-center gap-2 px-3 py-1.5 text-sm">
                      <span className="font-mono text-xs text-muted-foreground w-1/3 truncate flex-shrink-0">
                        {opt.value}
                      </span>
                      <input
                        type="text"
                        value={opt.label}
                        onChange={(e) => {
                          const updated = [...options];
                          updated[idx] = { ...opt, label: e.target.value };
                          setOptions(updated);
                        }}
                        placeholder="Label (optional)"
                        className="flex-1 text-xs px-2 py-0.5 rounded border bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                        data-testid={`input-hint-option-label-${idx}`}
                      />
                      <button
                        type="button"
                        onClick={() => setOptions((prev) => prev.filter((_, i) => i !== idx))}
                        className="ml-1 text-muted-foreground hover:text-destructive flex-shrink-0"
                        data-testid={`button-remove-hint-option-${idx}`}
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {options.length === 0 && (
                <p className="text-xs text-muted-foreground">No options added yet.</p>
              )}
              <label className="flex items-center gap-2 cursor-pointer pt-1" data-testid="label-populate-options">
                <input
                  type="checkbox"
                  checked={populateOptions}
                  onChange={(e) => setPopulateOptions(e.target.checked)}
                  className="h-3.5 w-3.5 rounded"
                  data-testid="checkbox-populate-options"
                />
                <span className="text-xs text-muted-foreground">
                  Also include values from existing data
                </span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer" data-testid="label-allow-custom">
                <input
                  type="checkbox"
                  checked={allowCustom}
                  onChange={(e) => setAllowCustom(e.target.checked)}
                  className="h-3.5 w-3.5 rounded"
                  data-testid="checkbox-allow-custom"
                />
                <span className="text-xs text-muted-foreground">
                  Allow typing custom values (not in list)
                </span>
              </label>
            </div>
          )}
        </div>
        <DialogFooter className="flex items-center justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose} data-testid="button-cancel-hint">
            Cancel
          </Button>
          <Button size="sm" onClick={handleApply} data-testid="button-save-hint">
            <Check className="h-3.5 w-3.5 mr-1" />
            Apply
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
