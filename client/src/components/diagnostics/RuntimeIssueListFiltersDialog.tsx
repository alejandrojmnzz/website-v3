import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { FILTER_ALL, SOURCE_FILTER_TAGS, deviceLabel, sourceLabel, type RuntimeIssueFilters } from "./runtime-issues-filters";

export function RuntimeIssueListFiltersDialog({
  open,
  onOpenChange,
  filters,
  locales,
  devices,
  onPatch,
  onClear,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filters: RuntimeIssueFilters;
  locales: string[];
  devices: string[];
  onPatch: (patch: Partial<RuntimeIssueFilters>) => void;
  onClear: () => void;
}) {
  const {
    pathQuery,
    referrerQuery,
    locale: localeFilter,
    device: deviceFilter,
    pagesOnly,
    windowDays,
    tz,
    source: sourceFilter,
  } = filters;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto" data-testid="dialog-runtime-list-filters">
        <DialogHeader>
          <DialogTitle>List filters</DialogTitle>
          <DialogDescription>
            These only change the table, CSV, and totals. They do not stop recording 404s.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex items-center gap-2" data-testid="toggle-pages-only">
            <Switch id="pages-only" checked={pagesOnly} onCheckedChange={(checked) => onPatch({ pagesOnly: checked })} />
            <Label htmlFor="pages-only" className="text-sm">
              Pages only
            </Label>
          </div>
          <p className="text-xs text-muted-foreground -mt-2">
            Hides file URLs (.js, images, and other assets), including Internal ones.
          </p>
          <div className="space-y-1">
            <Label htmlFor="runtime-path-filter" className="text-xs text-muted-foreground">
              Path
            </Label>
            <Input
              id="runtime-path-filter"
              value={pathQuery}
              onChange={(e) => onPatch({ pathQuery: e.target.value })}
              placeholder="Contains…"
              className="h-8 text-sm"
              data-testid="input-runtime-path-filter"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="runtime-window-filter" className="text-xs text-muted-foreground">
              Window ({tz})
            </Label>
            <Select value={String(windowDays)} onValueChange={(value) => onPatch({ windowDays: value === "7" ? 7 : 30 })}>
              <SelectTrigger id="runtime-window-filter" className="h-8 text-sm" data-testid="select-runtime-window-filter">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7">Last 7 days</SelectItem>
                <SelectItem value="30">Last 30 days</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="runtime-source-filter" className="text-xs text-muted-foreground">
              Source
            </Label>
            <Select value={sourceFilter} onValueChange={(source) => onPatch({ source })}>
              <SelectTrigger id="runtime-source-filter" className="h-8 text-sm" data-testid="select-runtime-source-filter">
                <SelectValue placeholder="All sources" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={FILTER_ALL}>All sources</SelectItem>
                {SOURCE_FILTER_TAGS.map((tag) => (
                  <SelectItem key={tag} value={tag} data-testid={`option-runtime-source-${tag}`}>
                    {sourceLabel(tag)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="runtime-referrer-filter" className="text-xs text-muted-foreground">
              Referrer
            </Label>
            <Input
              id="runtime-referrer-filter"
              value={referrerQuery}
              onChange={(e) => onPatch({ referrerQuery: e.target.value })}
              placeholder="Contains…"
              className="h-8 text-sm"
              data-testid="input-runtime-referrer-filter"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="runtime-locale-filter" className="text-xs text-muted-foreground">
              Locale
            </Label>
            <Select value={localeFilter} onValueChange={(locale) => onPatch({ locale })}>
              <SelectTrigger id="runtime-locale-filter" className="h-8 text-sm" data-testid="select-runtime-locale-filter">
                <SelectValue placeholder="All locales" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={FILTER_ALL}>All locales</SelectItem>
                {locales.map((locale) => (
                  <SelectItem key={locale} value={locale} data-testid={`option-runtime-locale-${locale}`}>
                    {locale}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="runtime-device-filter" className="text-xs text-muted-foreground">
              Device
            </Label>
            <Select value={deviceFilter} onValueChange={(device) => onPatch({ device })}>
              <SelectTrigger id="runtime-device-filter" className="h-8 text-sm" data-testid="select-runtime-device-filter">
                <SelectValue placeholder="All devices" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={FILTER_ALL}>All devices</SelectItem>
                {devices.map((device) => (
                  <SelectItem key={device} value={device} data-testid={`option-runtime-device-${device}`}>
                    {deviceLabel(device)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onClear} data-testid="button-clear-runtime-filters">
            Clear
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
