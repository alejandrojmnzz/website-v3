import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

export function RuntimeIssueIngestionFiltersDialog({
  open,
  onOpenChange,
  dropScrapers,
  dropScrapersPending,
  onDropScrapersChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dropScrapers: boolean;
  dropScrapersPending: boolean;
  onDropScrapersChange: (enabled: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto" data-testid="dialog-runtime-ingestion-filters">
        <DialogHeader>
          <DialogTitle>Ingestion Filters</DialogTitle>
          <DialogDescription>
            These skip future 404 digestion. They do not change public 404 HTML. Hide scrapers does not
            delete rows already in the log. Staff ignore rules are under Ignore rules next to Reset.
          </DialogDescription>
        </DialogHeader>
        <div className="rounded-md border p-3 space-y-2">
          <div className="flex items-center gap-2">
            <Switch
              id="drop-scrapers"
              checked={dropScrapers}
              disabled={dropScrapersPending}
              onCheckedChange={onDropScrapersChange}
              data-testid="toggle-hide-scrapers"
            />
            <Label htmlFor="drop-scrapers" className="text-sm">
              Hide scrapers
            </Label>
          </div>
          <p className="text-xs text-muted-foreground">
            When on (default), Ahrefs, curl, and similar clients are not recorded. Search crawlers and
            LLM crawlers still are. Turning this off starts recording those clients and adds 1 to the
            ingest badge; turning it on again does not wipe old rows.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
