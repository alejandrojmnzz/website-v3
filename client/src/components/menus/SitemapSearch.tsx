import { useState, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, Link, ExternalLink, Check } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import {
  filterSitemapEntries,
  sitemapPathname,
  type SitemapSearchEntry,
} from "@/lib/sitemapSearch";

interface SitemapSearchProps {
  value: string;
  onChange: (value: string, isCustom: boolean) => void;
  placeholder?: string;
  testId?: string;
  locale?: string;
  portalContainer?: HTMLElement | null;
  /**
   * Render only the search panel (for nesting inside a parent Popover).
   * Calls onClose after a selection or custom save.
   */
  embedded?: boolean;
  onClose?: () => void;
}

export function SitemapSearch({
  value,
  onChange,
  placeholder = "/page-url",
  testId,
  locale = "",
  portalContainer,
  embedded = false,
  onClose,
}: SitemapSearchProps) {
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [isCustomMode, setIsCustomMode] = useState(false);
  const [customUrl, setCustomUrl] = useState(value);
  const [customError, setCustomError] = useState("");

  useEffect(() => {
    setCustomUrl(value);
  }, [value]);

  const { data: sitemapUrls = [], isLoading } = useQuery<SitemapSearchEntry[]>({
    queryKey: ["/api/sitemap-urls", locale],
    queryFn: async () => {
      const url = locale ? `/api/sitemap-urls?locale=${locale}` : "/api/sitemap-urls";
      const response = await fetch(url);
      if (!response.ok) throw new Error("Failed to load sitemap URLs");
      return response.json();
    },
  });

  const filteredUrls = useMemo(
    () => filterSitemapEntries(sitemapUrls, searchQuery),
    [sitemapUrls, searchQuery],
  );

  const isCurrentValueInSitemap = sitemapUrls.some((entry) => sitemapPathname(entry.loc) === value);

  const finish = () => {
    setOpen(false);
    setSearchQuery("");
    setIsCustomMode(false);
    onClose?.();
  };

  const handleSelect = (url: string) => {
    onChange(url, false);
    finish();
  };

  const hasLocalePrefix = (url: string) => /^\/[a-z]{2}(\/|$)/i.test(url.trim());

  const handleCustomSubmit = () => {
    const trimmed = customUrl.trim();
    if (!trimmed.startsWith("http") && hasLocalePrefix(trimmed)) {
      setCustomError("Custom URLs cannot start with a locale prefix like /en/ or /es/. Use the page search above instead.");
      return;
    }
    setCustomError("");
    onChange(trimmed, true);
    finish();
  };

  const panel = (
    <>
      <div className="p-2 border-b">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setIsCustomMode(false);
            }}
            placeholder="Search pages..."
            className="h-8 pl-8 text-sm"
            autoFocus
            data-testid={`${testId}-search`}
          />
        </div>
      </div>

      {isCustomMode ? (
        <div className="p-2 space-y-2">
          <p className="text-xs text-muted-foreground">Enter a custom URL:</p>
          <div className="flex gap-2">
            <Input
              value={customUrl}
              onChange={(e) => { setCustomUrl(e.target.value.replace(/\s+/g, "-")); setCustomError(""); }}
              placeholder="/custom-url or https://..."
              className="h-8 text-sm flex-1"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCustomSubmit();
              }}
              data-testid={`${testId}-custom-input`}
            />
            <Button
              size="sm"
              className="h-8"
              onClick={handleCustomSubmit}
              data-testid={`${testId}-custom-save`}
            >
              Save
            </Button>
          </div>
          {customError && (
            <p className="text-xs text-destructive">{customError}</p>
          )}
          <button
            onClick={() => { setIsCustomMode(false); setCustomError(""); }}
            className="text-xs text-muted-foreground hover-elevate px-1 py-0.5 rounded"
          >
            Back to search
          </button>
        </div>
      ) : (
        <>
          <ScrollArea className="h-[200px]">
            {isLoading ? (
              <div className="p-4 text-sm text-muted-foreground text-center">
                Loading pages...
              </div>
            ) : filteredUrls.length === 0 ? (
              <div className="p-4 text-sm text-muted-foreground text-center">
                {searchQuery ? "No pages found" : "No pages available"}
              </div>
            ) : (
              <div className="p-1">
                {filteredUrls.map((entry, index) => {
                  const path = sitemapPathname(entry.loc);
                  return (
                    <button
                      key={path}
                      onClick={() => handleSelect(path)}
                      className={cn(
                        "w-full text-left px-2 py-1.5 rounded-md text-sm hover-elevate flex items-start gap-2 group",
                        value === path && "bg-primary/10"
                      )}
                      data-testid={`${testId}-option-${index}`}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-foreground truncate text-xs">
                          {entry.label}
                        </div>
                        <div className="text-xs text-muted-foreground truncate">
                          {path}
                        </div>
                      </div>
                      {value === path && (
                        <Check className="h-4 w-4 text-primary flex-shrink-0 mt-0.5" />
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </ScrollArea>

          <div className="p-2 border-t">
            <button
              onClick={() => {
                setIsCustomMode(true);
                setCustomUrl(value);
              }}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-muted-foreground hover-elevate"
              data-testid={`${testId}-custom-toggle`}
            >
              <ExternalLink className="h-4 w-4" />
              <span>Use custom URL</span>
              {!isCurrentValueInSitemap && value && (
                <span className="ml-auto text-xs text-primary">(current)</span>
              )}
            </button>
          </div>
        </>
      )}
    </>
  );

  if (embedded) {
    return <div data-testid={testId}>{panel}</div>;
  }

  const displayValue = value || placeholder;
  const isExternal = value?.startsWith("http");

  return (
    // modal={false}: avoid Radix Dialog focus/pointer traps when nested in Dialogs
    <Popover open={open} onOpenChange={setOpen} modal={false}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "group inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-md transition-colors max-w-full hover-elevate",
            value
              ? "text-primary/80 bg-primary/5"
              : "text-muted-foreground"
          )}
          data-testid={testId}
        >
          {isExternal ? (
            <ExternalLink className="h-3 w-3 flex-shrink-0" />
          ) : (
            <Link className="h-3 w-3 flex-shrink-0" />
          )}
          <span className="truncate">{displayValue}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-80 p-0 z-[10001] pointer-events-auto"
        align="start"
        container={portalContainer}
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        {panel}
      </PopoverContent>
    </Popover>
  );
}
