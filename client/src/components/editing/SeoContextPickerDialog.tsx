import { useEffect, useState } from "react";
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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown, Info } from "lucide-react";

export type SeoContextChoice =
  | { type: "live" }
  | { type: "variant"; variant: string };

interface ContextsResponse {
  contexts: SeoContextChoice[];
  default: SeoContextChoice | null;
}

export interface SeoContextPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contentType: string;
  slug: string;
  locale: string;
  onConfirm: (choice: SeoContextChoice) => void;
}

function choiceKey(c: SeoContextChoice): string {
  return c.type === "live" ? "live" : `variant:${c.variant}`;
}

function parseChoiceKey(key: string): SeoContextChoice {
  if (key === "live") return { type: "live" };
  return { type: "variant", variant: key.replace(/^variant:/, "") };
}

const INHERITANCE_BLURB =
  "Variant fields override LIVE. If a variant does not define a field, LIVE is used. Saving in a variant only changes that variant. Landing locations live in common (all variants). If you edit redirects on this variant, they apply only to this variant and you lose inherited LIVE redirects — edit LIVE if you want redirects for all.";

/**
 * Ask which SEO context to edit when an entry has LIVE and/or multiple variants.
 * Call {@link resolveSeoContexts} first; only open this dialog when contexts.length > 1.
 */
export async function resolveSeoContexts(
  contentType: string,
  slug: string,
  locale: string,
): Promise<ContextsResponse> {
  const res = await fetch(
    `/api/seo-preview/${encodeURIComponent(contentType)}/${encodeURIComponent(slug)}/contexts?locale=${encodeURIComponent(locale)}`,
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || "Failed to load SEO contexts");
  }
  return res.json();
}

export function SeoContextPickerDialog({
  open,
  onOpenChange,
  contentType,
  slug,
  locale,
  onConfirm,
}: SeoContextPickerDialogProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [contexts, setContexts] = useState<SeoContextChoice[]>([]);
  const [selected, setSelected] = useState<string>("live");
  const [advancedOpen, setAdvancedOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await resolveSeoContexts(contentType, slug, locale);
        if (cancelled) return;
        setContexts(data.contexts);
        const def = data.default ?? data.contexts[0];
        if (def) setSelected(choiceKey(def));
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load contexts");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, contentType, slug, locale]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" data-testid="dialog-seo-context-picker">
        <DialogHeader>
          <DialogTitle>Edit SEO — choose context</DialogTitle>
          <DialogDescription>
            {slug} · {locale.toUpperCase()}
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground flex gap-2">
          <Info className="h-4 w-4 shrink-0 mt-0.5" />
          <p>{INHERITANCE_BLURB}</p>
        </div>

        {loading ? (
          <p className="text-sm text-muted-foreground py-4">Loading contexts…</p>
        ) : error ? (
          <p className="text-sm text-destructive py-4">{error}</p>
        ) : (
          <RadioGroup
            value={selected}
            onValueChange={setSelected}
            className="space-y-2"
            data-testid="radio-seo-context"
          >
            {contexts.map((c) => {
              const key = choiceKey(c);
              const label =
                c.type === "live"
                  ? "LIVE (published locale file)"
                  : `Variant: ${c.variant}`;
              return (
                <div key={key} className="flex items-center space-x-2">
                  <RadioGroupItem value={key} id={`seo-ctx-${key}`} />
                  <Label htmlFor={`seo-ctx-${key}`} className="font-normal cursor-pointer">
                    {label}
                  </Label>
                </div>
              );
            })}
          </RadioGroup>
        )}

        <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
          <CollapsibleTrigger className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${advancedOpen ? "rotate-180" : ""}`} />
            Read more (advanced)
          </CollapsibleTrigger>
          <CollapsibleContent className="text-xs text-muted-foreground mt-2 space-y-1 font-mono">
            <p>server/routes/seo.ts — preview merge (common → live → variant)</p>
            <p>server/draft-entry.ts — draft write gate</p>
            <p>server/routes/versioning.ts — promote to live</p>
            <p>update-locations → _common.yml</p>
          </CollapsibleContent>
        </Collapsible>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={loading || !!error || contexts.length === 0}
            onClick={() => onConfirm(parseChoiceKey(selected))}
            data-testid="button-seo-context-confirm"
          >
            Continue
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
