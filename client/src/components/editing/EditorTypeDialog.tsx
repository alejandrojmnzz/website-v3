import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, Check, ChevronDown, ChevronRight, Info, Plus, X } from "lucide-react";
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { collectEditorFieldTokens } from "@shared/editor-field-values";

export type EditorHint = {
  type?: string;
  options?: (string | { value: string; label: string })[];
  populate_options?: boolean;
  allow_custom_values?: boolean;
  /** Split comma-separated strings into tokens. Arrays always expand. */
  split_comma_values?: boolean;
  cache_images?: boolean;
  description?: string;
};

export type EditorTypeDialogProps = {
  open: boolean;
  fieldName: string | null;
  initialHint?: EditorHint;
  /** When true, type select is locked to image (DB image-cache mode). */
  lockImageType?: boolean;
  /**
   * Mapped items (same shape the item editor uses) for the populate/CSV preview.
   * Pass post–field_mapping rows keyed by editor field names.
   */
  existingItems?: Record<string, unknown>[];
  /** True while parent is still loading sample/items for the preview. */
  existingItemsLoading?: boolean;
  onClose: () => void;
  onApply: (hint: EditorHint) => void;
};

const PREVIEW_CAP = 20;

function CheckboxInfoPopover({
  testId,
  children,
}: {
  testId: string;
  children: ReactNode;
}) {
  return (
    <Popover modal={false}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="More information"
          data-testid={testId}
          onClick={(e) => e.stopPropagation()}
        >
          <Info className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-80 space-y-2 text-sm text-muted-foreground z-[10001] pointer-events-auto"
        side="top"
        align="start"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        {children}
      </PopoverContent>
    </Popover>
  );
}

