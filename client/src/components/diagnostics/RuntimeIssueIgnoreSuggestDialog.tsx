import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { apiFetch } from "@/lib/queryClient";
import type { IgnoreRuleInput } from "@shared/runtime-issues-ignore";

interface SuggestOption {
  key: string;
  label: string;
  source: "heuristic" | "llm";
  rules: IgnoreRuleInput[];
  preview: string;
  matchCount: number;
  samplePaths: string[];
}

interface SuggestResponse {
  suggestions: SuggestOption[];
  llmFailed?: boolean;
  seedPaths: string[];
}

export function RuntimeIssueIgnoreSuggestDialog({
  open,
  fingerprints,
  pending,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  fingerprints: string[];
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (rules: IgnoreRuleInput[], seedPaths: string[]) => void;
}) {
  const [selected, setSelected] = useState<string>("");
  const [expanded, setExpanded] = useState<string | null>(null);

  const query = useQuery<SuggestResponse>({
    queryKey: ["/api/admin/runtime-issues/ignore-suggest", fingerprints],
    enabled: open && fingerprints.length > 0,
    queryFn: async () => {
      const res = await apiFetch("/api/admin/runtime-issues/ignore-suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fingerprints }),
      });
      if (!res.ok) throw new Error("Failed to suggest ignore templates");
      return res.json();
    },
  });

  const suggestions = query.data?.suggestions ?? [];
  const seedPaths = query.data?.seedPaths ?? [];

  useEffect(() => {
    if (!open) {
      setSelected("");
      setExpanded(null);
      return;
    }
    if (suggestions[0]?.key) setSelected(suggestions[0].key);
  }, [open, suggestions[0]?.key]);

  const selectedSuggestion = suggestions.find((s) => s.key === selected);

  function confirm() {
    if (!selectedSuggestion) return;
    onConfirm(selectedSuggestion.rules, seedPaths);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto max-w-xl" data-testid="dialog-runtime-ignore-suggest">
        <DialogHeader>
          <DialogTitle>Ignore from 404 log</DialogTitle>
          <DialogDescription>
            This is not a redirect. Matching rows leave the table, and future hits for the template are not
            recorded.
          </DialogDescription>
        </DialogHeader>
        {query.isLoading ? (
          <p className="text-sm text-muted-foreground" data-testid="ignore-suggest-loading">
            Loading suggestions…
          </p>
        ) : query.isError ? (
          <p className="text-sm text-destructive">
            {query.error instanceof Error ? query.error.message : "Failed to suggest"}
          </p>
        ) : (
          <RadioGroup value={selected} onValueChange={setSelected} className="space-y-2">
            {suggestions.map((s) => (
              <SuggestionRow
                key={s.key}
                value={s.key}
                label={`${s.label}${s.source === "llm" ? " (suggested)" : ""}`}
                preview={s.preview}
                matchCount={s.matchCount}
                samplePaths={s.samplePaths}
                expanded={expanded === s.key}
                onToggleExpand={() => setExpanded((v) => (v === s.key ? null : s.key))}
              />
            ))}
            {query.isFetching && !query.isLoading ? (
              <p className="text-xs text-muted-foreground">Loading more suggestions…</p>
            ) : null}
            {query.data?.llmFailed ? (
              <p className="text-xs text-muted-foreground">AI suggestions unavailable — exact path still works.</p>
            ) : null}
          </RadioGroup>
        )}
        <DialogFooter>
          <Button
            type="button"
            disabled={pending || query.isLoading || !selectedSuggestion}
            onClick={confirm}
            data-testid="button-confirm-ignore"
          >
            Ignore matching 404s
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SuggestionRow({
  value,
  label,
  preview,
  matchCount,
  samplePaths,
  expanded,
  onToggleExpand,
}: {
  value: string;
  label: string;
  preview: string;
  matchCount: number;
  samplePaths: string[];
  expanded: boolean;
  onToggleExpand: () => void;
}) {
  const id = `ignore-opt-${value.slice(0, 32)}`;
  return (
    <div className="rounded-md border p-3 space-y-1">
      <div className="flex items-start gap-2">
        <RadioGroupItem value={value} id={id} className="mt-0.5" />
        <div className="min-w-0 flex-1">
          <Label htmlFor={id} className="text-sm">
            {label}
          </Label>
          <p className="font-mono text-xs break-all text-muted-foreground whitespace-pre-wrap">{preview}</p>
          <p className="text-xs text-muted-foreground">{matchCount} current 404s</p>
          {samplePaths.length > 0 ? (
            <button type="button" className="text-xs text-primary hover:underline" onClick={onToggleExpand}>
              {expanded ? "Hide samples" : "Show samples"}
            </button>
          ) : null}
          {expanded ? (
            <ul className="mt-1 text-xs font-mono text-muted-foreground space-y-0.5">
              {samplePaths.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
    </div>
  );
}
