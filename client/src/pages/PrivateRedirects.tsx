import { useState, useEffect, useRef, useCallback } from "react";
import { AlertTriangle, ArrowLeft, ArrowRight, Check, ChevronDown, ChevronRight, ChevronUp, CircleCheck, ExternalLink, Info, Pencil, Plus, Route, Search, ShieldCheck, TestTube, Trash2, Wrench, X } from "lucide-react";
import { getDebugUserName } from "@/hooks/useDebugAuth";
import { useQuery } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
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
import { Link } from "wouter";
import { isDebugModeActive } from "@/hooks/useDebugAuth";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { SitemapSearch } from "@/components/menus/SitemapSearch";
import { useToast } from "@/hooks/use-toast";
import { LocaleFlag } from "@/components/DebugBubble/components/LocaleFlag";
import {
  RedirectConflictResolverModal,
  parseRedirectConflict,
  useRedirectConflictResolver,
} from "@/components/RedirectConflictResolver";
import { useFormatSitePath } from "@/hooks/useFormatSitePath";
import { Checkbox } from "@/components/ui/checkbox";

const SKIP_DELETE_CONFIRM_KEY = "private-redirects-skip-delete-confirm-until";
const SKIP_DELETE_CONFIRM_MS = 5 * 60 * 1000;

function getSkipDeleteConfirmUntil(): number {
  try {
    const raw = sessionStorage.getItem(SKIP_DELETE_CONFIRM_KEY);
    const until = raw ? Number(raw) : 0;
    return Number.isFinite(until) ? until : 0;
  } catch {
    return 0;
  }
}

function setSkipDeleteConfirmUntil(until: number): void {
  try {
    sessionStorage.setItem(SKIP_DELETE_CONFIRM_KEY, String(until));
  } catch {
    /* ignore */
  }
}

interface Redirect {
  from: string;
  to: string | Record<string, string>;
  type: string;
  status: number;
  source: string;
  priority?: "before" | "fallback";
}

/** Extract the server error from apiRequest throws (`${status}: ${body}`). */
function getApiErrorMessage(
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

function formatRedirectTo(to: string | Record<string, string>): string {
  if (typeof to === "string") return to;
  return Object.values(to).join(", ");
}

function isLocaleMap(
  to: string | Record<string, string>,
): to is Record<string, string> {
  return typeof to === "object";
}

function hasRegexChars(path: string): boolean {
  return /\(.*\)|\[.*\]|\.\*|\.\+|\\d|\\w|\\s|\{\d+[,}]/.test(path);
}

function isCustomRedirect(redirect: { type?: string; source?: string }): boolean {
  if (redirect.type === "custom") return true;
  return /(?:^|\/)custom-redirects\.yml$/.test(redirect.source || "");
}

interface ValidationIssue {
  type: "error" | "warning";
  code: string;
  message: string;
  file?: string;
  suggestion?: string;
}

interface ValidationResult {
  name: string;
  description: string;
  status: "passed" | "failed" | "warning";
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  duration: number;
}

function isContentFilePath(p: string): boolean {
  return (
    /\.ya?ml$/i.test(p) ||
    /(?:^|\/)(?:site_[^/]+|4geeks-com|content)\//.test(p)
  );
}

/** Format a path or a message that embeds content file paths (site-relative). */
function formatValidationText(
  text: string,
  formatPath: (filePath: string) => string,
): string {
  if (!text) return text;
  if (!text.includes('"') && isContentFilePath(text)) {
    return formatPath(text);
  }
  return text.replace(/"([^"]+)"/g, (full, inner: string) =>
    isContentFilePath(inner) ? `"${formatPath(inner)}"` : full,
  );
}

const FILE_ORDINALS = ["first", "second", "third", "fourth", "fifth"];

/** Button label for remove-from-file; disambiguates when basenames collide. */
function removeFromFileLabel(
  files: string[],
  index: number,
  formatPath: (filePath: string) => string,
): string {
  const basenames = files.map((f) => formatPath(f).split("/").pop() || f);
  const name = basenames[index] || "file";
  const duplicateCount = basenames.filter((b) => b === name).length;
  if (duplicateCount > 1) {
    const ordinalIndex =
      basenames.slice(0, index + 1).filter((b) => b === name).length - 1;
    const ordinal = FILE_ORDINALS[ordinalIndex] || `${ordinalIndex + 1}th`;
    return `Remove from ${ordinal} ${name}`;
  }
  return `Remove from ${name}`;
}

