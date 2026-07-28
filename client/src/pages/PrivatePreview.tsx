import { useState, useEffect, lazy, Suspense } from "react";
import { AlertTriangle, ArrowLeft, Code, Loader2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useParams, useSearch } from "wouter";
import { SectionRenderer } from "@/components/SectionRenderer";
import { apiFetch } from "@/lib/queryClient";
import { normalizeContentType, useContentTypesRaw } from "@/hooks/useContentTypes";
import type { CareerProgram, LandingPage, LocationPage, TemplatePage } from "@shared/schema";
import { usePageMeta } from "@/hooks/usePageMeta";
import { useSchemaOrg } from "@/hooks/useSchemaOrg";
import { useContentAutoRefresh } from "@/hooks/useContentAutoRefresh";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { Button } from "@/components/ui/button";
import LazyRender from "@/components/LazyRender";
import MenuSlotPlaceholder from "@/components/editing/MenuSlotPlaceholder";
import { MenuVisualContextProvider } from "@/contexts/MenuVisualContext";
import { useMenuConfig } from "@/hooks/useMenuConfig";
import { getMenuChromeHeights } from "@/lib/menuChrome";

const RawFileEditorPanel = lazy(() => import("@/components/editing/RawFileEditorPanel"));

type ContentData = CareerProgram | LandingPage | LocationPage | TemplatePage;

// Only special-case types whose API path differs from their registry directory name.
// For all other known content types, the directory from the registry is used as the API path.
const STATIC_API_PATHS: Record<string, string> = {
  program: "career-programs",
};

