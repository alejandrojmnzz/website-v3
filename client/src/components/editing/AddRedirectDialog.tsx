import { useState, useEffect, useRef } from "react";
import { TestTube, X } from "lucide-react";
import { getDebugUserName } from "@/hooks/useDebugAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { SitemapSearch } from "@/components/menus/SitemapSearch";
import { suggestedSitemapLocale } from "@/lib/sitemapSearch";
import { useToast } from "@/hooks/use-toast";
import { LocaleFlag } from "@/components/DebugBubble/components/LocaleFlag";

/** Extract the server error from apiRequest throws (`${status}: ${body}`). */
export function getApiErrorMessage(
  err: unknown,
  fallback = "An unexpected error occurred",
): string {
  if (!(err instanceof Error) || !err.message) return fallback;
  const colonIdx = err.message.indexOf(": ");
  const body = colonIdx === -1 ? err.message : err.message.slice(colonIdx + 2);
  try {
    const parsed = JSON.parse(body) as { error?: string };
    if (typeof parsed?.error === "string" && parsed.error.trim()) {
      return parsed.error;
    }
  } catch {
    // body is not JSON
  }
  return body.trim() || fallback;
}

export function hasRegexChars(path: string): boolean {
  return /\(.*\)|\[.*\]|\.\*|\.\+|\\d|\\w|\\s|\{\d+[,}]/.test(path);
}

function toAbsoluteUrlCandidate(value: string): string | null {
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith("//") && value.length > 2) return `https:${value}`;
  if (
    !value.startsWith("/") &&
    /^[a-z0-9][-a-z0-9]*(?:\.[a-z0-9][-a-z0-9]*)+/i.test(value)
  ) {
    return `https://${value}`;
  }
  return null;
}

/** Keep only the path from a pasted origin. Regex patterns are left as-is. */
export function originPathFromInput(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (hasRegexChars(trimmed)) return trimmed;

  const urlCandidate = toAbsoluteUrlCandidate(trimmed);
  if (urlCandidate) {
    try {
      const pathname = new URL(urlCandidate).pathname || "/";
      return pathname.replace(/\s+/g, "-");
    } catch {
      // fall through to path-only stripping
    }
  }

  const pathOnly = trimmed.split("#")[0]?.split("?")[0] ?? trimmed;
  return pathOnly.replace(/\s+/g, "-");
}

function stripLocalePrefix(url: string) {
  return url.replace(/^\/(en|es)(\/|$)/, "/");
}

interface AddRedirectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialFrom?: string;
  onSuccess?: () => void;
}

