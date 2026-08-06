import { useQuery } from "@tanstack/react-query";
import { IconShoppingBag, IconInfoCircle, IconExternalLink } from "@tabler/icons-react";
import { Link } from "wouter";
import { ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

interface EcommerceEventRow {
  name: string;
  wired: boolean;
  description: string;
  sample: Record<string, unknown>;
}

interface UsageRow {
  component_type: string;
  role?: string;
  events: string[];
  notes?: string;
}

interface EventsResponse {
  events: EcommerceEventRow[];
  usage: UsageRow[];
  product_count: number;
  education: { summary: string; advanced_paths: string[] };
}

interface ProductRow {
  product_id: string;
  name: string;
  content_type: string;
  content_slug: string;
  active: boolean;
}

export default function StoreEcommercePage() {
  const { data, isLoading, isError } = useQuery<EventsResponse>({
    queryKey: ["/api/ecommerce/events"],
  });
  const { data: mapData } = useQuery<{ products: ProductRow[] }>({
    queryKey: ["/api/ecommerce/product-map"],
  });

  const products = mapData?.products ?? [];

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-4xl mx-auto px-6 py-8 space-y-8">
        <div className="flex items-center gap-3">
          <Link href="/private/diagnostics">
            <button className="p-1.5 rounded-md hover-elevate" data-testid="button-back" title="Back">
              <ArrowLeft className="h-4 w-4 text-muted-foreground" />
            </button>
          </Link>
          <IconShoppingBag className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-xl font-semibold" data-testid="heading-ecommerce">
            Ecommerce events
          </h1>
          {data && (
            <Badge variant="secondary" data-testid="badge-product-count">
              {data.product_count} products
            </Badge>
          )}
        </div>

        <Card data-testid="card-education">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <IconInfoCircle className="h-4 w-4" />
              How it works
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <p>
              {data?.education.summary ??
                "Ecommerce funnel events are separate from Forms/conversions. Products require _ecommerce.yml with purchasable: true. Purchase completes on the external POS — this site never fires purchase."}
            </p>
            <p>
              Funnel: <code className="text-xs bg-muted px-1 rounded">view_item</code> →{" "}
              <code className="text-xs bg-muted px-1 rounded">add_to_cart</code> →{" "}
              <code className="text-xs bg-muted px-1 rounded">view_item_list</code> /{" "}
              <code className="text-xs bg-muted px-1 rounded">select_item</code> →{" "}
              <code className="text-xs bg-muted px-1 rounded">begin_checkout</code> → purchase (off-site).
            </p>
            <details className="text-xs">
              <summary className="cursor-pointer text-foreground font-medium">Read more (advanced)</summary>
              <ul className="mt-2 list-disc pl-5 space-y-1 font-mono">
                {(data?.education.advanced_paths ?? [
                  "docs/component-behaviors.md",
                  "client/src/lib/tracking.ts",
                  "shared/component-behaviors.ts",
                ]).map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </details>
          </CardContent>
        </Card>

        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Event catalog
          </h2>
          {isError && (
            <p className="text-sm text-muted-foreground">Failed to load events.</p>
          )}
          {isLoading && (
            <div className="space-y-2">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          )}
          {data?.events.map((ev) => (
            <Card key={ev.name} data-testid={`card-event-${ev.name}`}>
              <CardContent className="py-4 flex flex-col sm:flex-row sm:items-start gap-3 justify-between">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <code className="text-sm font-semibold">{ev.name}</code>
                    <Badge variant={ev.wired ? "default" : "outline"}>
                      {ev.wired ? "wired" : "off-site"}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">{ev.description}</p>
                </div>
                <pre className="text-[10px] bg-muted/50 rounded p-2 overflow-auto max-w-xs shrink-0">
                  {JSON.stringify(ev.sample, null, 2)}
                </pre>
              </CardContent>
            </Card>
          ))}
        </section>

        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Products
          </h2>
          {products.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No purchasable products. Add{" "}
              <code className="bg-muted px-1 rounded">_ecommerce.yml</code> with{" "}
              <code className="bg-muted px-1 rounded">purchasable: true</code>.
            </p>
          )}
          <div className="grid gap-2">
            {products.map((p) => (
              <Link key={p.product_id} href={`/private/store/product/${p.content_slug}`}>
                <Card
                  className="hover-elevate cursor-pointer"
                  data-testid={`card-product-${p.content_slug}`}
                >
                  <CardContent className="py-3 flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium">{p.name}</p>
                      <p className="text-xs text-muted-foreground font-mono">
                        {p.product_id} · {p.content_type}/{p.content_slug}
                      </p>
                    </div>
                    <IconExternalLink className="h-4 w-4 text-muted-foreground" />
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Components with ecommerce behavior
          </h2>
          {(data?.usage ?? []).map((u) => (
            <Card key={u.component_type} data-testid={`card-usage-${u.component_type}`}>
              <CardContent className="py-3">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-sm font-medium font-mono">{u.component_type}</span>
                  {u.role && <Badge variant="secondary">{u.role}</Badge>}
                </div>
                <p className="text-xs text-muted-foreground">
                  events: {u.events.join(", ") || "—"}
                </p>
                {u.notes && <p className="text-xs text-muted-foreground mt-1">{u.notes}</p>}
              </CardContent>
            </Card>
          ))}
        </section>
      </div>
    </div>
  );
}
