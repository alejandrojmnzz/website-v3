import { useState } from "react";
import { AlertTriangle, ArrowLeft, Brain, Check, Crosshair, Globe, Info, Network, Star } from "lucide-react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";

interface SeoOverview {
  intentDistribution: Record<string, Record<string, number>>;
  clusters: { pillarUrl: string; clusterSlugs: string[]; clusterCount: number }[];
  orphanPages: { slug: string; contentType: string; intent: string; filePath: string }[];
  featureCoverage: Record<string, number>;
  faqCoverage: { slug: string; contentType: string; locale: string; faqCount: number }[];
  schemaCoverage: Record<string, number>;
  totals: {
    totalPages: number;
    withPillar: number;
    withIntent: number;
    withFocusFeatures: number;
    withFaq: number;
    withSchema: number;
  };
}

interface BrandContext {
  brand?: { name?: string; tagline?: string; mission?: string };
  voice?: { tone?: string; style?: string; personality?: string };
  key_differentiators?: string[];
  forbidden_phrases?: { phrase: string; reason: string }[];
  target_audience?: {
    primary?: { description?: string; age_range?: string; motivations?: string[]; concerns?: string[] };
  };
}

const INTENT_LABELS: Record<string, string> = {
  awareness: "Awareness",
  consideration: "Consideration",
  transaction: "Transaction",
  "post-enrollment": "Post-Enroll",
  unknown: "Unknown",
};

const INTENT_COLORS: Record<string, string> = {
  awareness: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  consideration: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  transaction: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  "post-enrollment": "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
  unknown: "bg-muted text-muted-foreground",
};

const ALL_INTENTS = ["awareness", "consideration", "transaction", "post-enrollment"];
const ALL_FEATURES: Record<string, string> = {
  mentorship: "1-on-1 Mentorship",
  job_guarantee: "Job Guarantee",
  flexible_schedule: "Flexible Schedule",
  financing: "Financing & ISA",
  community: "Alumni Community",
  portfolio: "Real Portfolio",
  career_support: "Career Support",
  multilingual: "Multilingual",
};

