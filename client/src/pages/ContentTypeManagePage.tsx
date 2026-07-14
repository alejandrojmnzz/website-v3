import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, ArrowRight, Check, Clipboard, Clock, Code, Copy, Database, Download, ExternalLink, Eye, EyeOff, FileText, Folder, GitBranch, Globe, History, Info, LayoutList, Link as LinkIcon, List, Loader2, MoreVertical, Plus, RefreshCw, Search, Shuffle, SlidersHorizontal, Trash2, Wand2, X } from "lucide-react";
import { IconChevronDown, IconChevronRight, IconExternalLink } from "@tabler/icons-react";
import { queryClient } from "@/lib/queryClient";
import { useState, useEffect, useRef, lazy, Suspense } from "react";
import { Link, useRoute, useLocation } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { getDebugToken, resolveAuthorName } from "@/hooks/useDebugAuth";
import { DeletePageModal } from "@/components/DebugBubble/components/DeletePageModal";
import { CreateContentModal } from "@/components/DebugBubble/components/CreateContentModal";
import type { SitemapUrl } from "@/components/DebugBubble/types";
import { WebhookUrlPopover } from "@/components/WebhookUrlPopover";

const RawFileEditorPanel = lazy(() => import("@/components/editing/RawFileEditorPanel"));

interface ItemsResponse {
  count: number;
  results: Record<string, any>[];
  facets?: Record<string, string[]>;
}

interface CacheStatus {
  exists: boolean;
  age_hours: number | null;
  post_count: number | null;
}

interface StaticEntry {
  slug: string;
  title: string;
  locales: string[];
  urls: Record<string, string>;
  versionCounts?: Record<string, number>;
}

interface FieldMapping {
  [standardField: string]: string | null;
}

interface DatabaseConfig {
  slug: string;
}

interface ContentTypeConfig {
  name: string;
  label: string;
  directory: string;
  field_mapping?: Record<string, string | { source: string; default: string }>;
  indexes?: string[];
  unique_fields?: string[];
  database: DatabaseConfig | null;
  url_pattern: Record<string, string>;
  static_entry_count?: number;
}

interface DatabaseListItem {
  name: string;
  label: string;
  description: string | null;
  source_type: string;
}

interface LocaleEntry {
  code: string;
  label: string;
}

interface LocaleSettings {
  default_locale: string;
  supported_locales: LocaleEntry[];
}

function detectPatternMode(urlPattern: Record<string, string>): {
  mode: "non-localized" | "shorthand" | "per-locale";
  nonLocalizedPattern: string;
  shorthandPattern: string;
  localePatterns: { locale: string; path: string }[];
} {
  const keys = Object.keys(urlPattern);

  if (keys.length === 1 && keys[0] === "default") {
    return {
      mode: "non-localized",
      nonLocalizedPattern: urlPattern.default,
      shorthandPattern: "",
      localePatterns: [],
    };
  }

  const localeKeys = keys.filter(k => k !== "default");
  if (localeKeys.length > 0) {
    const suffixes = localeKeys.map(locale => {
      const val = urlPattern[locale];
      const prefix = `/${locale}`;
      return val.startsWith(prefix) ? val.slice(prefix.length) : null;
    });
    const allValid = suffixes.every(s => s !== null);
    const allSame = allValid && suffixes.every(s => s === suffixes[0]);

    if (allSame && suffixes[0] !== null) {
      return {
        mode: "shorthand",
        nonLocalizedPattern: "",
        shorthandPattern: suffixes[0] as string,
        localePatterns: localeKeys.map((locale, i) => ({ locale, path: suffixes[i] as string })),
      };
    }

    return {
      mode: "per-locale",
      nonLocalizedPattern: "",
      shorthandPattern: "",
      localePatterns: localeKeys.map(locale => {
        const val = urlPattern[locale];
        const prefix = `/${locale}`;
        return { locale, path: val.startsWith(prefix) ? val.slice(prefix.length) : val };
      }),
    };
  }

  return { mode: "shorthand", nonLocalizedPattern: "", shorthandPattern: "", localePatterns: [] };
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  try {
    return new Date(dateStr).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return "—";
  }
}

function StatusBadge({ status }: { status: string }) {
  const normalized = status?.toLowerCase() || "unknown";
  if (normalized === "published") {
    return <Badge variant="default" data-testid="badge-status-published"><Check className="h-3 w-3 mr-1" />Published</Badge>;
  }
  if (normalized === "draft") {
    return <Badge variant="secondary" data-testid="badge-status-draft"><Clock className="h-3 w-3 mr-1" />Draft</Badge>;
  }
  return <Badge variant="outline" data-testid={`badge-status-${normalized}`}>{status}</Badge>;
}

function VisibilityIcon({ visibility }: { visibility: string }) {
  if (visibility?.toLowerCase() === "public") {
    return <Eye className="h-4 w-4 text-muted-foreground" />;
  }
  return <EyeOff className="h-4 w-4 text-muted-foreground" />;
}

