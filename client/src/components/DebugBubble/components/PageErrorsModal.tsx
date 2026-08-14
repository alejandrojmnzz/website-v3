import { useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import type { PageDiagnostics } from "../types";
import { useFormatSitePath } from "@/hooks/useFormatSitePath";
import { cn } from "@/lib/utils";
import {
  IconAlertTriangle,
  IconArrowRight,
  IconChevronDown,
  IconClock,
  IconExternalLink,
  IconLoader2,
  IconRefresh,
} from "@tabler/icons-react";
import * as Flags from "country-flag-icons/react/3x2";

/** Validators that make sense for a single page (entry-local only). */
export const PER_PAGE_VALIDATORS = [
  "meta",
  "required-fields",
  "editor-field-types",
  "unknown-keys",
  "seo-depth",
  "seo-intent",
  "schema-completeness",
  "content-quality",
  "section-variants",
];

interface PageErrorsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pageDiagnostics: PageDiagnostics | null;
  pageUrl?: string;
  onRefreshDiagnostics?: () => Promise<void>;
}

type PageIssue = NonNullable<PageDiagnostics["issues"]>[number];

function formatStaleness(isoDate: string): string {
  const diffMs = Date.now() - new Date(isoDate).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? "" : "s"} ago`;
  const days = Math.floor(hrs / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function LocaleFlag({ locale }: { locale: string }) {
  const FlagComponent = locale === "es" ? Flags.ES : Flags.US;
  return <FlagComponent className="h-3.5 w-auto rounded-sm" title={locale === "es" ? "Spanish" : "English"} />;
}

function IssueCard({
  issue,
  index,
  variant,
  formatSitePath,
}: {
  issue: PageIssue;
  index: number;
  variant: "error" | "warning";
  formatSitePath: (path: string) => string;
}) {
  const [open, setOpen] = useState(false);
  const isError = variant === "error";
  const cacheBuiltAt = (issue as { validationCacheBuiltAt?: string }).validationCacheBuiltAt;
  const hasDetails = Boolean(
    issue.details?.expected || issue.suggestion || issue.file || cacheBuiltAt,
  );

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div
        className={
          isError
            ? "rounded-md bg-destructive/10 border border-destructive/30 text-sm"
            : "rounded-md bg-amber-500/10 border border-amber-500/30 text-sm"
        }
        data-testid={`modal-${variant}-${index}`}
      >
        <CollapsibleTrigger asChild disabled={!hasDetails}>
          <button
            type="button"
            className={cn(
              "flex w-full items-start gap-2 p-3 text-left",
              hasDetails ? "cursor-pointer" : "cursor-default",
            )}
            data-testid={`modal-${variant}-${index}-toggle`}
            aria-expanded={open}
          >
            <div className="min-w-0 flex-1">
              <div
                className={
                  isError
                    ? "font-mono font-medium text-destructive text-xs"
                    : "font-mono font-medium text-amber-700 dark:text-amber-300 text-xs"
                }
              >
                {issue.code}
              </div>
              <div className="mt-1 text-foreground">{issue.message}</div>
            </div>
            {hasDetails && (
              <IconChevronDown
                className={cn(
                  "h-4 w-4 shrink-0 mt-0.5 text-muted-foreground transition-transform",
                  open && "rotate-180",
                )}
              />
            )}
          </button>
        </CollapsibleTrigger>
        {hasDetails && (
          <CollapsibleContent>
            <div className="px-3 pb-3 space-y-1">
              {issue.details?.expected && (
                <div className="text-xs text-muted-foreground">
                  Expected: <span className="font-mono">{issue.details.expected}</span>
                  {issue.details.received && (
                    <>
                      {" "}
                      | Received: <span className="font-mono">{issue.details.received}</span>
                    </>
                  )}
                </div>
              )}
              {issue.suggestion && (
                <div className="text-xs text-muted-foreground">{issue.suggestion}</div>
              )}
              {issue.file && (
                <div className="text-xs text-muted-foreground font-mono" title={issue.file}>
                  {formatSitePath(issue.file)}
                </div>
              )}
              {cacheBuiltAt && (
                <div className="text-xs text-muted-foreground flex items-center gap-1">
                  <IconClock className="h-3 w-3" />
                  Cache built at {new Date(cacheBuiltAt).toLocaleString()}
                </div>
              )}
            </div>
          </CollapsibleContent>
        )}
      </div>
    </Collapsible>
  );
}

export function PageErrorsModal(props: PageErrorsModalProps) {
  const {
    open,
    onOpenChange,
    pageDiagnostics,
    pageUrl,
    onRefreshDiagnostics,
  } = props;

  const [isRunningValidation, setIsRunningValidation] = useState(false);
  const [activeTab, setActiveTab] = useState<"errors" | "warnings">("errors");
  const [openPageMenuOpen, setOpenPageMenuOpen] = useState(false);
  const openPageMenuRef = useRef<HTMLDivElement>(null);
  const formatSitePath = useFormatSitePath();

  const errors = pageDiagnostics?.issues?.filter((i) => i.type === "error") ?? [];
  const warnings = pageDiagnostics?.issues?.filter((i) => i.type === "warning") ?? [];
  const openPageUrl = pageUrl ?? pageDiagnostics?.url;

  useEffect(() => {
    if (!open) setOpenPageMenuOpen(false);
  }, [open]);

  useEffect(() => {
    if (!openPageMenuOpen) return;
    function onDown(e: MouseEvent) {
      if (openPageMenuRef.current && !openPageMenuRef.current.contains(e.target as Node)) {
        setOpenPageMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [openPageMenuOpen]);

  useEffect(() => {
    if (!open || !pageDiagnostics) return;
    setActiveTab(errors.length > 0 ? "errors" : "warnings");
  }, [open, pageDiagnostics?.url, pageDiagnostics?.entryKey, errors.length, warnings.length]);

  async function handleRunValidation() {
    if (isRunningValidation) return;
    setIsRunningValidation(true);
    try {
      const url = pageUrl ?? pageDiagnostics?.url;
      if (url) {
        await fetch("/api/validation/run-page", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            url,
            validators: PER_PAGE_VALIDATORS,
          }),
        });
      }
      if (onRefreshDiagnostics) {
        await onRefreshDiagnostics();
      }
    } catch {}
    setIsRunningValidation(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <IconAlertTriangle className="h-5 w-5 text-destructive" />
            {pageDiagnostics
              ? `${pageDiagnostics.contentType} · ${pageDiagnostics.slug}`
              : "Page Diagnostics"}
          </DialogTitle>
          <DialogDescription data-testid="text-modal-description" className="flex items-center gap-1.5">
            {pageDiagnostics ? (
              <>
                <span>{pageDiagnostics.url}</span>
                <LocaleFlag locale={pageDiagnostics.locale} />
                {openPageUrl && (
                  <div ref={openPageMenuRef} className="relative">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-5 w-5 text-muted-foreground"
                      aria-label="Open page"
                      aria-haspopup="menu"
                      aria-expanded={openPageMenuOpen}
                      onClick={() => setOpenPageMenuOpen((prev) => !prev)}
                      data-testid="button-open-page"
                    >
                      <IconExternalLink className="h-3.5 w-3.5" />
                    </Button>
                    {openPageMenuOpen && (
                      <div
                        role="menu"
                        className="absolute left-0 z-50 mt-1 w-44 rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
                      >
                        <button
                          type="button"
                          role="menuitem"
                          className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-[13px] hover-elevate"
                          onClick={() => {
                            setOpenPageMenuOpen(false);
                            window.location.href = openPageUrl;
                          }}
                          data-testid="menu-open-page-same-tab"
                        >
                          <IconArrowRight className="h-3.5 w-3.5" />
                          Same tab
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-[13px] hover-elevate"
                          onClick={() => {
                            setOpenPageMenuOpen(false);
                            window.open(openPageUrl, "_blank", "noopener,noreferrer");
                          }}
                          data-testid="menu-open-page-new-tab"
                        >
                          <IconExternalLink className="h-3.5 w-3.5" />
                          New tab
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </>
            ) : "Loading diagnostics…"}
          </DialogDescription>
        </DialogHeader>
        {pageDiagnostics && (
          <div className="space-y-4">
            <Tabs
              value={activeTab}
              onValueChange={(v) => setActiveTab(v as "errors" | "warnings")}
              className="w-full"
            >
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <TabsList className="h-9" data-testid="tabs-page-errors">
                  <TabsTrigger value="errors" data-testid="tab-errors" className="gap-1.5">
                    Errors
                    <span
                      className="rounded-sm bg-destructive/15 text-destructive px-1.5 py-0 text-[10px] font-semibold tabular-nums"
                      data-testid="text-modal-error-count"
                    >
                      {errors.length}
                    </span>
                  </TabsTrigger>
                  <TabsTrigger value="warnings" data-testid="tab-warnings" className="gap-1.5">
                    Warnings
                    <span
                      className="rounded-sm bg-amber-500/15 text-amber-700 dark:text-amber-300 px-1.5 py-0 text-[10px] font-semibold tabular-nums"
                      data-testid="text-modal-warning-count"
                    >
                      {warnings.length}
                    </span>
                  </TabsTrigger>
                </TabsList>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleRunValidation}
                    disabled={isRunningValidation}
                    data-testid="button-run-validation"
                  >
                    {isRunningValidation ? (
                      <>
                        <IconLoader2 className="h-3.5 w-3.5 animate-spin" />
                        Running…
                      </>
                    ) : (
                      <>
                        <IconRefresh className="h-3.5 w-3.5" />
                        Run validation
                      </>
                    )}
                  </Button>
                </div>
              </div>

              {pageDiagnostics.cached ? (
                <p className="text-xs text-muted-foreground flex items-center gap-1.5 mt-2" data-testid="text-cached-staleness">
                  <IconClock className="h-3.5 w-3.5" />
                  Validated {formatStaleness(pageDiagnostics.cached.lastRunAt)}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground mt-2" data-testid="cached-not-yet-validated">
                  Not yet validated — click &quot;Run validation&quot; to refresh this list.
                </p>
              )}

              <TabsContent value="errors" className="mt-3 space-y-2">
                {errors.length === 0 ? (
                  <div
                    className="p-3 rounded-md bg-muted/50 border border-border text-sm text-muted-foreground"
                    data-testid="modal-errors-empty"
                  >
                    No errors for this entry.
                  </div>
                ) : (
                  errors.map((issue, i) => (
                    <IssueCard
                      key={`${issue.code}-${i}`}
                      issue={issue}
                      index={i}
                      variant="error"
                      formatSitePath={formatSitePath}
                    />
                  ))
                )}
              </TabsContent>

              <TabsContent value="warnings" className="mt-3 space-y-2">
                {warnings.length === 0 ? (
                  <div
                    className="p-3 rounded-md bg-muted/50 border border-border text-sm text-muted-foreground"
                    data-testid="modal-warnings-empty"
                  >
                    No warnings for this entry.
                  </div>
                ) : (
                  warnings.map((issue, i) => (
                    <IssueCard
                      key={`${issue.code}-${i}`}
                      issue={issue}
                      index={i}
                      variant="warning"
                      formatSitePath={formatSitePath}
                    />
                  ))
                )}
              </TabsContent>
            </Tabs>

            <div className="p-3 rounded-md bg-muted/50 border border-border text-sm">
              <p className="text-muted-foreground text-xs">
                Validation uses one shared store. This list shows issues that target this entry
                (including redirects/media that touch it). Saving re-checks local rules; redirect
                conflicts refresh when redirect config changes or via Redirects / Global Health.
              </p>
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-close-page-errors">
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
