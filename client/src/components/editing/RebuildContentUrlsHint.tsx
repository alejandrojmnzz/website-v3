import { useState } from "react";
import { ChevronDown, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiRequestWithAuth } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { applyRebuiltQueryToUrl } from "@/lib/staff404";

export function assignLocationWithRebuiltFlag(): void {
  window.location.assign(applyRebuiltQueryToUrl(window.location.href));
}

export function useRebuildContentUrls() {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);

  const rebuild = async () => {
    setBusy(true);
    try {
      const res = await apiRequestWithAuth("POST", "/api/content/refresh-cache", {});
      const data = (await res.json()) as { ok?: boolean; knownUrlCount?: number };
      toast({
        title: "URLs rebuilt",
        description:
          typeof data.knownUrlCount === "number"
            ? `Known URL index now has ${data.knownUrlCount} entries. Reloading…`
            : "Sitemap cache cleared. Reloading…",
      });
      assignLocationWithRebuiltFlag();
    } catch (err) {
      toast({
        title: "Rebuild failed",
        description: err instanceof Error ? err.message : "Could not rebuild URLs",
        variant: "destructive",
      });
      setBusy(false);
    }
  };

  return { busy, rebuild };
}

export function RebuildUrlsAdvancedDetails() {
  const [showAdvanced, setShowAdvanced] = useState(false);

  return (
    <div className="mt-3">
      <button
        type="button"
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        onClick={() => setShowAdvanced((v) => !v)}
        data-testid="button-rebuild-urls-advanced"
      >
        {showAdvanced ? "Hide advanced details" : "Read more (advanced)"}
        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showAdvanced ? "rotate-180" : ""}`} />
      </button>
      {showAdvanced && (
        <div className="mt-2 rounded-md border border-border bg-muted/40 p-3 space-y-2 text-xs text-muted-foreground">
          <p className="font-medium text-foreground">How URLs are rebuilt</p>
          <ol className="list-decimal pl-5 space-y-1.5">
            <li>
              <code className="text-[11px] font-mono">POST /api/content/refresh-cache</code> calls{" "}
              <code className="text-[11px] font-mono">contentIndex.refresh()</code> →{" "}
              <code className="text-[11px] font-mono">scan()</code> →{" "}
              <code className="text-[11px] font-mono">scanFast()</code> in{" "}
              <code className="text-[11px] font-mono">server/content-index.ts</code>.
            </li>
            <li>
              YAML types: walk each content folder on disk and re-register entries by slug (landings,
              pages, attached blog posts, …).
            </li>
            <li>
              Database types: read the current SQLite mapped snapshot (
              <code className="text-[11px] font-mono">getMappedItems</code>
              ). For each row, fill that type’s <code className="text-[11px] font-mono">url_pattern</code>{" "}
              from <code className="text-[11px] font-mono">content-types.yml</code> and store the result in{" "}
              <code className="text-[11px] font-mono">byUrl</code>. The row’s{" "}
              <code className="text-[11px] font-mono">language</code> /{" "}
              <code className="text-[11px] font-mono">lang</code> /{" "}
              <code className="text-[11px] font-mono">locale</code> must match the pattern locale (
              <code className="text-[11px] font-mono">en</code> or{" "}
              <code className="text-[11px] font-mono">es</code>) or that URL is skipped.
            </li>
            <li>
              <code className="text-[11px] font-mono">clearSitemapCache()</code> in{" "}
              <code className="text-[11px] font-mono">server/sitemap.ts</code> drops the cached sitemap so
              the next build uses the new index.
            </li>
            <li>
              This page reloads so <code className="text-[11px] font-mono">isKnownUrl</code> and content
              loaders see the new map. Redirect fallback only runs when the path is still unknown.
            </li>
          </ol>
          <p>
            Non-effects: does not call the remote database API, does not change{" "}
            <code className="text-[11px] font-mono">custom-redirects.yml</code>, does not publish drafts.
            If the row is missing from SQLite, rebuild still will not know its URL — refetch the
            database first (Clear Cache on the content type).
          </p>
        </div>
      )}
    </div>
  );
}

/** Standalone card kept for any remaining call sites; prefer Staff404Layout. */
export default function RebuildContentUrlsHint() {
  const { busy, rebuild } = useRebuildContentUrls();

  return (
    <div
      className="rounded-md border border-border bg-card p-4 text-left"
      data-testid="rebuild-content-urls-hint"
    >
      <p className="text-sm text-muted-foreground mb-3">
        If you think this is a mistake, you can rebuild the sitemap and content URLs. Rebuild
        rescans the local snapshot and clears the sitemap cache. It does not fetch the remote
        database.
      </p>
      <Button
        type="button"
        onClick={() => void rebuild()}
        disabled={busy}
        data-testid="button-rebuild-urls"
      >
        {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
        Rebuild URLs
      </Button>
      <RebuildUrlsAdvancedDetails />
    </div>
  );
}