function StatCard({ label, value, total, icon }: { label: string; value: number; total?: number; icon?: React.ReactNode }) {
  const pct = total ? Math.round((value / total) * 100) : null;
  return (
    <Card data-testid={`stat-card-${label.toLowerCase().replace(/\s+/g, "-")}`}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-2xl font-bold text-foreground">{value}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
          </div>
          <div className="flex flex-col items-end gap-1">
            {icon && <span className="text-muted-foreground">{icon}</span>}
            {pct !== null && (
              <span className="text-xs text-muted-foreground">{pct}%</span>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function LoadingSection() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-6 w-48" />
      <Skeleton className="h-32 w-full" />
      <Skeleton className="h-32 w-full" />
    </div>
  );
}

export function SeoTab({ data }: { data: SeoOverview }) {
  const contentTypes = Object.keys(data.intentDistribution);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3" data-testid="seo-totals-grid">
        <StatCard label="Total Pages" value={data.totals.totalPages} icon={<Network className="h-4 w-4" />} />
        <StatCard label="With Intent" value={data.totals.withIntent} total={data.totals.totalPages} icon={<Crosshair className="h-4 w-4" />} />
        <StatCard label="Clustered" value={data.totals.withPillar} total={data.totals.totalPages} icon={<Network className="h-4 w-4" />} />
        <StatCard label="Focus Features" value={data.totals.withFocusFeatures} total={data.totals.totalPages} icon={<Star className="h-4 w-4" />} />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Crosshair className="h-4 w-4" />
            Intent Distribution
          </CardTitle>
        </CardHeader>
        <CardContent>
          {contentTypes.length === 0 ? (
            <p className="text-sm text-muted-foreground">No intent data found</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs" data-testid="intent-distribution-table">
                <thead>
                  <tr>
                    <th className="text-left py-2 pr-4 text-muted-foreground font-medium">Content Type</th>
                    {ALL_INTENTS.map((intent) => (
                      <th key={intent} className="text-center py-2 px-2 text-muted-foreground font-medium">
                        {INTENT_LABELS[intent]}
                      </th>
                    ))}
                    <th className="text-center py-2 px-2 text-muted-foreground font-medium">Unknown</th>
                  </tr>
                </thead>
                <tbody>
                  {contentTypes.map((ct) => (
                    <tr key={ct} className="border-t border-border" data-testid={`intent-row-${ct}`}>
                      <td className="py-2 pr-4 font-medium text-foreground capitalize">{ct}</td>
                      {[...ALL_INTENTS, "unknown"].map((intent) => {
                        const count = data.intentDistribution[ct]?.[intent] || 0;
                        return (
                          <td key={intent} className="py-2 px-2 text-center" data-testid={`intent-cell-${ct}-${intent}`}>
                            {count > 0 ? (
                              <span className={`inline-flex items-center justify-center px-2 py-0.5 rounded text-xs font-medium ${INTENT_COLORS[intent]}`}>
                                {count}
                              </span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Network className="h-4 w-4" />
            Cluster Map
            <Badge variant="secondary">{data.clusters.length} pillar{data.clusters.length !== 1 ? "s" : ""}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {data.clusters.length === 0 ? (
            <div className="text-center py-8" data-testid="clusters-empty">
              <Network className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
              <p className="text-sm text-muted-foreground">No pillar pages defined yet</p>
              <p className="text-xs text-muted-foreground mt-1">Set <code className="bg-muted px-1 rounded">seo.pillar</code> on pages to build topic clusters</p>
            </div>
          ) : (
            <Accordion type="multiple">
              {data.clusters.map((cluster) => (
                <AccordionItem key={cluster.pillarUrl} value={cluster.pillarUrl} data-testid={`cluster-${cluster.pillarUrl}`}>
                  <AccordionTrigger className="text-xs py-2 hover:no-underline">
                    <div className="flex items-center gap-2 text-left">
                      <code className="text-xs bg-muted px-1.5 py-0.5 rounded text-foreground font-mono">{cluster.pillarUrl}</code>
                      <Badge variant="secondary">{cluster.clusterCount} page{cluster.clusterCount !== 1 ? "s" : ""}</Badge>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent>
                    <div className="flex flex-wrap gap-1.5 pt-1 pb-2">
                      {cluster.clusterSlugs.map((slug) => (
                        <Badge key={slug} variant="outline" className="text-xs font-mono" data-testid={`cluster-slug-${slug}`}>
                          {slug}
                        </Badge>
                      ))}
                    </div>
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-12 gap-6">
        <Card className="col-span-12 md:col-span-5">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Star className="h-4 w-4" />
              Focus Feature Coverage
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2" data-testid="feature-coverage-list">
              {Object.entries(ALL_FEATURES).map(([key, label]) => {
                const count = data.featureCoverage[key] || 0;
                return (
                  <div key={key} className="flex items-center justify-between gap-2" data-testid={`feature-row-${key}`}>
                    <span className={`text-xs ${count === 0 ? "text-muted-foreground" : "text-foreground"}`}>{label}</span>
                    <Badge variant={count === 0 ? "outline" : "secondary"} className="text-xs tabular-nums">
                      {count}
                    </Badge>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        <Card className="col-span-12 md:col-span-7">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" />
              Orphan Pages
              {data.orphanPages.length > 0 && (
                <Badge variant="destructive">{data.orphanPages.length}</Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {data.orphanPages.length === 0 ? (
              <div className="text-center py-6" data-testid="orphans-empty">
                <Check className="h-6 w-6 mx-auto text-chart-3 mb-2" />
                <p className="text-sm text-muted-foreground">All pages are clustered</p>
              </div>
            ) : (
              <ScrollArea className="max-h-64">
                <div className="space-y-1.5" data-testid="orphan-pages-list">
                  {data.orphanPages.map((p, i) => (
                    <div key={`${p.slug}-${i}`} className="py-1.5 border-b border-border last:border-0" data-testid={`orphan-${p.slug}`}>
                      <span className="text-xs font-mono text-foreground block truncate">{p.slug}</span>
                      <div className="flex items-center gap-1 mt-1">
                        <Badge variant="outline" className="text-xs capitalize">{p.contentType}</Badge>
                        <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs ${INTENT_COLORS[p.intent] || INTENT_COLORS.unknown}`}>
                          {INTENT_LABELS[p.intent] || p.intent}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export function GeoTab({ data, brand }: { data: SeoOverview; brand: BrandContext | null }) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3" data-testid="geo-totals-grid">
        <StatCard label="Total Pages" value={data.totals.totalPages} icon={<Globe className="h-4 w-4" />} />
        <StatCard label="With FAQ" value={data.totals.withFaq} total={data.totals.totalPages} icon={<Brain className="h-4 w-4" />} />
        <StatCard label="With Schema" value={data.totals.withSchema} total={data.totals.totalPages} icon={<Info className="h-4 w-4" />} />
      </div>

      {brand && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Brain className="h-4 w-4" />
              Brand Context
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {brand.brand && (
              <div data-testid="brand-identity">
                <p className="text-base font-semibold text-foreground">{brand.brand.name}</p>
                {brand.brand.tagline && (
                  <p className="text-sm text-muted-foreground italic mt-0.5">"{brand.brand.tagline}"</p>
                )}
                {brand.brand.mission && (
                  <p className="text-xs text-muted-foreground mt-1">{brand.brand.mission}</p>
                )}
              </div>
            )}

            {brand.key_differentiators && brand.key_differentiators.length > 0 && (
              <div data-testid="brand-differentiators">
                <p className="text-xs font-medium text-foreground mb-1.5">Key Differentiators</p>
                <div className="flex flex-wrap gap-1.5">
                  {brand.key_differentiators.map((d, i) => (
                    <Badge key={i} variant="secondary" className="text-xs">{d}</Badge>
                  ))}
                </div>
              </div>
            )}

            {brand.forbidden_phrases && brand.forbidden_phrases.length > 0 && (
              <div data-testid="brand-forbidden">
                <p className="text-xs font-medium text-foreground mb-1.5">Forbidden Phrases</p>
                <div className="flex flex-wrap gap-1.5">
                  {brand.forbidden_phrases.map((fp, i) => (
                    <Badge
                      key={i}
                      variant="outline"
                      className="text-xs text-destructive border-destructive/30"
                      title={fp.reason}
                      data-testid={`forbidden-${fp.phrase.replace(/\s+/g, "-")}`}
                    >
                      {fp.phrase}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {brand.target_audience?.primary && (
              <div data-testid="brand-audience">
                <p className="text-xs font-medium text-foreground mb-1.5">Primary Audience</p>
                <p className="text-xs text-muted-foreground">{brand.target_audience.primary.description}</p>
                {brand.target_audience.primary.concerns && (
                  <div className="mt-1.5">
                    <p className="text-xs text-muted-foreground font-medium">Common concerns:</p>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {brand.target_audience.primary.concerns.map((c, i) => (
                        <Badge key={i} variant="outline" className="text-xs">{c}</Badge>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Brain className="h-4 w-4" />
              FAQ Coverage
              <Badge variant="secondary">{data.faqCoverage.length} pages</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {data.faqCoverage.length === 0 ? (
              <div className="text-center py-6" data-testid="faq-empty">
                <p className="text-sm text-muted-foreground">No FAQ sections found</p>
                <p className="text-xs text-muted-foreground mt-1">Add <code className="bg-muted px-1 rounded">type: faq</code> sections to improve AI search coverage</p>
              </div>
            ) : (
              <ScrollArea className="max-h-64">
                <div className="space-y-1.5" data-testid="faq-coverage-list">
                  {data.faqCoverage.map((f, i) => (
                    <div key={`${f.slug}-${f.locale}-${i}`} className="flex items-center justify-between gap-2 py-1 border-b border-border last:border-0" data-testid={`faq-${f.slug}-${f.locale}`}>
                      <div className="min-w-0">
                        <span className="text-xs font-mono text-foreground truncate block">{f.slug}</span>
                        <span className="text-xs text-muted-foreground">{f.locale} · {f.contentType}</span>
                      </div>
                      <Badge variant="secondary" className="text-xs shrink-0">{f.faqCount} FAQ{f.faqCount !== 1 ? "s" : ""}</Badge>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Info className="h-4 w-4" />
              Schema.org Distribution
            </CardTitle>
          </CardHeader>
          <CardContent>
            {Object.keys(data.schemaCoverage).length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">No schema types found</p>
            ) : (
              <div className="flex flex-wrap gap-2" data-testid="schema-distribution">
                {Object.entries(data.schemaCoverage)
                  .sort(([, a], [, b]) => b - a)
                  .map(([schemaType, count]) => (
                    <div key={schemaType} className="flex items-center gap-1.5" data-testid={`schema-type-${schemaType}`}>
                      <Badge variant="secondary" className="text-xs font-mono">{schemaType}</Badge>
                      <span className="text-xs text-muted-foreground">{count}</span>
                    </div>
                  ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default function SeoGeoPage() {
  const { data: overview, isLoading: overviewLoading } = useQuery<SeoOverview>({
    queryKey: ["/api/seo/overview"],
  });

  const { data: brandRaw, isLoading: brandLoading } = useQuery<BrandContext>({
    queryKey: ["/api/brand-context"],
  });

  const brand = brandRaw && !("error" in brandRaw) ? brandRaw : null;

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-7xl mx-auto px-4 py-6">
        <Tabs defaultValue="seo">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
            <div className="flex items-center gap-3">
              <Link href="/private/diagnostics">
                <Button variant="ghost" size="icon" data-testid="button-back-diagnostics">
                  <ArrowLeft className="h-5 w-5" />
                </Button>
              </Link>
              <div className="flex items-center gap-2">
                <Crosshair className="h-5 w-5 text-primary" />
                <h1 className="text-lg font-semibold text-foreground" data-testid="text-seo-geo-title">
                  SEO &amp; GEO
                </h1>
              </div>
            </div>
            <TabsList data-testid="tabs-seo-geo">
              <TabsTrigger value="seo" data-testid="tab-seo">SEO</TabsTrigger>
              <TabsTrigger value="geo" data-testid="tab-geo">GEO</TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="seo">
            {overviewLoading ? (
              <LoadingSection />
            ) : overview ? (
              <SeoTab data={overview} />
            ) : (
              <p className="text-muted-foreground text-sm text-center py-12">Failed to load SEO data</p>
            )}
          </TabsContent>

          <TabsContent value="geo">
            {overviewLoading || brandLoading ? (
              <LoadingSection />
            ) : overview ? (
              <GeoTab data={overview} brand={brand} />
            ) : (
              <p className="text-muted-foreground text-sm text-center py-12">Failed to load GEO data</p>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