export default function PrivatePreview() {
  const params = useParams<{ contentType: string; slug: string }>();
  const searchString = useSearch();
  const searchParams = new URLSearchParams(searchString);
  
  const contentType = params.contentType!;
  const slug = params.slug;
  const variant = searchParams.get("variant");
  const version = searchParams.get("version");
  const locale = searchParams.get("locale") || "en";
  
  const { data: allContentTypes, isLoading: typesLoading } = useContentTypesRaw();

  const normalizedType = normalizeContentType(
    contentType,
    allContentTypes
      ? Object.fromEntries(allContentTypes.map(t => [t.name, { directory: t.directory, url_pattern: t.url_pattern }]))
      : undefined
  );

  const typeInfo = allContentTypes?.find(t => t.name === normalizedType);
  // For types with /api/{directory}/{slug} standalone endpoints, derive the path from the
  // registry directory instead of hardcoding it. Types without standalone endpoints (e.g. blog,
  // downloadable) are routed through the generic /api/content-pages endpoint below.
  const STANDALONE_ENDPOINT_TYPES = new Set(["landing", "location", "page"]);
  const staticApiPath =
    STATIC_API_PATHS[normalizedType] ??
    (STANDALONE_ENDPOINT_TYPES.has(normalizedType) ? typeInfo?.directory : undefined);
  const isValidContentType = !!typeInfo || !!staticApiPath;
  const typeLabel = typeInfo?.label || normalizedType.charAt(0).toUpperCase() + normalizedType.slice(1);

  const [showRawEditor, setShowRawEditor] = useState(false);

  const { data: content, isLoading, error, refetch } = useQuery<ContentData>({
    queryKey: ["/api/preview", normalizedType, slug, variant, version, locale],
    queryFn: async ({ signal }) => {
      let url: string;
      if (staticApiPath) {
        url = `/api/${staticApiPath}/${slug}?locale=${locale}`;
      } else {
        url = `/api/content-pages/${normalizedType}/${slug}?locale=${locale}`;
      }
      if (variant) url += `&force_variant=${variant}`;
      if (version) url += `&force_version=${version}`;

      // Bound the wait so a hung fetch cannot leave the page on "Loading…" forever.
      const timeoutMs = 20_000;
      const timeoutCtrl = new AbortController();
      const timer = setTimeout(() => timeoutCtrl.abort(), timeoutMs);
      const onAbort = () => timeoutCtrl.abort();
      signal?.addEventListener("abort", onAbort);
      try {
        const response = await apiFetch(url, { signal: timeoutCtrl.signal });
        if (!response.ok) {
          throw new Error("Content not found");
        }
        return response.json();
      } catch (err) {
        if (timeoutCtrl.signal.aborted && !signal?.aborted) {
          throw new Error(`Timed out loading ${normalizedType} preview`);
        }
        throw err;
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
      }
    },
    enabled: !!slug && isValidContentType && !typesLoading,
  });

  const { data: rawFileCheck } = useQuery<{ exists: boolean }>({
    queryKey: ["/api/content/raw-file", normalizedType, slug, locale],
    queryFn: async () => {
      const res = await fetch(`/api/content/raw-file?contentType=${normalizedType}&slug=${slug}&locale=${locale}`);
      if (!res.ok) return { exists: false };
      const data = await res.json();
      return { exists: !!data.exists };
    },
    enabled: !!slug && isValidContentType && (!!error || !content),
  });

  usePageMeta(content?.meta, locale);
  useSchemaOrg(content?.schema);

  const handleRefetch = () => {
    refetch();
  };

  useEffect(() => {
    if (!content || isLoading) return;
    const hash = window.location.hash;
    if (!hash) return;
    const id = hash.slice(1);
    requestAnimationFrame(() => {
      const el = document.getElementById(id);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
  }, [content, isLoading]);

  useEffect(() => {
    if (!content || isLoading) return;
    const contentLocale = (content as Record<string, unknown>).locale;
    if (typeof contentLocale === "string" && contentLocale && contentLocale !== locale) {
      const url = new URL(window.location.href);
      url.searchParams.set("locale", contentLocale);
      window.history.replaceState(null, "", url.pathname + url.search + url.hash);
    }
  }, [content, isLoading, locale]);

  useContentAutoRefresh(
    normalizedType,
    slug,
    locale,
    handleRefetch
  );

  const {
    topMenuId,
    bottomMenuId,
    topMenuConfig,
    isTopMenuLoading,
    sectionBackgroundOverlapsMenu,
  } = useMenuConfig({ layout: (content as any)?.layout as { menu?: { top?: string | null; bottom?: string | null } } | undefined, locale });
  const topChromeHeights = getMenuChromeHeights(topMenuConfig);

  if (typesLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" data-testid="loading-preview">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin text-primary mx-auto mb-4" />
          <p className="text-sm text-muted-foreground">Loading preview...</p>
        </div>
      </div>
    );
  }

  if (!isValidContentType) {
    return (
      <div className="min-h-screen flex items-center justify-center" data-testid="error-invalid-type">
        <div className="text-center">
          <AlertTriangle className="w-12 h-12 text-destructive mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-foreground mb-2">Invalid Content Type</h1>
          <p className="text-muted-foreground mb-4">
            Content type "{contentType}" is not valid.
          </p>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" data-testid="loading-preview">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin text-primary mx-auto mb-4" />
          <p className="text-sm text-muted-foreground">
            Loading {typeLabel.toLowerCase()} preview...
          </p>
        </div>
      </div>
    );
  }

  if (error || !content) {
    return (
      <>
        <div className="min-h-screen flex items-center justify-center" data-testid="error-preview">
          <div className="text-center">
            <AlertTriangle className="w-12 h-12 text-destructive mx-auto mb-4" />
            <h1 className="text-2xl font-bold text-foreground mb-2">
              {typeLabel} not found
            </h1>
            <p className="text-muted-foreground mb-4">
              Could not load the requested content variant.
            </p>
            <div className="flex items-center justify-center gap-2 flex-wrap">
              <Button variant="outline" onClick={() => window.history.back()} data-testid="button-go-back">
                <ArrowLeft className="w-4 h-4 mr-2" />
                Go Back
              </Button>
              {rawFileCheck?.exists && (
                <Button variant="outline" onClick={() => setShowRawEditor(true)} data-testid="button-edit-yaml">
                  <Code className="w-4 h-4 mr-2" />
                  Edit YAML
                </Button>
              )}
            </div>
          </div>
        </div>
        {showRawEditor && (
          <Suspense fallback={null}>
            <RawFileEditorPanel
              contentType={normalizedType}
              slug={slug}
              locale={locale}
              onClose={() => setShowRawEditor(false)}
              onSaved={() => window.location.reload()}
            />
          </Suspense>
        )}
      </>
    );
  }

  const pageDetached = !!(content as { detached?: boolean }).detached;
  const isSharedLayout = !!(typeInfo?.has_database || typeInfo?.single_template);
  const isSharedTemplate = isSharedLayout && !pageDetached;
  const isDetached = isSharedLayout && pageDetached;

  return (
    <div data-testid={`preview-${contentType}-${slug}`}>
      <MenuVisualContextProvider
        value={{
          sectionBackgroundOverlapsMenu,
          topChromeHeightDesktop: topChromeHeights.totalHeightDesktop,
          topChromeHeightMobile: topChromeHeights.totalHeightMobile,
        }}
      >
        <div className="group relative">
          {topMenuId && <Header menuConfig={topMenuConfig} isLoading={isTopMenuLoading} />}
          <MenuSlotPlaceholder
            position="top"
            currentMenuId={topMenuId}
            contentType={normalizedType}
            slug={slug!}
            locale={locale}
            onMenuChange={() => refetch()}
            isSharedTemplate={isSharedTemplate}
            isDetached={isDetached}
          />
        </div>
        <SectionRenderer 
          sections={content.sections} 
          contentType={normalizedType}
          slug={slug}
          locale={locale}
          variant={variant ?? undefined}
          version={version ? Number(version) : undefined}
          isSharedTemplate={isSharedTemplate}
          singleEntry={(content as any).singleEntry}
          meta={(content as any).meta}
          param={(content as any).param}
          allowEntryStructuralOverrides={!isSharedLayout || pageDetached}
        />
      </MenuVisualContextProvider>
      <div className="group relative">
        {bottomMenuId && (
          <LazyRender>
            <div className="pb-12">
              <Footer menuId={bottomMenuId} />
            </div>
          </LazyRender>
        )}
        <MenuSlotPlaceholder
          position="bottom"
          currentMenuId={bottomMenuId}
          contentType={normalizedType}
          slug={slug!}
          locale={locale}
          onMenuChange={() => refetch()}
          isSharedTemplate={isSharedTemplate}
          isDetached={isDetached}
        />
      </div>
    </div>
  );
}