export default function PrivateRedirects() {
  const formatPath = useFormatSitePath();
  const [search, setSearch] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [expandedType, setExpandedType] = useState<string | null>(null);
  const [validationResult, setValidationResult] =
    useState<ValidationResult | null>(null);
  const [isValidating, setIsValidating] = useState(false);
  const [showValidation, setShowValidation] = useState(false);
  const [validationExpanded, setValidationExpanded] = useState(false);

  const [testRedirectUrl, setTestRedirectUrl] = useState("");
  const [testRedirectResult, setTestRedirectResult] = useState<{
    match: boolean;
    from?: string;
    resolvedTo?: string;
    status?: number;
    priority?: string;
    source?: string;
    matchType?: string;
    captureGroups?: string[];
    pageExists?: boolean;
    destinationExists?: boolean;
  } | null>(null);
  const [isTestingRedirect, setIsTestingRedirect] = useState(false);
  const testRedirectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [showAddDialog, setShowAddDialog] = useState(false);
  const [newFrom, setNewFrom] = useState("");
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
  const [deletingRedirect, setDeletingRedirect] = useState<Redirect | null>(
    null,
  );
  const [isDeleting, setIsDeleting] = useState(false);
  const [dontAskAgainDelete, setDontAskAgainDelete] = useState(false);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const editDraftRef = useRef("");
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const [originCheckStatus, setOriginCheckStatus] = useState<
    "idle" | "checking" | "available" | "taken"
  >("idle");
  const [originCheckReason, setOriginCheckReason] = useState<string | null>(
    null,
  );
  const originCheckTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { toast } = useToast();
  const {
    resolveModalOpen,
    setResolveModalOpen,
    activeConflict,
    openResolver,
  } = useRedirectConflictResolver();

  const isOriginRegex = hasRegexChars(newFrom);

  const originHasUrlOrDomain = (() => {
    if (isOriginRegex) return false;
    const v = newFrom.trim();
    if (!v) return false;
    const stripped = v.startsWith("/") ? v.slice(1) : v;
    return (/https?:\/\//i.test(stripped) || /[a-z0-9][-a-z0-9]*\.[a-z]{2,}/i.test(stripped));
  })();
  const isOriginInvalid =
    newFrom.trim() !== "" &&
    (originHasUrlOrDomain ||
      !newFrom.startsWith("/") ||
      (!isOriginRegex && originCheckStatus === "taken"));

  useEffect(() => {
    setIsAuthorized(isDebugModeActive());
  }, []);

  const runValidation = useCallback(async () => {
    setIsValidating(true);
    setValidationExpanded(false);
    try {
      const res = await apiRequest("POST", "/api/validation/run/redirects");
      const data = await res.json();
      setValidationResult(data);
      if (data.status === "failed" || data.status === "warning") {
        setShowValidation(true);
      }
    } catch {
      setValidationResult(null);
    } finally {
      setIsValidating(false);
    }
  }, []);

  useEffect(() => {
    if (isAuthorized) {
      runValidation();
    }
  }, [isAuthorized, runValidation]);

  useEffect(() => {
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
  }, [newFrom, originHasUrlOrDomain, isOriginRegex]);

  useEffect(() => {
    if (testRedirectTimer.current) clearTimeout(testRedirectTimer.current);
    const trimmed = testRedirectUrl.trim();
    if (!trimmed) {
      setTestRedirectResult(null);
      setIsTestingRedirect(false);
      return;
    }
    setIsTestingRedirect(true);
    const controller = new AbortController();
    testRedirectTimer.current = setTimeout(() => {
      fetch(`/api/debug/redirects/test?url=${encodeURIComponent(trimmed)}`, {
        signal: controller.signal,
      })
        .then((r) => r.json())
        .then((data) => {
          setTestRedirectResult(data);
          setIsTestingRedirect(false);
        })
        .catch(() => {
          if (!controller.signal.aborted) {
            setTestRedirectResult(null);
            setIsTestingRedirect(false);
          }
        });
    }, 300);
    return () => {
      if (testRedirectTimer.current) clearTimeout(testRedirectTimer.current);
      controller.abort();
    };
  }, [testRedirectUrl]);

  const { data: redirectsData, isLoading } = useQuery<{
    redirects: Redirect[];
  }>({
    queryKey: ["/api/debug/redirects"],
    enabled: isAuthorized,
  });

  const redirects = redirectsData?.redirects || [];

  const filteredRedirects = redirects.filter((r) => {
    const q = search.toLowerCase();
    const toStr = formatRedirectTo(r.to).toLowerCase();
    return (
      r.from.toLowerCase().includes(q) ||
      toStr.includes(q) ||
      r.type.toLowerCase().includes(q) ||
      String(r.status).includes(q)
    );
  });

  const groupedByType = filteredRedirects.reduce(
    (acc, redirect) => {
      const normalizedType = redirect.type.replace(/-common$/, "");
      if (!acc[normalizedType]) {
        acc[normalizedType] = [];
      }
      acc[normalizedType].push(redirect);
      return acc;
    },
    {} as Record<string, Redirect[]>,
  );

  const totalIssues = validationResult
    ? validationResult.errors.length + validationResult.warnings.length
    : 0;

  const isLandingDestination = newTo.startsWith("/landing");

  const stripLocalePrefix = (url: string) =>
    url.replace(/^\/(en|es)(\/|$)/, "/");

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

  const handleOpenAddDialog = () => {
    setNewFrom("");
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
    setShowAddDialog(true);
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

      setShowAddDialog(false);
      queryClient.invalidateQueries({ queryKey: ["/api/debug/redirects"] });
      runValidation();
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

  const handleDeleteRedirect = async (redirect?: Redirect | null) => {
    const target = redirect ?? deletingRedirect;
    if (!target) return;

    setIsDeleting(true);
    try {
      await apiRequest("DELETE", "/api/debug/redirects", {
        from: target.from,
        source: target.source,
        author: getDebugUserName(),
      });

      if (dontAskAgainDelete) {
        setSkipDeleteConfirmUntil(Date.now() + SKIP_DELETE_CONFIRM_MS);
      }

      toast({
        title: "Redirect deleted",
        description: `${target.from} has been removed`,
      });

      setDeletingRedirect(null);
      setDontAskAgainDelete(false);
      queryClient.invalidateQueries({ queryKey: ["/api/debug/redirects"] });
      runValidation();
    } catch (err) {
      toast({
        title: "Failed to delete redirect",
        description: getApiErrorMessage(err),
        variant: "destructive",
      });
    } finally {
      setIsDeleting(false);
    }
  };

  const requestDeleteRedirect = (redirect: Redirect) => {
    if (Date.now() < getSkipDeleteConfirmUntil()) {
      void handleDeleteRedirect(redirect);
      return;
    }
    setDontAskAgainDelete(false);
    setDeletingRedirect(redirect);
  };

  const [removingFrom, setRemovingFrom] = useState<string | null>(null);

  const removeIssueFromValidation = (redirectUrl: string) => {
    setValidationResult((prev) => {
      if (!prev) return prev;
      const matchesUrl = (issue: ValidationIssue) => issue.message.includes(`"${redirectUrl}"`);
      return {
        ...prev,
        errors: prev.errors.filter((e) => !matchesUrl(e)),
        warnings: prev.warnings.filter((w) => !matchesUrl(w)),
      };
    });
  };

  const handleRemoveFromFile = async (redirectUrl: string, source: string) => {
    const key = `${redirectUrl}::${source}`;
    setRemovingFrom(key);
    try {
      const res = await apiRequest("DELETE", "/api/debug/redirects", {
        from: redirectUrl,
        source,
        author: getDebugUserName(),
      });
      const data = await res.json();
      toast({ title: "Removed", description: data.message || `Removed from ${source}` });
      removeIssueFromValidation(redirectUrl);
      queryClient.invalidateQueries({ queryKey: ["/api/debug/redirects"] });
    } catch (err) {
      toast({
        title: "Failed to remove",
        description: getApiErrorMessage(err),
        variant: "destructive",
      });
    } finally {
      setRemovingFrom(null);
    }
  };

  const handleRemoveFromBoth = async (redirectUrl: string, files: string[]) => {
    const key = `${redirectUrl}::both`;
    setRemovingFrom(key);
    try {
      for (const source of files) {
        await apiRequest("DELETE", "/api/debug/redirects", {
          from: redirectUrl,
          source,
          author: getDebugUserName(),
        });
      }
      toast({ title: "Removed from both", description: `Removed "${redirectUrl}" from all sources` });
      removeIssueFromValidation(redirectUrl);
      queryClient.invalidateQueries({ queryKey: ["/api/debug/redirects"] });
    } catch (err) {
      toast({
        title: "Failed to remove",
        description: getApiErrorMessage(err),
        variant: "destructive",
      });
    } finally {
      setRemovingFrom(null);
    }
  };

  const handleTogglePriority = async (redirect: Redirect, targetPriority?: "before" | "fallback") => {
    const newPriority = targetPriority || (redirect.priority === "fallback" ? "before" : "fallback");
    if ((redirect.priority || "before") === newPriority) return;
    try {
      await apiRequest("PATCH", "/api/debug/redirects/priority", {
        from: redirect.from,
        priority: newPriority,
        author: getDebugUserName(),
      });
      queryClient.invalidateQueries({ queryKey: ["/api/debug/redirects"] });
    } catch (err) {
      toast({
        title: "Failed to update priority",
        description: getApiErrorMessage(err),
        variant: "destructive",
      });
    }
  };

  const startInlineEdit = (redirect: Redirect, field: "from" | "to") => {
    if (!isCustomRedirect(redirect) || !hasRegexChars(redirect.from)) return;
    if (field === "to" && typeof redirect.to !== "string") return;
    const initial = field === "from" ? redirect.from : String(redirect.to);
    editDraftRef.current = initial;
    setEditDraft(initial);
    setEditingKey(`${redirect.from}::${field}`);
  };

  const cancelInlineEdit = () => {
    setEditingKey(null);
    editDraftRef.current = "";
    setEditDraft("");
  };

  const handleSaveInlineEdit = async (redirect: Redirect, field: "from" | "to") => {
    const trimmed = editDraftRef.current.trim();
    if (!trimmed) {
      toast({
        title: "Value required",
        description: "Pattern or destination cannot be empty",
        variant: "destructive",
      });
      return;
    }
    if (field === "from" && !hasRegexChars(trimmed)) {
      toast({
        title: "Invalid pattern",
        description: "Edited origin must remain a regex pattern",
        variant: "destructive",
      });
      return;
    }
    const current = field === "from" ? redirect.from : String(redirect.to);
    if (trimmed === current) {
      cancelInlineEdit();
      return;
    }

    setIsSavingEdit(true);
    try {
      await apiRequest("PATCH", "/api/debug/redirects", {
        from: redirect.from,
        ...(field === "from" ? { newFrom: trimmed } : { newTo: trimmed }),
        author: getDebugUserName(),
      });
      toast({
        title: "Redirect updated",
        description:
          field === "from"
            ? `${redirect.from} → ${trimmed}`
            : `${redirect.from} now points to ${trimmed}`,
      });
      cancelInlineEdit();
      await queryClient.invalidateQueries({ queryKey: ["/api/debug/redirects"] });
    } catch (err) {
      toast({
        title: "Failed to update redirect",
        description: getApiErrorMessage(err),
        variant: "destructive",
      });
    } finally {
      setIsSavingEdit(false);
    }
  };

  const handleReorderCustomRedirect = async (fromIndex: number, toIndex: number) => {
    const allCustomRedirects = redirects.filter((r) => isCustomRedirect(r));
    const reordered = [...allCustomRedirects];
    const [moved] = reordered.splice(fromIndex, 1);
    reordered.splice(toIndex, 0, moved);
    await apiRequest("PATCH", "/api/debug/redirects/reorder", {
      redirects: reordered.map((r) => ({ from: r.from, to: r.to, status: r.status, priority: r.priority })),
      author: getDebugUserName(),
    });
    queryClient.invalidateQueries({ queryKey: ["/api/debug/redirects"] });
  };

  if (!isAuthorized) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardHeader>
            <CardTitle>Access Denied</CardTitle>
            <CardDescription>
              This page requires debug mode. Add{" "}
              <code className="bg-muted px-1 rounded">?debug=true</code> to the
              URL.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/">
              <Button variant="outline" data-testid="link-back-home">
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back to Home
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="border-b">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <Link href="/">
                <Button
                  variant="ghost"
                  size="icon"
                  data-testid="link-back-home"
                >
                  <ArrowLeft className="w-4 h-4" />
                </Button>
              </Link>
              <div>
                <h1 className="text-xl font-bold flex items-center gap-2">
                  <Route className="w-5 h-5" />
                  URL Redirects
                </h1>
                <p className="text-sm text-muted-foreground">
                  {redirects.length} redirect{redirects.length !== 1 ? "s" : ""}{" "}
                  configured
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {validationResult && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowValidation(!showValidation)}
                  data-testid="button-toggle-validation"
                >
                  {validationResult.status === "passed" ? (
                    <Popover>
                      <PopoverTrigger asChild>
                        <Badge
                          variant="secondary"
                          className="gap-1 cursor-pointer bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
                        >
                          <CircleCheck className="h-3.5 w-3.5" />
                          Passed
                        </Badge>
                      </PopoverTrigger>
                      <PopoverContent
                        className="w-64 text-sm"
                        side="bottom"
                        align="start"
                      >
                        <div className="space-y-2">
                          <p className="font-medium">All tests passed</p>
                          <p className="text-muted-foreground text-xs">
                            No redirect conflicts, loops, or self-redirects were
                            found. All redirects are properly configured and
                            pointing to valid destinations.
                          </p>
                        </div>
                      </PopoverContent>
                    </Popover>
                  ) : validationResult.status === "warning" ? (
                    <Badge variant="outline" className="gap-1">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      {totalIssues} warning{totalIssues !== 1 ? "s" : ""}
                    </Badge>
                  ) : (
                    <Badge variant="destructive" className="gap-1">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      {totalIssues} issue{totalIssues !== 1 ? "s" : ""}
                    </Badge>
                  )}
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon"
                onClick={runValidation}
                disabled={isValidating}
                title="Run validation"
                data-testid="button-run-validation"
              >
                {isValidating ? (
                  <div className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-solid border-current border-r-transparent" />
                ) : (
                  <TestTube className="h-4 w-4" />
                )}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() =>
                  setShowSearch((prev) => {
                    if (prev) setSearch("");
                    return !prev;
                  })
                }
                data-testid="button-toggle-search"
              >
                <Search className="h-4 w-4" />
              </Button>
              <Button
                variant="default"
                size="sm"
                onClick={handleOpenAddDialog}
                data-testid="button-add-redirect"
              >
                <Plus className="h-3.5 w-3.5 mr-1" />
                Add redirect
              </Button>
            </div>
          </div>
        </div>
      </div>
      {showSearch && (
        <div
          className="border-b"
          style={{ background: "hsl(var(--muted-foreground) / 0.03)" }}
        >
          <div className="container mx-auto px-4 py-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search redirects..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
                autoFocus
                data-testid="input-search-redirects"
              />
            </div>
          </div>
        </div>
      )}
      <div className="border-b" style={{ background: "hsl(var(--muted-foreground) / 0.03)" }}>
        <div className="container mx-auto px-4 py-3">
          <div className="flex flex-col gap-3">
            <div className="flex items-start gap-2 text-xs text-muted-foreground">
              <Info className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
              <span>
                Redirects take effect immediately — no server restart needed.
                Browsers cache 301 redirects aggressively, so test changes in an incognito window if a redirect seems stuck.
              </span>
            </div>
            <div className="space-y-2">
              <div className="relative">
                <TestTube className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Test a URL — paste a full link or a path like /us/coding-bootcamp/some-article"
                  value={testRedirectUrl}
                  onChange={(e) => setTestRedirectUrl(e.target.value)}
                  className="pl-9 pr-8"
                  data-testid="input-test-redirect-url"
                />
                {testRedirectUrl && (
                  <button
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    onClick={() => setTestRedirectUrl("")}
                    data-testid="button-clear-test-url"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              {isTestingRedirect && (
                <p className="text-xs text-muted-foreground" data-testid="status-testing-redirect">Checking...</p>
              )}
              {!isTestingRedirect && testRedirectResult && (
                testRedirectResult.match ? (
                  <div className="rounded-md border p-3 space-y-2" data-testid="result-redirect-match">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge
                        variant={testRedirectResult.destinationExists === false ? "destructive" : "secondary"}
                        className={`gap-1 ${testRedirectResult.destinationExists === false ? "" : "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"}`}
                      >
                        {testRedirectResult.destinationExists === false ? (
                          <AlertTriangle className="h-3 w-3" />
                        ) : (
                          <CircleCheck className="h-3 w-3" />
                        )}
                        {testRedirectResult.destinationExists === false ? "Redirect found to a 404" : "Redirect found"}
                      </Badge>
                      <Badge variant="outline" className="font-mono text-xs">
                        {testRedirectResult.status}
                      </Badge>
                      <Badge variant="outline" className="text-xs">
                        {testRedirectResult.priority}
                      </Badge>
                      {testRedirectResult.matchType === "regex" && (
                        <Badge variant="outline" className="text-xs font-mono">regex</Badge>
                      )}
                    </div>
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2 text-xs">
                        <span className="text-muted-foreground flex-shrink-0">Rule:</span>
                        <code className="bg-muted px-2 py-0.5 rounded truncate">{testRedirectResult.from}</code>
                      </div>
                      <div className="flex items-center gap-2 text-xs">
                        <span className="text-muted-foreground flex-shrink-0">Destination:</span>
                        <code className="bg-muted px-2 py-0.5 rounded truncate">{testRedirectResult.resolvedTo}</code>
                        <a
                          href={testRedirectResult.resolvedTo}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="p-0.5 rounded hover:bg-muted flex-shrink-0"
                          data-testid="link-test-redirect-destination"
                        >
                          <ExternalLink className="h-3 w-3 text-muted-foreground" />
                        </a>
                      </div>
                      {testRedirectResult.captureGroups && testRedirectResult.captureGroups.length > 0 && (
                        <div className="flex items-center gap-2 text-xs flex-wrap">
                          <span className="text-muted-foreground flex-shrink-0">Groups:</span>
                          {testRedirectResult.captureGroups.map((g, i) => (
                            <span key={i} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-muted text-xs">
                              <span className="font-mono font-medium">${i + 1}</span>
                              <span className="text-muted-foreground">=</span>
                              <span>{g}</span>
                            </span>
                          ))}
                        </div>
                      )}
                      <div className="flex items-center gap-2 text-xs">
                        <span className="text-muted-foreground flex-shrink-0">Source:</span>
                        <span className="text-muted-foreground">{formatPath(testRedirectResult.source || "")}</span>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-md border p-3 space-y-1" data-testid="result-redirect-no-match">
                    {(() => {
                      let displayPath = testRedirectUrl.trim();
                      try {
                        if (/^https?:\/\//i.test(displayPath)) displayPath = new URL(displayPath).pathname;
                      } catch {}
                      displayPath = displayPath.split("?")[0].split("#")[0];
                      if (!displayPath.startsWith("/")) displayPath = "/" + displayPath;
                      return testRedirectResult.pageExists ? (
                        <>
                          <p className="text-xs text-muted-foreground">
                            No redirect matches — this URL loads an existing page directly.
                          </p>
                          <div className="flex items-center gap-2 text-xs">
                            <span className="text-muted-foreground flex-shrink-0">Page:</span>
                            <code className="bg-muted px-2 py-0.5 rounded truncate">{displayPath}</code>
                            <a
                              href={displayPath}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="p-0.5 rounded hover:bg-muted flex-shrink-0"
                              data-testid="link-test-page-destination"
                            >
                              <ExternalLink className="h-3 w-3 text-muted-foreground" />
                            </a>
                          </div>
                        </>
                      ) : (
                        <p className="text-xs text-muted-foreground">
                          No redirect matches and no page exists at <code className="bg-muted px-1.5 py-0.5 rounded">{displayPath}</code> — visitors would see a 404.
                        </p>
                      );
                    })()}
                  </div>
                )
              )}
            </div>
          </div>
        </div>
      </div>
      {showValidation && validationResult && (
        <div
          className="border-b"
          style={{ background: "hsl(var(--muted-foreground) / 0.05)" }}
        >
          <div className="container mx-auto px-4 py-4">
            <button
              onClick={() => setValidationExpanded(!validationExpanded)}
              className="flex items-center gap-2 w-full text-left"
              data-testid="button-toggle-validation-details"
            >
              <ChevronRight
                className={`h-4 w-4 text-muted-foreground transition-transform ${validationExpanded ? "rotate-90" : ""}`}
              />
              <ShieldCheck className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">Validation Results</span>
              <span className="text-xs text-muted-foreground">
                ({validationResult.duration}ms)
              </span>
              <div className="flex items-center gap-2 ml-auto">
                {totalIssues === 0 ? (
                  <Badge variant="secondary" className="text-xs gap-1">
                    <CircleCheck className="h-3 w-3" />
                    All passed
                  </Badge>
                ) : (
                  <>
                    {validationResult.errors.length > 0 && (
                      <Badge variant="destructive" className="text-xs">
                        {validationResult.errors.length} error
                        {validationResult.errors.length !== 1 ? "s" : ""}
                      </Badge>
                    )}
                    {validationResult.warnings.length > 0 && (
                      <Badge variant="secondary" className="text-xs">
                        {validationResult.warnings.length} warning
                        {validationResult.warnings.length !== 1 ? "s" : ""}
                      </Badge>
                    )}
                  </>
                )}
              </div>
            </button>
            {validationExpanded && (
              <div className="mt-3 space-y-2">
                {totalIssues === 0 ? (
                  <div className="flex items-center gap-2 px-3 py-2 rounded-md border text-sm">
                    <CircleCheck className="h-4 w-4 flex-shrink-0" />
                    All redirect checks passed. No conflicts, loops, or
                    self-redirects found.
                  </div>
                ) : (
                  <>
                    {validationResult.errors.map((issue, i) => {
                      const conflict = parseRedirectConflict(issue);
                      return (
                        <div
                          key={`err-${i}`}
                          className="flex items-start gap-3 px-3 py-2 rounded-md border bg-destructive/5 border-destructive/20"
                          data-testid={`validation-error-${i}`}
                        >
                          <AlertTriangle className="h-4 w-4 text-destructive flex-shrink-0 mt-0.5" />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <Badge variant="destructive" className="text-xs">
                                {issue.code}
                              </Badge>
                              {issue.file && (
                                <span className="text-xs text-muted-foreground truncate">
                                  {formatPath(issue.file || "")}
                                </span>
                              )}
                            </div>
                            <p className="text-sm mt-1">
                              {formatValidationText(issue.message, formatPath)}
                            </p>
                            {issue.suggestion && (
                              <p className="text-xs text-muted-foreground mt-1">
                                {formatValidationText(issue.suggestion || "", formatPath)}
                              </p>
                            )}
                            {conflict && conflict.files.length >= 2 && (
                              <div className="flex items-center gap-2 mt-2 flex-wrap">
                                {conflict.files.map((file, fi) => (
                                  <Button
                                    key={file}
                                    variant="outline"
                                    size="sm"
                                    className="text-xs gap-1.5"
                                    disabled={removingFrom !== null}
                                    onClick={() => handleRemoveFromFile(conflict.redirectUrl, file)}
                                    data-testid={`button-remove-from-${fi}-err-${i}`}
                                  >
                                    <Trash2 className="h-3 w-3" />
                                    {removingFrom === `${conflict.redirectUrl}::${file}`
                                      ? "Removing..."
                                      : removeFromFileLabel(conflict.files, fi, formatPath)}
                                  </Button>
                                ))}
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="text-xs gap-1.5 text-destructive"
                                  disabled={removingFrom !== null}
                                  onClick={() => handleRemoveFromBoth(conflict.redirectUrl, conflict.files)}
                                  data-testid={`button-remove-both-err-${i}`}
                                >
                                  <Trash2 className="h-3 w-3" />
                                  {removingFrom === `${conflict.redirectUrl}::both` ? "Removing..." : "Remove from both"}
                                </Button>
                              </div>
                            )}
                            {conflict && conflict.files.length === 1 && (
                              <div className="flex items-center gap-2 mt-2">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="text-xs gap-1.5"
                                  disabled={removingFrom !== null}
                                  onClick={() => handleRemoveFromFile(conflict.redirectUrl, conflict.files[0])}
                                  data-testid={`button-remove-err-${i}`}
                                >
                                  <Trash2 className="h-3 w-3" />
                                  {removingFrom === `${conflict.redirectUrl}::${conflict.files[0]}`
                                    ? "Removing..."
                                    : removeFromFileLabel(conflict.files, 0, formatPath)}
                                </Button>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                    {validationResult.warnings.map((issue, i) => {
                      const conflict = parseRedirectConflict(issue);
                      return (
                        <div
                          key={`warn-${i}`}
                          className="flex items-start gap-3 px-3 py-2 rounded-md border"
                          style={{
                            background: "hsl(var(--muted-foreground) / 0.03)",
                          }}
                          data-testid={`validation-warning-${i}`}
                        >
                          <AlertTriangle className="h-4 w-4 text-yellow-600 dark:text-yellow-400 flex-shrink-0 mt-0.5" />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <Badge variant="secondary" className="text-xs">
                                {issue.code}
                              </Badge>
                              {issue.file && (
                                <span className="text-xs text-muted-foreground truncate">
                                  {formatPath(issue.file || "")}
                                </span>
                              )}
                            </div>
                            <p className="text-sm mt-1">
                              {formatValidationText(issue.message, formatPath)}
                            </p>
                            {issue.suggestion && (
                              <p className="text-xs text-muted-foreground mt-1">
                                {formatValidationText(issue.suggestion || "", formatPath)}
                              </p>
                            )}
                            {conflict && conflict.files.length >= 2 && (
                              <div className="flex items-center gap-2 mt-2 flex-wrap">
                                {conflict.files.map((file, fi) => (
                                  <Button
                                    key={file}
                                    variant="outline"
                                    size="sm"
                                    className="text-xs gap-1.5"
                                    disabled={removingFrom !== null}
                                    onClick={() => handleRemoveFromFile(conflict.redirectUrl, file)}
                                    data-testid={`button-remove-from-${fi}-warn-${i}`}
                                  >
                                    <Trash2 className="h-3 w-3" />
                                    {removingFrom === `${conflict.redirectUrl}::${file}`
                                      ? "Removing..."
                                      : removeFromFileLabel(conflict.files, fi, formatPath)}
                                  </Button>
                                ))}
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="text-xs gap-1.5 text-destructive"
                                  disabled={removingFrom !== null}
                                  onClick={() => handleRemoveFromBoth(conflict.redirectUrl, conflict.files)}
                                  data-testid={`button-remove-both-warn-${i}`}
                                >
                                  <Trash2 className="h-3 w-3" />
                                  {removingFrom === `${conflict.redirectUrl}::both` ? "Removing..." : "Remove from both"}
                                </Button>
                              </div>
                            )}
                            {conflict && conflict.files.length === 1 && (
                              <div className="flex items-center gap-2 mt-2">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="text-xs gap-1.5"
                                  disabled={removingFrom !== null}
                                  onClick={() => handleRemoveFromFile(conflict.redirectUrl, conflict.files[0])}
                                  data-testid={`button-remove-warn-${i}`}
                                >
                                  <Trash2 className="h-3 w-3" />
                                  {removingFrom === `${conflict.redirectUrl}::${conflict.files[0]}`
                                    ? "Removing..."
                                    : removeFromFileLabel(conflict.files, 0, formatPath)}
                                </Button>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}
      <div className="container mx-auto px-4 py-6">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-current border-r-transparent" />
          </div>
        ) : filteredRedirects.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              {search
                ? "No redirects match your search"
                : "No redirects configured"}
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {Object.entries(groupedByType).map(([type, typeRedirects]) => {
              const isExpanded = expandedType === type;
              return (
                <div key={type}>
                  <button
                    onClick={() => setExpandedType(isExpanded ? null : type)}
                    className="flex items-center gap-3 w-full px-4 py-3 rounded-md text-sm hover-elevate"
                    data-testid={`button-toggle-${type}`}
                  >
                    <ChevronRight
                      className={`h-4 w-4 text-muted-foreground transition-transform ${isExpanded ? "rotate-90" : ""}`}
                    />
                    <Badge variant="secondary">{type}</Badge>
                    <span className="text-muted-foreground font-normal text-sm">
                      {typeRedirects.length} redirect
                      {typeRedirects.length !== 1 ? "s" : ""}
                    </span>
                  </button>
                  {isExpanded && (
                    <div className="ml-4 mt-1 border rounded-lg divide-y overflow-hidden">
                      {(() => {
                        const allCustomRedirects = redirects.filter((r) =>
                          isCustomRedirect(r),
                        );
                        return typeRedirects.map((redirect, index) => {
                        const isCustom = isCustomRedirect(redirect);
                        const isEditableRegex =
                          isCustom && hasRegexChars(redirect.from);
                        const globalCustomIndex = isCustom
                          ? allCustomRedirects.findIndex((r) => r.from === redirect.from && r.to === redirect.to)
                          : -1;
                        const isFirstCustom = globalCustomIndex === 0;
                        const isLastCustom = globalCustomIndex === allCustomRedirects.length - 1;
                        const editingFrom = editingKey === `${redirect.from}::from`;
                        const editingTo = editingKey === `${redirect.from}::to`;
                        return (
                          <div
                            key={`${redirect.from}-${index}`}
                            className="flex items-center gap-3 px-4 py-3 text-sm hover:bg-muted/50 transition-colors"
                            data-testid={`redirect-row-${type}-${index}`}
                          >
                            {isCustom && (
                              <div className="flex flex-col flex-shrink-0" style={{ gap: 0 }}>
                                <button
                                  className={`h-5 w-5 flex items-center justify-center text-muted-foreground${isFirstCustom ? " opacity-30 pointer-events-none" : ""}`}
                                  onClick={() => handleReorderCustomRedirect(globalCustomIndex, globalCustomIndex - 1)}
                                  disabled={isFirstCustom}
                                  data-testid={`button-move-up-${index}`}
                                >
                                  <ChevronUp className="h-3.5 w-3.5" />
                                </button>
                                <button
                                  className={`h-5 w-5 flex items-center justify-center text-muted-foreground${isLastCustom ? " opacity-30 pointer-events-none" : ""}`}
                                  onClick={() => handleReorderCustomRedirect(globalCustomIndex, globalCustomIndex + 1)}
                                  disabled={isLastCustom}
                                  data-testid={`button-move-down-${index}`}
                                >
                                  <ChevronDown className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            )}
                            <div className="flex-1 min-w-0 flex items-center gap-1.5">
                              {editingFrom ? (
                                <div className="flex items-center gap-1 flex-1 min-w-0">
                                  <Input
                                    value={editDraft}
                                    onChange={(e) => {
                                      editDraftRef.current = e.target.value;
                                      setEditDraft(e.target.value);
                                    }}
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter") {
                                        e.preventDefault();
                                        void handleSaveInlineEdit(redirect, "from");
                                      } else if (e.key === "Escape") {
                                        cancelInlineEdit();
                                      }
                                    }}
                                    disabled={isSavingEdit}
                                    autoFocus
                                    className="h-7 text-xs font-mono flex-1"
                                    data-testid={`input-edit-from-${type}-${index}`}
                                  />
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7 flex-shrink-0"
                                    disabled={isSavingEdit}
                                    onMouseDown={(e) => e.preventDefault()}
                                    onClick={() => void handleSaveInlineEdit(redirect, "from")}
                                    title="Save"
                                    data-testid={`button-save-from-${type}-${index}`}
                                  >
                                    <Check className="h-3.5 w-3.5" />
                                  </Button>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7 flex-shrink-0"
                                    disabled={isSavingEdit}
                                    onMouseDown={(e) => e.preventDefault()}
                                    onClick={cancelInlineEdit}
                                    title="Cancel"
                                    data-testid={`button-cancel-from-${type}-${index}`}
                                  >
                                    <X className="h-3.5 w-3.5" />
                                  </Button>
                                </div>
                              ) : isEditableRegex ? (
                                <button
                                  type="button"
                                  className="text-xs bg-muted px-2 py-1 rounded truncate text-left min-w-0 max-w-full cursor-pointer hover:ring-1 hover:ring-ring inline-flex items-center gap-1.5"
                                  onClick={() => startInlineEdit(redirect, "from")}
                                  title="Click to edit regex"
                                  data-testid={`code-from-${type}-${index}`}
                                >
                                  <code className="font-mono truncate">{redirect.from}</code>
                                  <Pencil className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                                </button>
                              ) : (
                                <code className="text-xs bg-muted px-2 py-1 rounded block truncate">
                                  {redirect.from}
                                </code>
                              )}
                              {hasRegexChars(redirect.from) && (
                                <Badge variant="outline" className="text-[10px] px-1.5 py-0 flex-shrink-0 font-mono">
                                  regex
                                </Badge>
                              )}
                              {isCustom ? (
                                <Popover>
                                  <PopoverTrigger asChild>
                                    <button
                                      className="flex-shrink-0"
                                      data-testid={`button-toggle-priority-${index}`}
                                    >
                                      <Badge
                                        variant="outline"
                                        className={`text-[10px] px-1.5 py-0 cursor-pointer gap-0.5 ${
                                          redirect.priority === "fallback"
                                            ? "bg-primary/10"
                                            : ""
                                        }`}
                                      >
                                        {redirect.priority === "fallback" && (
                                          <AlertTriangle className="h-2.5 w-2.5" />
                                        )}
                                        {redirect.priority === "fallback" ? "fallback" : "before"}
                                      </Badge>
                                    </button>
                                  </PopoverTrigger>
                                  <PopoverContent className="w-72 p-0" align="start" side="bottom">
                                    <div className="p-3 space-y-2">
                                      <p className="text-xs font-medium">When should this redirect apply?</p>
                                      <div className="flex border rounded-md overflow-hidden">
                                        {[
                                          {
                                            value: "before" as const,
                                            label: "Before",
                                            desc: "Always redirects, even if a real page exists at this URL.",
                                          },
                                          {
                                            value: "fallback" as const,
                                            label: "Fallback",
                                            desc: "Only redirects if no real page matches. Real pages take priority.",
                                          },
                                        ].map((option, i) => (
                                          <button
                                            key={option.value}
                                            type="button"
                                            onClick={() => handleTogglePriority(redirect, option.value)}
                                            className={`flex-1 text-left p-2.5 transition-colors ${
                                              i > 0 ? "border-l" : ""
                                            } ${
                                              (redirect.priority || "before") === option.value
                                                ? "bg-primary/15"
                                                : "hover-elevate"
                                            }`}
                                            data-testid={`button-inline-priority-${option.value}-${index}`}
                                          >
                                            <span className="text-xs font-medium">{option.label}</span>
                                            <p className="text-[10px] text-muted-foreground mt-0.5 leading-tight">
                                              {option.desc}
                                            </p>
                                          </button>
                                        ))}
                                      </div>
                                    </div>
                                  </PopoverContent>
                                </Popover>
                              ) : redirect.priority === "fallback" ? (
                                <Badge variant="outline" className="text-[10px] px-1.5 py-0 flex-shrink-0 gap-0.5">
                                  <AlertTriangle className="h-2.5 w-2.5" />
                                  fallback
                                </Badge>
                              ) : null}
                            </div>
                            <Badge
                              variant={
                                redirect.status === 301 || redirect.status === 308
                                  ? "secondary"
                                  : "outline"
                              }
                              className="text-xs flex-shrink-0 font-mono"
                            >
                              {redirect.status}
                            </Badge>
                            <ArrowRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                            <div className="flex-1 min-w-0 flex items-center gap-2">
                              {isLocaleMap(redirect.to) ? (
                                <div className="flex-1 min-w-0 space-y-1">
                                  {Object.entries(redirect.to).map(
                                    ([locale, url]) => (
                                      <div
                                        key={locale}
                                        className="flex items-center gap-1.5"
                                      >
                                        <LocaleFlag locale={locale} />
                                        <code className="text-xs bg-muted px-2 py-0.5 rounded truncate flex-1">
                                          {url}
                                        </code>
                                        <a
                                          href={url}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="p-0.5 rounded hover:bg-muted flex-shrink-0"
                                          data-testid={`link-redirect-target-${type}-${index}-${locale}`}
                                        >
                                          <ExternalLink className="h-3 w-3 text-muted-foreground" />
                                        </a>
                                      </div>
                                    ),
                                  )}
                                </div>
                              ) : editingTo ? (
                                <div className="flex items-center gap-1 flex-1 min-w-0">
                                  <Input
                                    value={editDraft}
                                    onChange={(e) => {
                                      editDraftRef.current = e.target.value;
                                      setEditDraft(e.target.value);
                                    }}
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter") {
                                        e.preventDefault();
                                        void handleSaveInlineEdit(redirect, "to");
                                      } else if (e.key === "Escape") {
                                        cancelInlineEdit();
                                      }
                                    }}
                                    disabled={isSavingEdit}
                                    autoFocus
                                    className="h-7 text-xs font-mono flex-1"
                                    data-testid={`input-edit-to-${type}-${index}`}
                                  />
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7 flex-shrink-0"
                                    disabled={isSavingEdit}
                                    onMouseDown={(e) => e.preventDefault()}
                                    onClick={() => void handleSaveInlineEdit(redirect, "to")}
                                    title="Save"
                                    data-testid={`button-save-to-${type}-${index}`}
                                  >
                                    <Check className="h-3.5 w-3.5" />
                                  </Button>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7 flex-shrink-0"
                                    disabled={isSavingEdit}
                                    onMouseDown={(e) => e.preventDefault()}
                                    onClick={cancelInlineEdit}
                                    title="Cancel"
                                    data-testid={`button-cancel-to-${type}-${index}`}
                                  >
                                    <X className="h-3.5 w-3.5" />
                                  </Button>
                                </div>
                              ) : (
                                <>
                                  {isEditableRegex ? (
                                    <button
                                      type="button"
                                      className="text-xs bg-muted px-2 py-1 rounded truncate text-left flex-1 min-w-0 cursor-pointer hover:ring-1 hover:ring-ring inline-flex items-center gap-1.5"
                                      onClick={() => startInlineEdit(redirect, "to")}
                                      title="Click to edit destination"
                                      data-testid={`code-to-${type}-${index}`}
                                    >
                                      <code className="font-mono truncate">{redirect.to as string}</code>
                                      <Pencil className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                                    </button>
                                  ) : (
                                    <code className="text-xs bg-muted px-2 py-1 rounded block truncate flex-1">
                                      {redirect.to}
                                    </code>
                                  )}
                                  {!/\$\d/.test(redirect.to as string) && !hasRegexChars(redirect.to as string) && (
                                    <a
                                      href={redirect.to as string}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="p-1 rounded hover:bg-muted flex-shrink-0"
                                      title="Open target URL"
                                      data-testid={`link-redirect-target-${type}-${index}`}
                                    >
                                      <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
                                    </a>
                                  )}
                                </>
                              )}
                            </div>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="flex-shrink-0 text-muted-foreground hover:text-destructive"
                              onClick={() => requestDeleteRedirect(redirect)}
                              title="Delete redirect"
                              data-testid={`button-delete-redirect-${type}-${index}`}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        );
                      });
                      })()}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
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

          <div className="space-y-4 py-2">
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
                    const val = e.target.value;
                    setNewFrom(hasRegexChars(val) ? val : val.replace(/\s+/g, "-"));
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
                          } catch (e: any) {
                            testResult = { matches: false, error: e.message };
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
                      locale=""
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
              onClick={() => setShowAddDialog(false)}
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
      <Dialog
        open={!!deletingRedirect}
        onOpenChange={(open) => {
          if (!open) {
            setDeletingRedirect(null);
            setDontAskAgainDelete(false);
          }
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete Redirect</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this redirect? This action cannot
              be undone.
            </DialogDescription>
          </DialogHeader>
          {deletingRedirect && (
            <div className="space-y-3 py-2">
              <div className="rounded-md border p-3 space-y-2">
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground mb-1">From</p>
                  <code className="text-xs bg-muted px-2 py-1 rounded block truncate">
                    {deletingRedirect.from}
                  </code>
                </div>
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground mb-1">To</p>
                  {isLocaleMap(deletingRedirect.to) ? (
                    <div className="space-y-1">
                      {Object.entries(deletingRedirect.to).map(
                        ([locale, url]) => (
                          <div
                            key={locale}
                            className="flex items-center gap-1.5"
                          >
                            <LocaleFlag locale={locale} />
                            <code className="text-xs bg-muted px-2 py-0.5 rounded truncate">
                              {url}
                            </code>
                          </div>
                        ),
                      )}
                    </div>
                  ) : (
                    <code className="text-xs bg-muted px-2 py-1 rounded block truncate">
                      {deletingRedirect.to}
                    </code>
                  )}
                </div>
              </div>
              <label
                className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer select-none"
                data-testid="label-dont-ask-again-delete"
              >
                <Checkbox
                  checked={dontAskAgainDelete}
                  onCheckedChange={(checked) =>
                    setDontAskAgainDelete(checked === true)
                  }
                  data-testid="checkbox-dont-ask-again-delete"
                />
                Don&apos;t ask again for 5 min
              </label>
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setDeletingRedirect(null);
                setDontAskAgainDelete(false);
              }}
              disabled={isDeleting}
              data-testid="button-cancel-delete"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => handleDeleteRedirect()}
              disabled={isDeleting}
              data-testid="button-confirm-delete"
            >
              {isDeleting ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <RedirectConflictResolverModal
        open={resolveModalOpen}
        onOpenChange={setResolveModalOpen}
        conflict={activeConflict}
        onResolved={() => {
          queryClient.invalidateQueries({ queryKey: ["/api/debug/redirects"] });
          runValidation();
        }}
      />
    </div>
  );
}
