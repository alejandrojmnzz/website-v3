import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  IconShoppingBag,
  IconInfoCircle,
  IconSpeakerphone,
  IconTarget,
  IconShoppingCart,
  IconSchool,
  IconHash,
  IconFileText,
  IconCircleCheck,
  IconPlayerPause,
  IconLayersIntersect,
} from "@tabler/icons-react";
import { Link, useParams } from "wouter";
import { ArrowLeft, ChevronDown, Plus } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { isActivelySelling } from "@/lib/ecommerceProductMap";
import { Card, CardContent } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Skeleton } from "@/components/ui/skeleton";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SitemapSearch } from "@/components/menus/SitemapSearch";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { SitemapSearchEntry } from "@/lib/sitemapSearch";
import { type ComponentType, type ReactNode } from "react";
import { LocaleFlag } from "@/components/DebugBubble/components/LocaleFlag";
import { cn } from "@/lib/utils";
import {
  FUNNEL_STAGE_TAPER,
  FUNNEL_STAGE_TONE,
  FUNNEL_TAPER_WIDTH,
  type FunnelStageTaper,
} from "@/lib/funnel-stage-ui";
import { FUNNEL_STAGES, type FunnelBlock, type FunnelStage as FunnelStageKey } from "@shared/funnel";

interface FunnelStepRow {
  source?: "locked" | "authored" | "auto";
  content_type: string;
  slug: string;
  role?: string;
  urls: Record<string, string>;
  files: string[];
}

interface FunnelResponse {
  product: {
    product_id: string;
    name: string;
    content_type: string;
    content_slug: string;
    actively_selling?: boolean;
    active?: boolean;
    description?: string;
  };
  funnel: {
    locked: FunnelStepRow;
    stages: Record<string, FunnelStepRow[]>;
    stage_order: string[];
  };
  education: { summary: string; advanced_paths: string[] };
}

const STAGE_META: Record<
  string,
  { label: string; description: string; icon: ComponentType<{ className?: string }>; taper: FunnelStageTaper }
> = {
  awareness: {
    label: "Awareness",
    description: "Top of funnel (TOFU) — widest audience, most general.",
    icon: IconSpeakerphone,
    taper: FUNNEL_STAGE_TAPER.awareness,
  },
  consideration: {
    label: "Consideration",
    description: "Middle of funnel (MOFU) — target audience / buyer persona.",
    icon: IconTarget,
    taper: FUNNEL_STAGE_TAPER.consideration,
  },
  decision: {
    label: "Decision",
    description: "Bottom of funnel (BOFU) — ready to buy; includes the locked product page.",
    icon: IconShoppingCart,
    taper: FUNNEL_STAGE_TAPER.decision,
  },
  "post-enrollment": {
    label: "Post-enrollment",
    description: "After purchase — onboarding and upsell paths.",
    icon: IconSchool,
    taper: FUNNEL_STAGE_TAPER["post-enrollment"],
  },
};

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

function mergeProductIntoStageFunnel(
  existing: FunnelBlock,
  productSlug: string,
  stageKey: FunnelStageKey,
): { stage: FunnelStageKey; products: string[] | "all" } {
  const products = existing.products;
  let nextProducts: string[] | "all";
  if (products === "all") {
    nextProducts = "all";
  } else if (Array.isArray(products)) {
    nextProducts = products.includes(productSlug) ? products : [...products, productSlug];
  } else {
    nextProducts = [productSlug];
  }
  return { stage: stageKey, products: nextProducts };
}