export function AddRedirectDialog({
  open,
  onOpenChange,
  initialFrom = "",
  onSuccess,
}: AddRedirectDialogProps) {
  const [newFrom, setNewFrom] = useState(initialFrom);
  const [newTo, setNewTo] = useState("");
  const [originalTo, setOriginalTo] = useState("");
  const [allLanguages, setAllLanguages] = useState(true);
  const [isCustomDestination, setIsCustomDestination] = useState(false);
  const [isRegexDestination, setIsRegexDestination] = useState(false);
  const [testUrl, setTestUrl] = useState("");
  const [redirectStatus, setRedirectStatus] = useState<number>(301);
  const [redirectPriority, setRedirectPriority] = useState<"before" | "fallback">("before");
  const [localeUrls, setLocaleUrls] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const [originCheckStatus, setOriginCheckStatus] = useState<
    "idle" | "checking" | "available" | "taken"
  >("idle");
  const [originCheckReason, setOriginCheckReason] = useState<string | null>(null);
  const originCheckTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { toast } = useToast();

  const isOriginRegex = hasRegexChars(newFrom);

  const originHasUrlOrDomain = (() => {
    if (isOriginRegex) return false;
    const v = newFrom.trim();
    if (!v) return false;
    const stripped = v.startsWith("/") ? v.slice(1) : v;
    return /https?:\/\//i.test(stripped) || /[a-z0-9][-a-z0-9]*\.[a-z]{2,}/i.test(stripped);
  })();
  const isOriginInvalid =
    newFrom.trim() !== "" &&
    (originHasUrlOrDomain ||
      !newFrom.startsWith("/") ||
      (!isOriginRegex && originCheckStatus === "taken"));

  const isLandingDestination = newTo.startsWith("/landing");
  const suggestedLocale = suggestedSitemapLocale(newFrom);

  useEffect(() => {
    if (!open) return;
    setNewFrom(originPathFromInput(initialFrom));
    setNewTo("");
    setOriginalTo("");
    setAllLanguages(true);
    setIsCustomDestination(false);
    setIsRegexDestination(false);
    setTestUrl("");
    setRedirectStatus(301);
    setRedirectPriority("before");
    setLocaleUrls({});
    setOriginCheckStatus("idle");
    setOriginCheckReason(null);
    setIsSubmitting(false);
  }, [open, initialFrom]);

  useEffect(() => {
    if (!open) return;
    if (originCheckTimer.current) clearTimeout(originCheckTimer.current);
    const trimmed = newFrom.trim();
    if (!trimmed || !trimmed.startsWith("/") || originHasUrlOrDomain || isOriginRegex) {
      setOriginCheckStatus("idle");
      setOriginCheckReason(null);
      return;
    }
    setOriginCheckStatus("checking");
    const controller = new AbortController();
    originCheckTimer.current = setTimeout(() => {
      fetch(`/api/content/check-origin?path=${encodeURIComponent(trimmed)}`, {
        signal: controller.signal,
      })
        .then((r) => r.json())
        .then((data) => {
          if (data.taken) {
            setOriginCheckStatus("taken");
            setOriginCheckReason(
              data.details ||
                (data.reason === "existing_redirect"
                  ? "This path already has a redirect"
                  : "This path belongs to an existing page"),
            );
          } else {
            setOriginCheckStatus("available");
            setOriginCheckReason(null);
          }
        })
        .catch(() => {
          if (!controller.signal.aborted) {
            setOriginCheckStatus("idle");
            setOriginCheckReason(null);
          }
        });
    }, 500);
    return () => {
      if (originCheckTimer.current) clearTimeout(originCheckTimer.current);
      controller.abort();
    };
  }, [open, newFrom, originHasUrlOrDomain, isOriginRegex]);

  const fetchLocaleUrls = async (url: string) => {
    try {
      const res = await fetch(
        `/api/debug/redirects/locale-urls?url=${encodeURIComponent(url)}`,
      );
      if (res.ok) {
        const data = await res.json();
        setLocaleUrls(data.urls || {});
      }
    } catch {
      setLocaleUrls({});
    }
  };

  const handleDestinationChange = (url: string, isCustom: boolean) => {
    setOriginalTo(url);
    setIsCustomDestination(isCustom);
    if (isCustom) {
      setAllLanguages(false);
      setNewTo(url);
      setLocaleUrls({});
    } else {
      if (allLanguages && !url.startsWith("/landing")) {
        setNewTo(stripLocalePrefix(url));
      } else {
        setNewTo(url);
      }
      if (!url.startsWith("/landing")) {
        fetchLocaleUrls(url);
      }
    }
  };

  const handleSubmitRedirect = async () => {
    if (!newFrom.trim() || !newTo.trim()) return;

    setIsSubmitting(true);
    try {
      await apiRequest("POST", "/api/debug/redirects", {
        from: newFrom.trim(),
        to: newTo.trim(),
        allLanguages,
        status: redirectStatus,
        isCustomDestination: isCustomDestination || isRegexDestination,
        priority: redirectPriority,
        author: getDebugUserName(),
      });

      toast({
        title: "Redirect added",
        description: `${newFrom.trim()} → ${newTo.trim()}`,
      });

      onOpenChange(false);
      queryClient.invalidateQueries({ queryKey: ["/api/debug/redirects"] });
      onSuccess?.();
    } catch (err) {
      toast({
        title: "Failed to add redirect",
        description: getApiErrorMessage(err),
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        ref={dialogRef}
        className="sm:max-w-md"
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Add Redirect</DialogTitle>
          <DialogDescription>
            Create a new URL redirect. The origin URL will be redirected to
            the destination page.
          </DialogDescription>
        </DialogHeader>

        <div className="min-w-0 space-y-4 py-2">
          <div className="space-y-2">
            <Label>Status Code</Label>
            <div className="flex border rounded-md overflow-hidden">
              {[
                {
                  code: 301,
                  label: "301 — Permanent",
                  desc: "The page has moved forever. Search engines transfer ranking to the new URL.",
                },
                {
                  code: 302,
                  label: "302 — Temporary",
                  desc: "The page is temporarily at a different URL. Search engines keep the original URL indexed.",
                },
              ].map((option, i) => (
                <button
                  key={option.code}
                  type="button"
                  onClick={() => setRedirectStatus(option.code)}
                  className={`flex-1 text-left p-3 transition-colors ${
                    i > 0 ? "border-l" : ""
                  } ${
                    redirectStatus === option.code
                      ? "bg-primary/15"
                      : "hover-elevate"
                  }`}
                  data-testid={`button-status-${option.code}`}
                >
                  <span className="text-sm font-medium">{option.label}</span>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {option.desc}
                  </p>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="redirect-from">Origin URL</Label>
            <div className="flex items-center flex-wrap gap-2">
              <Input
                id="redirect-from"
                placeholder="/old-page-url or /path/(.*)"
                value={newFrom}
                onChange={(e) => {
                  setNewFrom(originPathFromInput(e.target.value));
                }}
                className={`flex-1 min-w-0 ${isOriginInvalid ? "border-destructive" : ""}`}
                data-testid="input-redirect-from"
              />
              {isOriginRegex && newFrom.trim() && !isOriginInvalid && (
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" size="icon" title="Test this pattern" data-testid="button-test-pattern">
                      <TestTube className="h-4 w-4" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-80" align="end" side="bottom" container={dialogRef.current}>
                    {(() => {
                      const groupColors = [
                        { bg: "bg-blue-100 dark:bg-blue-900/40", text: "text-blue-700 dark:text-blue-300" },
                        { bg: "bg-amber-100 dark:bg-amber-900/40", text: "text-amber-700 dark:text-amber-300" },
                        { bg: "bg-emerald-100 dark:bg-emerald-900/40", text: "text-emerald-700 dark:text-emerald-300" },
                        { bg: "bg-purple-100 dark:bg-purple-900/40", text: "text-purple-700 dark:text-purple-300" },
                        { bg: "bg-rose-100 dark:bg-rose-900/40", text: "text-rose-700 dark:text-rose-300" },
                      ];
                      let testResult: { matches: boolean; groups?: string[]; destination?: string; error?: string } = { matches: false };
                      if (testUrl.trim()) {
                        try {
                          const regex = new RegExp(`^${newFrom.trim()}$`, "i");
                          const match = testUrl.trim().match(regex);
                          if (match) {
                            const groups = Array.from(match).slice(1);
                            let dest = newTo.trim();
                            if (dest) {
                              for (let g = 0; g < groups.length; g++) {
                                dest = dest.replace(new RegExp(`\\$${g + 1}`, "g"), groups[g] || "");
                              }
                            }
                            testResult = { matches: true, groups, destination: dest || undefined };
                          }
                        } catch (e: unknown) {
                          testResult = {
                            matches: false,
                            error: e instanceof Error ? e.message : "Invalid pattern",
                          };
                        }
                      }

                      const renderColoredUrl = (url: string, groups: string[]) => {
                        const parts: Array<{ text: string; groupIndex: number | null }> = [];
                        let remaining = url;
                        for (let g = 0; g < groups.length; g++) {
                          const val = groups[g];
                          if (!val) continue;
                          const idx = remaining.indexOf(val);
                          if (idx === -1) continue;
                          if (idx > 0) parts.push({ text: remaining.slice(0, idx), groupIndex: null });
                          parts.push({ text: val, groupIndex: g });
                          remaining = remaining.slice(idx + val.length);
                        }
                        if (remaining) parts.push({ text: remaining, groupIndex: null });
                        return parts.map((p, i) =>
                          p.groupIndex !== null ? (
                            <span key={i} className={`${groupColors[p.groupIndex % groupColors.length].bg} ${groupColors[p.groupIndex % groupColors.length].text} px-0.5 rounded font-medium`}>{p.text}</span>
                          ) : (
                            <span key={i}>{p.text}</span>
                          )
                        );
                      };

                      const renderColoredDest = (dest: string, groups: string[]) => {
                        const parts: Array<{ text: string; groupIndex: number | null }> = [];
                        let remaining = dest;
                        for (let g = 0; g < groups.length; g++) {
                          const val = groups[g];
                          if (!val) continue;
                          let idx = remaining.indexOf(val);
                          while (idx !== -1) {
                            if (idx > 0) parts.push({ text: remaining.slice(0, idx), groupIndex: null });
                            parts.push({ text: val, groupIndex: g });
                            remaining = remaining.slice(idx + val.length);
                            idx = remaining.indexOf(val);
                          }
                        }
                        if (remaining) parts.push({ text: remaining, groupIndex: null });
                        return parts.map((p, i) =>
                          p.groupIndex !== null ? (
                            <span key={i} className={`${groupColors[p.groupIndex % groupColors.length].bg} ${groupColors[p.groupIndex % groupColors.length].text} px-0.5 rounded font-medium`}>{p.text}</span>
                          ) : (
                            <span key={i}>{p.text}</span>
                          )
                        );
                      };

                      return (
                        <div className="space-y-2">
                          <p className="text-sm font-medium">Test this pattern</p>
                          <Input
                            id="test-url"
                            placeholder="/us/some-page"
                            value={testUrl}
                            onChange={(e) => setTestUrl(e.target.value)}
                            data-testid="input-test-url"
                          />
                          {testUrl.trim() && (
                            testResult.error ? (
                              <p className="text-xs text-destructive" data-testid="status-test-url-error">Invalid pattern: {testResult.error}</p>
                            ) : testResult.matches && testResult.groups ? (
                              <div className="text-xs space-y-2" data-testid="status-test-url-match">
                                <p className="text-green-600 font-medium">Match found</p>
                                {testResult.groups.length > 0 && (
                                  <div className="space-y-1.5">
                                    <p className="text-muted-foreground font-medium">Captured groups:</p>
                                    <code className="text-xs bg-muted px-2 py-1 rounded block" data-testid="text-test-url-colored">
                                      {renderColoredUrl(testUrl.trim(), testResult.groups)}
                                    </code>
                                    <div className="flex flex-wrap gap-1.5">
                                      {testResult.groups.map((g, i) => (
                                        <span key={i} className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs ${groupColors[i % groupColors.length].bg} ${groupColors[i % groupColors.length].text}`}>
                                          <span className="font-medium">${i + 1}</span>
                                          <span className="opacity-70">=</span>
                                          <span>{g}</span>
                                        </span>
                                      ))}
                                    </div>
                                  </div>
                                )}
                                {testResult.destination && (
                                  <div className="space-y-1">
                                    <p className="text-muted-foreground font-medium">Destination:</p>
                                    <code className="text-xs bg-muted px-2 py-1 rounded block" data-testid="text-test-url-destination">
                                      {renderColoredDest(testResult.destination, testResult.groups)}
                                    </code>
                                  </div>
                                )}
                              </div>
                            ) : (
                              <p className="text-xs text-muted-foreground" data-testid="status-test-url-no-match">No match — this URL would not be redirected.</p>
                            )
                          )}
                        </div>
                      );
                    })()}
                  </PopoverContent>
                </Popover>
              )}
            </div>
            {originHasUrlOrDomain ? (
              <p className="text-xs text-destructive">
                Just the path, please — no need for the full website address.
                Start with <code className="bg-muted px-1 rounded">/</code>
              </p>
            ) : newFrom.trim() && !newFrom.startsWith("/") ? (
              <p className="text-xs text-destructive">
                {isOriginRegex
                  ? <>Patterns must start with <code className="bg-muted px-1 rounded">/</code> because all URL paths begin with it — e.g. <code className="bg-muted px-1 rounded">/{newFrom.trim()}</code></>
                  : <>The path must start with{" "}<code className="bg-muted px-1 rounded">/</code></>}
              </p>
            ) : !isOriginRegex && originCheckStatus === "taken" ? (
              <p className="text-xs text-destructive">
                {originCheckReason || "This path is already in use"}
              </p>
            ) : !isOriginRegex && originCheckStatus === "checking" ? (
              <p className="text-xs text-muted-foreground">
                Checking availability...
              </p>
            ) : !isOriginRegex && originCheckStatus === "available" ? (
              <p className="text-xs text-green-600">Path is available</p>
            ) : isOriginRegex && newFrom ? (
              <p className="text-xs text-muted-foreground">
                Regex pattern detected — URLs matching{" "}
                <code className="bg-muted px-1 rounded">{newFrom}</code> will
                be redirected. Use capture groups like{" "}
                <code className="bg-muted px-1 rounded">(.*)</code> and reference
                them in the destination with{" "}
                <code className="bg-muted px-1 rounded">$1</code>,{" "}
                <code className="bg-muted px-1 rounded">$2</code>, etc.
              </p>
            ) : newFrom ? (
              <p className="text-xs text-muted-foreground">
                Visitors to{" "}
                <code className="bg-muted px-1 rounded">{newFrom}</code> will
                be redirected
              </p>
            ) : null}
          </div>

          {newFrom.trim() && !isOriginInvalid && (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <Label>Destination</Label>
                {!newTo && (
                  <div className="flex border rounded-md overflow-hidden text-xs">
                    <button
                      type="button"
                      onClick={() => setIsRegexDestination(false)}
                      className={`px-2.5 py-1 transition-colors ${!isRegexDestination ? "bg-primary/15 font-medium" : "hover-elevate"}`}
                      data-testid="button-dest-page"
                    >
                      Pick a page
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsRegexDestination(true)}
                      className={`px-2.5 py-1 border-l transition-colors ${isRegexDestination ? "bg-primary/15 font-medium" : "hover-elevate"}`}
                      data-testid="button-dest-pattern"
                    >
                      Type a pattern
                    </button>
                  </div>
                )}
              </div>
              {isRegexDestination ? (
                <div className="space-y-2">
                  <Input
                    placeholder="/new-path/$1"
                    value={newTo}
                    onChange={(e) => setNewTo(e.target.value)}
                    data-testid="input-redirect-to-pattern"
                  />
                  <p className="text-xs text-muted-foreground">
                    Type a destination path. Use{" "}
                    <code className="bg-muted px-1 rounded">$1</code>,{" "}
                    <code className="bg-muted px-1 rounded">$2</code>, etc. to
                    reference capture groups from the origin pattern.
                  </p>
                </div>
              ) : !newTo ? (
                <div className="flex items-center">
                  <SitemapSearch
                    value={newTo}
                    onChange={handleDestinationChange}
                    placeholder="Search for a page..."
                    testId="input-redirect-to"
                    locale={suggestedLocale}
                    showLocaleFilter
                    portalContainer={dialogRef.current}
                  />
                </div>
              ) : (
                <div className="rounded-md border p-3 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1 space-y-1.5">
                      {isLandingDestination ? (
                        <>
                          <code className="text-xs bg-muted px-2 py-1 rounded block truncate">
                            {newTo}
                          </code>
                          <p className="text-xs text-muted-foreground">
                            Visitors to{" "}
                            <code className="bg-muted px-1 rounded">
                              {newFrom.startsWith("/")
                                ? newFrom
                                : `/${newFrom}`}
                            </code>{" "}
                            will land on this exact landing page.
                          </p>
                        </>
                      ) : isCustomDestination ? (
                        <>
                          <code className="text-xs bg-muted px-2 py-1 rounded block truncate">
                            {newTo}
                          </code>
                          <p className="text-xs text-muted-foreground">
                            Visitors to{" "}
                            <code className="bg-muted px-1 rounded">
                              {newFrom.startsWith("/")
                                ? newFrom
                                : `/${newFrom}`}
                            </code>{" "}
                            will be redirected to this exact URL.
                          </p>
                        </>
                      ) : allLanguages ? (
                        <>
                          <div className="space-y-1">
                            {Object.entries(localeUrls).map(
                              ([locale, url]) => (
                                <div
                                  key={locale}
                                  className="flex items-center gap-2 min-w-0"
                                >
                                  <LocaleFlag locale={locale} />
                                  <code className="text-xs bg-muted px-2 py-1 rounded truncate min-w-0">
                                    {url}
                                  </code>
                                </div>
                              ),
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground">
                            Visitors to{" "}
                            <code className="bg-muted px-1 rounded">
                              {newFrom.startsWith("/")
                                ? newFrom
                                : `/${newFrom}`}
                            </code>{" "}
                            will be redirected to the matching language
                            version of this content.
                          </p>
                        </>
                      ) : (
                        <>
                          <code className="text-xs bg-muted px-2 py-1 rounded block truncate">
                            {originalTo || newTo}
                          </code>
                          <p className="text-xs text-muted-foreground">
                            Visitors to{" "}
                            <code className="bg-muted px-1 rounded">
                              {newFrom.startsWith("/")
                                ? newFrom
                                : `/${newFrom}`}
                            </code>{" "}
                            will be sent to the{" "}
                            <strong>
                              {(originalTo || newTo).match(
                                /^\/(en|es)/,
                              )?.[1] || "en"}
                            </strong>{" "}
                            version of this page only.
                          </p>
                        </>
                      )}
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => {
                        setNewTo("");
                        setOriginalTo("");
                        setLocaleUrls({});
                        setIsCustomDestination(false);
                        setAllLanguages(true);
                      }}
                      data-testid="button-clear-destination"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>

                  {!isLandingDestination && !isCustomDestination && (
                    <div className="border-t pt-3 space-y-1.5">
                      <div className="flex items-center justify-between gap-4">
                        <Label
                          htmlFor="all-languages"
                          className="text-sm font-medium"
                        >
                          All languages
                        </Label>
                        <Switch
                          id="all-languages"
                          checked={allLanguages}
                          onCheckedChange={(checked) => {
                            setAllLanguages(checked);
                            if (
                              originalTo &&
                              !originalTo.startsWith("/landing")
                            ) {
                              setNewTo(
                                checked
                                  ? stripLocalePrefix(originalTo)
                                  : originalTo,
                              );
                            }
                          }}
                          data-testid="switch-all-languages"
                        />
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {allLanguages
                          ? "One redirect for all languages. Visitors are sent to the matching language version automatically."
                          : "This redirect only applies to the specific language URL selected above."}
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {(isOriginRegex || isCustomDestination || isRegexDestination) && newTo.trim() && (
            <div className="space-y-2">
              <Label>Priority</Label>
              <div className="flex rounded-md border overflow-hidden">
                {[
                  { value: "before" as const, label: "Before", desc: "Always redirect" },
                  { value: "fallback" as const, label: "Fallback", desc: "Only if no page exists" },
                ].map((option, i) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setRedirectPriority(option.value)}
                    className={`flex-1 text-left p-3 transition-colors ${
                      i > 0 ? "border-l" : ""
                    } ${
                      redirectPriority === option.value
                        ? "bg-primary/15"
                        : "hover-elevate"
                    }`}
                    data-testid={`button-priority-${option.value}`}
                  >
                    <span className="text-sm font-medium">{option.label}</span>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {option.desc}
                    </p>
                  </button>
                ))}
              </div>
            </div>
          )}

        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            data-testid="button-cancel-redirect"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmitRedirect}
            disabled={
              isOriginInvalid ||
              originCheckStatus === "checking" ||
              !newFrom.trim() ||
              !newTo.trim() ||
              isSubmitting
            }
            data-testid="button-save-redirect"
          >
            {isSubmitting ? "Adding..." : "Add Redirect"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
