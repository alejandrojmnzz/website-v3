import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ChevronDown, Info } from "lucide-react";

function urlToPath(url: string): string {
  try {
    return new URL(url, window.location.origin).pathname;
  } catch {
    return url.startsWith("/") ? url : `/${url}`;
  }
}

function formatPathWarningTitle(paths: string[]): string {
  if (paths.length === 0) {
    return "Deleting this override will not remove the public page";
  }
  if (paths.length === 1) {
    return `Deleting this override will not remove the ${paths[0]} path`;
  }
  if (paths.length === 2) {
    return `Deleting this override will not remove the ${paths[0]} or ${paths[1]} paths`;
  }
  const last = paths[paths.length - 1];
  const rest = paths.slice(0, -1).join(", ");
  return `Deleting this override will not remove the ${rest}, or ${last} paths`;
}

interface DeletePageModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  deletingPage: { slug: string; contentType: string } | null;
  deleteConfirmInput: string;
  setDeleteConfirmInput: (v: string) => void;
  isDeletingPage: boolean;
  onConfirm: (localesToDelete: string[]) => void;
  availableLocales?: string[];
  currentLocale?: string;
  isPartialOverride?: boolean;
  publicUrls?: Record<string, string>;
}

export function DeletePageModal(props: DeletePageModalProps) {
  const {
    open,
    onOpenChange,
    deletingPage,
    deleteConfirmInput,
    setDeleteConfirmInput,
    isDeletingPage,
    onConfirm,
    availableLocales,
    currentLocale,
    isPartialOverride = false,
    publicUrls,
  } = props;

  const [selectedLocales, setSelectedLocales] = useState<Set<string>>(new Set());
  const [showOverrideDetails, setShowOverrideDetails] = useState(false);

  useEffect(() => {
    if (!open) {
      setShowOverrideDetails(false);
    }
  }, [open]);

  useEffect(() => {
    if (open && availableLocales && availableLocales.length > 0) {
      if (currentLocale && availableLocales.includes(currentLocale)) {
        setSelectedLocales(new Set([currentLocale]));
      } else {
        setSelectedLocales(new Set(availableLocales));
      }
    } else if (!open) {
      setSelectedLocales(new Set());
    }
  }, [open, availableLocales, currentLocale]);

  const hasLocaleSelection = availableLocales && availableLocales.length > 0;
  const allSelected = hasLocaleSelection && selectedLocales.size === availableLocales.length;
  const selectedList = Array.from(selectedLocales).sort();
  const liveUrls = publicUrls ? Object.entries(publicUrls).filter(([, url]) => url) : [];
  const livePaths = liveUrls.map(([, url]) => urlToPath(url));

  const toggleLocale = (locale: string) => {
    setSelectedLocales(prev => {
      const next = new Set(prev);
      if (next.has(locale)) {
        next.delete(locale);
      } else {
        next.add(locale);
      }
      return next;
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-destructive">
            {isPartialOverride ? "Delete partial override" : "Delete page"}
          </DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground pt-2">
            {isPartialOverride ? (
              <>
                This removes only the YAML customizations for{" "}
                <span className="font-bold text-foreground">{deletingPage?.slug}</span>. The
                database entry is not affected. Type the slug below to confirm.
              </>
            ) : (
              <>
                This action is irreversible and permanent. If you are sure you want to delete{" "}
                <span className="font-bold text-foreground">{deletingPage?.slug}</span>, type the
                page name below and click confirm.
              </>
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          {isPartialOverride && (
            <Alert
              className="border-violet-500/40 bg-violet-500/5 text-foreground [&>svg]:text-violet-600 dark:[&>svg]:text-violet-400"
              data-testid="alert-partial-override-delete"
            >
              <Info className="h-4 w-4" />
              <AlertTitle className="text-sm leading-snug">
                {formatPathWarningTitle(livePaths)}
              </AlertTitle>
              <AlertDescription className="text-xs text-muted-foreground">
                <button
                  type="button"
                  className="inline-flex items-center gap-1 text-violet-600 dark:text-violet-400 hover:underline"
                  onClick={() => setShowOverrideDetails((v) => !v)}
                  data-testid="button-toggle-partial-override-delete-details"
                >
                  {showOverrideDetails ? "Hide details" : "What does this mean?"}
                  <ChevronDown
                    className={`h-3.5 w-3.5 transition-transform ${showOverrideDetails ? "rotate-180" : ""}`}
                  />
                </button>
                {showOverrideDetails && (
                  <div className="mt-2 space-y-2">
                    <p>
                      Only the partial override folder (layout and section customizations) will be
                      removed. The original database entry remains, and the page will fall back to the
                      shared template with database content.
                    </p>
                    {liveUrls.length > 0 && (
                      <div className="space-y-1">
                        <p>The public {liveUrls.length === 1 ? "URL" : "URLs"} will keep working:</p>
                        <ul className="space-y-1">
                          {liveUrls.map(([locale, url]) => (
                            <li key={locale}>
                              {liveUrls.length > 1 && (
                                <span className="font-mono uppercase text-[11px] mr-1.5">{locale}</span>
                              )}
                              <a
                                href={url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="font-mono text-[11px] text-violet-600 dark:text-violet-400 hover:underline break-all"
                              >
                                {url}
                              </a>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
              </AlertDescription>
            </Alert>
          )}
          <label className="text-sm text-muted-foreground">
            Type <span className="font-mono font-bold text-foreground">{deletingPage?.slug}</span> to complete this action:
          </label>
          <input
            value={deleteConfirmInput}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDeleteConfirmInput(e.target.value)}
            placeholder={deletingPage?.slug || ""}
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors font-mono placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            data-testid="input-delete-confirm-slug"
          />

          {hasLocaleSelection && (
            <div className="space-y-2 pt-1">
              <p className="text-xs font-medium text-muted-foreground">Select locales to delete:</p>
              <div className="flex flex-col gap-1.5">
                {availableLocales.map((locale) => (
                  <label key={locale} className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedLocales.has(locale)}
                      onChange={() => toggleLocale(locale)}
                      className="h-4 w-4 rounded border-input accent-destructive"
                      data-testid={`checkbox-delete-locale-${locale}`}
                    />
                    <span className="font-mono text-xs">{locale}.yml</span>
                  </label>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                {selectedLocales.size === 0 ? (
                  <span className="text-destructive">Select at least one locale</span>
                ) : allSelected ? (
                  <>Will delete: {selectedList.map(l => `${l}.yml`).join(', ')} — <span className="font-medium">entire folder will be removed</span></>
                ) : (
                  <>Will delete: {selectedList.map(l => `${l}.yml`).join(', ')}</>
                )}
              </p>
            </div>
          )}
        </div>
        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            data-testid="button-delete-cancel"
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={deleteConfirmInput !== deletingPage?.slug || isDeletingPage || (hasLocaleSelection && selectedLocales.size === 0)}
            onClick={() => onConfirm(selectedList)}
            data-testid="button-delete-confirm"
          >
            {isDeletingPage ? "Deleting..." : "Confirm deletion"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