function AddFunnelContentButton({
  stageKey,
  stageLabel,
  productSlug,
  onSuccess,
}: {
  stageKey: FunnelStageKey;
  stageLabel: string;
  productSlug: string;
  onSuccess: () => void;
}) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [pickerKey, setPickerKey] = useState(0);
  const [adding, setAdding] = useState(false);

  const handleSelectEntry = async (entry: SitemapSearchEntry) => {
    const contentType = entry.content_type;
    const slug = entry.slug;
    if (!contentType || !slug) {
      toast({
        title: "Cannot add page",
        description: "Pick a CMS page from search — this URL is not linked to a content entry.",
        variant: "destructive",
      });
      return;
    }

    setAdding(true);
    try {
      const getRes = await apiRequest("GET", `/api/content-types/${contentType}/funnel/${slug}`);
      const getJson = (await getRes.json()) as { funnel?: FunnelBlock; error?: string };
      if (!getRes.ok) throw new Error(getJson.error || "Failed to load page funnel");

      const body = mergeProductIntoStageFunnel(getJson.funnel ?? {}, productSlug, stageKey);
      const putRes = await apiRequest(
        "PUT",
        `/api/content-types/${contentType}/funnel/${slug}`,
        body,
      );
      const putJson = (await putRes.json()) as { error?: string };
      if (!putRes.ok) throw new Error(putJson.error || "Failed to save funnel");

      toast({
        title: "Page added",
        description: `${contentType}/${slug} is now at ${stageLabel} for this product.`,
      });
      setOpen(false);
      setPickerKey((k) => k + 1);
      onSuccess();
    } catch (err) {
      toast({
        title: "Could not add page",
        description: err instanceof Error ? err.message : "Save failed",
        variant: "destructive",
      });
    } finally {
      setAdding(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen} modal={false}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={adding}
          className="ml-auto shrink-0 inline-flex h-6 items-center gap-1 rounded-md border border-dashed px-2 text-[11px] text-muted-foreground hover-elevate disabled:opacity-50"
          data-testid={`button-funnel-add-content-${stageKey}`}
        >
          <Plus className="h-3 w-3" />
          Add content +
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0 z-50 pointer-events-auto" align="end">
        <SitemapSearch
          key={pickerKey}
          value=""
          onChange={() => {}}
          embedded
          onClose={() => setOpen(false)}
          onSelectEntry={(entry) => void handleSelectEntry(entry)}
          placeholder="Search pages…"
          testId={`funnel-add-${stageKey}`}
          showLocaleFilter
        />
      </PopoverContent>
    </Popover>
  );
}

function FunnelStage({
  label,
  description,
  icon: Icon,
  index,
  isLast,
  children,
  taper = "full",
  headerAction,
}: {
  label: string;
  description?: string;
  icon?: ComponentType<{ className?: string }>;
  index: number;
  isLast?: boolean;
  children: ReactNode;
  taper?: FunnelStageTaper;
  headerAction?: ReactNode;
}) {
  return (
    <div
      className={cn("pb-5", isLast && "pb-0")}
      data-testid={`funnel-stage-${label.toLowerCase().replace(/\s+/g, "-")}`}
    >
      <div
        className={cn(
          "mx-auto rounded-lg border px-3 py-3",
          FUNNEL_TAPER_WIDTH[taper],
          FUNNEL_STAGE_TONE[taper],
        )}
      >
        <div className="flex items-start gap-2 mb-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-full border border-border/80 bg-background/60 text-[10px] font-mono text-muted-foreground shrink-0">
            {index}
          </span>
          {Icon && <Icon className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />}
          <div className="min-w-0 flex-1">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</h3>
            {description && (
              <p className="text-xs text-muted-foreground/80 mt-0.5 leading-snug">{description}</p>
            )}
          </div>
          {headerAction}
        </div>
        {children}
      </div>
    </div>
  );
}

function KpiCard({
  label,
  value,
  hint,
  icon: Icon,
  testId,
  valueClassName,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon: ComponentType<{ className?: string }>;
  testId: string;
  valueClassName?: string;
}) {
  return (
    <Card data-testid={testId}>
      <CardContent className="pt-4 pb-3 space-y-1">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Icon className="h-3.5 w-3.5 shrink-0" />
          <span>{label}</span>
        </div>
        <p className={cn("text-sm font-medium truncate", valueClassName)}>{value}</p>
        {hint != null && (
          <p className="text-xs text-muted-foreground truncate">{hint}</p>
        )}
      </CardContent>
    </Card>
  );
}

