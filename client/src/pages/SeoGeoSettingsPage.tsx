import { useEffect } from "react";
import { Link, useLocation } from "wouter";
import {
  IconArrowLeft,
  IconBrandGoogle,
  IconPhoto,
  IconCode,
  IconSearch,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { OgImageTab } from "@/components/settings/OgImageTab";
import { SchemaOrgTab } from "@/components/settings/SchemaOrgTab";
import { SearchConsoleTab } from "@/components/settings/SearchConsoleTab";

type SeoGeoTab = "og" | "schema" | "search-console";

const SEO_TABS: {
  id: SeoGeoTab;
  href: string;
  label: string;
  Icon: typeof IconPhoto;
}[] = [
  { id: "og", href: "/private/settings/seo/og", label: "OG Image", Icon: IconPhoto },
  { id: "schema", href: "/private/settings/seo/schema", label: "Schema org", Icon: IconCode },
  { id: "search-console", href: "/private/settings/seo/search-console", label: "Search Console", Icon: IconBrandGoogle },
];

function resolveSeoTab(pathname: string): SeoGeoTab | null {
  if (pathname === "/private/settings/seo/og") return "og";
  if (pathname === "/private/settings/seo/schema") return "schema";
  if (pathname === "/private/settings/seo/search-console") return "search-console";
  return null;
}

export default function SeoGeoSettingsPage() {
  const [pathname, setLocation] = useLocation();
  const activeTab = resolveSeoTab(pathname);

  useEffect(() => {
    if (pathname === "/private/settings/seo" || pathname === "/private/settings/seo/") {
      setLocation("/private/settings/seo/og");
    }
  }, [pathname, setLocation]);

  if (!activeTab) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-muted-foreground text-sm">Redirecting…</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
        <div className="flex items-start gap-4">
          <Button variant="ghost" size="icon" asChild data-testid="button-seo-geo-settings-back">
            <Link href="/private/settings">
              <IconArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          <div className="flex-1 space-y-1">
            <div className="flex items-center gap-2">
              <IconSearch className="h-5 w-5 text-muted-foreground" />
              <h1 className="text-2xl font-semibold tracking-tight" data-testid="text-seo-geo-settings-title">
                SEO/GEO
              </h1>
            </div>
            <p className="text-sm text-muted-foreground">
              Open Graph capture credentials, Schema.org site definitions, and Search Console inspection.
              Brand logos, social links, and the default social image stay under{" "}
              <Link href="/private/settings?tab=brand" className="underline underline-offset-2 hover:text-foreground">
                General → Brand
              </Link>
              .
            </p>
          </div>
        </div>

        <div
          className="inline-flex h-10 w-full items-center justify-center rounded-md bg-muted p-1 text-muted-foreground"
          role="tablist"
          data-testid="seo-geo-settings-tablist"
        >
          {SEO_TABS.map(({ id, href, label, Icon }) => {
            const isActive = activeTab === id;
            return (
              <Link key={id} href={href} className="flex-1">
                <button
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  className={cn(
                    "inline-flex w-full items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                    isActive
                      ? "bg-background text-foreground shadow-sm"
                      : "hover:text-foreground",
                  )}
                  data-testid={`tab-seo-${id}`}
                >
                  <Icon className="h-4 w-4 mr-1.5" />
                  {label}
                </button>
              </Link>
            );
          })}
        </div>

        <div role="tabpanel">
          {activeTab === "og" ? (
            <OgImageTab />
          ) : activeTab === "schema" ? (
            <SchemaOrgTab />
          ) : (
            <SearchConsoleTab />
          )}
        </div>
      </div>
    </div>
  );
}
