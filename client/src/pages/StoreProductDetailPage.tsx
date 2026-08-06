import { useQuery } from "@tanstack/react-query";
import { IconShoppingBag, IconInfoCircle } from "@tabler/icons-react";
import { Link, useParams } from "wouter";
import { ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

interface FunnelResponse {
  product: {
    product_id: string;
    name: string;
    content_type: string;
    content_slug: string;
    active: boolean;
    plans: Array<{ plan_id: string; name: string; price: number }>;
    description?: string;
  };
  funnel: {
    pages: Array<{ path: string; locale?: string; file: string }>;
    components: Array<{ type: string; events: string[]; role?: string }>;
  };
  education: { summary: string; advanced_paths: string[] };
}

export default function StoreProductDetailPage() {
  const params = useParams<{ slug: string }>();
  const slug = params.slug ?? "";

  const { data, isLoading, isError } = useQuery<FunnelResponse>({
    queryKey: [`/api/ecommerce/funnel/${slug}`],
    enabled: !!slug,
  });

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
                {data.product.plans?.length > 0 && (
                  <ul className="mt-2 text-xs text-muted-foreground list-disc pl-5">
                    {data.product.plans.map((pl) => (
                      <li key={pl.plan_id}>
                        {pl.name} ({pl.plan_id}) — {pl.price}
                      </li>
                    ))}
                  </ul>
                )}
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

            <section className="space-y-2">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Funnel pages
              </h2>
              {data.funnel.pages.length === 0 && (
                <p className="text-sm text-muted-foreground">No page references found.</p>
              )}
              {data.funnel.pages.map((pg) => (
                <Card key={pg.file}>
                  <CardContent className="py-3 text-sm">
                    <p className="font-medium">{pg.path}</p>
                    <p className="text-xs text-muted-foreground font-mono">{pg.file}</p>
                  </CardContent>
                </Card>
              ))}
            </section>

            <section className="space-y-2">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Components
              </h2>
              {data.funnel.components.map((c) => (
                <Card key={c.type}>
                  <CardContent className="py-3 text-sm flex items-center gap-2 flex-wrap">
                    <span className="font-mono">{c.type}</span>
                    {c.role && <Badge variant="secondary">{c.role}</Badge>}
                    <span className="text-xs text-muted-foreground">
                      {c.events.join(", ")}
                    </span>
                  </CardContent>
                </Card>
              ))}
            </section>
          </>
        )}
      </div>
    </div>
  );
}