function SearchableFieldSelect({
  value,
  onValueChange,
  dbFields,
  rawFields,
  placeholder,
  testId,
}: {
  value: string;
  onValueChange: (v: string) => void;
  dbFields: string[];
  rawFields: string[];
  placeholder?: string;
  testId?: string;
}) {
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  useEffect(() => {
    if (open && inputRef.current) {
      inputRef.current.focus();
    }
  }, [open]);

  const q = searchQuery.toLowerCase();
  const filteredDb = q ? dbFields.filter((f) => f.toLowerCase().includes(q)) : dbFields;
  const filteredRaw = q ? rawFields.filter((f) => f.toLowerCase().includes(q)) : rawFields;

  const displayValue = value === "__none__" || !value ? (placeholder || "(not mapped)") : value;

  return (
    <div className="relative flex-1" ref={containerRef}>
      <button
        type="button"
        className="flex h-8 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-1 text-xs font-mono ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
        onClick={() => { setOpen(!open); setSearchQuery(""); }}
        data-testid={testId}
      >
        <span className={!value || value === "__none__" ? "text-muted-foreground" : ""}>
          {displayValue}
        </span>
        <Search className="h-3 w-3 text-muted-foreground ml-1 flex-shrink-0" />
      </button>
      {open && (
        <div className="absolute z-[10002] top-full left-0 mt-1 w-full min-w-[240px] max-h-64 overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md">
          <div className="p-1.5 border-b">
            <Input
              ref={inputRef}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search fields..."
              className="h-7 text-xs"
              data-testid={testId ? `${testId}-search` : undefined}
              onKeyDown={(e) => {
                if (e.key === "Escape") setOpen(false);
              }}
            />
          </div>
          <div className="overflow-y-auto max-h-48">
            <div
              className="px-2 py-1.5 text-xs cursor-pointer hover:bg-muted rounded-sm mx-1 my-0.5 text-muted-foreground"
              onClick={() => { onValueChange("__none__"); setOpen(false); }}
            >
              (not mapped)
            </div>
            {filteredDb.length > 0 && (
              <>
                <div className="px-2 py-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                  Database Fields
                </div>
                {filteredDb.map((f) => (
                  <div
                    key={`db-${f}`}
                    className={`px-2 py-1.5 text-xs font-mono cursor-pointer hover:bg-muted rounded-sm mx-1 my-0.5 flex items-center gap-1.5 ${value === f || value === `db.${f}` ? "bg-muted font-medium" : ""}`}
                    onClick={() => { onValueChange(f); setOpen(false); }}
                  >
                    {(value === f || value === `db.${f}`) && <Check className="h-3 w-3 flex-shrink-0" />}
                    {f}
                  </div>
                ))}
              </>
            )}
            {filteredRaw.length > 0 && (
              <>
                <div className="px-2 py-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mt-1 border-t pt-1.5">
                  Raw API Fields
                </div>
                {filteredRaw.map((f) => (
                  <div
                    key={`raw-${f}`}
                    className={`px-2 py-1.5 text-xs font-mono cursor-pointer hover:bg-muted rounded-sm mx-1 my-0.5 flex items-center gap-1.5 ${value === `raw.${f}` ? "bg-muted font-medium" : ""}`}
                    onClick={() => { onValueChange(`raw.${f}`); setOpen(false); }}
                  >
                    {value === `raw.${f}` && <Check className="h-3 w-3 flex-shrink-0" />}
                    <span className="text-muted-foreground">raw.</span>{f}
                  </div>
                ))}
              </>
            )}
            {filteredDb.length === 0 && filteredRaw.length === 0 && (
              <div className="px-2 py-3 text-xs text-muted-foreground text-center">
                No fields match "{searchQuery}"
              </div>
            )}
            <div className="border-t mx-1 mt-1 pt-0.5 mb-0.5">
              <div
                className="px-2 py-1.5 text-xs cursor-pointer hover:bg-muted rounded-sm text-muted-foreground"
                onClick={() => { onValueChange("__custom__"); setOpen(false); }}
              >
                Custom path...
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const WIZARD_STEPS = [
  { id: "database", label: "Database", icon: Database },
  { id: "preview", label: "Inspect", icon: Eye },
  { id: "identity", label: "Identity", icon: LinkIcon },
  { id: "mapping", label: "Mapping", icon: LayoutList },
  { id: "indexes", label: "Indexes", icon: FileText },
] as const;

type WizardStep = typeof WIZARD_STEPS[number]["id"];


function StepIndicator({ steps, currentStep, completedSteps }: {
  steps: typeof WIZARD_STEPS;
  currentStep: WizardStep;
  completedSteps: Set<WizardStep>;
}) {
  const currentIndex = steps.findIndex((s) => s.id === currentStep);

  return (
    <div className="flex items-center gap-1 px-1" data-testid="wizard-step-indicator">
      {steps.map((step, i) => {
        const isActive = step.id === currentStep;
        const isCompleted = completedSteps.has(step.id);
        const isPast = i < currentIndex;
        const StepIcon = step.icon;

        return (
          <div key={step.id} className="flex items-center gap-1 flex-1">
            <div className="flex items-center gap-1.5 flex-1 min-w-0">
              <div
                className={`flex items-center justify-center w-6 h-6 rounded-full flex-shrink-0 text-xs font-medium transition-colors ${
                  isActive
                    ? "bg-primary text-primary-foreground"
                    : isCompleted || isPast
                      ? "bg-primary/20 text-primary"
                      : "bg-muted text-muted-foreground"
                }`}
                data-testid={`step-indicator-${step.id}`}
              >
                {isCompleted || isPast ? (
                  <Check className="h-3.5 w-3.5" />
                ) : (
                  <StepIcon className="h-3.5 w-3.5" />
                )}
              </div>
              <span
                className={`text-xs truncate ${
                  isActive ? "text-foreground font-medium" : "text-muted-foreground"
                }`}
              >
                {step.label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div
                className={`h-px flex-shrink-0 w-4 ${
                  isPast || isCompleted ? "bg-primary/40" : "bg-border"
                }`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function SampleDataDialog({
  open,
  onOpenChange,
  sampleItems,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sampleItems: Record<string, unknown>[];
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[640px] max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Sample Data ({sampleItems.length} item{sampleItems.length !== 1 ? "s" : ""})</DialogTitle>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto rounded-md bg-muted p-3">
          <pre className="text-xs font-mono whitespace-pre-wrap break-all" data-testid="text-sample-json">
            {JSON.stringify(sampleItems, null, 2)}
          </pre>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-close-sample">
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PartialOverrideDialog({
  open,
  onOpenChange,
  contentTypeLabel,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contentTypeLabel: string;
}) {
  const [showAdvanced, setShowAdvanced] = useState(false);

  useEffect(() => {
    if (!open) setShowAdvanced(false);
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px] max-h-[85vh] flex flex-col overflow-hidden" data-testid="dialog-partial-override">
        <DialogHeader>
          <DialogTitle>Partial Override</DialogTitle>
          <DialogDescription>
            This page appears in both the database and as a static folder for {contentTypeLabel}.
          </DialogDescription>
        </DialogHeader>
        <div className="flex-1 min-h-0 overflow-y-auto space-y-4 text-sm text-muted-foreground pr-1">
          <p>
            The static folder does not replace the database entry. It adds customizations on top — like
            layout or presentation tweaks for this one page.
          </p>
          <div>
            <p className="font-medium text-foreground mb-1">What you can customize here</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Page title and SEO description</li>
              <li>Which sections appear and how they are arranged</li>
              <li>One-off layout changes for this entry only</li>
            </ul>
          </div>
          <div>
            <p className="font-medium text-foreground mb-1">What still comes from the database</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>The main article content (body text, author, dates, etc.)</li>
              <li>The page must still exist in the database — deleting it there breaks the live page</li>
            </ul>
          </div>
          <p>
            Use this when you want one database entry to look different without changing the shared
            template for every entry.
          </p>

          <button
            type="button"
            className="inline-flex items-center gap-1 text-xs text-violet-600 dark:text-violet-400 hover:underline"
            onClick={() => setShowAdvanced((v) => !v)}
            data-testid="button-toggle-partial-override-advanced"
          >
            {showAdvanced ? "Hide advanced details" : "Read more (advanced)"}
            <IconChevronDown
              className={`h-3.5 w-3.5 transition-transform ${showAdvanced ? "rotate-180" : ""}`}
            />
          </button>

          {showAdvanced && (
            <div className="rounded-md border border-border bg-muted/40 p-3 space-y-3 text-xs">
              <div>
                <p className="font-medium text-foreground mb-1">How it works under the hood</p>
                <p>
                  At render time, the YAML folder merges on top of the shared{" "}
                  <code className="text-[11px]">single.&lt;locale&gt;.yml</code> template via{" "}
                  <code className="text-[11px]">mergeSingleTemplate</code>. The database row is still
                  fetched and attached as <code className="text-[11px]">singleEntry</code>.
                </p>
              </div>
              <div>
                <p className="font-medium text-foreground mb-1">YAML merge rules</p>
                <ul className="list-disc pl-5 space-y-1">
                  <li>Sections are patched by <code className="text-[11px]">id</code></li>
                  <li>Sections can be removed with <code className="text-[11px]">_remove: true</code></li>
                  <li>Per-entry files: <code className="text-[11px]">_common.yml</code> and locale files (e.g. <code className="text-[11px]">en.yml</code>)</li>
                </ul>
              </div>
              <div>
                <p className="font-medium text-foreground mb-1">Database dependencies</p>
                <ul className="list-disc pl-5 space-y-1">
                  <li>Template fields using <code className="text-[11px]">{`{{ single.* }}`}</code> resolve from the DB row at render time</li>
                  <li>Public URLs are resolved from the database index (<code className="text-[11px]">byUrl</code>) when the cache is loaded</li>
                  <li>
                    <code className="text-[11px]">loadDatabaseSinglePage</code> returns null without a
                    matching DB row — static YAML alone cannot serve the page on indexed types
                  </li>
                </ul>
              </div>
            </div>
          )}
        </div>
        <DialogFooter className="border-t pt-4">
          <Button onClick={() => onOpenChange(false)} data-testid="button-close-partial-override">
            Got it
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PartialOverrideVersionsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]" data-testid="dialog-partial-override-versions">
        <DialogHeader>
          <DialogTitle>Versioning not available</DialogTitle>
          <DialogDescription>
            Partial overrides do not support A/B versioning.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm text-muted-foreground">
          <p>
            This entry is a partial override — its YAML folder customizes layout and sections on top
            of a database-backed page. Versioning requires a fully static YAML entry and is not wired
            into the database render path.
          </p>
          <p>
            To test layout changes, edit the per-entry YAML directly. To run an A/B test, use a
            fully static entry instead.
          </p>
        </div>
        <DialogFooter className="border-t pt-4">
          <Button onClick={() => onOpenChange(false)} data-testid="button-close-partial-override-versions">
            Got it
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DataSourceDialog({
  open,
  onOpenChange,
  contentType,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contentType: string;
}) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [step, setStep] = useState<WizardStep>("database");
  const [completedSteps, setCompletedSteps] = useState<Set<WizardStep>>(new Set());
  const label = contentType.charAt(0).toUpperCase() + contentType.slice(1);

  const { data: config, isLoading } = useQuery<ContentTypeConfig>({
    queryKey: ["/api/content-types", contentType, "config"],
    queryFn: () => fetch(`/api/content-types/${contentType}/config`).then(r => r.json()),
    enabled: open,
  });

  const { data: databases } = useQuery<DatabaseListItem[]>({
    queryKey: ["/api/databases"],
    enabled: open,
  });

  const [selectedDb, setSelectedDb] = useState("");

  const [fieldMapping, setFieldMapping] = useState<FieldMapping>({});
  const [slugField, setSlugField] = useState("");
  const [localeField, setLocaleField] = useState("");
  const [availableFields, setAvailableFields] = useState<string[]>([]);
  const [fieldMappingNotes, setFieldMappingNotes] = useState("");
  const [fieldMappingError, setFieldMappingError] = useState<string | null>(null);
  const [aiMappingFields, setAiMappingFields] = useState(false);

  const [sampleItems, setSampleItems] = useState<Record<string, unknown>[]>([]);
  const [loadingSample, setLoadingSample] = useState(false);
  const [sampleDialogOpen, setSampleDialogOpen] = useState(false);
  const [deletedFields, setDeletedFields] = useState<string[]>([]);
  const [indexedFields, setIndexedFields] = useState<string[]>([]);
  const [rawFields, setRawFields] = useState<string[]>([]);

  const [transformerModes, setTransformerModes] = useState<Record<string, boolean>>({});
  const [localeIsTransformer, setLocaleIsTransformer] = useState(false);
  const [slugIsTransformer, setSlugIsTransformer] = useState(false);

  const markComplete = (s: WizardStep) => {
    setCompletedSteps((prev) => {
      const next = new Set(Array.from(prev));
      next.add(s);
      return next;
    });
  };

  useEffect(() => {
    if (config) {
      setSelectedDb(config.database?.slug || "");

      if (config.field_mapping) {
        const fm: FieldMapping = {};
        const modes: Record<string, boolean> = {};
        for (const [k, v] of Object.entries(config.field_mapping)) {
          if (!k.startsWith("_")) {
            const raw = typeof v === "object" ? v.source : v;
            if (raw && raw.startsWith("function:")) {
              try {
                fm[k] = atob(raw.slice("function:".length));
                modes[k] = true;
              } catch {
                fm[k] = raw;
              }
            } else {
              fm[k] = raw;
            }
          }
        }
        setFieldMapping(fm);
        setTransformerModes(modes);

        const sm = config.field_mapping._slug;
        const smVal = sm ? (typeof sm === "object" ? sm.source : sm) : "";
        if (smVal && smVal.startsWith("function:")) {
          try {
            setSlugField(atob(smVal.slice("function:".length)));
            setSlugIsTransformer(true);
          } catch {
            setSlugField(smVal);
          }
        } else {
          setSlugField(smVal);
          setSlugIsTransformer(false);
        }

        const lm = config.field_mapping._locale;
        const lmVal = lm ? (typeof lm === "object" ? lm.source : lm) : "";
        if (lmVal && lmVal.startsWith("function:")) {
          try {
            setLocaleField(atob(lmVal.slice("function:".length)));
            setLocaleIsTransformer(true);
          } catch {
            setLocaleField(lmVal);
          }
        } else {
          setLocaleField(lmVal);
          setLocaleIsTransformer(false);
        }
      }
      setIndexedFields(config.indexes || []);

      if (config.database?.slug && sampleItems.length === 0) {
        loadSampleFromDb(config.database.slug);
      }

      const initialCompleted = new Set<WizardStep>();
      if (config.database?.slug) {
        initialCompleted.add("database");
        initialCompleted.add("preview");
      }
      if (config.field_mapping) {
        const hasSlug = !!config.field_mapping._slug;
        const hasRegular = Object.keys(config.field_mapping).filter(k => !k.startsWith("_")).length > 0;
        if (hasSlug) initialCompleted.add("identity");
        if (hasRegular) {
          initialCompleted.add("mapping");
          initialCompleted.add("indexes");
        }
      }
      setCompletedSteps(initialCompleted);
    }
  }, [config]);

  useEffect(() => {
    setCompletedSteps((prev) => {
      const next = new Set(Array.from(prev));
      if (selectedDb) next.add("database"); else next.delete("database");
      if (sampleItems.length > 0) next.add("preview"); else next.delete("preview");
      if (slugField) next.add("identity"); else next.delete("identity");
      const hasMappedField = Object.values(fieldMapping).some((v) => v != null && v !== "__none__");
      if (hasMappedField) next.add("mapping"); else next.delete("mapping");
      return next;
    });
  }, [selectedDb, fieldMapping, slugField, sampleItems]);

  const loadSampleFromDb = async (dbName: string) => {
    if (!dbName) return;
    setLoadingSample(true);
    try {
      const [itemsRes, rawFieldsRes] = await Promise.all([
        fetch(`/api/databases/${dbName}/items`),
        fetch(`/api/databases/${dbName}/raw-fields`),
      ]);
      if (itemsRes.ok) {
        const data = await itemsRes.json();
        const items = (data.items || []).slice(0, 3) as Record<string, unknown>[];
        setSampleItems(items);
        if (items.length > 0) {
          const keys = new Set<string>();
          for (const item of items) {
            collectFieldPaths(item, "", keys);
          }
          setAvailableFields(Array.from(keys).sort());
        }
      }
      if (rawFieldsRes.ok) {
        const rawData = await rawFieldsRes.json();
        setRawFields((rawData.fields || []).sort());
      }
    } catch {
      setSampleItems([]);
    } finally {
      setLoadingSample(false);
    }
  };

  const handleAnalyzeFields = async () => {
    if (sampleItems.length === 0) return;
    setAiMappingFields(true);
    setFieldMappingError(null);
    setDeletedFields([]);
    try {
      const res = await apiRequest("POST", `/api/content-types/${contentType}/ai/analyze-fields`, {
        sample_posts: sampleItems.slice(0, 3),
      });
      const data = await res.json();
      if (data.error) {
        setFieldMappingError(data.error);
      } else {
        const aiMapping = data.field_mapping || {};
        if (aiMapping._slug) {
          setSlugField(typeof aiMapping._slug === "object" ? aiMapping._slug.source : aiMapping._slug);
          delete aiMapping._slug;
        }
        if (aiMapping._locale) {
          setLocaleField(typeof aiMapping._locale === "object" ? aiMapping._locale.source : aiMapping._locale);
          delete aiMapping._locale;
        }
        setFieldMapping(aiMapping);
        if (data.available_fields) {
          setAvailableFields(data.available_fields);
        }
        setFieldMappingNotes(data.notes || "");
      }
    } catch (err) {
      setFieldMappingError(String(err));
    } finally {
      setAiMappingFields(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const fullMapping: Record<string, string> = {};
      if (slugField) {
        fullMapping._slug = slugIsTransformer ? "function:" + btoa(slugField) : slugField;
      }
      if (localeField) {
        fullMapping._locale = localeIsTransformer ? "function:" + btoa(localeField) : localeField;
      }
      const localeSource = localeIsTransformer ? null : localeField;
      for (const [k, v] of Object.entries(fieldMapping)) {
        if (v != null && v !== "__none__") {
          // skip any regular mapping whose source is the same as the locale field —
          // it's already captured by _locale and would create a redundant duplicate
          if (!transformerModes[k] && localeSource && v === localeSource) continue;
          fullMapping[k] = transformerModes[k] ? "function:" + btoa(v) : v;
        }
      }

      const payload = {
        field_mapping: Object.keys(fullMapping).length > 0 ? fullMapping : undefined,
        indexes: indexedFields.length > 0 ? indexedFields : undefined,
        database: {
          slug: selectedDb,
        },
      };

      const res = await fetch(`/api/content-types/${contentType}/config`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      let data: Record<string, unknown> = {};
      try { data = await res.json(); } catch { /* non-JSON */ }

      if (!res.ok) {
        toast({ title: (data.error as string) || "Failed to save configuration", variant: "destructive" });
        return;
      }

      queryClient.invalidateQueries({ queryKey: ["/api/content-types", contentType, "config"] });
      queryClient.invalidateQueries({ queryKey: ["/api/content-types", contentType, "items"] });
      queryClient.invalidateQueries({ queryKey: ["/api/content-types"] });
      toast({ title: `${label} configuration saved` });
      onOpenChange(false);
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : "Failed to save configuration", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const canGoNext = (s: WizardStep): boolean => {
    switch (s) {
      case "database": return !!selectedDb;
      case "preview": return true;
      case "identity": return !!slugField;
      case "mapping": return Object.values(fieldMapping).some((v) => v != null && v !== "__none__");
      case "indexes": return true;
      default: return false;
    }
  };

  const goNext = () => {
    const idx = WIZARD_STEPS.findIndex((s) => s.id === step);
    if (idx < WIZARD_STEPS.length - 1) {
      markComplete(step);
      const nextStep = WIZARD_STEPS[idx + 1].id;
      setStep(nextStep);
      if (nextStep === "preview" && sampleItems.length === 0 && selectedDb) {
        loadSampleFromDb(selectedDb);
      }
    }
  };

  const goBack = () => {
    const idx = WIZARD_STEPS.findIndex((s) => s.id === step);
    if (idx > 0) {
      setStep(WIZARD_STEPS[idx - 1].id);
    }
  };

  const stepIndex = WIZARD_STEPS.findIndex((s) => s.id === step);
  const isLastStep = stepIndex === WIZARD_STEPS.length - 1;

  const dbList = databases || [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[580px] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Connect Database to {label}</DialogTitle>
        </DialogHeader>

        <StepIndicator steps={WIZARD_STEPS} currentStep={step} completedSteps={completedSteps} />

        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="ml-2 text-sm text-muted-foreground">Loading configuration...</span>
          </div>
        ) : (
          <div className="space-y-4 min-h-[250px]">

            {step === "database" && (
              <div className="space-y-4" data-testid="step-database">
                <p className="text-sm text-muted-foreground">
                  Choose which database provides dynamic entries for this content type. Database items will appear alongside any static YAML entries.
                </p>

                <div className="space-y-2">
                  <Label>Database</Label>
                  <Select value={selectedDb} onValueChange={(v) => { setSelectedDb(v); setSampleItems([]); }}>
                    <SelectTrigger data-testid="select-database">
                      <SelectValue placeholder="Select a database..." />
                    </SelectTrigger>
                    <SelectContent>
                      {dbList.map((db) => (
                        <SelectItem key={db.name} value={db.name}>
                          <div className="flex items-center gap-2">
                            <span>{db.label || db.name}</span>
                            <span className="text-muted-foreground text-xs">({db.name})</span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {selectedDb && (() => {
                  const db = dbList.find((d) => d.name === selectedDb);
                  return db ? (
                    <div className="rounded-md border p-3 space-y-1" data-testid="section-db-info">
                      <p className="text-sm font-medium">{db.label || db.name}</p>
                      {db.description && (
                        <p className="text-xs text-muted-foreground">{db.description}</p>
                      )}
                      <div className="flex items-center gap-2 pt-1">
                        <Badge variant="outline" className="text-xs">{db.source_type}</Badge>
                      </div>
                    </div>
                  ) : null;
                })()}

                {dbList.length === 0 && (
                  <div className="rounded-md bg-muted px-3 py-2">
                    <p className="text-xs text-muted-foreground">
                      No databases found. <a href="/private/databases?create=true" className="text-primary underline" data-testid="link-create-database">Create a database</a> first.
                    </p>
                  </div>
                )}

                {dbList.length > 0 && (
                  <div className="text-right">
                    <a href="/private/databases" className="text-xs text-muted-foreground underline" data-testid="link-manage-databases">
                      Manage databases
                    </a>
                  </div>
                )}
              </div>
            )}

            {step === "preview" && (
              <div className="space-y-4" data-testid="step-preview">
                <p className="text-sm text-muted-foreground">
                  Here's what we found in your database. Review the detected fields below — these will be available for mapping in the next steps. You can also auto-detect the mapping using AI.
                </p>

                {loadingSample && (
                  <div className="flex items-center justify-center gap-2 py-6">
                    <Loader2 className="h-5 w-5 animate-spin" />
                    <span className="text-sm text-muted-foreground">Loading sample data from database...</span>
                  </div>
                )}

                {!loadingSample && sampleItems.length > 0 && (
                  <>
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant="outline" className="text-xs" data-testid="badge-item-count">
                        {sampleItems.length} sample item{sampleItems.length !== 1 ? "s" : ""} loaded
                      </Badge>
                      <button
                        type="button"
                        className="text-xs text-muted-foreground underline"
                        onClick={() => setSampleDialogOpen(true)}
                        data-testid="link-view-sample"
                      >
                        View raw JSON
                      </button>
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={() => loadSampleFromDb(selectedDb)}
                        disabled={loadingSample}
                        data-testid="button-refresh-sample"
                      >
                        <RefreshCw className="h-4 w-4" />
                      </Button>
                    </div>

                    <div className="space-y-2">
                      <Label className="text-xs font-medium text-muted-foreground">Detected Fields ({availableFields.length})</Label>
                      <div className="rounded-md border p-3 flex flex-wrap gap-1.5" data-testid="section-detected-fields">
                        {availableFields.map((f) => (
                          <Badge key={f} variant="outline" className="text-xs font-mono no-default-active-elevate" data-testid={`badge-field-${f}`}>
                            {f}
                          </Badge>
                        ))}
                        {availableFields.length === 0 && (
                          <p className="text-xs text-muted-foreground">No fields detected.</p>
                        )}
                      </div>
                    </div>

                    <Button
                      onClick={handleAnalyzeFields}
                      disabled={aiMappingFields}
                      className="w-full"
                      data-testid="button-ai-fields"
                    >
                      {aiMappingFields ? (
                        <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Analyzing fields...</>
                      ) : (
                        <><Wand2 className="h-4 w-4 mr-2" />Auto-detect Field Mapping</>
                      )}
                    </Button>

                    {fieldMappingError && (
                      <div className="rounded-md bg-destructive/10 px-3 py-2">
                        <p className="text-xs text-destructive">{fieldMappingError}</p>
                      </div>
                    )}
                  </>
                )}

                {!loadingSample && sampleItems.length === 0 && selectedDb && (
                  <div className="rounded-md bg-muted px-3 py-4 space-y-2 text-center">
                    <p className="text-sm text-muted-foreground">
                      No sample data available from database "{selectedDb}".
                    </p>
                    <Button
                      variant="outline"
                      onClick={() => loadSampleFromDb(selectedDb)}
                      disabled={loadingSample}
                      data-testid="button-retry-sample"
                    >
                      <RefreshCw className="h-4 w-4 mr-2" />
                      Retry
                    </Button>
                  </div>
                )}

                <SampleDataDialog
                  open={sampleDialogOpen}
                  onOpenChange={setSampleDialogOpen}
                  sampleItems={sampleItems}
                />
              </div>
            )}

            {step === "identity" && (
              <div className="space-y-4" data-testid="step-identity">
                <p className="text-sm text-muted-foreground">
                  Every database-backed content type needs an identity. The slug field uniquely identifies each item for URL routing. The locale field identifies the item's language for multi-language support.
                </p>

                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Label className="text-xs font-medium text-muted-foreground flex-1">Slug Field (_slug)</Label>
                    <Badge variant="default" className="text-[10px] no-default-active-elevate">Required</Badge>
                    <Button
                      variant="ghost"
                      size="icon"
                      className={slugIsTransformer ? "text-primary" : ""}
                      onClick={() => {
                        if (!slugIsTransformer) {
                          setSlugIsTransformer(true);
                          if (!slugField) setSlugField("(value, item) => item.slug");
                        } else {
                          setSlugIsTransformer(false);
                          setSlugField("");
                        }
                      }}
                      data-testid="button-toggle-slug-transform"
                    >
                      <Code className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  {slugIsTransformer ? (
                    <div className="space-y-1">
                      <p className="text-[10px] text-muted-foreground font-mono">(value, item) =&gt; ...</p>
                      <Textarea
                        value={slugField}
                        onChange={(e) => setSlugField(e.target.value)}
                        placeholder="(value, item) => item.slug"
                        className="text-xs font-mono min-h-[3rem] resize-y"
                        data-testid="textarea-slug-transform"
                      />
                    </div>
                  ) : (
                    <Select
                      value={slugField || "__none__"}
                      onValueChange={(v) => {
                        setSlugField(v === "__none__" ? "" : v);
                      }}
                    >
                      <SelectTrigger className="h-8 text-xs font-mono" data-testid="select-slug-field">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">(none)</SelectItem>
                        {availableFields.map((f) => (
                          <SelectItem key={f} value={f}>{f}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  <p className="text-xs text-muted-foreground">
                    Which field uniquely identifies each item (e.g., "slug", "id")
                  </p>
                </div>

                <div className="space-y-2 pt-2 border-t">
                  <div className="flex items-center gap-2">
                    <Label className="text-xs font-medium text-muted-foreground flex-1">Locale Field (_locale)</Label>
                    <Badge variant="outline" className="text-[10px] no-default-active-elevate">Recommended</Badge>
                    <Button
                      variant="ghost"
                      size="icon"
                      className={localeIsTransformer ? "text-primary" : ""}
                      onClick={() => {
                        if (!localeIsTransformer) {
                          setLocaleIsTransformer(true);
                          if (!localeField) setLocaleField("(value) => value === 'us' ? 'en' : value");
                        } else {
                          setLocaleIsTransformer(false);
                          setLocaleField("");
                        }
                      }}
                      data-testid="button-toggle-locale-transform"
                    >
                      <Code className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  {localeIsTransformer ? (
                    <div className="space-y-1">
                      <p className="text-[10px] text-muted-foreground font-mono">(value, item) =&gt; ...</p>
                      <Textarea
                        value={localeField}
                        onChange={(e) => setLocaleField(e.target.value)}
                        placeholder="(value) => value === 'us' ? 'en' : value"
                        className="text-xs font-mono min-h-[3rem] resize-y"
                        data-testid="textarea-locale-transform"
                      />
                    </div>
                  ) : (
                    <Select
                      value={localeField || "__none__"}
                      onValueChange={(v) => {
                        setLocaleField(v === "__none__" ? "" : v);
                      }}
                    >
                      <SelectTrigger className="h-8 text-xs font-mono" data-testid="select-locale-field">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">(none)</SelectItem>
                        {availableFields.map((f) => (
                          <SelectItem key={f} value={f}>{f}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  <p className="text-xs text-muted-foreground">
                    Which field identifies the item's language (e.g., "lang", "locale")
                  </p>
                </div>

                {(slugIsTransformer || localeIsTransformer) && (
                  <div className="rounded-md bg-muted px-3 py-2 space-y-1" data-testid="section-transform-help">
                    <p className="text-xs font-medium text-muted-foreground">About computed fields</p>
                    <p className="text-xs text-muted-foreground">
                      Write a JavaScript function that receives two arguments: <code className="font-mono bg-background px-1 rounded">value</code> (the raw field value) and <code className="font-mono bg-background px-1 rounded">item</code> (the full database record). Return the normalized value.
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Example: <code className="font-mono bg-background px-1 rounded">(value, item) =&gt; value === 'us' ? 'en' : value</code>
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      Functions run in a secure sandbox — no access to files, network, or system resources. 50ms timeout.
                    </p>
                  </div>
                )}
              </div>
            )}

            {step === "mapping" && (
              <div className="space-y-4" data-testid="step-mapping">
                <p className="text-sm text-muted-foreground">
                  Map database fields to content type properties. Pick from detected fields, type a custom dot-path, or compute a value with a function.
                </p>

                <p className="text-xs text-muted-foreground" data-testid="text-field-mapping-note">
                  Use <code className="font-mono bg-muted px-1 rounded">raw.fieldName</code> to reference original API fields, or <code className="font-mono bg-muted px-1 rounded">db.fieldName</code> (default) for normalized database fields.
                </p>

                {fieldMappingNotes && (
                  <p className="text-xs text-muted-foreground">{fieldMappingNotes}</p>
                )}

                {fieldMappingError && (
                  <div className="rounded-md bg-destructive/10 px-3 py-2">
                    <p className="text-xs text-destructive">{fieldMappingError}</p>
                  </div>
                )}

                {Object.values(transformerModes).some(Boolean) && (
                  <div className="rounded-md bg-muted px-3 py-2 space-y-1" data-testid="section-transform-help-mapping">
                    <p className="text-xs font-medium text-muted-foreground">About computed fields</p>
                    <p className="text-xs text-muted-foreground">
                      Write a JavaScript function: <code className="font-mono bg-background px-1 rounded">(value, item) =&gt; result</code>. <code className="font-mono bg-background px-1 rounded">value</code> is the raw field value, <code className="font-mono bg-background px-1 rounded">item</code> is the full record. Runs in a secure sandbox (50ms timeout).
                    </p>
                  </div>
                )}

                {Object.keys(fieldMapping).length > 0 && (
                  <div className="space-y-2">
                    {Object.entries(fieldMapping).map(([standardField, sourceField]) => {
                      const isFnMode = !!transformerModes[standardField];
                      const isOptional = !isFnMode && typeof sourceField === "string" && sourceField.startsWith("?");
                      const bareSource = isOptional ? (sourceField as string).slice(1) : sourceField;
                      const hasDotPath = typeof bareSource === "string" && (bareSource.includes(".") || bareSource === "");
                      const isCustom = !isFnMode && bareSource != null && bareSource !== "__none__" && hasDotPath;
                      const selectValue = isCustom ? "__custom__" : ((bareSource as string) || "__none__");
                      return (
                      <div key={standardField} className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-medium w-24 flex-shrink-0 text-right text-muted-foreground">
                            {standardField}
                          </span>
                          <ArrowRight className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                          {isFnMode ? (
                            <div className="flex-1 space-y-1">
                              <p className="text-[10px] text-muted-foreground font-mono">(value, item) =&gt; ...</p>
                              <Textarea
                                value={sourceField || ""}
                                onChange={(e) => setFieldMapping((prev) => ({ ...prev, [standardField]: e.target.value }))}
                                placeholder="(value, item) => value"
                                className="text-xs font-mono min-h-[3rem] resize-y"
                                data-testid={`textarea-transform-${standardField}`}
                              />
                            </div>
                          ) : isCustom ? (
                            <>
                              <Input
                                value={bareSource as string}
                                onChange={(e) => {
                                  const prefix = isOptional ? "?" : "";
                                  setFieldMapping((prev) => ({ ...prev, [standardField]: `${prefix}${e.target.value}` }));
                                }}
                                placeholder="e.g. author.details.name"
                                className="h-8 text-xs font-mono flex-1"
                                data-testid={`input-custom-path-${standardField}`}
                              />
                              <Button
                                variant="ghost"
                                size="icon"
                                className="flex-shrink-0"
                                onClick={() => {
                                  setFieldMapping((prev) => ({ ...prev, [standardField]: null }));
                                }}
                                data-testid={`button-clear-custom-${standardField}`}
                              >
                                <X className="h-3.5 w-3.5" />
                              </Button>
                            </>
                          ) : (
                            <Select
                              value={selectValue}
                              onValueChange={(v) => {
                                const prefix = isOptional ? "?" : "";
                                if (v === "__custom__") {
                                  setFieldMapping((prev) => ({ ...prev, [standardField]: prefix }));
                                } else {
                                  setFieldMapping((prev) => ({ ...prev, [standardField]: v === "__none__" ? null : `${prefix}${v}` }));
                                }
                              }}
                            >
                              <SelectTrigger className="h-8 text-xs font-mono" data-testid={`select-field-${standardField}`}>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="__none__">(not mapped)</SelectItem>
                                {bareSource && bareSource !== "__none__" && !availableFields.includes(bareSource as string) && (
                                  <SelectItem value={bareSource as string} className="text-destructive font-mono">
                                    {bareSource} (not in DB)
                                  </SelectItem>
                                )}
                                {availableFields.map((f) => (
                                  <SelectItem key={f} value={f}>{f}</SelectItem>
                                ))}
                                <SelectItem value="__custom__">Custom path...</SelectItem>
                              </SelectContent>
                            </Select>
                          )}
                          {!isFnMode && bareSource && bareSource !== "__none__" && (
                            <button
                              type="button"
                              onClick={() => {
                                setFieldMapping((prev) => {
                                  const cur = prev[standardField];
                                  if (!cur) return prev;
                                  const wasOptional = typeof cur === "string" && cur.startsWith("?");
                                  return { ...prev, [standardField]: wasOptional ? cur.slice(1) : `?${cur}` };
                                });
                              }}
                              className={`text-[10px] flex-shrink-0 cursor-pointer transition-colors ${isOptional ? "text-muted-foreground hover:text-foreground" : "text-foreground font-medium hover:text-muted-foreground"}`}
                              data-testid={`button-toggle-optional-${standardField}`}
                            >
                              {isOptional ? "optional" : "required"}
                            </button>
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            className={`flex-shrink-0 ${isFnMode ? "text-primary" : ""}`}
                            onClick={() => {
                              setTransformerModes((prev) => {
                                const next = { ...prev, [standardField]: !prev[standardField] };
                                if (!next[standardField]) {
                                  setFieldMapping((p) => ({ ...p, [standardField]: null }));
                                }
                                return next;
                              });
                            }}
                            data-testid={`button-toggle-transform-${standardField}`}
                          >
                            <Code className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="flex-shrink-0"
                            onClick={() => {
                              setFieldMapping((prev) => {
                                const next = { ...prev };
                                delete next[standardField];
                                return next;
                              });
                              setTransformerModes((prev) => {
                                const next = { ...prev };
                                delete next[standardField];
                                return next;
                              });
                              setDeletedFields((prev) => prev.includes(standardField) ? prev : [...prev, standardField]);
                            }}
                            data-testid={`button-delete-field-${standardField}`}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                      );
                    })}
                  </div>
                )}

                {Object.keys(fieldMapping).length === 0 && (
                  <div className="space-y-3">
                    {availableFields.length > 0 ? (
                      <>
                        <p className="text-xs text-muted-foreground">Click a field to add it as a mapping:</p>
                        <div className="flex flex-wrap gap-1.5" data-testid="section-suggest-fields">
                          {availableFields.filter(f => {
                            const slugSrc = !slugIsTransformer && slugField ? slugField.replace(/^\?/, '') : null;
                            const localeSrc = !localeIsTransformer && localeField ? localeField.replace(/^\?/, '') : null;
                            if (slugSrc && f === slugSrc) return false;
                            if (localeSrc && f === localeSrc) return false;
                            return true;
                          }).map((f) => (
                            <Badge
                              key={f}
                              variant="outline"
                              className="cursor-pointer text-xs font-mono"
                              onClick={() => setFieldMapping((prev) => ({ ...prev, [f]: f }))}
                              data-testid={`badge-suggest-${f}`}
                            >
                              <Plus className="h-2.5 w-2.5 mr-1" />
                              {f}
                            </Badge>
                          ))}
                        </div>
                      </>
                    ) : (
                      <p className="text-xs text-muted-foreground">No fields detected yet. Use auto-detect below or go back to the Inspect step to load sample data first.</p>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleAnalyzeFields}
                      disabled={aiMappingFields || sampleItems.length === 0}
                      className="w-full"
                      data-testid="button-ai-fields-mapping"
                    >
                      {aiMappingFields ? (
                        <><Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />Analyzing fields...</>
                      ) : (
                        <><Wand2 className="h-3.5 w-3.5 mr-1" />Auto-detect Field Mapping</>
                      )}
                    </Button>
                  </div>
                )}

                {(() => {
                  const mappedSources = new Set(Object.values(fieldMapping).filter(Boolean));
                  const slugSrc = !slugIsTransformer && slugField ? slugField.replace(/^\?/, '') : null;
                  const localeSrc = !localeIsTransformer && localeField ? localeField.replace(/^\?/, '') : null;
                  const unmapped = availableFields.filter(f => {
                    if (slugSrc && f === slugSrc) return false;
                    if (localeSrc && f === localeSrc) return false;
                    return !mappedSources.has(f) && !(f in fieldMapping);
                  });
                  if (Object.keys(fieldMapping).length === 0 || unmapped.length === 0) return null;
                  return (
                    <div className="flex items-center gap-2 flex-wrap" data-testid="section-unmapped-available">
                      <span className="text-xs text-muted-foreground">Also add:</span>
                      {unmapped.map((f) => (
                        <Badge
                          key={f}
                          variant="outline"
                          className="cursor-pointer text-xs font-mono"
                          onClick={() => setFieldMapping((prev) => ({ ...prev, [f]: f }))}
                          data-testid={`badge-add-field-${f}`}
                        >
                          <Plus className="h-2.5 w-2.5 mr-1" />
                          {f}
                        </Badge>
                      ))}
                    </div>
                  );
                })()}

                {deletedFields.filter((f) => !(f in fieldMapping)).length > 0 && (
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs text-muted-foreground">Re-add:</span>
                    {deletedFields.filter((f) => !(f in fieldMapping)).map((f) => (
                      <Badge
                        key={f}
                        variant="outline"
                        className="cursor-pointer text-xs"
                        onClick={() => {
                          setFieldMapping((prev) => ({ ...prev, [f]: null }));
                        }}
                        data-testid={`badge-readd-${f}`}
                      >
                        + {f}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            )}

            {step === "indexes" && (
              <div className="space-y-4" data-testid="step-indexes">
                <p className="text-sm text-muted-foreground">
                  Indexed fields generate summary cards, filter dropdowns, and sortable columns on the management page. Click a field to toggle indexing. Locale is always indexed automatically.
                </p>

                <div className="flex items-center gap-2 flex-wrap" data-testid="section-index-badges">
                  {localeField && (
                    <Badge variant="default" className="text-xs cursor-default opacity-70 no-default-active-elevate" data-testid="badge-index-locale">
                      <Check className="h-3 w-3 mr-1" />
                      {localeIsTransformer ? "locale (computed)" : localeField} (auto)
                    </Badge>
                  )}
                  {Object.keys(fieldMapping).filter(k => {
                    if (k.startsWith("_") || k === localeField) return false;
                    // also hide any field whose source maps to the same DB column as the locale
                    if (!localeIsTransformer && localeField && fieldMapping[k] === localeField) return false;
                    return true;
                  }).map((field) => {
                    const isIndexed = indexedFields.includes(field);
                    return (
                      <Badge
                        key={field}
                        variant={isIndexed ? "default" : "outline"}
                        className="text-xs cursor-pointer"
                        onClick={() => {
                          setIndexedFields((prev) =>
                            isIndexed ? prev.filter((f) => f !== field) : [...prev, field]
                          );
                        }}
                        data-testid={`badge-index-${field}`}
                      >
                        {isIndexed && <Check className="h-3 w-3 mr-1" />}
                        {field}
                      </Badge>
                    );
                  })}
                  {Object.keys(fieldMapping).filter(k => {
                    if (k.startsWith("_") || k === localeField) return false;
                    if (!localeIsTransformer && localeField && fieldMapping[k] === localeField) return false;
                    return true;
                  }).length === 0 && !localeField && (
                    <p className="text-xs text-muted-foreground">No mapped fields available for indexing. Go back and add field mappings first.</p>
                  )}
                </div>
              </div>
            )}

          </div>
        )}

        <DialogFooter>
          {stepIndex > 0 && (
            <Button variant="outline" onClick={goBack} className="mr-auto" data-testid="button-wizard-back">
              <ArrowLeft className="h-4 w-4 mr-1" />
              Back
            </Button>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-cancel-datasource">
            Cancel
          </Button>
          {isLastStep ? (
            <Button
              onClick={handleSave}
              disabled={saving || isLoading || !Object.values(fieldMapping).some((v) => v != null && v !== "__none__")}
              data-testid="button-save-datasource"
            >
              {saving ? "Saving..." : "Save"}
            </Button>
          ) : (
            <Button
              onClick={goNext}
              disabled={!canGoNext(step)}
              data-testid="button-wizard-next"
            >
              Next
              <ArrowRight className="h-4 w-4 ml-1" />
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function collectFieldPaths(obj: unknown, prefix: string, keys: Set<string>): void {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return;
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${k}` : k;
    keys.add(path);
    if (v && typeof v === "object" && !Array.isArray(v)) {
      collectFieldPaths(v, path, keys);
    }
  }
}

function resolveItemField(item: Record<string, any>, field: string): string {
  switch (field) {
    case "slug": return item.slug || "";
    case "category": return item.category?.slug || item.category || "";
    case "lang": return item.lang || "";
    case "status": return item.status || "";
    case "tags": return (item.tags || []).join(",");
    default: return String(item[field] || "");
  }
}

function buildItemUrl(pattern: string, item: Record<string, any>, locale: string): string {
  let result = pattern.replaceAll(":locale", locale);
  const paramMatches = pattern.match(/:([a-zA-Z_]+)/g) || [];
  for (const param of paramMatches) {
    const key = param.slice(1);
    if (key === "locale") continue;
    result = result.replaceAll(param, resolveItemField(item, key));
  }
  return result;
}

type MissingEntry = { slug: string; files: string[] };
type FieldValidationResult = { valid: boolean; total: number; found: number; missing: MissingEntry[] };
type ValidationState = Record<string, FieldValidationResult | "loading" | null>;

function FieldValidationIndicator({ result }: { result: FieldValidationResult | "loading" | null | undefined }) {
  if (!result) return null;
  if (result === "loading") {
    return <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground flex-shrink-0" />;
  }
  if (result.valid) {
    return <Check className="h-3.5 w-3.5 text-green-600 dark:text-green-400 flex-shrink-0" data-testid="icon-validation-valid" />;
  }
  return <AlertTriangle className="h-3.5 w-3.5 text-destructive flex-shrink-0" data-testid="icon-validation-invalid" />;
}

function FieldValidationMessage({ result, fieldKey, source }: { result: FieldValidationResult | "loading" | null | undefined; fieldKey: string; source?: string }) {
  if (!result || result === "loading" || result.valid) return null;
  const displaySource = source || (fieldKey.startsWith("__") ? "" : fieldKey);
  if (!displaySource) return null;
  const allMissing = result.found === 0;
  return (
    <div className="text-[11px] text-destructive mt-1" data-testid={`text-validation-error-${fieldKey}`}>
      <p>
        Source property "<span className="font-mono font-medium">{displaySource}</span>" was not found in {allMissing ? "any" : "some"} content {result.total === 1 ? "entry" : "entries"}.
        {" "}{allMissing ? "None" : `Only ${result.found}`} of {result.total} {result.total === 1 ? "entry has" : "entries have"} this property, it must be in all entries to become a common mapped field.
      </p>
    </div>
  );
}

function FieldMappingDialog({
  open,
  onOpenChange,
  contentType,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contentType: string;
}) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const label = contentType.charAt(0).toUpperCase() + contentType.slice(1);

  const { data: config, isLoading } = useQuery<ContentTypeConfig>({
    queryKey: ["/api/content-types", contentType, "config"],
    queryFn: () => fetch(`/api/content-types/${contentType}/config`).then(r => r.json()),
    enabled: open,
  });

  const isDbBacked = !!config?.database?.slug;

  const [mappings, setMappings] = useState<Record<string, string>>({});
  const [indexedFields, setIndexedFields] = useState<string[]>([]);
  const [uniqueFields, setUniqueFields] = useState<string[]>(["slug"]);
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const [sourceDropdownOpen, setSourceDropdownOpen] = useState(false);
  const [showAddField, setShowAddField] = useState(false);
  const [pendingDeleteKey, setPendingDeleteKey] = useState<string | null>(null);
  const [transformerModes, setTransformerModes] = useState<Record<string, boolean>>({});
  const [customModes, setCustomModes] = useState<Record<string, boolean>>({});
  const [validation, setValidation] = useState<ValidationState>({});
  const [newValueValidation, setNewValueValidation] = useState<FieldValidationResult | "loading" | null>(null);
  const debounceTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const requestCounters = useRef<Record<string, number>>({});

  // All source props — used in the editing dropdown for existing rows
  const { data: allAvailableProps } = useQuery<{ common: string[]; partial: { key: string; count: number; total: number }[] }>({
    queryKey: ["/api/content-types", contentType, "available-properties-all"],
    queryFn: () => fetch(`/api/content-types/${contentType}/available-properties`).then(r => r.json()),
    enabled: open,
  });

  // Unmapped props only — used in the "add new field" combobox
  const { data: availableProps } = useQuery<{ common: string[]; partial: { key: string; count: number; total: number }[] }>({
    queryKey: ["/api/content-types", contentType, "available-properties-exclude-mapped"],
    queryFn: () => fetch(`/api/content-types/${contentType}/available-properties?exclude_mapped=true`).then(r => r.json()),
    enabled: open,
  });

  useEffect(() => {
    if (!config) return;
    const fm: Record<string, string> = {};
    const tmodes: Record<string, boolean> = {};
    if (config.field_mapping) {
      for (const [k, v] of Object.entries(config.field_mapping)) {
        if (typeof v === "string") {
          if (v.startsWith("function:")) {
            fm[k] = atob(v.slice(9));
            tmodes[k] = true;
          } else {
            fm[k] = v;
          }
        } else if (v && typeof v === "object" && "source" in v) {
          fm[k] = v.source;
        }
      }
    }
    setMappings(fm);
    setTransformerModes(tmodes);
    // A source is "custom" if it contains a dot (dotted path like category.slug)
    const cmodes: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(fm)) {
      if (!tmodes[k] && v.includes(".")) cmodes[k] = true;
    }
    setCustomModes(cmodes);
    setIndexedFields(config.indexes || []);
    setUniqueFields(config.unique_fields ?? ["slug"]);
    setValidation({});
    setShowAddField(false);
    setPendingDeleteKey(null);
    requestCounters.current = {};
  }, [config]);

  const validateSingleField = (key: string, source: string) => {
    if (isDbBacked || !source || key.startsWith("_")) return;
    const reqId = (requestCounters.current[key] || 0) + 1;
    requestCounters.current[key] = reqId;
    setValidation((prev) => ({ ...prev, [key]: "loading" }));
    fetch(`/api/content-types/${contentType}/validate-field?source=${encodeURIComponent(source)}`)
      .then((r) => r.ok ? r.json() : null)
      .then((result: FieldValidationResult | null) => {
        if (requestCounters.current[key] !== reqId) return;
        setValidation((prev) => ({ ...prev, [key]: result }));
      })
      .catch(() => {
        if (requestCounters.current[key] !== reqId) return;
        setValidation((prev) => ({ ...prev, [key]: null }));
      });
  };

  const debouncedValidate = (key: string, source: string) => {
    if (debounceTimers.current[key]) clearTimeout(debounceTimers.current[key]);
    debounceTimers.current[key] = setTimeout(() => validateSingleField(key, source), 500);
  };

  useEffect(() => {
    if (!config || isDbBacked) return;
    const rawMapping: Record<string, string> = {};
    if (config.field_mapping) {
      for (const [k, v] of Object.entries(config.field_mapping)) {
        if (typeof v === "string" && !v.startsWith("function:") && !k.startsWith("_")) {
          rawMapping[k] = v;
        }
      }
    }
    if (Object.keys(rawMapping).length === 0) return;
    const bulkReqId = Date.now();
    requestCounters.current["__bulk"] = bulkReqId;
    fetch(`/api/content-types/${contentType}/validate-mappings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ field_mapping: rawMapping }),
    })
      .then((r) => r.ok ? r.json() : null)
      .then((data: { results: Record<string, FieldValidationResult> } | null) => {
        if (requestCounters.current["__bulk"] !== bulkReqId || !data) return;
        setValidation(data.results || {});
      })
      .catch(() => {});
  }, [config, contentType, isDbBacked]);

  const handleSourceChange = (key: string, value: string) => {
    setMappings((prev) => ({ ...prev, [key]: value }));
    if (!transformerModes[key] && !key.startsWith("_") && !isDbBacked) {
      debouncedValidate(key, value);
    }
  };

  const validateNewValue = (source: string) => {
    if (isDbBacked || !source) {
      setNewValueValidation(null);
      return;
    }
    const reqId = (requestCounters.current["__new"] || 0) + 1;
    requestCounters.current["__new"] = reqId;
    setNewValueValidation("loading");
    fetch(`/api/content-types/${contentType}/validate-field?source=${encodeURIComponent(source)}`)
      .then((r) => r.ok ? r.json() : null)
      .then((result: FieldValidationResult | null) => {
        if (requestCounters.current["__new"] !== reqId) return;
        setNewValueValidation(result);
      })
      .catch(() => {
        if (requestCounters.current["__new"] !== reqId) return;
        setNewValueValidation(null);
      });
  };

  const debouncedValidateNew = (source: string) => {
    if (debounceTimers.current["__new"]) clearTimeout(debounceTimers.current["__new"]);
    debounceTimers.current["__new"] = setTimeout(() => validateNewValue(source), 500);
  };

  const handleNewValueChange = (value: string) => {
    setNewValue(value);
    debouncedValidateNew(value.trim() || newKey.trim());
  };

  const filteredAvailableProps = (() => {
    if (!availableProps) return { common: [], partial: [] };
    const q = newValue.toLowerCase().trim();
    if (!q) return availableProps;
    return {
      common: availableProps.common.filter(k => k.toLowerCase().includes(q)),
      partial: availableProps.partial.filter(p => p.key.toLowerCase().includes(q)),
    };
  })();

  const handleAddField = () => {
    const key = newKey.trim();
    if (!key || key in mappings) return;
    const source = newValue.trim() || key;
    setMappings((prev) => ({ ...prev, [key]: source }));
    if (newValueValidation && newValueValidation !== "loading") {
      setValidation((prev) => ({ ...prev, [key]: newValueValidation }));
    } else if (!isDbBacked && !key.startsWith("_")) {
      validateSingleField(key, source);
    }
    setNewKey("");
    setNewValue("");
    setNewValueValidation(null);
    setSourceDropdownOpen(false);
    setShowAddField(false);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const fullMapping: Record<string, string> = {};
      for (const [k, v] of Object.entries(mappings)) {
        if (v) {
          fullMapping[k] = transformerModes[k] ? "function:" + btoa(v) : v;
        }
      }

      const payload = {
        field_mapping: Object.keys(fullMapping).length > 0 ? fullMapping : undefined,
        indexes: indexedFields.length > 0 ? indexedFields : undefined,
        unique_fields: uniqueFields,
      };

      const res = await fetch(`/api/content-types/${contentType}/config`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      let data: Record<string, unknown> = {};
      try { data = await res.json(); } catch { /* non-JSON response */ }

      if (!res.ok) {
        if (data.validation && typeof data.validation === "object") {
          setValidation((prev) => ({ ...prev, ...(data.validation as Record<string, FieldValidationResult>) }));
        }
        toast({ title: (data.error as string) || "Failed to save field mappings", variant: "destructive" });
        return;
      }

      queryClient.invalidateQueries({ queryKey: ["/api/content-types", contentType, "config"] });
      queryClient.invalidateQueries({ queryKey: ["/api/content-types", contentType, "items"] });
      queryClient.invalidateQueries({ queryKey: ["/api/content-types"] });
      toast({ title: `${label} field mappings saved` });
      onOpenChange(false);
    } catch {
      toast({ title: "Failed to save field mappings", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const regularKeys = Object.keys(mappings).filter((k) => !k.startsWith("_"));
  const specialKeys = Object.keys(mappings).filter((k) => k.startsWith("_"));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[540px] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{label} Field Mappings</DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="ml-2 text-sm text-muted-foreground">Loading...</span>
          </div>
        ) : (
          <div className="space-y-5">
            <p className="text-sm text-muted-foreground">
              Field mappings define which values are available as <code className="font-mono bg-muted px-1 rounded text-xs">{"{{ single.fieldName }}"}</code> template variables in sections.
            </p>

            {Object.values(transformerModes).some(Boolean) && (
              <div className="rounded-md bg-muted px-3 py-2">
                <p className="text-xs text-muted-foreground">
                  Computed fields use: <code className="font-mono bg-background px-1 rounded">(value, item) =&gt; result</code>. Runs in a secure sandbox (50ms timeout).
                </p>
              </div>
            )}

            {specialKeys.length > 0 && (
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">Special Fields</Label>
                {specialKeys.map((key) => (
                  <div key={key} className="flex items-center gap-2">
                    <Badge variant="outline" className="text-xs font-mono flex-shrink-0">{key}</Badge>
                    <ArrowRight className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                    {transformerModes[key] ? (
                      <Textarea
                        value={mappings[key] || ""}
                        onChange={(e) => setMappings((prev) => ({ ...prev, [key]: e.target.value }))}
                        placeholder="(value, item) => value"
                        className="text-xs font-mono min-h-[3rem] resize-y flex-1"
                        data-testid={`textarea-transform-${key}`}
                      />
                    ) : (
                      <Input
                        value={mappings[key] || ""}
                        onChange={(e) => setMappings((prev) => ({ ...prev, [key]: e.target.value }))}
                        className="text-xs font-mono flex-1"
                        data-testid={`input-mapping-${key}`}
                      />
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      className={`flex-shrink-0 ${transformerModes[key] ? "text-primary" : ""}`}
                      onClick={() => setTransformerModes((prev) => ({ ...prev, [key]: !prev[key] }))}
                      data-testid={`button-toggle-transform-${key}`}
                    >
                      <Code className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            )}

            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Field Mappings</Label>
              {regularKeys.length > 0 ? (
                <div className="space-y-1">
                  {regularKeys.map((key) => {
                    const isFn = !!transformerModes[key];
                    const isCustom = !!customModes[key];
                    const vResult = isFn ? null : validation[key];
                    const currentSrc = mappings[key] || "";
                    // Build Select options from all props (not just unmapped) so editing existing rows shows full list
                    const selectOptions = allAvailableProps?.common ?? [];
                    const currentInList = !currentSrc || selectOptions.includes(currentSrc) || currentSrc === key;
                    const extraOption = !currentInList ? currentSrc : null;
                    const selectValue = currentSrc || key;
                    return (
                      <div key={key}>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-mono w-28 flex-shrink-0 text-right text-muted-foreground truncate" title={key}>
                            {key}
                          </span>
                          <ArrowRight className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                          {isFn ? (
                            <Textarea
                              value={currentSrc}
                              onChange={(e) => setMappings((prev) => ({ ...prev, [key]: e.target.value }))}
                              placeholder="(value, item) => value"
                              className="text-xs font-mono min-h-[3rem] resize-y flex-1"
                              data-testid={`textarea-transform-${key}`}
                            />
                          ) : isCustom ? (
                            <div className="flex-1 flex items-center gap-1">
                              <Input
                                value={currentSrc}
                                onChange={(e) => handleSourceChange(key, e.target.value)}
                                placeholder="path.to.field"
                                className="text-xs font-mono flex-1"
                                data-testid={`input-mapping-${key}`}
                                autoFocus
                              />
                              <Button
                                variant="ghost"
                                size="icon"
                                className="flex-shrink-0 text-muted-foreground"
                                title="Pick from list"
                                onClick={() => {
                                  setCustomModes((prev) => { const n = { ...prev }; delete n[key]; return n; });
                                  if (availableProps?.common.length) {
                                    handleSourceChange(key, key);
                                  }
                                }}
                                data-testid={`button-pick-from-list-${key}`}
                              >
                                <List className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          ) : (
                            <Select
                              value={selectValue}
                              onValueChange={(v) => {
                                if (v === "__custom__") {
                                  setCustomModes((prev) => ({ ...prev, [key]: true }));
                                  setMappings((prev) => ({ ...prev, [key]: "" }));
                                } else {
                                  handleSourceChange(key, v);
                                }
                              }}
                            >
                              <SelectTrigger className="flex-1 text-xs font-mono h-9" data-testid={`select-mapping-${key}`}>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {extraOption && (
                                  <SelectItem key={extraOption} value={extraOption} className="text-xs font-mono">
                                    <span className="flex items-center gap-2">
                                      <Check className="h-3 w-3 text-green-600 flex-shrink-0" />
                                      {extraOption}
                                    </span>
                                  </SelectItem>
                                )}
                                {/* Always include the "same as key" option */}
                                {!selectOptions.includes(key) && key !== extraOption && (
                                  <SelectItem value={key} className="text-xs font-mono">
                                    <span className="flex items-center gap-2">
                                      <Check className="h-3 w-3 text-green-600 flex-shrink-0" />
                                      {key}
                                      <span className="text-[10px] text-muted-foreground">(same name)</span>
                                    </span>
                                  </SelectItem>
                                )}
                                {selectOptions.map((opt) => (
                                  <SelectItem key={opt} value={opt} className="text-xs font-mono">
                                    <span className="flex items-center gap-2">
                                      <Check className="h-3 w-3 text-green-600 flex-shrink-0" />
                                      {opt}
                                    </span>
                                  </SelectItem>
                                ))}
                                {(allAvailableProps?.partial ?? []).map((p) => (
                                  <SelectItem key={p.key} value={p.key} disabled className="text-xs font-mono opacity-50">
                                    <span className="flex items-center gap-2">
                                      <AlertTriangle className="h-3 w-3 text-amber-500 flex-shrink-0" />
                                      {p.key}
                                      <span className="text-[10px] text-muted-foreground">{p.count}/{p.total}</span>
                                    </span>
                                  </SelectItem>
                                ))}
                                <SelectItem value="__custom__" className="text-xs font-mono text-muted-foreground italic">
                                  Custom path…
                                </SelectItem>
                              </SelectContent>
                            </Select>
                          )}
                          {!isFn && !isDbBacked && <FieldValidationIndicator result={vResult} />}
                          <Button
                            variant="ghost"
                            size="icon"
                            className={`flex-shrink-0 ${isFn ? "text-primary" : ""}`}
                            onClick={() => {
                              const nowFn = !transformerModes[key];
                              setTransformerModes((prev) => ({ ...prev, [key]: nowFn }));
                              if (nowFn) {
                                setValidation((prev) => { const n = { ...prev }; delete n[key]; return n; });
                              } else if (!isDbBacked && mappings[key]) {
                                validateSingleField(key, mappings[key]);
                              }
                            }}
                            data-testid={`button-toggle-transform-${key}`}
                          >
                            <Code className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="flex-shrink-0"
                            onClick={() => setPendingDeleteKey(key)}
                            data-testid={`button-delete-mapping-${key}`}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                        {pendingDeleteKey === key && (
                          <div className="flex items-center gap-2 ml-[7.5rem] text-[11px] mt-1" data-testid={`confirm-delete-${key}`}>
                            <span className="text-muted-foreground">
                              Remove "<span className="font-mono font-medium">{key}</span>" mapping? Values in your YML files will not be affected.
                            </span>
                            <Button
                              variant="destructive"
                              size="sm"
                              className="text-[11px]"
                              onClick={() => {
                                setMappings((prev) => {
                                  const next = { ...prev };
                                  delete next[key];
                                  return next;
                                });
                                setTransformerModes((prev) => {
                                  const next = { ...prev };
                                  delete next[key];
                                  return next;
                                });
                                setValidation((prev) => {
                                  const next = { ...prev };
                                  delete next[key];
                                  return next;
                                });
                                setIndexedFields((prev) => prev.filter((f) => f !== key));
                                setUniqueFields((prev) => prev.filter((f) => f !== key));
                                setPendingDeleteKey(null);
                              }}
                              data-testid={`button-confirm-delete-${key}`}
                            >
                              Remove
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-[11px]"
                              onClick={() => setPendingDeleteKey(null)}
                              data-testid={`button-cancel-delete-${key}`}
                            >
                              Cancel
                            </Button>
                          </div>
                        )}
                        {!isFn && !isDbBacked && pendingDeleteKey !== key && <FieldValidationMessage result={vResult} fieldKey={key} source={mappings[key]} />}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground py-2">No field mappings defined yet.</p>
              )}

              <div className="pt-1">
                {showAddField ? (
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <Input
                        value={newKey}
                        onChange={(e) => setNewKey(e.target.value)}
                        placeholder="Field name"
                        className="text-xs font-mono flex-1"
                        onKeyDown={(e) => { if (e.key === "Enter") handleAddField(); }}
                        autoFocus
                        data-testid="input-new-mapping-key"
                      />
                      <ArrowRight className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                      <div className="relative flex-1">
                        <Input
                          value={newValue}
                          onChange={(e) => { handleNewValueChange(e.target.value); setSourceDropdownOpen(true); }}
                          onFocus={() => setSourceDropdownOpen(true)}
                          onBlur={() => setTimeout(() => setSourceDropdownOpen(false), 150)}
                          placeholder="Source (default: same)"
                          className="text-xs font-mono"
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleAddField();
                            if (e.key === "Escape") setSourceDropdownOpen(false);
                          }}
                          data-testid="input-new-mapping-value"
                        />
                        {sourceDropdownOpen && availableProps && (filteredAvailableProps.common.length > 0 || filteredAvailableProps.partial.length > 0) && (
                          <div className="absolute top-full left-0 right-0 z-50 mt-0.5 border rounded-md bg-popover shadow-md max-h-[180px] overflow-y-auto" data-testid="source-dropdown">
                            {filteredAvailableProps.common.map((k) => (
                              <button
                                key={k}
                                type="button"
                                className="w-full text-left px-2 py-1.5 flex items-center gap-2 text-xs hover-elevate border-b last:border-b-0"
                                onClick={() => {
                                  handleNewValueChange(k);
                                  setSourceDropdownOpen(false);
                                  if (!newKey.trim()) {
                                    setNewKey(k.split(".").pop() || k);
                                  }
                                }}
                                data-testid={`source-option-${k}`}
                              >
                                <Check className="w-3 h-3 text-green-600 flex-shrink-0" />
                                <span className="font-mono">{k}</span>
                                <span className="text-[10px] text-muted-foreground ml-auto">all entries</span>
                              </button>
                            ))}
                            {filteredAvailableProps.partial.map((p) => (
                              <button
                                key={p.key}
                                type="button"
                                disabled
                                className="w-full text-left px-2 py-1.5 flex items-center gap-2 text-xs opacity-50 cursor-not-allowed border-b last:border-b-0"
                                data-testid={`source-option-${p.key}`}
                              >
                                <AlertTriangle className="w-3 h-3 text-amber-500 flex-shrink-0" />
                                <span className="font-mono">{p.key}</span>
                                <span className="text-[10px] text-muted-foreground ml-auto">{p.count}/{p.total}</span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                      {!isDbBacked && (newValue.trim() || newKey.trim()) && <FieldValidationIndicator result={newValueValidation} />}
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={handleAddField}
                        disabled={!newKey.trim() || newKey.trim() in mappings}
                        data-testid="button-add-mapping"
                      >
                        <Check className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => { setShowAddField(false); setNewKey(""); setNewValue(""); setNewValueValidation(null); }}
                        data-testid="button-cancel-add-field"
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                    {!isDbBacked && <FieldValidationMessage result={newValueValidation} fieldKey="__new" source={newValue.trim() || newKey.trim()} />}
                  </div>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowAddField(true)}
                    data-testid="button-show-add-field"
                  >
                    <Plus className="h-3.5 w-3.5 mr-1.5" />
                    Add new field
                  </Button>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Indexes</Label>
              <p className="text-[11px] text-muted-foreground">
                Indexed fields generate filter dropdowns and summary cards on the management page.
              </p>
              <div className="flex items-center gap-2 flex-wrap" data-testid="section-index-toggles">
                {regularKeys.map((field) => {
                  const isIndexed = indexedFields.includes(field);
                  return (
                    <Badge
                      key={field}
                      variant={isIndexed ? "default" : "outline"}
                      className="text-xs cursor-pointer"
                      onClick={() => {
                        setIndexedFields((prev) =>
                          isIndexed ? prev.filter((f) => f !== field) : [...prev, field]
                        );
                      }}
                      data-testid={`badge-index-toggle-${field}`}
                    >
                      {isIndexed && <Check className="h-3 w-3 mr-1" />}
                      {field}
                    </Badge>
                  );
                })}
                {regularKeys.length === 0 && (
                  <p className="text-xs text-muted-foreground">Add field mappings first to enable indexing.</p>
                )}
              </div>
            </div>

            <div className="space-y-2" data-testid="section-unique-toggles">
              <Label className="text-xs text-muted-foreground font-medium">Unique Fields</Label>
              <p className="text-[11px] text-muted-foreground">
                Unique fields must have a distinct value across entries. When duplicating, the creation modal will prompt for new values. The same value can appear across different locales of the same entry.
              </p>
              <div className="flex items-center gap-2 flex-wrap">
                <Badge
                  variant={uniqueFields.includes("slug") ? "default" : "outline"}
                  className="text-xs cursor-default no-default-active-elevate"
                  data-testid="badge-unique-toggle-slug"
                >
                  {uniqueFields.includes("slug") && <Check className="h-3 w-3 mr-1" />}
                  slug
                </Badge>
                {regularKeys.filter(f => f !== "slug").map((field) => {
                  const isUnique = uniqueFields.includes(field);
                  return (
                    <Badge
                      key={field}
                      variant={isUnique ? "default" : "outline"}
                      className="text-xs cursor-pointer"
                      onClick={() => {
                        setUniqueFields((prev) =>
                          isUnique ? prev.filter((f) => f !== field) : [...prev, field]
                        );
                      }}
                      data-testid={`badge-unique-toggle-${field}`}
                    >
                      {isUnique && <Check className="h-3 w-3 mr-1" />}
                      {field}
                    </Badge>
                  );
                })}
                {regularKeys.length === 0 && (
                  <p className="text-[11px] text-muted-foreground italic">Add field mappings first to enable unique field selection.</p>
                )}
              </div>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-cancel-mappings">
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={saving || isLoading}
            data-testid="button-save-mappings"
          >
            {saving ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SeoSettingsDialog({
  open,
  onOpenChange,
  contentType,
  staticCount,
  dbCount,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contentType: string;
  staticCount: number;
  dbCount: number;
}) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const label = contentType.charAt(0).toUpperCase() + contentType.slice(1);

  const { data: config, isLoading } = useQuery<ContentTypeConfig>({
    queryKey: ["/api/content-types", contentType, "config"],
    queryFn: () => fetch(`/api/content-types/${contentType}/config`).then(r => r.json()),
    enabled: open,
  });

  const { data: localeSettings } = useQuery<LocaleSettings>({
    queryKey: ["/api/settings/locales"],
    staleTime: Infinity,
    enabled: open,
  });

  const availableLocales = localeSettings?.supported_locales ?? [
    { code: "en", label: "English" },
    { code: "es", label: "Spanish" },
  ];

  const [patternMode, setPatternMode] = useState<"non-localized" | "shorthand" | "per-locale">("shorthand");
  const [nonLocalizedPattern, setNonLocalizedPattern] = useState("");
  const [shorthandPattern, setShorthandPattern] = useState("");
  const [localePatterns, setLocalePatterns] = useState<{ locale: string; path: string }[]>([]);
  const [activeLocaleIndex, setActiveLocaleIndex] = useState(0);

  const nonLocalizedRef = useRef<HTMLInputElement>(null);
  const shorthandRef = useRef<HTMLInputElement>(null);
  const localeRefs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    if (!open || !config?.url_pattern) return;
    const detected = detectPatternMode(config.url_pattern);
    setPatternMode(detected.mode);
    setNonLocalizedPattern(detected.nonLocalizedPattern);
    setShorthandPattern(detected.shorthandPattern);
    const detectedCodes = new Set(detected.localePatterns.map(lp => lp.locale));
    const extraFromAvailable = availableLocales
      .filter(l => !detectedCodes.has(l.code))
      .map(l => ({ locale: l.code, path: "" }));
    setLocalePatterns([...detected.localePatterns, ...extraFromAvailable]);
  }, [open, config]);

  useEffect(() => {
    setLocalePatterns(prev => {
      const existingMap = Object.fromEntries(prev.map(lp => [lp.locale, lp.path]));
      const next = availableLocales.map(l => ({ locale: l.code, path: existingMap[l.code] ?? "" }));
      const changed = next.length !== prev.length || next.some((lp, i) => lp.locale !== prev[i]?.locale || lp.path !== prev[i]?.path);
      return changed ? next : prev;
    });
  }, [availableLocales]);

  const URL_SAFE_FIELDS = new Set(["slug", "category", "lang", "status", "tags"]);

  const mappedKeys = (() => {
    const keys: string[] = ["slug"];
    if (!config?.field_mapping) return keys;
    const fromMapping = Object.entries(config.field_mapping)
      .filter(([k, v]) => v != null && !k.startsWith("_") && URL_SAFE_FIELDS.has(k))
      .map(([k]) => k);
    return Array.from(new Set([...keys, ...fromMapping]));
  })();

  function normalizePathInput(raw: string): string {
    const trimmed = raw.trim();
    if (trimmed && !trimmed.startsWith("/")) return "/" + trimmed;
    return trimmed;
  }

  function validatePattern(p: string): string {
    if (!p) return "";
    const normalized = normalizePathInput(p);
    if (!normalized.includes(":slug")) return "Must include :slug";
    return "";
  }

  const nonLocalizedError = nonLocalizedPattern ? validatePattern(nonLocalizedPattern) : "";
  const shorthandError = shorthandPattern ? validatePattern(shorthandPattern) : "";
  const localeErrors = localePatterns.map(lp => lp.path ? validatePattern(lp.path) : "");
  const hasLocaleErrors = localeErrors.some(e => e !== "");
  const allLocalesFilled = localePatterns.length > 0 && localePatterns.every(lp => lp.path.trim() !== "");

  const canSubmit =
    patternMode === "non-localized"
      ? nonLocalizedPattern.trim() !== "" && !nonLocalizedError
      : patternMode === "shorthand"
        ? shorthandPattern.trim() !== "" && !shorthandError
        : allLocalesFilled && !hasLocaleErrors;

  const activePattern =
    patternMode === "non-localized"
      ? nonLocalizedPattern
      : patternMode === "shorthand"
        ? shorthandPattern
        : (localePatterns[activeLocaleIndex]?.path ?? "");

  const unknownVars = (() => {
    const patternsToCheck =
      patternMode === "per-locale"
        ? localePatterns.map(lp => lp.path)
        : [activePattern];
    const allVars = patternsToCheck.flatMap(p => (p.match(/:([a-z_]+)/g) || []).map(m => m.slice(1)));
    const unique = Array.from(new Set(allVars));
    return unique.filter(v => !mappedKeys.includes(v));
  })();

  const sampleItem = { slug: "sample-item", category: { slug: "general" } };

  const insertVariable = (varName: string) => {
    if (patternMode === "non-localized") {
      const el = nonLocalizedRef.current;
      const token = `:${varName}`;
      if (!el) { setNonLocalizedPattern(prev => prev + token); return; }
      const start = el.selectionStart ?? nonLocalizedPattern.length;
      const end = el.selectionEnd ?? nonLocalizedPattern.length;
      const next = nonLocalizedPattern.slice(0, start) + token + nonLocalizedPattern.slice(end);
      setNonLocalizedPattern(next);
      requestAnimationFrame(() => { el.focus(); el.setSelectionRange(start + token.length, start + token.length); });
    } else if (patternMode === "shorthand") {
      const el = shorthandRef.current;
      const token = `:${varName}`;
      if (!el) { setShorthandPattern(prev => prev + token); return; }
      const start = el.selectionStart ?? shorthandPattern.length;
      const end = el.selectionEnd ?? shorthandPattern.length;
      const next = shorthandPattern.slice(0, start) + token + shorthandPattern.slice(end);
      setShorthandPattern(next);
      requestAnimationFrame(() => { el.focus(); el.setSelectionRange(start + token.length, start + token.length); });
    } else {
      const idx = activeLocaleIndex;
      const el = localeRefs.current[idx];
      const current = localePatterns[idx]?.path ?? "";
      const token = `:${varName}`;
      if (!el) {
        setLocalePatterns(prev => prev.map((lp, i) => i === idx ? { ...lp, path: lp.path + token } : lp));
        return;
      }
      const start = el.selectionStart ?? current.length;
      const end = el.selectionEnd ?? current.length;
      const next = current.slice(0, start) + token + current.slice(end);
      setLocalePatterns(prev => prev.map((lp, i) => i === idx ? { ...lp, path: next } : lp));
      requestAnimationFrame(() => { el.focus(); el.setSelectionRange(start + token.length, start + token.length); });
    }
  };

  const previewItems = (() => {
    if (patternMode === "non-localized") {
      const p = normalizePathInput(nonLocalizedPattern);
      return p ? [{ label: "URL", pattern: p, locale: "en" }] : [];
    } else if (patternMode === "shorthand") {
      const suffix = normalizePathInput(shorthandPattern);
      if (!suffix) return [];
      return availableLocales.map(l => ({
        label: l.code.toUpperCase(),
        pattern: `/${l.code}${suffix}`,
        locale: l.code,
      }));
    } else {
      return localePatterns
        .filter(lp => lp.path.trim())
        .map(lp => ({
          label: lp.locale.toUpperCase(),
          pattern: `/${lp.locale}${normalizePathInput(lp.path)}`,
          locale: lp.locale,
        }));
    }
  })();

  const handleSave = async () => {
    setSaving(true);
    try {
      let url_pattern: Record<string, string>;
      if (patternMode === "non-localized") {
        url_pattern = { default: normalizePathInput(nonLocalizedPattern) };
      } else if (patternMode === "shorthand") {
        const suffix = normalizePathInput(shorthandPattern);
        url_pattern = Object.fromEntries(availableLocales.map(l => [l.code, `/${l.code}${suffix}`]));
      } else {
        url_pattern = Object.fromEntries(
          localePatterns.map(lp => [lp.locale, `/${lp.locale}${normalizePathInput(lp.path)}`])
        );
      }
      await apiRequest("PUT", `/api/content-types/${contentType}/config`, { url_pattern });
      queryClient.invalidateQueries({ queryKey: ["/api/content-types", contentType, "config"] });
      toast({ title: "URL pattern saved" });
      onOpenChange(false);
    } catch {
      toast({ title: "Failed to save URL pattern", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const totalEntries = staticCount + dbCount;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{label} URL Settings</DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <div className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-solid border-current border-r-transparent" />
            <span className="ml-2 text-sm text-muted-foreground">Loading...</span>
          </div>
        ) : (
          <div className="space-y-4">
            {totalEntries > 0 && (
              <div className="flex items-start gap-2.5 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2.5" data-testid="banner-url-change-warning">
                <AlertTriangle className="h-4 w-4 text-destructive flex-shrink-0 mt-0.5" />
                <p className="text-xs text-destructive leading-relaxed">
                  <span className="font-medium">Changing the URL pattern may break existing URLs.</span>{" "}
                  This content type has {totalEntries} existing {totalEntries === 1 ? "entry" : "entries"} already indexed by search engines and sitemaps. You will need to set up redirections manually.
                </p>
              </div>
            )}

            <div className="space-y-2">
              <Label>URL Pattern</Label>
              <div className="flex rounded-md border overflow-visible" data-testid="segmented-url-pattern-mode">
                {([
                  { value: "non-localized" as const, label: "No locale prefix" },
                  { value: "shorthand" as const, label: "Use locale prefix" },
                  { value: "per-locale" as const, label: "Customized" },
                ]).map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    className={`flex-1 text-xs py-1.5 px-1 transition-colors ${
                      patternMode === opt.value
                        ? "bg-primary text-primary-foreground font-medium"
                        : "text-muted-foreground hover-elevate"
                    } ${opt.value === "non-localized" ? "rounded-l-md" : ""} ${opt.value === "per-locale" ? "rounded-r-md" : ""}`}
                    onClick={() => setPatternMode(opt.value)}
                    data-testid={`button-pattern-mode-${opt.value}`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              {patternMode === "non-localized" && (
                <div className="space-y-1">
                  <Input
                    ref={nonLocalizedRef}
                    placeholder={`/${contentType}/:slug`}
                    value={nonLocalizedPattern}
                    onChange={(e) => setNonLocalizedPattern(e.target.value)}
                    className="font-mono text-sm"
                    data-testid="input-url-pattern-non-localized"
                  />
                  {nonLocalizedError && (
                    <p className="text-xs text-destructive" data-testid="text-non-localized-error">{nonLocalizedError}</p>
                  )}
                  <p className="text-xs text-muted-foreground">A single URL for all locales, no language prefix.</p>
                </div>
              )}

              {patternMode === "shorthand" && (
                <div className="space-y-1">
                  <div className="flex items-center">
                    <span
                      className="inline-flex items-center rounded-l-md border border-r-0 bg-muted px-2 py-2 text-xs text-muted-foreground flex-shrink-0"
                      data-testid="label-locale-prefix"
                    >
                      /:locale
                    </span>
                    <Input
                      ref={shorthandRef}
                      placeholder={`/${contentType}/:slug`}
                      value={shorthandPattern}
                      onChange={(e) => setShorthandPattern(e.target.value)}
                      className="rounded-l-none font-mono text-sm"
                      data-testid="input-url-pattern-shorthand"
                    />
                  </div>
                  {shorthandError && (
                    <p className="text-xs text-destructive" data-testid="text-shorthand-error">{shorthandError}</p>
                  )}
                </div>
              )}

              {patternMode === "per-locale" && (
                <div className="space-y-2">
                  {localePatterns.map((lp, i) => (
                    <div key={lp.locale} className="space-y-1">
                      <div className="flex items-center">
                        <span className="inline-flex items-center rounded-l-md border border-r-0 bg-muted px-2 py-2 text-xs text-muted-foreground flex-shrink-0">
                          /{lp.locale}
                        </span>
                        <Input
                          ref={el => { localeRefs.current[i] = el; }}
                          placeholder={`/${contentType}/:slug`}
                          value={lp.path}
                          onChange={(e) => setLocalePatterns(prev => prev.map((p, j) => j === i ? { ...p, path: e.target.value } : p))}
                          onFocus={() => setActiveLocaleIndex(i)}
                          className="rounded-l-none font-mono text-sm"
                          data-testid={`input-url-pattern-${lp.locale}`}
                        />
                      </div>
                      {localeErrors[i] && (
                        <p className="text-xs text-destructive" data-testid={`text-pattern-error-${lp.locale}`}>{localeErrors[i]}</p>
                      )}
                    </div>
                  ))}
                  <Link
                    href="/private/settings"
                    className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
                    onClick={() => onOpenChange(false)}
                    data-testid="link-manage-locales"
                  >
                    Manage locales
                    <ExternalLink className="h-3 w-3" />
                  </Link>
                </div>
              )}
            </div>

            {unknownVars.length > 0 && (
              <p className="text-xs text-destructive" data-testid="text-unknown-vars-warning">
                Unknown variable{unknownVars.length > 1 ? "s" : ""}: {unknownVars.map(v => `:${v}`).join(", ")}
              </p>
            )}

            <div className="space-y-1.5" data-testid="section-available-variables">
              <Label className="text-xs text-muted-foreground">Click to insert a variable</Label>
              <div className="flex items-center gap-1.5 flex-wrap">
                {mappedKeys.map((key) => (
                  <Badge
                    key={key}
                    variant="outline"
                    className="cursor-pointer font-mono text-xs"
                    onClick={() => insertVariable(key)}
                    data-testid={`chip-var-${key}`}
                  >
                    :{key}
                  </Badge>
                ))}
              </div>
            </div>

            {previewItems.length > 0 && (
              <div className="rounded-md bg-muted px-3 py-2 space-y-1" data-testid="section-url-previews">
                <Label className="text-xs text-muted-foreground">Preview</Label>
                {previewItems.map(({ label: lbl, pattern, locale }) => (
                  <p key={locale} className="text-xs text-muted-foreground font-mono" data-testid={`text-url-preview-${locale}`}>
                    {lbl}: {buildItemUrl(pattern, sampleItem, locale)}
                  </p>
                ))}
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-cancel-seo">
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving || isLoading || !canSubmit} data-testid="button-save-seo">
            {saving ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function ContentTypeManagePage() {
  const { toast } = useToast();
  const [, params] = useRoute("/private/type/:contentType");
  const [, navigate] = useLocation();
  const contentType = params?.contentType || "blog";
  const label = contentType.charAt(0).toUpperCase() + contentType.slice(1);

  const [search, setSearch] = useState("");
  const [tagFilters, setTagFilters] = useState<Record<string, string[]>>({});
  const [clearing, setClearing] = useState(false);
  const [dsDialogOpen, setDsDialogOpen] = useState(false);
  const [seoDialogOpen, setSeoDialogOpen] = useState(false);
  const [mappingDialogOpen, setMappingDialogOpen] = useState(false);
  const [viewMode, setViewMode] = useState<"static" | "db">("static");
  const [deletingEntry, setDeletingEntry] = useState<StaticEntry | null>(null);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deleteConfirmInput, setDeleteConfirmInput] = useState("");
  const [isDeletingEntry, setIsDeletingEntry] = useState(false);

  const [semanticResults, setSemanticResults] = useState<Record<string, unknown>[] | null>(null);
  const [semanticActive, setSemanticActive] = useState(false);
  const [semanticLoading, setSemanticLoading] = useState(false);
  const semanticDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [deleteTypeDialogOpen, setDeleteTypeDialogOpen] = useState(false);
  const [deleteTypeConfirmInput, setDeleteTypeConfirmInput] = useState("");
  const [isDeletingType, setIsDeletingType] = useState(false);
  const [dryRunResult, setDryRunResult] = useState<{
    static_entry_count: number;
    has_database: boolean;
    database_slug: string | null;
    directory: string;
    message: string;
    affected_urls: string[];
  } | null>(null);
  const [urlsExpanded, setUrlsExpanded] = useState(false);
  const [dryRunLoading, setDryRunLoading] = useState(false);

  const [convertDialogOpen, setConvertDialogOpen] = useState(false);
  const [convertConfirmInput, setConvertConfirmInput] = useState("");
  const [isConverting, setIsConverting] = useState(false);
  const [convertDryRunLoading, setConvertDryRunLoading] = useState(false);
  const [convertDryRun, setConvertDryRun] = useState<{
    entry_count: number;
    locale_count: number;
    files_to_write: number;
    files_to_overwrite: number;
    existing_slug_folders: string[];
    templates_to_delete: string[];
    directory: string;
    database_slug: string;
    message: string;
  } | null>(null);

  const [showYamlEditor, setShowYamlEditor] = useState(false);
  const [yamlEditorInfo, setYamlEditorInfo] = useState<{ contentType: string; slug: string; locale: string } | null>(null);

  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [duplicatingPage, setDuplicatingPage] = useState<{ loc: string; label: string; contentType: string; locale?: string } | null>(null);
  const [createContentType, setCreateContentType] = useState<string>(contentType);
  const [createContentTitle, setCreateContentTitle] = useState("");
  const [createContentSlugEn, setCreateContentSlugEn] = useState("");
  const [createContentSlugEs, setCreateContentSlugEs] = useState("");
  const [createContentSlugEnStatus, setCreateContentSlugEnStatus] = useState<'idle' | 'checking' | 'available' | 'taken'>('idle');
  const [createContentSlugEsStatus, setCreateContentSlugEsStatus] = useState<'idle' | 'checking' | 'available' | 'taken'>('idle');
  const [slugEnConflictReason, setSlugEnConflictReason] = useState<string | null>(null);
  const [slugEsConflictReason, setSlugEsConflictReason] = useState<string | null>(null);
  const [editingSlugEn, setEditingSlugEn] = useState(false);
  const [editingSlugEs, setEditingSlugEs] = useState(false);
  const [isCreatingContent, setIsCreatingContent] = useState(false);

  const [createVersionOpen, setCreateVersionOpen] = useState(false);
  const [createVersionEntry, setCreateVersionEntry] = useState<StaticEntry | null>(null);
  const [createVersionSlug, setCreateVersionSlug] = useState("");
  const [createVersionLocale, setCreateVersionLocale] = useState("en");
  const [isCreatingVersion, setIsCreatingVersion] = useState(false);
  const [partialOverrideDialogOpen, setPartialOverrideDialogOpen] = useState(false);
  const [partialOverrideVersionsDialogOpen, setPartialOverrideVersionsDialogOpen] = useState(false);
  const [versionsData, setVersionsData] = useState<Record<string, Record<string, { variants: { slug: string; allocation: number }[] }> | null>>({});
  const [versionsLoading, setVersionsLoading] = useState<Set<string>>(new Set());

  const { data: allItemsData, isLoading: allLoading } = useQuery<ItemsResponse>({
    queryKey: ["/api/content-types", contentType, "items"],
    queryFn: () => fetch(`/api/content-types/${contentType}/items`).then(r => r.json()),
    staleTime: 60000,
  });

  const { data: staticEntriesData, isLoading: staticLoading } = useQuery<{ count: number; results: StaticEntry[] }>({
    queryKey: ["/api/content-types", contentType, "static-entries"],
    queryFn: () => fetch(`/api/content-types/${contentType}/static-entries`).then(r => r.json()),
    staleTime: 60000,
  });

  const { data: cacheStatus } = useQuery<CacheStatus>({
    queryKey: ["/api/content-types", contentType, "cache-status"],
    queryFn: () => fetch(`/api/content-types/${contentType}/cache-status`).then(r => r.json()),
    staleTime: 30000,
  });

  const { data: typeConfig } = useQuery<ContentTypeConfig>({
    queryKey: ["/api/content-types", contentType, "config"],
    queryFn: () => fetch(`/api/content-types/${contentType}/config`).then(r => r.json()),
    staleTime: 60000,
  });

  const urlPatterns = typeConfig?.url_pattern || {};
  const localeKey = (() => {
    const raw = typeConfig?.field_mapping?._locale;
    if (!raw) return null;
    const val = typeof raw === "object" ? raw.source : raw;
    if (typeof val === "string" && val.startsWith("function:")) {
      const fm = typeConfig?.field_mapping || {};
      const localeLike = ["lang", "locale", "language"];
      for (const f of localeLike) {
        if (f in fm && !f.startsWith("_")) return f;
      }
      return null;
    }
    return val;
  })();

  const items = allItemsData?.results || [];

  const dbSlug = typeConfig?.database?.slug || null;
  const hasDbConnection = !!dbSlug;

  const dbSlugSet = new Set(
    hasDbConnection ? items.map((item) => String(item.slug ?? "")).filter(Boolean) : [],
  );
  const isPartialOverride = (entrySlug: string) => hasDbConnection && dbSlugSet.has(entrySlug);

  const LOCALE_LABELS: Record<string, string> = { en: "English", es: "Spanish", pt: "Portuguese", fr: "French", de: "German", it: "Italian" };

  const { data: dbEditorConfig } = useQuery<Record<string, { type?: string }>>({
    queryKey: ["/api/databases", dbSlug, "editor-config"],
    queryFn: () =>
      fetch(`/api/databases/${dbSlug}`).then(async (r) => {
        const data = await r.json();
        return (data.config?.editor as Record<string, { type?: string }>) || {};
      }),
    enabled: !!dbSlug,
    staleTime: 60000,
  });

  const isTagsField = (fieldKey: string) =>
    dbEditorConfig?.[fieldKey]?.type === "tags";

  const allIndexFields = (() => {
    const explicit = typeConfig?.indexes || [];
    const result = [...explicit];
    if (localeKey && !result.includes(localeKey)) {
      result.push(localeKey);
    }
    return result;
  })();


  useEffect(() => {
    if (viewMode !== "db" || !dbSlug) {
      setSemanticResults(null);
      setSemanticActive(false);
      setSemanticLoading(false);
      if (semanticDebounceRef.current) clearTimeout(semanticDebounceRef.current);
      return;
    }

    if (!search.trim()) {
      setSemanticResults(null);
      setSemanticActive(false);
      setSemanticLoading(false);
      if (semanticDebounceRef.current) clearTimeout(semanticDebounceRef.current);
      return;
    }

    setSemanticLoading(true);

    if (semanticDebounceRef.current) clearTimeout(semanticDebounceRef.current);

    semanticDebounceRef.current = setTimeout(async () => {
      try {
        const localeFilter = (tagFilters[localeKey || ""] ?? [])[0] || "";
        const params = new URLSearchParams({ q: search.trim(), limit: "50" });
        if (localeFilter) params.set("locale", localeFilter);

        const res = await fetch(`/api/databases/${dbSlug}/search?${params.toString()}`);
        if (!res.ok) throw new Error(`Search failed: ${res.status}`);
        const data = await res.json();

        setSemanticResults(data.items || []);
        setSemanticActive(data.semantic === true);
      } catch {
        setSemanticResults(null);
        setSemanticActive(false);
      } finally {
        setSemanticLoading(false);
      }
    }, 300);

    return () => {
      if (semanticDebounceRef.current) clearTimeout(semanticDebounceRef.current);
    };
  }, [search, viewMode, dbSlug, tagFilters, localeKey]);

  const matchesFilter = (item: Record<string, unknown>, field: string, value: string) => {
    if (isTagsField(field)) {
      const raw = item[field];
      const tokens: string[] = Array.isArray(raw)
        ? (raw as string[]).map((t) => t.toLowerCase())
        : typeof raw === "string" && raw.trim()
        ? raw.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean)
        : [];
      return tokens.includes(value.toLowerCase());
    }
    return String(item[field] || "").toLowerCase() === value.toLowerCase();
  };

  const filtered = (() => {
    if (viewMode === "db" && search.trim() && semanticResults !== null) {
      let result = semanticResults;
      for (const [field, values] of Object.entries(tagFilters)) {
        for (const value of values) {
          result = result.filter((p) => matchesFilter(p, field, value));
        }
      }
      return result;
    }

    let result = items;

    for (const [field, values] of Object.entries(tagFilters)) {
      for (const value of values) {
        result = result.filter((p) => matchesFilter(p, field, value));
      }
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (p) =>
          p.title?.toLowerCase().includes(q) ||
          p.slug?.toLowerCase().includes(q) ||
          p.description?.toLowerCase().includes(q) ||
          (p.author_name ? `${p.author_name} ${p.author_last_name || ""}` : "").toLowerCase().includes(q)
      );
    }

    return result;
  })();

  const staticEntries = staticEntriesData?.results || [];
  const filteredStatic = (() => {
    if (!search.trim()) return staticEntries;
    const q = search.toLowerCase();
    return staticEntries.filter(
      (e) => e.title.toLowerCase().includes(q) || e.slug.toLowerCase().includes(q)
    );
  })();

  const hasDb = !!typeConfig?.database?.slug;
  const staticEntryCount =
    typeConfig?.static_entry_count !== undefined
      ? typeConfig.static_entry_count
      : staticLoading
        ? null
        : staticEntriesData?.count ?? 0;
  const dbEntryCount = hasDb ? (allLoading ? null : allItemsData?.count ?? items.length) : null;
  const defaultViewMode = hasDb ? "db" : "static";
  const prevDefaultRef = useRef(defaultViewMode);
  useEffect(() => {
    if (prevDefaultRef.current !== defaultViewMode) {
      prevDefaultRef.current = defaultViewMode;
      setViewMode(defaultViewMode);
    }
  }, [defaultViewMode]);

  const handleDeleteEntry = async (localesToDelete: string[]) => {
    if (!deletingEntry || deleteConfirmInput !== deletingEntry.slug) return;
    setIsDeletingEntry(true);
    try {
      const token = getDebugToken();
      const author = await resolveAuthorName();
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Token ${token}`;
      const response = await fetch("/api/content/delete", {
        method: "POST",
        headers,
        body: JSON.stringify({
          type: contentType,
          slug: deletingEntry.slug,
          confirmSlug: deleteConfirmInput,
          author,
          ...(localesToDelete.length > 0 ? { localesToDelete } : {}),
        }),
      });
      const data = await response.json();
      if (response.ok) {
        toast({ title: "Entry deleted", description: data.message });
        setDeleteModalOpen(false);
        setDeletingEntry(null);
        setDeleteConfirmInput("");
        queryClient.invalidateQueries({ queryKey: ["/api/content-types", contentType, "static-entries"] });
      } else {
        toast({ title: "Error", description: data.error || "Failed to delete", variant: "destructive" });
      }
    } catch {
      toast({ title: "Error", description: "Connection error", variant: "destructive" });
    } finally {
      setIsDeletingEntry(false);
    }
  };

  const handleClearCache = async () => {
    setClearing(true);
    try {
      await apiRequest("POST", `/api/content-types/${contentType}/clear-cache`);
      toast({ title: `${label} cache cleared`, description: "Refreshing entries..." });
      queryClient.invalidateQueries({ queryKey: ["/api/content-types", contentType, "items"] });
      queryClient.invalidateQueries({ queryKey: ["/api/content-types", contentType, "cache-status"] });
    } catch {
      toast({ title: "Failed to clear cache", variant: "destructive" });
    } finally {
      setClearing(false);
    }
  };

  const handleOpenConvertDialog = async () => {
    setConvertConfirmInput("");
    setConvertDryRun(null);
    setConvertDialogOpen(true);
    setConvertDryRunLoading(true);
    try {
      const token = getDebugToken();
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Token ${token}`;
      const res = await fetch(`/api/content-types/${contentType}/convert-to-static`, {
        method: "POST",
        headers,
        body: JSON.stringify({ dry_run: true }),
      });
      const data = await res.json();
      if (res.ok) {
        setConvertDryRun(data);
      } else {
        toast({
          title: "Cannot convert",
          description: data.error || "Failed to preview conversion",
          variant: "destructive",
        });
        setConvertDialogOpen(false);
      }
    } catch {
      toast({ title: "Cannot convert", description: "Connection error", variant: "destructive" });
      setConvertDialogOpen(false);
    } finally {
      setConvertDryRunLoading(false);
    }
  };

  const handleConvertToStatic = async () => {
    if (convertConfirmInput !== contentType) return;
    setIsConverting(true);
    try {
      const token = getDebugToken();
      const author = await resolveAuthorName();
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Token ${token}`;
      const res = await fetch(`/api/content-types/${contentType}/convert-to-static`, {
        method: "POST",
        headers,
        body: JSON.stringify({ dry_run: false, author }),
      });
      const data = await res.json();
      if (res.ok) {
        toast({
          title: "Converted to static",
          description: `Wrote ${data.written?.length ?? 0} new and ${data.overwritten?.length ?? 0} overwritten file(s). Database unlinked.`,
        });
        setConvertDialogOpen(false);
        setConvertConfirmInput("");
        setConvertDryRun(null);
        queryClient.invalidateQueries({ queryKey: ["/api/content-types"] });
        queryClient.invalidateQueries({ queryKey: ["/api/content-types", contentType, "config"] });
        queryClient.invalidateQueries({ queryKey: ["/api/content-types", contentType, "items"] });
        queryClient.invalidateQueries({ queryKey: ["/api/content-types", contentType, "static-entries"] });
        queryClient.invalidateQueries({ queryKey: ["/api/content-types", contentType, "cache-status"] });
        setViewMode("static");
      } else {
        toast({
          title: "Conversion failed",
          description: data.error || "Failed to convert",
          variant: "destructive",
        });
      }
    } catch {
      toast({ title: "Conversion failed", description: "Connection error", variant: "destructive" });
    } finally {
      setIsConverting(false);
    }
  };

  const handleOpenDeleteTypeDialog = async () => {
    setDeleteTypeConfirmInput("");
    setDryRunResult(null);
    setUrlsExpanded(false);
    setDeleteTypeDialogOpen(true);
    setDryRunLoading(true);
    try {
      const res = await fetch(`/api/content-types/${contentType}?dry_run=true`, { method: "DELETE" });
      const data = await res.json();
      if (res.ok) {
        setDryRunResult(data);
      }
    } catch {
    } finally {
      setDryRunLoading(false);
    }
  };

  const handleDeleteType = async () => {
    if (deleteTypeConfirmInput !== contentType) return;
    setIsDeletingType(true);
    try {
      const res = await apiRequest("DELETE", `/api/content-types/${contentType}`);
      const data = await res.json();
      if (data.success) {
        toast({ title: "Content type deleted", description: `"${contentType}" has been removed from content-types.yml.` });
        setDeleteTypeDialogOpen(false);
        queryClient.invalidateQueries({ queryKey: ["/api/content-types"] });
        navigate("/");
      } else {
        toast({ title: "Failed to delete content type", description: data.error || "Unknown error", variant: "destructive" });
      }
    } catch (err) {
      toast({ title: "Failed to delete content type", description: String(err), variant: "destructive" });
    } finally {
      setIsDeletingType(false);
    }
  };

  const fetchVersionsForEntry = async (slug: string) => {
    if (slug in versionsData || versionsLoading.has(slug)) return;
    setVersionsLoading(prev => new Set([...prev, slug]));
    try {
      const res = await fetch(`/api/versioning/${contentType}/${slug}`);
      const data = await res.json();
      setVersionsData(prev => ({ ...prev, [slug]: data.versioning || null }));
    } finally {
      setVersionsLoading(prev => { const next = new Set(prev); next.delete(slug); return next; });
    }
  };

  const handleCreateVersion = async () => {
    if (!createVersionEntry || !createVersionSlug) return;
    setIsCreatingVersion(true);
    try {
      const res = await apiRequest("POST", `/api/versioning/${contentType}/${createVersionEntry.slug}`, {
        variantSlug: createVersionSlug,
        locale: createVersionLocale,
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ title: data.error || "Failed to create version", variant: "destructive" });
        return;
      }
      toast({ title: `Version "${createVersionSlug}" created`, description: data.filePath });
      setCreateVersionOpen(false);
      setVersionsData(prev => { const next = { ...prev }; delete next[createVersionEntry.slug]; return next; });
      queryClient.invalidateQueries({ queryKey: ["/api/content-types", contentType, "static-entries"] });
      navigate(`/private/${contentType}/${createVersionEntry.slug}/versions`);
    } catch {
      toast({ title: "Failed to create version", variant: "destructive" });
    } finally {
      setIsCreatingVersion(false);
    }
  };

  const copyUrl = async (url: string) => {
    await navigator.clipboard.writeText(url);
    toast({ title: "Copied", description: url, duration: 2000 });
  };

  const handleDownloadYml = async (slug: string) => {
    const token = getDebugToken();
    const headers: Record<string, string> = {};
    if (token) headers["Authorization"] = `Token ${token}`;
    try {
      const resolveRes = await fetch(`/api/content/resolve-folder?slug=${encodeURIComponent(slug)}`, { headers });
      if (!resolveRes.ok) {
        toast({ title: "No YAML found", description: "This entry has no YAML content files" });
        return;
      }
      const resolveData = await resolveRes.json();
      const entries: { directory: string; files: string[]; title?: string; contentType: string }[] = resolveData.multiple
        ? resolveData.matches
        : [resolveData];
      let downloadedCount = 0;
      for (const entry of entries) {
        for (const filename of entry.files) {
          try {
            const res = await fetch(`/api/content/file?path=${encodeURIComponent(`${entry.directory}/${filename}`)}`, { headers });
            if (!res.ok) continue;
            const text = await res.text();
            const blob = new Blob([text], { type: 'text/yaml' });
            const blobUrl = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = blobUrl;
            a.download = entries.length > 1 ? `${entry.contentType}-${slug}-${filename}` : `${slug}-${filename}`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(blobUrl);
            downloadedCount++;
          } catch {}
        }
      }
      if (downloadedCount > 0) {
        toast({ title: "Download complete", description: `Downloaded ${downloadedCount} YAML file(s) for "${slug}"` });
      } else {
        toast({ title: "No files found", description: `No YAML files could be downloaded for "${slug}"`, variant: "destructive" });
      }
    } catch {
      toast({ title: "Download failed", description: "An error occurred while downloading", variant: "destructive" });
    }
  };

  const handleEditYaml = async (entry: StaticEntry) => {
    const locale = entry.locales[0] || "en";
    const token = getDebugToken();
    const headers: Record<string, string> = {};
    if (token) headers["Authorization"] = `Token ${token}`;
    try {
      const res = await fetch(`/api/content/raw-file?contentType=${encodeURIComponent(contentType)}&slug=${encodeURIComponent(entry.slug)}&locale=${encodeURIComponent(locale)}`, { headers });
      if (!res.ok) {
        toast({ title: "No YAML found", description: "This entry has no YAML content files", variant: "destructive" });
        return;
      }
      const data = await res.json();
      if (!data.exists) {
        toast({ title: "No YAML found", description: "This entry has no YAML content files", variant: "destructive" });
        return;
      }
      setYamlEditorInfo({ contentType, slug: entry.slug, locale });
      setShowYamlEditor(true);
    } catch {
      toast({ title: "Error", description: "Failed to check YAML files", variant: "destructive" });
    }
  };

  const handleDuplicate = async (entry: StaticEntry) => {
    const firstLocale = entry.locales[0] || "en";
    const firstUrl = entry.urls[firstLocale] || Object.values(entry.urls)[0] || `/${firstLocale}/${entry.slug}`;
    const suggestedSlug = `${entry.slug}-copy`;
    setDuplicatingPage({ loc: firstUrl, label: entry.title, contentType, locale: firstLocale });
    setCreateContentType(contentType);
    setCreateContentTitle(`${entry.title} (Copy)`);
    setCreateContentSlugEn(suggestedSlug);
    setCreateContentSlugEs(suggestedSlug);
    setCreateContentSlugEnStatus('checking');
    setCreateContentSlugEsStatus('checking');
    setSlugEnConflictReason(null);
    setSlugEsConflictReason(null);
    setEditingSlugEn(true);
    setEditingSlugEs(true);
    setCreateModalOpen(true);
    try {
      const [enRes, esRes] = await Promise.all([
        fetch(`/api/content/check-slug?type=${encodeURIComponent(contentType)}&slug=${encodeURIComponent(suggestedSlug)}&locale=en`),
        fetch(`/api/content/check-slug?type=${encodeURIComponent(contentType)}&slug=${encodeURIComponent(suggestedSlug)}&locale=es`),
      ]);
      const [enData, esData] = await Promise.all([enRes.json(), esRes.json()]);
      setCreateContentSlugEnStatus(enData.available ? 'available' : 'taken');
      setSlugEnConflictReason(enData.available ? null : (enData.reason === 'redirect_conflict' ? `Conflicts with redirect: ${enData.conflictUrl} → ${enData.redirectTo}` : null));
      setCreateContentSlugEsStatus(esData.available ? 'available' : 'taken');
      setSlugEsConflictReason(esData.available ? null : (esData.reason === 'redirect_conflict' ? `Conflicts with redirect: ${esData.conflictUrl} → ${esData.redirectTo}` : null));
    } catch {
      setCreateContentSlugEnStatus('idle');
      setCreateContentSlugEsStatus('idle');
    }
  };

  const hasAuthorField = items.some(p => p.author_name || p.author);
  const hasPublishedAt = items.some(p => p.published_at);
  const hasUpdatedAt = items.some(p => p.updated_at);

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-7xl mx-auto p-6 space-y-6">
        <div className="flex items-center gap-3 flex-wrap">
          <Link href="/" className="inline-flex">
            <Button variant="ghost" size="icon" data-testid="button-back-home">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl font-bold" data-testid="text-page-title">{label} Management</h1>
            <p className="text-sm text-muted-foreground">
              Overview of all {contentType} entries and cache status{hasDb && <> — or by calling the <WebhookUrlPopover type={contentType} /></>}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  data-testid="button-data-source"
                >
                  <Database className="h-4 w-4 mr-1" />
                  Database
                  {cacheStatus?.exists && cacheStatus.age_hours != null && (
                    <span className="text-[10px] text-muted-foreground ml-1" data-testid="text-cache-age">
                      ({cacheStatus.age_hours}h)
                    </span>
                  )}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onClick={() => setDsDialogOpen(true)}
                  data-testid="button-manage-connection"
                >
                  <Database className="h-4 w-4 mr-2" />
                  Manage Connection
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={handleClearCache}
                  disabled={clearing}
                  data-testid="button-clear-cache"
                >
                  <RefreshCw className={`h-4 w-4 mr-2 ${clearing ? "animate-spin" : ""}`} />
                  Clear Cache
                </DropdownMenuItem>
                {hasDb && (
                  <DropdownMenuItem
                    onClick={handleOpenConvertDialog}
                    data-testid="button-convert-to-static"
                  >
                    <FileText className="h-4 w-4 mr-2" />
                    Convert to static
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setMappingDialogOpen(true)}
              data-testid="button-field-mappings"
            >
              <Shuffle className="h-4 w-4 mr-1" />
              Mappings
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSeoDialogOpen(true)}
              data-testid="button-seo-settings"
            >
              <LinkIcon className="h-4 w-4 mr-1" />
              URLs
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" data-testid="button-more-actions">
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={handleOpenDeleteTypeDialog}
                  className="text-destructive focus:text-destructive"
                  data-testid="button-delete-content-type"
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete Content Type
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {allIndexFields.map((idx) => {
            const isLocale = idx === localeKey;
            const counts: Record<string, number> = {};
            for (const item of items) {
              if (isTagsField(idx)) {
                const raw = item[idx];
                const tokens: string[] = Array.isArray(raw)
                  ? (raw as string[])
                  : typeof raw === "string" && raw.trim()
                  ? raw.split(",").map((t) => t.trim()).filter(Boolean)
                  : [];
                for (const token of tokens) {
                  const t = token.toLowerCase();
                  if (t) counts[t] = (counts[t] || 0) + 1;
                }
              } else {
                const val = String(item[idx] || "").toLowerCase();
                if (val) counts[val] = (counts[val] || 0) + 1;
              }
            }
            const sortedEntries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
            return (
              <Card key={idx} data-testid={`card-kpi-${idx}`}>
                <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    {isLocale ? "Language" : idx.charAt(0).toUpperCase() + idx.slice(1)}
                  </CardTitle>
                  {isLocale ? (
                    <Globe className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <LayoutList className="h-4 w-4 text-muted-foreground" />
                  )}
                </CardHeader>
                <CardContent>
                  {(() => {
                    const VISIBLE_COUNT = 2;
                    const visible = sortedEntries.slice(0, VISIBLE_COUNT);
                    const remaining = sortedEntries.length - VISIBLE_COUNT;
                    return (
                      <div className="flex flex-wrap gap-1.5">
                        {visible.map(([val, count]) => (
                          <Badge key={val} variant="secondary" className="text-xs" data-testid={`text-kpi-${idx}-${val}`}>
                            {allLoading ? "..." : count}
                            <span className="ml-1 text-muted-foreground font-normal">
                              {isLocale ? val.toUpperCase() : val.charAt(0).toUpperCase() + val.slice(1)}
                            </span>
                          </Badge>
                        ))}
                        {remaining > 0 && (
                          <Popover>
                            <PopoverTrigger asChild>
                              <Badge variant="outline" className="text-xs cursor-pointer" data-testid={`button-view-more-${idx}`}>
                                +{remaining} more
                              </Badge>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto max-w-xs p-3" align="start">
                              <div className="flex flex-wrap gap-1.5">
                                {sortedEntries.slice(VISIBLE_COUNT).map(([val, count]) => (
                                  <Badge key={val} variant="secondary" className="text-xs" data-testid={`text-kpi-${idx}-${val}`}>
                                    {allLoading ? "..." : count}
                                    <span className="ml-1 text-muted-foreground font-normal">
                                      {isLocale ? val.toUpperCase() : val.charAt(0).toUpperCase() + val.slice(1)}
                                    </span>
                                  </Badge>
                                ))}
                              </div>
                            </PopoverContent>
                          </Popover>
                        )}
                      </div>
                    );
                  })()}
                </CardContent>
              </Card>
            );
          })}
        </div>

        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-1" data-testid="toggle-view-mode">
                <Button
                  variant="ghost"
                  size="sm"
                  className={`toggle-elevate ${viewMode === "static" ? "toggle-elevated" : ""}`}
                  onClick={() => setViewMode("static")}
                  data-testid="button-view-static"
                >
                  <Folder className="h-4 w-4 mr-1" />
                  Static Entries
                  <span className="ml-1.5 text-muted-foreground font-normal tabular-nums" data-testid="text-kpi-static">
                    ({staticEntryCount ?? "..."})
                  </span>
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className={`toggle-elevate ${viewMode === "db" ? "toggle-elevated" : ""}`}
                  onClick={() => setViewMode("db")}
                  data-testid="button-view-db"
                >
                  <Database className="h-4 w-4 mr-1" />
                  DB Entries
                  {hasDb && (
                    <span className="ml-1.5 text-muted-foreground font-normal tabular-nums" data-testid="text-kpi-db">
                      ({dbEntryCount ?? "..."})
                    </span>
                  )}
                </Button>
              </div>
              <div className="relative flex-1 min-w-[200px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder={`Search ${contentType} entries by title or slug...`}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className={`pl-9${search ? (viewMode === "db" && (semanticLoading || semanticActive) ? " pr-20" : " pr-8") : ""}`}
                  data-testid="input-search"
                />
                {search && (
                  <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
                    {viewMode === "db" && search.trim() && (
                      semanticLoading ? (
                        <div className="h-3 w-3 animate-spin rounded-full border border-solid border-current border-r-transparent text-muted-foreground" />
                      ) : semanticActive ? (
                        <span
                          className="text-[10px] font-medium text-primary bg-primary/10 px-1.5 py-0.5 rounded"
                          title="Results ranked by semantic similarity"
                          data-testid="badge-semantic-search"
                        >
                          semantic
                        </span>
                      ) : null
                    )}
                    <button
                      type="button"
                      className="text-muted-foreground hover:text-foreground"
                      onClick={() => setSearch("")}
                      aria-label="Clear search"
                      data-testid="button-clear-search"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
              </div>
              {(() => {
                const facets = allItemsData?.facets;
                if (viewMode !== "db" || !facets || Object.keys(facets).length === 0) return null;
                const activeFilterCount = Object.values(tagFilters).flat().length;
                return (
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        size="icon"
                        className="shrink-0 relative"
                        data-testid="button-open-filters"
                      >
                        <SlidersHorizontal className="h-4 w-4" />
                        {activeFilterCount > 0 && (
                          <span className="absolute -top-1 -right-1 h-3.5 w-3.5 rounded-full bg-primary text-primary-foreground text-[9px] flex items-center justify-center font-medium leading-none">
                            {activeFilterCount}
                          </span>
                        )}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent side="bottom" align="end" className="p-3 w-64" data-testid="tag-filter-bar">
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <p className="text-xs font-medium">Filters</p>
                          {activeFilterCount > 0 && (
                            <button
                              className="text-[11px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer underline underline-offset-2"
                              onClick={() => setTagFilters({})}
                              data-testid="button-clear-tag-filters"
                            >
                              Clear all
                            </button>
                          )}
                        </div>
                        {Object.entries(facets).map(([field, values]) => {
                          const active = tagFilters[field] ?? [];
                          const available = values.filter((v) => !active.includes(v));
                          return (
                            <div key={field} className="space-y-1.5">
                              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">{field}</p>
                              <Select
                                value=""
                                onValueChange={(v) => {
                                  setTagFilters((prev) => ({ ...prev, [field]: [...(prev[field] ?? []), v] }));
                                }}
                              >
                                <SelectTrigger className="h-7 text-xs" data-testid={`select-filter-${field}`}>
                                  <SelectValue placeholder="Add filter…" />
                                </SelectTrigger>
                                <SelectContent>
                                  {available.length === 0 ? (
                                    <div className="px-2 py-1.5 text-xs text-muted-foreground">All selected</div>
                                  ) : (
                                    available.map((v) => (
                                      <SelectItem key={v} value={v} className="text-xs" data-testid={`chip-filter-${field}-${v}`}>
                                        {v}
                                      </SelectItem>
                                    ))
                                  )}
                                </SelectContent>
                              </Select>
                              {active.length > 0 && (
                                <div className="flex flex-wrap gap-1">
                                  {active.map((v) => (
                                    <span key={v} className="inline-flex items-center gap-0.5 bg-primary/10 text-primary text-[11px] rounded px-1.5 py-0.5">
                                      {v}
                                      <button
                                        className="ml-0.5 hover:text-foreground cursor-pointer"
                                        onClick={() => {
                                          setTagFilters((prev) => {
                                            const next = (prev[field] ?? []).filter((x) => x !== v);
                                            if (next.length === 0) {
                                              const { [field]: _, ...rest } = prev;
                                              return rest;
                                            }
                                            return { ...prev, [field]: next };
                                          });
                                        }}
                                      >
                                        <X className="h-2.5 w-2.5" />
                                      </button>
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </PopoverContent>
                  </Popover>
                );
              })()}
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {viewMode === "static" ? (
              staticLoading ? (
                <div className="flex items-center justify-center py-12" data-testid="loading-static">
                  <div className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-solid border-current border-r-transparent" />
                  <span className="ml-2 text-sm text-muted-foreground">Loading entries...</span>
                </div>
              ) : filteredStatic.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground" data-testid="text-no-results">
                  No static entries found
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm" data-testid="table-static-entries">
                    <thead>
                      <tr className="border-b bg-muted/50">
                        <th className="text-left px-4 py-3 font-medium text-muted-foreground">Title</th>
                        <th className="text-left px-4 py-3 font-medium text-muted-foreground">Locales</th>
                        <th className="text-right px-4 py-3 font-medium text-muted-foreground">Link</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredStatic.map((entry) => {
                        const firstUrl = entry.urls[entry.locales[0]] || Object.values(entry.urls)[0] || "";
                        return (
                          <tr
                            key={entry.slug}
                            className="border-b last:border-0 hover:bg-muted/30 transition-colors"
                            data-testid={`row-static-${entry.slug}`}
                          >
                            <td className="px-4 py-3">
                              <div className="min-w-0">
                                <div className="font-medium truncate max-w-[300px]" title={entry.title} data-testid={`text-title-${entry.slug}`}>
                                  {entry.title}
                                </div>
                                <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
                                  <div className="text-xs text-muted-foreground truncate max-w-[300px]">
                                    {entry.slug}
                                  </div>
                                  {isPartialOverride(entry.slug) && (
                                    <Badge
                                      variant="outline"
                                      className="text-[10px] px-1.5 py-0 h-4 cursor-pointer shrink-0 gap-0.5 border-violet-500/40 text-violet-600 dark:text-violet-400 hover:bg-violet-500/10"
                                      data-testid={`badge-partial-override-${entry.slug}`}
                                      onClick={() => setPartialOverrideDialogOpen(true)}
                                    >
                                      <Info className="h-2.5 w-2.5" />
                                      Partial Override
                                    </Badge>
                                  )}
                                </div>
                              </div>
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-1 flex-wrap">
                                {entry.locales.length === 0 ? (
                                  <span className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400" title="Legacy format — click actions to migrate">
                                    <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
                                    Legacy
                                  </span>
                                ) : (
                                  entry.locales.map((loc) => {
                                    const count = entry.versionCounts?.[loc];
                                    return (
                                      <Badge key={loc} variant="outline" className="text-xs">
                                        {loc.toUpperCase()}{count && count > 1 ? ` · ${count}` : ""}
                                      </Badge>
                                    );
                                  })
                                )}
                              </div>
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex items-center justify-end gap-1">
                                {Object.keys(entry.urls).length > 0 && (
                                  <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                      <Button variant="ghost" size="sm" className="text-xs gap-1.5" data-testid={`button-open-${entry.slug}`}>
                                        <ExternalLink className="h-3.5 w-3.5" />
                                        Open
                                      </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end">
                                      {Object.entries(entry.urls).flatMap(([loc, url]) => [
                                        <DropdownMenuItem key={`${loc}-new`} asChild>
                                          <a href={url} target="_blank" rel="noopener noreferrer" data-testid={`link-new-tab-${entry.slug}-${loc}`}>
                                            <ExternalLink className="h-4 w-4 mr-2" />
                                            Open in new tab ({loc.toUpperCase()})
                                          </a>
                                        </DropdownMenuItem>,
                                        <DropdownMenuItem key={`${loc}-same`} asChild>
                                          <a href={url} data-testid={`link-same-tab-${entry.slug}-${loc}`}>
                                            <ArrowLeft className="h-4 w-4 mr-2 rotate-180" />
                                            Open ({loc.toUpperCase()})
                                          </a>
                                        </DropdownMenuItem>,
                                      ])}
                                    </DropdownMenuContent>
                                  </DropdownMenu>
                                )}
                                {entry.locales.length > 0 && (
                                  isPartialOverride(entry.slug) ? (
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="text-xs gap-1.5"
                                      data-testid={`button-versions-${entry.slug}`}
                                      onClick={() => setPartialOverrideVersionsDialogOpen(true)}
                                    >
                                      <GitBranch className="h-3.5 w-3.5" />
                                      Versions
                                    </Button>
                                  ) : (
                                    <DropdownMenu onOpenChange={(open) => { if (open) fetchVersionsForEntry(entry.slug); }}>
                                      <DropdownMenuTrigger asChild>
                                        <Button variant="ghost" size="sm" className="text-xs gap-1.5" data-testid={`button-versions-${entry.slug}`}>
                                          <GitBranch className="h-3.5 w-3.5" />
                                          Versions{entry.versionCounts && Object.keys(entry.versionCounts).length > 0 ? ` (${Object.values(entry.versionCounts).reduce((a, b) => a + b, 0)})` : ""}
                                        </Button>
                                      </DropdownMenuTrigger>
                                      <DropdownMenuContent align="end" className="min-w-[220px]">
                                        {versionsLoading.has(entry.slug) ? (
                                          <div className="flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground">
                                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                            Loading...
                                          </div>
                                        ) : !versionsData[entry.slug] || Object.keys(versionsData[entry.slug]!).length === 0 ? (
                                          <div className="px-2 py-1.5 text-xs text-muted-foreground">
                                            No alternate versions for {Object.values(entry.urls)[0] ? new URL(Object.values(entry.urls)[0], window.location.origin).pathname : `/${entry.slug}`}, you can propose new versions here
                                          </div>
                                        ) : (
                                          Object.entries(versionsData[entry.slug]!).flatMap(([loc, localeData]) =>
                                            localeData.variants.map((variant) => (
                                              <DropdownMenuItem key={`${loc}-${variant.slug}`} asChild>
                                                <a
                                                  href={entry.urls[loc] ? `${entry.urls[loc].split("?")[0]}?force_variant=${variant.slug}` : "#"}
                                                  target="_blank"
                                                  rel="noopener noreferrer"
                                                  data-testid={`link-variant-${entry.slug}-${loc}-${variant.slug}`}
                                                >
                                                  <GitBranch className="h-4 w-4 mr-2 flex-shrink-0" />
                                                  <span className="flex-1">{variant.slug}</span>
                                                  <span className="ml-2 text-xs text-muted-foreground">{loc.toUpperCase()} · {variant.allocation}%</span>
                                                </a>
                                              </DropdownMenuItem>
                                            ))
                                          )
                                        )}
                                        <DropdownMenuSeparator />
                                        <DropdownMenuItem
                                          onClick={() => {
                                            setCreateVersionEntry(entry);
                                            setCreateVersionLocale(entry.locales[0] || "en");
                                            setCreateVersionSlug("");
                                            setCreateVersionOpen(true);
                                          }}
                                          data-testid={`button-new-version-${entry.slug}`}
                                        >
                                          <Plus className="h-4 w-4 mr-2" />
                                          New version...
                                        </DropdownMenuItem>
                                      </DropdownMenuContent>
                                    </DropdownMenu>
                                  )
                                )}
                              {(Object.keys(entry.urls).length > 0 || entry.locales.length === 0) && (
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <Button variant="ghost" size="icon" data-testid={`button-actions-${entry.slug}`}>
                                      <MoreVertical className="h-4 w-4" />
                                    </Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end">
                                    <DropdownMenuItem
                                      onClick={() => copyUrl(firstUrl)}
                                      className="text-[13px]"
                                      data-testid={`menu-copy-url-${entry.slug}`}
                                    >
                                      <Clipboard className="h-4 w-4 mr-2" />
                                      Copy URL
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                      onClick={() => handleDuplicate(entry)}
                                      className="text-[13px]"
                                      data-testid={`menu-duplicate-${entry.slug}`}
                                    >
                                      <Copy className="h-4 w-4 mr-2" />
                                      Duplicate
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                      onClick={() => handleDownloadYml(entry.slug)}
                                      className="text-[13px]"
                                      data-testid={`menu-download-${entry.slug}`}
                                    >
                                      <Download className="h-4 w-4 mr-2" />
                                      Download YAML
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                      onClick={() => handleEditYaml(entry)}
                                      className="text-[13px]"
                                      data-testid={`menu-edit-yaml-${entry.slug}`}
                                    >
                                      <Code className="h-4 w-4 mr-2" />
                                      Edit YAML
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                      onClick={() => { window.location.href = `/private/repository-sync?search=${encodeURIComponent(entry.slug)}`; }}
                                      className="text-[13px]"
                                      data-testid={`menu-changelog-${entry.slug}`}
                                    >
                                      <History className="h-4 w-4 mr-2" />
                                      View Change Log
                                    </DropdownMenuItem>
                                    {entry.locales.length === 0 && (
                                      <DropdownMenuItem
                                        onClick={async () => {
                                          try {
                                            const result = await apiRequest("POST", `/api/content-types/${contentType}/entries/${entry.slug}/migrate-legacy`);
                                            const data = await result.json();
                                            toast({ title: `Migrated — entry now uses ${data.locale}.yml` });
                                            queryClient.invalidateQueries({ queryKey: ["/api/content-types", contentType, "static-entries"] });
                                          } catch {
                                            toast({ title: "Migration failed", variant: "destructive" });
                                          }
                                        }}
                                        data-testid={`button-migrate-${entry.slug}`}
                                      >
                                        <Shuffle className="h-4 w-4 mr-2" />
                                        Migrate to standard format
                                      </DropdownMenuItem>
                                    )}
                                    <DropdownMenuItem
                                      onClick={async () => {
                                        try {
                                          await apiRequest("DELETE", `/api/content-types/${contentType}/cache/${entry.slug}`);
                                          toast({ title: `Cache refreshed for "${entry.slug}"` });
                                        } catch {
                                          toast({ title: "Failed to refresh cache", variant: "destructive" });
                                        }
                                      }}
                                      className="text-[13px]"
                                      data-testid={`menu-refresh-cache-${entry.slug}`}
                                    >
                                      <RefreshCw className="h-4 w-4 mr-2" />
                                      Refresh Cache
                                    </DropdownMenuItem>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem
                                      onClick={() => {
                                        setDeletingEntry(entry);
                                        setDeleteConfirmInput("");
                                        setDeleteModalOpen(true);
                                      }}
                                      className="text-destructive focus:text-destructive text-[13px]"
                                      data-testid={`button-delete-${entry.slug}`}
                                    >
                                      <Trash2 className="h-4 w-4 mr-2" />
                                      Delete
                                    </DropdownMenuItem>
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )
            ) : (
              allLoading ? (
                <div className="flex items-center justify-center py-12" data-testid="loading-items">
                  <div className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-solid border-current border-r-transparent" />
                  <span className="ml-2 text-sm text-muted-foreground">Loading entries...</span>
                </div>
              ) : !hasDb ? (
                <div className="text-center py-12 space-y-3" data-testid="text-no-database">
                  <Database className="h-8 w-8 mx-auto text-muted-foreground/50" />
                  <p className="text-sm text-muted-foreground max-w-md mx-auto">
                    You can link a database to create more {label} entries dynamically. You will be able to configure how these dynamic entries look in a template.
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setDsDialogOpen(true)}
                    data-testid="button-link-database"
                  >
                    <Database className="h-4 w-4 mr-1" />
                    Link to Database
                  </Button>
                </div>
              ) : filtered.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground" data-testid="text-no-results">
                  No DB entries found
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm" data-testid="table-items">
                    <thead>
                      <tr className="border-b bg-muted/50">
                        <th className="text-left px-4 py-3 font-medium text-muted-foreground">Title</th>
                        {hasAuthorField && <th className="text-left px-4 py-3 font-medium text-muted-foreground hidden md:table-cell">Author</th>}
                        {allIndexFields.map((idx) => (
                          <th key={idx} className="text-left px-4 py-3 font-medium text-muted-foreground">
                            {idx === localeKey ? "Lang" : idx.charAt(0).toUpperCase() + idx.slice(1)}
                          </th>
                        ))}
                        {hasPublishedAt && <th className="text-left px-4 py-3 font-medium text-muted-foreground hidden lg:table-cell">Published</th>}
                        {hasUpdatedAt && <th className="text-left px-4 py-3 font-medium text-muted-foreground hidden lg:table-cell">Updated</th>}
                        <th className="text-right px-4 py-3 font-medium text-muted-foreground">Link</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((item) => {
                        const itemLocale = localeKey ? String(item[localeKey] || "en") : "en";
                        const pattern = itemLocale === "es" ? (urlPatterns.es || urlPatterns.en) : (urlPatterns.en || urlPatterns.default || "");
                        const itemUrl = pattern ? buildItemUrl(pattern, item, itemLocale) : "";
                        return (
                          <tr
                            key={item.id || item.slug}
                            className="border-b last:border-0 hover:bg-muted/30 transition-colors"
                            data-testid={`row-item-${item.id || item.slug}`}
                          >
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-3">
                                {(item.preview || item.image) && (
                                  <img
                                    src={item.preview || item.image}
                                    alt=""
                                    className="w-10 h-10 rounded-md object-cover flex-shrink-0 hidden sm:block"
                                  />
                                )}
                                <div className="min-w-0">
                                  <div className="font-medium truncate max-w-[300px]" title={item.title} data-testid={`text-title-${item.id || item.slug}`}>
                                    {item.title || item.slug}
                                  </div>
                                  <div className="text-xs text-muted-foreground truncate max-w-[300px]">
                                    {item.slug}
                                  </div>
                                </div>
                              </div>
                            </td>
                            {hasAuthorField && (
                              <td className="px-4 py-3 text-muted-foreground hidden md:table-cell">
                                {item.author_name
                                  ? `${item.author_name} ${item.author_last_name || ""}`.trim()
                                  : item.author
                                    ? `${item.author.first_name || ""} ${item.author.last_name || ""}`.trim()
                                    : "—"}
                              </td>
                            )}
                            {allIndexFields.map((idx) => {
                              const val = String(item[idx] || "");
                              const isLocale = idx === localeKey;
                              if (idx === "status") {
                                return (
                                  <td key={idx} className="px-4 py-3">
                                    <StatusBadge status={val} />
                                  </td>
                                );
                              }
                              return (
                                <td key={idx} className="px-4 py-3">
                                  <Badge variant="outline">
                                    {isLocale ? val.toUpperCase() : val.charAt(0).toUpperCase() + val.slice(1)}
                                  </Badge>
                                </td>
                              );
                            })}
                            {hasPublishedAt && (
                              <td className="px-4 py-3 text-muted-foreground hidden lg:table-cell">
                                {formatDate(item.published_at)}
                              </td>
                            )}
                            {hasUpdatedAt && (
                              <td className="px-4 py-3 text-muted-foreground hidden lg:table-cell">
                                {formatDate(item.updated_at)}
                              </td>
                            )}
                            <td className="px-4 py-3 text-right">
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button variant="ghost" size="icon" data-testid={`button-actions-${item.id || item.slug}`}>
                                    <MoreVertical className="h-4 w-4" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  {itemUrl && (
                                    <>
                                      <DropdownMenuItem asChild>
                                        <a href={itemUrl} target="_blank" rel="noopener noreferrer" data-testid={`link-new-tab-${item.id || item.slug}`}>
                                          <ExternalLink className="h-4 w-4 mr-2" />
                                          Open in new tab
                                        </a>
                                      </DropdownMenuItem>
                                      <DropdownMenuItem asChild>
                                        <a href={itemUrl} data-testid={`link-same-tab-${item.id || item.slug}`}>
                                          <ArrowLeft className="h-4 w-4 mr-2 rotate-180" />
                                          Open in this tab
                                        </a>
                                      </DropdownMenuItem>
                                      <DropdownMenuSeparator />
                                    </>
                                  )}
                                  <DropdownMenuItem
                                    onClick={async () => {
                                      try {
                                        await apiRequest("DELETE", `/api/content-types/${contentType}/cache/${item.slug}`);
                                        toast({ title: `Cache refreshed for "${item.title || item.slug}"` });
                                      } catch {
                                        toast({ title: "Failed to refresh cache", variant: "destructive" });
                                      }
                                    }}
                                    data-testid={`button-clear-cache-${item.id || item.slug}`}
                                  >
                                    <RefreshCw className="h-4 w-4 mr-2" />
                                    Refresh Cache
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )
            )}
            {viewMode === "static" && !staticLoading && filteredStatic.length > 0 && (
              <div className="px-4 py-3 border-t text-xs text-muted-foreground" data-testid="text-showing-count">
                Showing {filteredStatic.length} of {staticEntries.length} entries
              </div>
            )}
            {viewMode === "db" && !allLoading && filtered.length > 0 && (
              <div className="px-4 py-3 border-t text-xs text-muted-foreground" data-testid="text-showing-count">
                Showing {filtered.length} of {items.length} entries
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog
        open={deleteTypeDialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTypeDialogOpen(false);
            setDeleteTypeConfirmInput("");
            setDryRunResult(null);
            setUrlsExpanded(false);
          }
        }}
      >
        <DialogContent className="sm:max-w-[480px]" data-testid="dialog-delete-content-type">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Delete Content Type
            </DialogTitle>
            <DialogDescription>
              This action cannot be undone. The content type definition will be permanently removed from{" "}
              <span className="font-mono text-xs">content-types.yml</span> and synced to GitHub.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {dryRunLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Checking impact…
              </div>
            ) : dryRunResult ? (
              <div className="rounded-md border bg-muted/50 p-3 space-y-2 text-sm" data-testid="text-dry-run-result">
                <p className="text-foreground">{dryRunResult.message}</p>
                <div className="flex flex-wrap gap-3 text-xs text-muted-foreground pt-1">
                  <span>
                    <span className="font-medium text-foreground">{dryRunResult.static_entry_count}</span> content file{dryRunResult.static_entry_count !== 1 ? "s" : ""} in{" "}
                    <span className="font-mono">4geeks-com/{dryRunResult.directory}/</span>
                  </span>
                  {dryRunResult.has_database && (
                    <span className="inline-flex items-center gap-1">
                      <Database className="h-3 w-3" />
                      Connected to <span className="font-mono">{dryRunResult.database_slug}</span>
                    </span>
                  )}
                </div>
                {dryRunResult.affected_urls.length > 0 && (
                  <div className="pt-1 space-y-1" data-testid="affected-urls-section">
                    <button
                      type="button"
                      className="flex items-center gap-1 text-xs font-medium text-foreground hover:underline"
                      onClick={() => setUrlsExpanded(prev => !prev)}
                      data-testid="button-toggle-affected-urls"
                    >
                      {urlsExpanded
                        ? <IconChevronDown className="h-3 w-3" />
                        : <IconChevronRight className="h-3 w-3" />
                      }
                      {dryRunResult.affected_urls.length} URL{dryRunResult.affected_urls.length !== 1 ? "s" : ""} will stop working
                    </button>
                    {urlsExpanded && (
                      <ul className="pl-4 space-y-0.5 text-xs text-muted-foreground font-mono" data-testid="affected-urls-list">
                        {dryRunResult.affected_urls.slice(0, 10).map((url) => (
                          <li key={url}>
                            <a
                              href={url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 hover:underline text-muted-foreground hover:text-foreground transition-colors"
                              data-testid={`affected-url-link-${url}`}
                            >
                              {url}
                              <IconExternalLink className="h-3 w-3 flex-shrink-0" />
                            </a>
                          </li>
                        ))}
                        {dryRunResult.affected_urls.length > 10 && (
                          <li className="text-muted-foreground/70 font-sans" data-testid="affected-urls-overflow">
                            and {dryRunResult.affected_urls.length - 10} more…
                          </li>
                        )}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            ) : null}
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="delete-type-confirm">
                Type <span className="font-mono font-bold">{contentType}</span> to confirm
              </label>
              <Input
                id="delete-type-confirm"
                value={deleteTypeConfirmInput}
                onChange={(e) => setDeleteTypeConfirmInput(e.target.value)}
                placeholder={contentType}
                data-testid="input-delete-type-confirm"
                autoComplete="off"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setDeleteTypeDialogOpen(false);
                setDeleteTypeConfirmInput("");
                setDryRunResult(null);
              }}
              data-testid="button-cancel-delete-content-type"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeleteType}
              disabled={deleteTypeConfirmInput !== contentType || isDeletingType}
              data-testid="button-confirm-delete-content-type"
            >
              {isDeletingType ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Deleting…
                </>
              ) : (
                <>
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete Content Type
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={convertDialogOpen}
        onOpenChange={(open) => {
          setConvertDialogOpen(open);
          if (!open) {
            setConvertConfirmInput("");
            setConvertDryRun(null);
          }
        }}
      >
        <DialogContent className="max-w-lg" data-testid="dialog-convert-to-static">
          <DialogHeader>
            <DialogTitle>Convert to static</DialogTitle>
            <DialogDescription>
              Materialize all database entries into YAML folders and unlink the database from this content type.
              This cannot be automatically undone.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {convertDryRunLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground" data-testid="convert-dry-run-loading">
                <Loader2 className="h-4 w-4 animate-spin" />
                Previewing conversion…
              </div>
            ) : convertDryRun ? (
              <div className="space-y-3 text-sm" data-testid="convert-dry-run-result">
                <p className="text-muted-foreground">{convertDryRun.message}</p>
                <ul className="space-y-1 rounded-md border bg-muted/40 p-3 font-mono text-xs">
                  <li>Directory: {convertDryRun.directory}/</li>
                  <li>Database: {convertDryRun.database_slug}</li>
                  <li>Entries: {convertDryRun.entry_count}</li>
                  <li>Locales: {convertDryRun.locale_count}</li>
                  <li>New files: {convertDryRun.files_to_write}</li>
                  <li>Overwrite files: {convertDryRun.files_to_overwrite}</li>
                  <li>Existing overlays: {convertDryRun.existing_slug_folders.length}</li>
                  <li>Templates to delete: {convertDryRun.templates_to_delete.length}</li>
                </ul>
                <p className="text-destructive text-xs">
                  Existing per-entry overlay patches will be merged into full static YAML and overwritten.
                  Shared <code className="text-[11px]">single.*.yml</code> templates will be deleted.
                  Remote markdown bodies are inlined into the YAML.
                </p>
              </div>
            ) : null}
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="convert-type-confirm">
                Type <span className="font-mono font-bold">{contentType}</span> to confirm
              </label>
              <Input
                id="convert-type-confirm"
                value={convertConfirmInput}
                onChange={(e) => setConvertConfirmInput(e.target.value)}
                placeholder={contentType}
                data-testid="input-convert-to-static-confirm"
                autoComplete="off"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setConvertDialogOpen(false);
                setConvertConfirmInput("");
                setConvertDryRun(null);
              }}
              data-testid="button-cancel-convert-to-static"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleConvertToStatic}
              disabled={
                convertConfirmInput !== contentType ||
                isConverting ||
                convertDryRunLoading ||
                !convertDryRun
              }
              data-testid="button-confirm-convert-to-static"
            >
              {isConverting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Converting…
                </>
              ) : (
                <>
                  <FileText className="h-4 w-4 mr-2" />
                  Convert to static
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <DataSourceDialog open={dsDialogOpen} onOpenChange={setDsDialogOpen} contentType={contentType} />
      <FieldMappingDialog open={mappingDialogOpen} onOpenChange={setMappingDialogOpen} contentType={contentType} />
      <SeoSettingsDialog
        open={seoDialogOpen}
        onOpenChange={setSeoDialogOpen}
        contentType={contentType}
        staticCount={staticEntriesData?.count ?? 0}
        dbCount={allItemsData?.count ?? 0}
      />
      <DeletePageModal
        open={deleteModalOpen}
        onOpenChange={(open) => {
          setDeleteModalOpen(open);
          if (!open) {
            setDeletingEntry(null);
            setDeleteConfirmInput("");
          }
        }}
        deletingPage={deletingEntry ? { slug: deletingEntry.slug, contentType } : null}
        deleteConfirmInput={deleteConfirmInput}
        setDeleteConfirmInput={setDeleteConfirmInput}
        isDeletingPage={isDeletingEntry}
        onConfirm={handleDeleteEntry}
        availableLocales={deletingEntry?.locales}
        isPartialOverride={deletingEntry ? isPartialOverride(deletingEntry.slug) : false}
        publicUrls={deletingEntry?.urls}
      />
      <CreateContentModal
        open={createModalOpen}
        onOpenChange={(open) => {
          setCreateModalOpen(open);
          if (!open) setDuplicatingPage(null);
        }}
        duplicatingPage={duplicatingPage}
        createContentType={createContentType}
        setCreateContentType={setCreateContentType}
        createContentTitle={createContentTitle}
        setCreateContentTitle={setCreateContentTitle}
        createContentSlugEn={createContentSlugEn}
        setCreateContentSlugEn={setCreateContentSlugEn}
        createContentSlugEs={createContentSlugEs}
        setCreateContentSlugEs={setCreateContentSlugEs}
        createContentSlugEnStatus={createContentSlugEnStatus}
        setCreateContentSlugEnStatus={setCreateContentSlugEnStatus}
        createContentSlugEsStatus={createContentSlugEsStatus}
        setCreateContentSlugEsStatus={setCreateContentSlugEsStatus}
        slugEnConflictReason={slugEnConflictReason}
        setSlugEnConflictReason={setSlugEnConflictReason}
        slugEsConflictReason={slugEsConflictReason}
        setSlugEsConflictReason={setSlugEsConflictReason}
        editingSlugEn={editingSlugEn}
        setEditingSlugEn={setEditingSlugEn}
        editingSlugEs={editingSlugEs}
        setEditingSlugEs={setEditingSlugEs}
        isCreatingContent={isCreatingContent}
        setIsCreatingContent={setIsCreatingContent}
        setSitemapUrls={(_urls: SitemapUrl[]) => {
          queryClient.invalidateQueries({ queryKey: ["/api/content-types", contentType, "static-entries"] });
        }}
        setSitemapLoading={(_v: boolean) => {}}
        setDuplicatingPage={setDuplicatingPage}
        toast={toast}
      />
      {showYamlEditor && yamlEditorInfo && (
        <Suspense fallback={null}>
          <RawFileEditorPanel
            contentType={yamlEditorInfo.contentType}
            slug={yamlEditorInfo.slug}
            locale={yamlEditorInfo.locale}
            onClose={() => setShowYamlEditor(false)}
            onSaved={() => window.location.reload()}
          />
        </Suspense>
      )}

      <Dialog open={createVersionOpen} onOpenChange={(open) => {
        setCreateVersionOpen(open);
        if (!open) { setCreateVersionEntry(null); setCreateVersionSlug(""); }
      }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Create New Version</DialogTitle>
            <DialogDescription>
              A version is a copy of a page's content that can be A/B tested against the original.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-1">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Locale</label>
              <Select value={createVersionLocale} onValueChange={setCreateVersionLocale}>
                <SelectTrigger data-testid="select-version-locale">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {createVersionEntry?.locales.map((loc) => (
                    <SelectItem key={loc} value={loc}>{loc.toUpperCase()}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Version name</label>
              <Input
                placeholder="e.g. colorful, dark-hero, new-cta"
                value={createVersionSlug}
                onChange={(e) => setCreateVersionSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                data-testid="input-version-slug"
              />
              <p className="text-xs text-muted-foreground">Lowercase letters, numbers, and hyphens only.</p>
            </div>
            {createVersionEntry && createVersionSlug && (
              <div className="rounded-md bg-muted px-3 py-2 space-y-0.5">
                <p className="text-xs font-medium">File that will be created:</p>
                <p className="text-xs font-mono text-muted-foreground break-all">
                  {createVersionEntry.slug}/{createVersionSlug}.{createVersionLocale}.yml
                </p>
              </div>
            )}
            <div className="rounded-md bg-muted px-3 py-2">
              <p className="text-xs text-muted-foreground">
                This version starts with <strong>0% traffic allocation</strong> — no real visitors will see it until you allocate traffic in the Versions editor. You can preview it anytime using the <code className="text-xs">?force_variant=</code> URL parameter.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateVersionOpen(false)}>Cancel</Button>
            <Button
              onClick={handleCreateVersion}
              disabled={!createVersionSlug || isCreatingVersion}
              data-testid="button-confirm-create-version"
            >
              {isCreatingVersion && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Create version
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <PartialOverrideDialog
        open={partialOverrideDialogOpen}
        onOpenChange={setPartialOverrideDialogOpen}
        contentTypeLabel={typeConfig?.label || label}
      />

      <PartialOverrideVersionsDialog
        open={partialOverrideVersionsDialogOpen}
        onOpenChange={setPartialOverrideVersionsDialogOpen}
      />
    </div>
  );
}