export function EditorTypeDialog({
  open,
  fieldName,
  initialHint,
  lockImageType = false,
  existingItems,
  existingItemsLoading = false,
  onClose,
  onApply,
}: EditorTypeDialogProps) {
  const [type, setType] = useState("text");
  const [options, setOptions] = useState<{ value: string; label: string }[]>([]);
  const [newOption, setNewOption] = useState("");
  const [populateOptions, setPopulateOptions] = useState(false);
  const [allowCustom, setAllowCustom] = useState(false);
  const [splitComma, setSplitComma] = useState(false);
  const [description, setDescription] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);

  useEffect(() => {
    if (!open) return;
    const hint = initialHint || {};
    setType(lockImageType || hint.cache_images ? "image" : hint.type || "text");
    setOptions(
      (hint.options || []).map((opt) =>
        typeof opt === "string"
          ? { value: opt, label: "" }
          : { value: opt.value, label: opt.label ?? "" },
      ),
    );
    setNewOption("");
    setPopulateOptions(hint.populate_options ?? false);
    setAllowCustom(hint.allow_custom_values ?? false);
    setSplitComma(hint.split_comma_values ?? false);
    setDescription(hint.description || "");
    setShowAdvanced(false);
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
        hint.options = options.map((o) =>
          (o.label ?? "").trim() ? { value: o.value, label: o.label } : o.value,
        );
      }
      if (populateOptions) hint.populate_options = true;
      if (allowCustom) hint.allow_custom_values = true;
      if (splitComma) hint.split_comma_values = true;
    }
    if (initialHint?.cache_images) hint.cache_images = true;
    onApply(hint);
  };

  const manualValueSet = useMemo(
    () => new Set(options.map((o) => o.value)),
    [options],
  );

  const previewTokens = useMemo(() => {
    if (!populateOptions || !fieldName || !existingItems) return [];
    return collectEditorFieldTokens(existingItems, fieldName, {
      splitComma,
    }).filter((t) => !manualValueSet.has(t));
  }, [populateOptions, fieldName, existingItems, splitComma, manualValueSet]);

  const previewVisible = previewTokens.slice(0, PREVIEW_CAP);
  const previewMore = Math.max(0, previewTokens.length - PREVIEW_CAP);
  const hasItemsProp = existingItems !== undefined;
  const itemsLoaded = hasItemsProp && !existingItemsLoading;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      {/* Nested above Field Mapping / DB config dialogs (both use z-[10000]). */}
      <DialogContent
        className="z-[10002] max-w-md max-h-[90vh] flex flex-col gap-4 overflow-hidden p-6"
        overlayClassName="z-[10002]"
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >        <DialogHeader className="shrink-0">
          <DialogTitle>Editor Type for "{fieldName}"</DialogTitle>
          <DialogDescription>
            Choose how this field renders in the item editor.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2 min-h-0 flex-1 overflow-y-auto">
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
              <div className="flex items-center gap-1.5">
                <Label className="text-xs">Options</Label>
                <CheckboxInfoPopover testId="info-hint-options">
                  <p>
                    Manual options are the curated list shown in the item editor.
                    They are saved on this field&apos;s editor config.
                  </p>
                  <p>
                    Values discovered from existing data (when enabled below) are
                    merged at edit time and are <strong className="text-foreground">not</strong> written
                    into this list when you Apply.
                  </p>
                </CheckboxInfoPopover>
              </div>
              <p className="text-[11px] text-muted-foreground leading-relaxed" data-testid="text-hint-how-it-works">
                Curate options below. Arrays in existing data already expand into
                distinct choices when you include values from data. Comma-separated
                strings need the CSV checkbox. Use &quot;Allow custom values&quot; for
                free-text entries not in the list.
              </p>
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
                <span className="text-xs text-muted-foreground flex-1">
                  Also include values from existing data
                </span>
                <CheckboxInfoPopover testId="info-populate-options">
                  <p>
                    Scans loaded items for this field and unions distinct string
                    tokens into the editor option list at edit time (not saved into
                    Options above).
                  </p>
                  <p>
                    Arrays always expand (each element becomes a token). Without the
                    CSV checkbox, a whole string like{" "}
                    <code className="text-foreground">python, javascript</code> is
                    one option.
                  </p>
                  <p>
                    Enabling this does not by itself allow free-text entry — use
                    &quot;Allow custom values&quot; for that. (Older configs that
                    only set populate may still allow custom add as a legacy fallback.)
                  </p>
                </CheckboxInfoPopover>
              </label>

              {populateOptions && (
                <div className="space-y-1.5" data-testid="preview-from-existing-data">
                  <p className="text-[11px] font-medium text-muted-foreground">
                    From existing data (preview)
                  </p>
                  {existingItemsLoading && (
                    <p className="text-xs text-muted-foreground">Loading sample values…</p>
                  )}
                  {!existingItemsLoading && !hasItemsProp && (
                    <p className="text-xs text-muted-foreground">
                      Sample data not loaded. Preview appears when items are available;
                      populate still works in the item editor once entries exist.
                    </p>
                  )}
                  {itemsLoaded && previewTokens.length === 0 && (
                    <p className="text-xs text-muted-foreground">
                      No values found in existing data yet
                      {manualValueSet.size > 0 ? " (beyond your manual options)" : ""}.
                    </p>
                  )}
                  {itemsLoaded && previewVisible.length > 0 && (
                    <>
                      <p className="text-[10px] text-muted-foreground">
                        Preview from loaded data ({previewTokens.length} unique
                        {previewMore > 0 ? `, showing ${PREVIEW_CAP}` : ""}). Not
                        saved into Options on Apply.
                      </p>
                      <div className="border border-dashed rounded-md divide-y max-h-40 overflow-y-auto bg-muted/30">
                        {previewVisible.map((token) => (
                          <div
                            key={token}
                            className="px-3 py-1.5 text-xs font-mono text-muted-foreground truncate"
                            data-testid={`preview-token-${token}`}
                          >
                            {token}
                          </div>
                        ))}
                      </div>
                      {previewMore > 0 && (
                        <p className="text-[10px] text-muted-foreground">
                          and {previewMore} more
                        </p>
                      )}
                    </>
                  )}
                </div>
              )}

              <label className="flex items-center gap-2 cursor-pointer" data-testid="label-split-comma">
                <input
                  type="checkbox"
                  checked={splitComma}
                  onChange={(e) => setSplitComma(e.target.checked)}
                  className="h-3.5 w-3.5 rounded"
                  data-testid="checkbox-split-comma"
                />
                <span className="text-xs text-muted-foreground flex-1">
                  Treat comma-separated strings as multiple values
                </span>
                <CheckboxInfoPopover testId="info-split-comma">
                  <p>
                    Splits string cells on{" "}
                    <code className="text-foreground">,</code> (trim each part).
                    Arrays always expand regardless of this flag.
                  </p>
                  <p>
                    With populate on, the preview above updates immediately. For{" "}
                    <strong className="text-foreground">tags</strong>, the current
                    field value is also parsed this way in the item editor. For{" "}
                    <strong className="text-foreground">select</strong>, only the
                    option list is affected — the stored single value is unchanged.
                  </p>
                  <p>
                    Saving a tags field may normalize a comma-separated string into
                    a string array.
                  </p>
                  <p>
                    Facets for this field follow the same flag after the next database
                    refresh.
                  </p>
                </CheckboxInfoPopover>
              </label>

              {splitComma && (
                <div
                  className="flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-2 text-[11px] text-amber-200/90"
                  data-testid="warning-split-comma"
                  role="status"
                >
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5 text-amber-400" />
                  <div className="space-y-1">
                    <p>
                      Values that legitimately contain commas (e.g.{" "}
                      <code className="text-amber-100">San Francisco, CA</code>) will
                      be split into separate tokens.
                    </p>
                    <p className="text-amber-200/70">
                      Agents: set <code className="text-amber-100">split_comma_values: true</code>{" "}
                      only when field values are delimiter lists, not prose with commas.
                    </p>
                  </div>
                </div>
              )}

              <label className="flex items-center gap-2 cursor-pointer" data-testid="label-allow-custom">
                <input
                  type="checkbox"
                  checked={allowCustom}
                  onChange={(e) => setAllowCustom(e.target.checked)}
                  className="h-3.5 w-3.5 rounded"
                  data-testid="checkbox-allow-custom"
                />
                <span className="text-xs text-muted-foreground flex-1">
                  Allow typing custom values (not in list)
                </span>
                <CheckboxInfoPopover testId="info-allow-custom">
                  <p>
                    Shows an add/free-text control in the item editor so staff can
                    enter values that are not in the manual or populated list.
                  </p>
                  <p>
                    Prefer enabling this explicitly. Populate alone is for discovering
                    options from data, not for free-text (legacy configs may still
                    fall back).
                  </p>
                </CheckboxInfoPopover>
              </label>

              <button
                type="button"
                className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground pt-1"
                onClick={() => setShowAdvanced((v) => !v)}
                data-testid="button-hint-advanced"
              >
                {showAdvanced ? (
                  <ChevronDown className="h-3 w-3" />
                ) : (
                  <ChevronRight className="h-3 w-3" />
                )}
                {showAdvanced ? "Hide advanced details" : "Read more (advanced)"}
              </button>
              {showAdvanced && (
                <div
                  className="rounded-md border bg-muted/40 px-3 py-2 text-[11px] text-muted-foreground space-y-1.5"
                  data-testid="hint-advanced-details"
                >
                  <p>
                    Runtime merge and tags parsing:{" "}
                    <code className="text-foreground">client/src/components/databases/ItemEditModal.tsx</code>
                  </p>
                  <p>
                    Token helper:{" "}
                    <code className="text-foreground">shared/editor-field-values.ts</code>
                  </p>
                  <p>
                    Facets (follow <code className="text-foreground">split_comma_values</code> after
                    DB refresh):{" "}
                    <code className="text-foreground">server/database.ts</code>
                  </p>
                  <p>
                    Config shape:{" "}
                    <code className="text-foreground">server/content-types.ts</code>{" "}
                    (<code className="text-foreground">ContentTypeEditorHint</code> / YAML{" "}
                    <code className="text-foreground">editor</code> header)
                  </p>
                  <p>
                    This dialog:{" "}
                    <code className="text-foreground">client/src/components/editing/EditorTypeDialog.tsx</code>
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
        <DialogFooter className="shrink-0 flex items-center justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onClose}
            data-testid="button-cancel-hint"
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              handleApply();
            }}
            data-testid="button-save-hint"
          >
            <Check className="h-3.5 w-3.5 mr-1" />
            Apply
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
