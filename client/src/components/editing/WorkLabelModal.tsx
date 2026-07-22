import { useEffect, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Loader2, Pencil, Trash2, User, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card } from "@/components/ui/card";
import { getDebugToken } from "@/hooks/useDebugAuth";
import { getSessionHeaders } from "@/lib/sessionHeaders";

/**
 * Section work-label payload stored as `_label` on YAML sections.
 * `requester` / `owner` are staff ids (or special ids like "system" / "mcp").
 */
export interface WorkLabel {
  needs: string;
  note: string;
  /** Staff id (or system/mcp) of who assigned / last wrote the note. */
  requester?: string;
  /** Staff id of who must complete the work; null/omit = unassigned. */
  owner?: string | null;
}

export interface StaffDirectoryEntry {
  id: string;
  username: string;
  displayName: string;
}

export interface WorkLabelKindConfig {
  needs: string;
  label: string;
  title: string;
  description: string;
}

export const WORK_LABEL_KINDS: Record<string, WorkLabelKindConfig> = {
  edit: {
    needs: "edit",
    label: "edit",
    title: "Needs edit",
    description:
      "This section still needs localized or adapted copy. It stays hidden from the public until the label is removed.",
  },
  review: {
    needs: "review",
    label: "review",
    title: "Needs review",
    description:
      "This section needs a human review (for example after a shared-layout align). Clear the label when review is done.",
  },
};

const UNASSIGNED = "__unassigned__";

/** Coerce legacy `{ kind, id }` objects or plain strings into a staff/special id. */
export function coerceWorkLabelActorId(value: unknown): string | undefined {
  if (value == null || value === "") return undefined;
  if (typeof value === "string") {
    const id = value.trim();
    return id || undefined;
  }
  if (typeof value === "object" && value !== null) {
    const id = (value as { id?: unknown }).id;
    if (typeof id === "string" && id.trim()) return id.trim();
  }
  return undefined;
}

export function normalizeWorkLabel(raw: {
  needs?: string;
  note?: string;
  requester?: unknown;
  owner?: unknown;
}): WorkLabel | null {
  if (!raw?.needs) return null;
  const ownerRaw = raw.owner;
  return {
    needs: raw.needs,
    note: raw.note ?? "",
    requester: coerceWorkLabelActorId(raw.requester),
    owner:
      ownerRaw === null
        ? null
        : ownerRaw === undefined
          ? undefined
          : coerceWorkLabelActorId(ownerRaw) ?? null,
  };
}

function specialActorLabel(id: string): string | null {
  if (id === "system") return "System";
  if (id === "mcp" || id.startsWith("mcp:") || /\[MCP\]/i.test(id)) return "Agent";
  return null;
}

function resolveActorDisplayName(
  id: string | undefined,
  staff: StaffDirectoryEntry[],
): string {
  if (!id) return "Unknown";
  const special = specialActorLabel(id);
  if (special) return special;
  const found = staff.find((s) => s.id === id);
  if (found) return found.displayName;
  return id;
}

async function fetchStaffDirectory(): Promise<StaffDirectoryEntry[]> {
  const token = getDebugToken();
  const headers: Record<string, string> = {
    ...getSessionHeaders(),
  };
  if (token) {
    headers.Authorization = `Token ${token}`;
    headers["X-Debug-Token"] = token;
  }
  const res = await fetch("/api/staff", { headers });
  if (!res.ok) {
    throw new Error(`Failed to load staff (${res.status})`);
  }
  const data = await res.json();
  return Array.isArray(data?.staff) ? (data.staff as StaffDirectoryEntry[]) : [];
}

export interface WorkLabelModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  label: WorkLabel;
  kinds?: Record<string, WorkLabelKindConfig>;
  description?: string;
  /** Current editor's staff id — used as requester when the note is updated. */
  currentStaffId?: string;
  onSave: (next: WorkLabel) => Promise<void> | void;
  onRemove: () => Promise<void> | void;
  testIdPrefix?: string;
}