function StepCard({ step, badge }: { step: FunnelStepRow; badge?: string }) {
  const primaryUrl = step.urls.en || step.urls.es || Object.values(step.urls)[0];
  return (
    <Card data-testid={`card-funnel-step-${step.slug}`}>
      <CardContent className="py-2.5 text-sm">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="font-medium font-mono text-sm truncate">
            {step.content_type}/{step.slug}
          </p>
          <LocaleFlags urls={step.urls} />
          {badge && <Badge variant="secondary">{badge}</Badge>}
          {primaryUrl && (
            <a
              href={primaryUrl}
              className="text-xs text-primary hover:underline ml-auto"
              target="_blank"
              rel="noreferrer"
            >
              Open
            </a>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default function StoreProductDetailPage() {
  const params = useParams<{ slug: string }>();
  const slug = params.slug ?? "";
  const queryClient = useQueryClient();
  const [educationOpen, setEducationOpen] = useState(false);

  const { data, isLoading, isError } = useQuery<FunnelResponse>({
    queryKey: [`/api/ecommerce/funnel/${slug}`],
    enabled: !!slug,
  });

  const refreshJourney = () => {
    void queryClient.invalidateQueries({ queryKey: [`/api/ecommerce/funnel/${slug}`] });
  };

  const stageOrder = data?.funnel.stage_order ?? [...FUNNEL_STAGES];
  const selling = data ? isActivelySelling(data.product) : false;
  const journeyPages = data
    ? stageOrder.reduce((n, key) => n + (data.funnel.stages[key]?.length ?? 0), 1)
    : 0;
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

        {isLoading && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        )}
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
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <KpiCard
                label="Product ID"
                value={data.product.product_id}
                hint={data.product.name}
                icon={IconHash}
                testId="card-kpi-product-id"
                valueClassName="font-mono"
              />
              <KpiCard
                label="CMS entry"
                value={`${data.product.content_type}/${data.product.content_slug}`}
                hint="Source content entry"
                icon={IconFileText}
                testId="card-kpi-cms-entry"
                valueClassName="font-mono"
              />
              <KpiCard
                label="Status"
                value={selling ? "Selling" : "Paused"}
                hint={selling ? "Visible in the store journey" : "Hidden from the store journey"}
                icon={selling ? IconCircleCheck : IconPlayerPause}
                testId="card-kpi-selling"
              />
              <KpiCard
                label="Journey pages"
                value={journeyPages}
                hint={`across ${stageOrder.length} stages`}
                icon={IconLayersIntersect}
                testId="card-kpi-journey-pages"
                valueClassName="tabular-nums"
              />
            </div>

            <section className="space-y-1">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-3">
                Conversion journey
              </h2>
              <Card data-testid="card-education" className="mb-4">
                <Collapsible open={educationOpen} onOpenChange={setEducationOpen}>
                  <div className="px-3 py-2 space-y-2 text-sm text-muted-foreground">
                    <CollapsibleTrigger asChild>
                      <button
                        type="button"
                        className="flex w-full items-center gap-2 text-foreground font-medium text-left"
                        aria-expanded={educationOpen}
                        data-testid="button-how-it-works"
                      >
                        <IconInfoCircle className="h-4 w-4 shrink-0" />
                        <span className="flex-1">How it works</span>
                        <ChevronDown
                          className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${educationOpen ? "rotate-180" : ""}`}
                        />
                      </button>
                    </CollapsibleTrigger>
                    <CollapsibleContent className="space-y-2">
                      <p>{data.education.summary}</p>
                      <details className="text-xs">
                        <summary className="cursor-pointer text-foreground font-medium">Read more (advanced)</summary>
                        <ul className="mt-2 list-disc pl-5 font-mono space-y-1">
                          {data.education.advanced_paths.map((p) => (
                            <li key={p}>{p}</li>
                          ))}
                        </ul>
                      </details>
                    </CollapsibleContent>
                  </div>
                </Collapsible>
              </Card>
              <p className="text-xs text-muted-foreground mb-4">
                Pages appear here when their{" "}
                <code className="bg-muted px-1 rounded">funnel.stage</code> and{" "}
                <code className="bg-muted px-1 rounded">funnel.products</code> include this SKU.
                Use <strong>Add content +</strong> on a stage to attach a page from the sitemap.
              </p>

              {stageOrder.map((stageKey, i) => {
                const meta = STAGE_META[stageKey] ?? {
                  label: stageKey,
                  description: "",
                  icon: IconTarget,
                  taper: "mid" as const,
                };
                const pages = data.funnel.stages[stageKey] ?? [];
                const isDecision = stageKey === "decision";
                const locked = isDecision ? data.funnel.locked : null;
                const isLast = i === stageOrder.length - 1;
                const funnelStageKey = stageKey as FunnelStageKey;

                return (
                  <FunnelStage
                    key={stageKey}
                    label={meta.label}
                    description={meta.description}
                    icon={meta.icon}
                    index={stageIndex++}
                    taper={meta.taper}
                    isLast={isLast}
                    headerAction={
                      FUNNEL_STAGES.includes(funnelStageKey) ? (
                        <AddFunnelContentButton
                          stageKey={funnelStageKey}
                          stageLabel={meta.label}
                          productSlug={slug}
                          onSuccess={refreshJourney}
                        />
                      ) : null
                    }
                  >
                    {locked && (
                      <div className="space-y-2 mb-2">
                        <StepCard step={locked} badge="locked product page" />
                      </div>
                    )}
                    {pages.length === 0 ? (
                      <p className="text-xs text-muted-foreground rounded-md border border-dashed px-3 py-3">
                        No pages at this stage yet. Click <strong>Add content +</strong> to pick a page
                        from the sitemap.
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {pages.map((step) => (
                          <StepCard key={`${step.content_type}/${step.slug}`} step={step} />
                        ))}
                      </div>
                    )}
                  </FunnelStage>
                );
              })}
            </section>
          </>
        )}
      </div>
    </div>
  );
}
