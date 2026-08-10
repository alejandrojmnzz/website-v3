import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { IconShoppingBag, IconInfoCircle, IconGripVertical, IconPlus, IconTrash } from "@tabler/icons-react";
import { Link, useParams } from "wouter";
import { ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { type ReactNode, useState } from "react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { apiRequest } from "@/lib/queryClient";
import { LocaleFlag } from "@/components/DebugBubble/components/LocaleFlag";
import { SitemapSearch } from "@/components/menus/SitemapSearch";
import { cn } from "@/lib/utils";

interface SitemapEntry {
  loc: string;
  label: string;
  locale?: string;
  content_type?: string;
  slug?: string;
}

interface FunnelStepRow {
  source: "locked" | "authored" | "auto";
  locked?: boolean;
  content_type: string;
  slug: string;
  role?: string;
  urls: Record<string, string>;
  files: string[];
}

interface SuggestionRow {
  content_type: string;
  slug: string;
  reason: string;
  urls: Record<string, string>;
}

interface TrafficSourceRow {
  content_type: string;
  role: string;
}

interface ContentTypeOption {
  name: string;
  label?: string;
}

interface FunnelResponse {
  product: {
    product_id: string;
    name: string;
    content_type: string;
    content_slug: string;
    active: boolean;
    description?: string;
  };
  funnel: {
    traffic_sources: TrafficSourceRow[];
    steps: FunnelStepRow[];
    suggestions: SuggestionRow[];
  };
  education: { summary: string; advanced_paths: string[] };
}

function LocaleFlags({ urls }: { urls: Record<string, string> }) {
  const locales = Object.keys(urls);
  if (locales.length === 0) return null;
  return (
    <span className="inline-flex items-center gap-1" title={locales.join(", ")}>
      {locales.map((loc) => (
        <LocaleFlag key={loc} locale={loc} className="w-4 h-3 rounded-sm" />
      ))}
    </span>
  );
}

const FUNNEL_TAPER = {
  full: "w-full",
  mid: "w-[88%] max-w-full",
  narrow: "w-[76%] max-w-full",
  tight: "w-[64%] max-w-full",
} as const;

function FunnelStage({
  label,
  index,
  isLast,
  children,
  actions,
  taper = "full",
}: {
  label: string;
  index: number;
  isLast?: boolean;
  children: ReactNode;
  actions?: ReactNode;
  /** Progressive width so stages read as a funnel (top → bottom). */
  taper?: keyof typeof FUNNEL_TAPER;
}) {
  return (
    <div className="relative flex gap-3" data-testid={`funnel-stage-${label.toLowerCase().replace(/\s+/g, "-")}`}>
      <div className="flex flex-col items-center w-6 shrink-0">
        <div className="flex h-6 w-6 items-center justify-center rounded-full border border-border bg-card text-[10px] font-mono text-muted-foreground z-[1]">
          {index}
        </div>
        {!isLast && <div className="w-px flex-1 min-h-[12px] bg-border mt-1" aria-hidden />}
      </div>
      <div className={cn("flex-1 min-w-0 pb-5", isLast && "pb-0")}>
        <div className={cn("mx-auto", FUNNEL_TAPER[taper])}>
          <div className="flex items-center justify-between gap-2 mb-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</h3>
            {actions}
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}

function SortableAuthoredStep({
  id,
  step,
  onRemove,
}: {
  id: string;
  step: FunnelStepRow;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.7 : 1,
  };
  return (
    <Card ref={setNodeRef} style={style} data-testid={`card-funnel-step-${step.slug}`}>
      <CardContent className="py-2.5 text-sm">
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="p-1 rounded hover-elevate text-muted-foreground cursor-grab shrink-0"
            aria-label="Drag to reorder"
            {...attributes}
            {...listeners}
          >
            <IconGripVertical className="h-4 w-4" />
          </button>
          <p className="font-medium font-mono text-sm truncate min-w-0">
            {step.content_type}/{step.slug}
          </p>
          <LocaleFlags urls={step.urls} />
          <Badge variant="secondary">authored</Badge>
          {step.role && <Badge variant="outline">{step.role}</Badge>}
          <div className="flex-1" />
          <Button type="button" variant="ghost" size="icon" onClick={onRemove} aria-label="Remove step">
            <IconTrash className="h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function StaticStepCard({ step }: { step: FunnelStepRow }) {
  return (
    <Card data-testid={`card-funnel-step-${step.source}-${step.slug}`}>
      <CardContent className="py-2.5 text-sm">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="font-medium font-mono text-sm truncate">
            {step.content_type}/{step.slug}
          </p>
          <LocaleFlags urls={step.urls} />
          <Badge variant={step.source === "locked" ? "default" : "outline"}>{step.source}</Badge>
          {step.role && <Badge variant="secondary">{step.role}</Badge>}
        </div>
      </CardContent>
    </Card>
  );
}

function extractPath(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

function AddFunnelPageModal({
  disabled,
  suggestions,
  excludeKeys,
  onPick,
  trigger,
}: {
  disabled?: boolean;
  suggestions: SuggestionRow[];
  excludeKeys: Set<string>;
  onPick: (content_type: string, slug: string) => void;
  trigger?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [pickerValue, setPickerValue] = useState("");
  const [resolveError, setResolveError] = useState("");
  const [dialogEl, setDialogEl] = useState<HTMLDivElement | null>(null);
  const queryClient = useQueryClient();

  const openSuggestions = suggestions.filter(
    (sg) => !excludeKeys.has(`${sg.content_type}/${sg.slug}`),
  );

  const resolveAndPick = (path: string, isCustom: boolean) => {
    setPickerValue(path);
    if (isCustom) {
      setResolveError("Pick a page from the sitemap — custom URLs are not supported here.");
      return;
    }
    const sitemapUrls =
      queryClient.getQueryData<SitemapEntry[]>(["/api/sitemap-urls", ""]) ?? [];
    const entry = sitemapUrls.find((e) => extractPath(e.loc) === path);
    if (!entry?.content_type || !entry.slug) {
      setResolveError("Could not resolve that URL to a content entry.");
      return;
    }
    if (excludeKeys.has(`${entry.content_type}/${entry.slug}`)) {
      setResolveError("That page is already in the conversion journey.");
      return;
    }
    setResolveError("");
    onPick(entry.content_type, entry.slug);
    setPickerValue("");
    setOpen(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setPickerValue("");
          setResolveError("");
        }
      }}
    >
      <DialogTrigger asChild>
        {trigger ?? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={disabled}
            data-testid="button-add-funnel-step"
          >
            <IconPlus className="h-4 w-4 mr-1" />
            Add page
          </Button>
        )}
      </DialogTrigger>
      <DialogContent
        ref={setDialogEl}
        className="max-w-lg"
        data-testid="dialog-add-funnel-page"
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Add page to journey</DialogTitle>
          <DialogDescription>
            Accept a suggested page, or pick any page from the sitemap.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <section className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Suggested pages
            </h3>
            <p className="text-xs text-muted-foreground">
              Explicit product scope matches (not{" "}
              <code className="bg-muted px-1 rounded">all</code>). Accept to add to authored steps.
            </p>
            {openSuggestions.length === 0 ? (
              <p className="text-xs text-muted-foreground py-2">No suggestions right now.</p>
            ) : (
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {openSuggestions.map((sg) => (
                  <Card key={`${sg.content_type}/${sg.slug}`}>
                    <CardContent className="py-3 text-sm flex items-center gap-2 flex-wrap">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium font-mono text-xs">
                          {sg.content_type}/{sg.slug}
                        </p>
                        <p className="text-xs text-muted-foreground">{sg.reason}</p>
                      </div>
                      <LocaleFlags urls={sg.urls} />
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          onPick(sg.content_type, sg.slug);
                          setOpen(false);
                        }}
                        data-testid={`button-accept-suggestion-${sg.slug}`}
                      >
                        Add
                      </Button>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </section>

          <section className="space-y-2 border-t pt-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Sitemap
            </h3>
            <p className="text-xs text-muted-foreground">Search and select a page to add.</p>
            <div className="rounded-md border border-border bg-muted/30 px-3 py-2">
              <SitemapSearch
                value={pickerValue}
                onChange={resolveAndPick}
                placeholder="Select page…"
                testId="funnel-sitemap-search"
                portalContainer={dialogEl}
              />
            </div>
            {resolveError && <p className="text-xs text-destructive">{resolveError}</p>}
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function TrafficSourceTag({
  source,
  disabled,
  onRemove,
}: {
  source: TrafficSourceRow;
  disabled?: boolean;
  onRemove: () => void;
}) {
  return (
    <Popover modal={false}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className="inline-flex items-center rounded-md border border-border bg-card px-2.5 py-1 text-xs font-mono hover-elevate disabled:opacity-50"
          data-testid={`tag-traffic-source-${source.content_type}`}
        >
          {source.content_type}
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-72 p-3 z-[10001] pointer-events-auto space-y-2"
        align="start"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <p className="text-xs font-medium font-mono text-muted-foreground">{source.content_type}</p>
        <p className="text-sm text-foreground" data-testid={`popover-traffic-role-${source.content_type}`}>
          {source.role}
        </p>
        <div className="flex justify-end pt-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled}
            className="text-destructive h-8"
            onClick={onRemove}
            data-testid={`button-remove-traffic-source-${source.content_type}`}
          >
            <IconTrash className="h-3.5 w-3.5 mr-1" />
            Remove
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function TrafficSourcesEditor({
  sources,
  disabled,
  onChange,
}: {
  sources: TrafficSourceRow[];
  disabled?: boolean;
  onChange: (next: TrafficSourceRow[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [addType, setAddType] = useState("");
  const [addRole, setAddRole] = useState("");

  const { data: contentTypes = [] } = useQuery<ContentTypeOption[]>({
    queryKey: ["/api/content-types"],
    queryFn: async () => {
      const r = await fetch("/api/content-types");
      if (!r.ok) throw new Error("Failed to load content types");
      return r.json();
    },
    enabled: open,
  });

  const used = new Set(sources.map((s) => s.content_type));
  const available = contentTypes.filter((t) => t.name && !used.has(t.name));

  const resetForm = () => {
    setAddType("");
    setAddRole("");
  };

  const addSource = () => {
    const content_type = addType.trim();
    const role = addRole.trim();
    if (!content_type || !role || used.has(content_type)) return;
    onChange([...sources, { content_type, role }]);
    resetForm();
    setOpen(false);
  };

  const addDialog = (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) resetForm();
      }}
    >
      <DialogTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className="text-primary underline-offset-2 hover:underline font-medium disabled:opacity-50"
          data-testid="button-add-traffic-source"
        >
          add content type
        </button>
      </DialogTrigger>
      <DialogContent
        className="max-w-md"
        data-testid="dialog-add-traffic-source"
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Add content type</DialogTitle>
          <DialogDescription>
            Choose an inbound content type and describe the role it plays at the top of this funnel.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Content type</label>
            <Select
              value={addType}
              onValueChange={setAddType}
              disabled={disabled || available.length === 0}
            >
              <SelectTrigger className="h-9" data-testid="select-traffic-content-type">
                <SelectValue placeholder="Select type…" />
              </SelectTrigger>
              <SelectContent>
                {available.map((t) => (
                  <SelectItem key={t.name} value={t.name}>
                    {t.label || t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {available.length === 0 && (
              <p className="text-xs text-muted-foreground">All content types are already listed.</p>
            )}
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Role in the funnel</label>
            <Input
              value={addRole}
              disabled={disabled}
              className="h-9"
              placeholder="e.g. SEO blogs that link to this program"
              onChange={(e) => setAddRole(e.target.value)}
              data-testid="input-traffic-role-new"
            />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={disabled || !addType || !addRole.trim()}
              onClick={addSource}
              data-testid="button-confirm-traffic-source"
            >
              Add source
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );

  return (
    <Card data-testid="card-traffic-sources">
      <CardContent className="py-3 space-y-2">
        <p className="text-xs text-muted-foreground">
          Funnel traffic starts from other content types; you can document how each content type plays
          a role in bringing traffic into the funnel.
        </p>
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer text-foreground font-medium">Read more (advanced)</summary>
          <ul className="mt-1 list-disc pl-5 font-mono space-y-0.5">
            <li>funnel.traffic_sources</li>
            <li>funnel.steps</li>
            <li>programs/&#123;slug&#125;/_ecommerce.yml</li>
          </ul>
        </details>

        {sources.length === 0 ? (
          <div className="rounded-md border border-dashed border-border px-3 py-3 text-xs text-muted-foreground">
            No inbound content types listed yet.{" "}
            {addDialog}
          </div>
        ) : (
          <div className="space-y-2">
            <div
              className="flex flex-wrap gap-2"
              data-testid="traffic-sources-tag-cloud"
            >
              {sources.map((src) => (
                <TrafficSourceTag
                  key={src.content_type}
                  source={src}
                  disabled={disabled}
                  onRemove={() =>
                    onChange(sources.filter((s) => s.content_type !== src.content_type))
                  }
                />
              ))}
            </div>
            <p className="text-xs text-muted-foreground">{addDialog}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function StoreProductDetailPage() {
  const params = useParams<{ slug: string }>();
  const slug = params.slug ?? "";
  const queryClient = useQueryClient();

  const { data, isLoading, isError } = useQuery<FunnelResponse>({
    queryKey: [`/api/ecommerce/funnel/${slug}`],
    enabled: !!slug,
  });

  const saveMutation = useMutation({
    mutationFn: async (payload: {
      steps: Array<{ content_type: string; slug: string; role?: string }>;
      traffic_sources: TrafficSourceRow[];
    }) => {
      const res = await apiRequest("PUT", `/api/ecommerce/funnel/${slug}`, payload);
      return res.json();
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [`/api/ecommerce/funnel/${slug}`] });
    },
  });

  const authored = (data?.funnel.steps ?? []).filter((s) => s.source === "authored");
  const locked = (data?.funnel.steps ?? []).filter((s) => s.source === "locked");
  const auto = (data?.funnel.steps ?? []).filter((s) => s.source === "auto");
  const trafficSources = data?.funnel.traffic_sources ?? [];

  const excludeKeys = new Set<string>();
  for (const s of data?.funnel.steps ?? []) {
    excludeKeys.add(`${s.content_type}/${s.slug}`);
  }
  if (data?.product) {
    excludeKeys.add(`${data.product.content_type}/${data.product.content_slug}`);
  }

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const persistFunnel = (
    nextAuthored: FunnelStepRow[],
    nextSources: TrafficSourceRow[] = trafficSources,
  ) => {
    saveMutation.mutate({
      steps: nextAuthored.map((s) => ({
        content_type: s.content_type,
        slug: s.slug,
        role: s.role,
      })),
      traffic_sources: nextSources
        .map((s) => ({ content_type: s.content_type.trim(), role: s.role.trim() }))
        .filter((s) => s.content_type && s.role),
    });
  };

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = authored.findIndex((s) => `${s.content_type}/${s.slug}` === active.id);
    const newIndex = authored.findIndex((s) => `${s.content_type}/${s.slug}` === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    persistFunnel(arrayMove(authored, oldIndex, newIndex));
  };

  const addStep = (content_type: string, stepSlug: string, role?: string) => {
    if (!stepSlug.trim()) return;
    if (
      authored.some((s) => s.content_type === content_type && s.slug === stepSlug) ||
      (data?.product.content_type === content_type && data.product.content_slug === stepSlug)
    ) {
      return;
    }
    persistFunnel([
      ...authored,
      {
        source: "authored",
        content_type,
        slug: stepSlug.trim(),
        role,
        urls: {},
        files: [],
      },
    ]);
  };

  const hasAuto = auto.length > 0;
  let stageIndex = 1;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-4xl mx-auto px-6 py-8 space-y-6">
        <div className="flex items-center gap-3">
          <Link href="/private/store/ecommerce">
            <button className="p-1.5 rounded-md hover-elevate" data-testid="button-back">
              <ArrowLeft className="h-4 w-4 text-muted-foreground" />
            </button>
          </Link>
          <IconShoppingBag className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-xl font-semibold" data-testid="heading-product-funnel">
            {data?.product.name ?? slug}
          </h1>
        </div>

        {isLoading && <Skeleton className="h-32 w-full" />}
        {isError && (
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              Product not found or not purchasable. Enable{" "}
              <code className="bg-muted px-1 rounded">_ecommerce.yml</code> with{" "}
              <code className="bg-muted px-1 rounded">purchasable: true</code>.
            </CardContent>
          </Card>
        )}

        {data && (
          <>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Product</CardTitle>
              </CardHeader>
              <CardContent className="text-sm space-y-1">
                <p className="font-mono text-xs text-muted-foreground">{data.product.product_id}</p>
                <p>
                  {data.product.content_type}/{data.product.content_slug}
                </p>
                <Badge variant={data.product.active ? "default" : "outline"}>
                  {data.product.active ? "active" : "inactive"}
                </Badge>
              </CardContent>
            </Card>

            <Card data-testid="card-education">
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <IconInfoCircle className="h-4 w-4" />
                  How it works
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground space-y-2">
                <p>{data.education.summary}</p>
                <details className="text-xs">
                  <summary className="cursor-pointer text-foreground font-medium">
                    Read more (advanced)
                  </summary>
                  <ul className="mt-2 list-disc pl-5 font-mono space-y-1">
                    {data.education.advanced_paths.map((p) => (
                      <li key={p}>{p}</li>
                    ))}
                  </ul>
                </details>
              </CardContent>
            </Card>

            <section className="space-y-1">
              <div className="flex items-center justify-between gap-3 mb-3">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  Conversion journey
                </h2>
                <AddFunnelPageModal
                  disabled={saveMutation.isPending}
                  suggestions={data.funnel.suggestions}
                  excludeKeys={excludeKeys}
                  onPick={(content_type, stepSlug) => addStep(content_type, stepSlug)}
                />
              </div>
              {saveMutation.isError && (
                <p className="text-xs text-destructive mb-2">
                  {(saveMutation.error as Error)?.message ?? "Save failed"}
                </p>
              )}

              <FunnelStage label="Top of funnel" index={stageIndex++} taper="full">
                <TrafficSourcesEditor
                  sources={trafficSources}
                  disabled={saveMutation.isPending}
                  onChange={(next) => persistFunnel(authored, next)}
                />
              </FunnelStage>

              <FunnelStage label="Product" index={stageIndex++} taper="mid">
                <div className="space-y-2">
                  {locked.map((step) => (
                    <StaticStepCard key={`locked-${step.slug}`} step={step} />
                  ))}
                </div>
              </FunnelStage>

              <FunnelStage
                label="Journey steps"
                index={stageIndex++}
                taper="narrow"
                isLast={!hasAuto}
                actions={
                  <AddFunnelPageModal
                    disabled={saveMutation.isPending}
                    suggestions={data.funnel.suggestions}
                    excludeKeys={excludeKeys}
                    onPick={(content_type, stepSlug) => addStep(content_type, stepSlug)}
                    trigger={
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={saveMutation.isPending}
                        data-testid="button-add-funnel-step-stage"
                      >
                        <IconPlus className="h-4 w-4 mr-1" />
                        Add
                      </Button>
                    }
                  />
                }
              >
                {authored.length === 0 ? (
                  <AddFunnelPageModal
                    disabled={saveMutation.isPending}
                    suggestions={data.funnel.suggestions}
                    excludeKeys={excludeKeys}
                    onPick={(content_type, stepSlug) => addStep(content_type, stepSlug)}
                    trigger={
                      <button
                        type="button"
                        disabled={saveMutation.isPending}
                        className="w-full rounded-md border border-dashed border-border px-3 py-4 text-xs text-muted-foreground hover-elevate text-left"
                        data-testid="button-empty-authored-slot"
                      >
                        Add pages between product and checkout…
                      </button>
                    }
                  />
                ) : (
                  <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
                    <SortableContext
                      items={authored.map((s) => `${s.content_type}/${s.slug}`)}
                      strategy={verticalListSortingStrategy}
                    >
                      <div className="space-y-2">
                        {authored.map((step) => (
                          <SortableAuthoredStep
                            key={`${step.content_type}/${step.slug}`}
                            id={`${step.content_type}/${step.slug}`}
                            step={step}
                            onRemove={() =>
                              persistFunnel(
                                authored.filter(
                                  (s) =>
                                    !(s.content_type === step.content_type && s.slug === step.slug),
                                ),
                              )
                            }
                          />
                        ))}
                      </div>
                    </SortableContext>
                  </DndContext>
                )}
              </FunnelStage>

              {hasAuto && (
                <FunnelStage label="Always on" index={stageIndex++} taper="tight" isLast>
                  <p className="text-xs text-muted-foreground mb-2">
                    Pages with <code className="bg-muted px-1 rounded">ecommerce_products: all</code> —
                    appended automatically for every product.
                  </p>
                  <div className="space-y-2">
                    {auto.map((step) => (
                      <StaticStepCard key={`auto-${step.slug}`} step={step} />
                    ))}
                  </div>
                </FunnelStage>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}