export function WorkLabelModal({
  open,
  onOpenChange,
  label,
  kinds = WORK_LABEL_KINDS,
  description,
  currentStaffId,
  onSave,
  onRemove,
  testIdPrefix = "work-label",
}: WorkLabelModalProps) {
  const [needs, setNeeds] = useState(label.needs);
  const [note, setNote] = useState(label.note ?? "");
  const [requesterId, setRequesterId] = useState(label.requester ?? UNASSIGNED);
  const [ownerId, setOwnerId] = useState(label.owner ?? UNASSIGNED);
  const [editingRequester, setEditingRequester] = useState(false);
  const [editingOwner, setEditingOwner] = useState(false);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: staff = [], isLoading: staffLoading, isError: staffError } = useQuery({
    queryKey: ["/api/staff"],
    queryFn: fetchStaffDirectory,
    enabled: open,
    staleTime: 60_000,
    retry: 1,
  });

  useEffect(() => {
    if (!open) return;
    setNeeds(label.needs);
    setNote(label.note ?? "");
    setRequesterId(label.requester ?? UNASSIGNED);
    setOwnerId(label.owner ?? UNASSIGNED);
    setEditingRequester(false);
    setEditingOwner(false);
    setError(null);
    setSaving(false);
    setRemoving(false);
  }, [open, label.needs, label.note, label.requester, label.owner]);

  const kindOptions = Object.values(kinds);
  const activeKind = kinds[needs];
  const title = activeKind?.title ?? `Needs ${needs}`;
  const bodyDescription =
    description ??
    activeKind?.description ??
    "Staff-only work label on this section. Update the note or clear the label when finished.";

  const noteTrimmed = note.trim();
  const nextRequester =
    requesterId === UNASSIGNED ? undefined : requesterId;
  const nextOwner = ownerId === UNASSIGNED ? null : ownerId;
  const requesterDirty = (label.requester ?? null) !== (nextRequester ?? null);
  const ownerDirty = (label.owner ?? null) !== nextOwner;
  const dirty =
    needs !== label.needs ||
    noteTrimmed !== (label.note ?? "").trim() ||
    requesterDirty ||
    ownerDirty;
  // Enable whenever something changed; note emptiness is validated on save.
  const canSave = dirty && !saving && !removing;

  const staffOptions = [...staff];
  for (const id of [label.requester, label.owner, nextRequester, nextOwner]) {
    if (
      id &&
      id !== UNASSIGNED &&
      !staffOptions.some((s) => s.id === id) &&
      !specialActorLabel(id)
    ) {
      staffOptions.unshift({ id, username: id, displayName: id });
    }
  }

  const requesterName = resolveActorDisplayName(
    nextRequester ?? label.requester,
    staffOptions,
  );
  const ownerName =
    nextOwner == null
      ? "Unassigned"
      : resolveActorDisplayName(nextOwner, staffOptions);

  const handleSave = async () => {
    if (!noteTrimmed) {
      setError("A note is required.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const noteChanged = noteTrimmed !== (label.note ?? "").trim();
      const requester =
        nextRequester ||
        (noteChanged && currentStaffId ? currentStaffId : undefined) ||
        label.requester ||
        currentStaffId ||
        "system";

      const next: WorkLabel = {
        needs,
        note: noteTrimmed,
        requester,
        owner: nextOwner,
      };
      await onSave(next);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save label");
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async () => {
    setRemoving(true);
    setError(null);
    try {
      await onRemove();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove label");
    } finally {
      setRemoving(false);
    }
  };

  const actorSelect = (
    value: string,
    onChange: (v: string) => void,
    testId: string,
    allowUnassigned: boolean,
  ) => (
    <Select
      value={value}
      onValueChange={(v) => {
        onChange(v);
      }}
      disabled={saving || removing || staffLoading}
    >
      <SelectTrigger className="h-8 text-xs" data-testid={testId}>
        <SelectValue
          placeholder={
            staffLoading ? "Loading staff…" : allowUnassigned ? "Unassigned" : "Select"
          }
        />
      </SelectTrigger>
      <SelectContent>
        {allowUnassigned ? (
          <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
        ) : (
          <SelectItem value="system">System</SelectItem>
        )}
        {staffOptions.map((s) => (
          <SelectItem key={s.id} value={s.id}>
            {s.displayName}
          </SelectItem>
        ))}
        {!staffLoading && staffOptions.length === 0 ? (
          <SelectItem value="__none__" disabled>
            {staffError ? "Failed to load staff" : "No staff members yet"}
          </SelectItem>
        ) : null}
      </SelectContent>
    </Select>
  );

  const personCard = (
    titleText: string,
    name: string,
    subtitle: string | undefined,
    editing: boolean,
    setEditing: (v: boolean) => void,
    select: ReactNode,
    testId: string,
  ) => (
    <Card className="shadow-none" data-testid={`${testId}-card`}>
      <div className="flex items-center gap-1.5 px-2 py-1.5">
        {editing ? (
          <div className="min-w-0 flex-1">{select}</div>
        ) : (
          <div className="flex min-w-0 flex-1 items-center gap-1.5">
            <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted">
              <User className="h-3 w-3 text-muted-foreground" />
            </div>
            <div className="min-w-0 leading-none">
              <p className="text-[10px] text-muted-foreground">{titleText}</p>
              <p
                className="text-xs font-medium text-foreground truncate"
                data-testid={testId}
              >
                {name}
              </p>
              {subtitle ? (
                <p className="text-[10px] text-muted-foreground truncate">{subtitle}</p>
              ) : null}
            </div>
          </div>
        )}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-5 w-5 shrink-0 text-muted-foreground"
          disabled={saving || removing}
          onClick={() => setEditing(!editing)}
          data-testid={`${testId}-edit`}
          title={editing ? "Done" : "Edit"}
        >
          {editing ? <X className="h-3 w-3" /> : <Pencil className="h-3 w-3" />}
        </Button>
      </div>
    </Card>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" data-testid={`modal-${testIdPrefix}`}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-rose-500 shrink-0" />
            {title}
          </DialogTitle>
          <DialogDescription>{bodyDescription}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {personCard(
              "Assigned by",
              requesterName,
              nextRequester && !specialActorLabel(nextRequester) ? nextRequester : undefined,
              editingRequester,
              setEditingRequester,
              actorSelect(
                requesterId === UNASSIGNED
                  ? currentStaffId || "system"
                  : requesterId,
                (v) => {
                  setRequesterId(v);
                  setEditingRequester(false);
                },
                `${testIdPrefix}-requester-select`,
                false,
              ),
              `${testIdPrefix}-requester`,
            )}
            {personCard(
              "Assigned to",
              ownerName,
              nextOwner && !specialActorLabel(nextOwner) ? nextOwner : undefined,
              editingOwner,
              setEditingOwner,
              actorSelect(
                ownerId,
                (v) => {
                  setOwnerId(v);
                  setEditingOwner(false);
                },
                `${testIdPrefix}-owner`,
                true,
              ),
              `${testIdPrefix}-owner`,
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor={`${testIdPrefix}-needs`}>Label</Label>
            <Select value={needs} onValueChange={setNeeds} disabled={saving || removing}>
              <SelectTrigger id={`${testIdPrefix}-needs`} data-testid={`${testIdPrefix}-needs`}>
                <SelectValue placeholder="Select label" />
              </SelectTrigger>
              <SelectContent>
                {kindOptions.map((k) => (
                  <SelectItem key={k.needs} value={k.needs}>
                    Needs {k.label}
                  </SelectItem>
                ))}
                {!kinds[needs] && needs ? (
                  <SelectItem value={needs}>Needs {needs}</SelectItem>
                ) : null}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor={`${testIdPrefix}-note`}>Note</Label>
            <Textarea
              id={`${testIdPrefix}-note`}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Explain why this section needs work…"
              rows={4}
              disabled={saving || removing}
              data-testid={`${testIdPrefix}-note`}
            />
          </div>

          {error ? (
            <p className="text-sm text-destructive" data-testid={`${testIdPrefix}-error`}>
              {error}
            </p>
          ) : null}
        </div>

        <DialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:justify-between sm:space-x-0">
          <Button
            type="button"
            variant="outline"
            className="gap-1.5 text-destructive hover:text-destructive"
            onClick={handleRemove}
            disabled={saving || removing}
            data-testid={`${testIdPrefix}-remove`}
          >
            {removing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4" />
            )}
            Remove label
          </Button>
          <div className="flex gap-2 w-full sm:w-auto">
            <Button
              type="button"
              variant="ghost"
              className="flex-1 sm:flex-initial"
              onClick={() => onOpenChange(false)}
              disabled={saving || removing}
              data-testid={`${testIdPrefix}-cancel`}
            >
              Cancel
            </Button>
            <Button
              type="button"
              className="flex-1 sm:flex-initial gap-1.5"
              onClick={handleSave}
              disabled={!canSave}
              data-testid={`${testIdPrefix}-save`}
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Save
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
