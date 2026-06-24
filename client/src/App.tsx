import { Switch, Route } from "wouter";
import { queryClient as defaultQueryClient } from "./lib/queryClient";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { lazy, Suspense, useState, useEffect, type ReactNode } from "react";
import NotFound from "@/pages/not-found";
import { SessionProvider } from "@/contexts/SessionContext";
import { EditModeWrapper } from "@/components/editing/EditModeWrapper";
import { DebugAuthProvider, isDebugModeActive } from "@/hooks/useDebugAuth";
import { ImagePickerProvider } from "@/contexts/ImagePickerContext";
import { usePageTracking } from "@/hooks/usePageTracking";
import type { ContentTypeApiItem } from "@/hooks/useContentTypes";
import "./i18n";

// Track whether the Vite HMR WebSocket is currently connected.
// When disconnected, lazy-import retries are paused until the connection
// is restored (or a full-reload is imminent) rather than failing immediately.
let _hmrConnected = true;

function _waitForHmrReconnect(timeoutMs = 30_000): Promise<void> {
  return new Promise((resolve) => {
    if (_hmrConnected) { resolve(); return; }
    let timer: ReturnType<typeof setTimeout>;
    const onConnect = () => {
      clearTimeout(timer);
      window.removeEventListener("vite:ws:connect" as keyof WindowEventMap, onConnect);
      resolve();
    };
    window.addEventListener("vite:ws:connect" as keyof WindowEventMap, onConnect);
    // Timeout safety valve — resolve anyway so retries can proceed/fail naturally
    timer = setTimeout(() => {
      window.removeEventListener("vite:ws:connect" as keyof WindowEventMap, onConnect);
      resolve();
    }, timeoutMs);
  });
}

if (typeof window !== "undefined") {
  // Vite 5+ dispatches these events on the window when the HMR socket changes state
  window.addEventListener("vite:ws:connect" as keyof WindowEventMap, () => {
    _hmrConnected = true;
  });
  window.addEventListener("vite:ws:disconnect" as keyof WindowEventMap, () => {
    _hmrConnected = false;
  });
  // A full-reload means the page is about to reload — no point retrying imports
  window.addEventListener("vite:beforeFullReload" as keyof WindowEventMap, () => {
    _hmrConnected = false;
  });
}

function lazyWithRetry<T extends React.ComponentType<any>>(
  factory: () => Promise<{ default: T }>,
  retries = 2,
  delay = 500,
): React.LazyExoticComponent<T> {
  return lazy(() => {
    const attempt = (n: number): Promise<{ default: T }> =>
      factory().catch(async (err) => {
        if (n <= 0) throw err;
        // If the HMR socket is disconnected, pause until it reconnects
        // (avoids burning all retries while the server is restarting)
        if (!_hmrConnected) {
          await _waitForHmrReconnect();
        }
        await new Promise<void>((resolve) => setTimeout(resolve, delay));
        return attempt(n - 1);
      });
    return attempt(retries);
  });
}

const ContentTypeDetail = lazyWithRetry(() => import("@/pages/ContentTypeDetail"));
const TemplatePage = lazyWithRetry(() => import("@/pages/page"));
const DatabaseSinglePage = lazyWithRetry(() => import("@/pages/DatabaseSinglePage"));

const PreviewFrame = lazyWithRetry(() => import("@/pages/PreviewFrame"));
const PrivateRouter = lazyWithRetry(() => import("@/pages/PrivateRouter"));
// Admin/editor-only UI — deferred into separate chunks so regular visitors
// never download them as part of the initial bundle. They are already
// client-only (inside <ClientOnly>) so no SSR preload is needed.
const DebugBubble = lazyWithRetry(() =>
  import("@/components/DebugBubble").then((m) => ({ default: m.DebugBubble })),
);
const ChatWidget = lazyWithRetry(() =>
  import("@/components/ChatWidget").then((m) => ({ default: m.ChatWidget })),
);
const VariableModalHost = lazyWithRetry(() =>
  import("@/components/editing/VariableHighlight").then((m) => ({ default: m.VariableModalHost })),
);
const OverlayRuntime = lazyWithRetry(() =>
  import("@/components/overlays/OverlayRuntime").then((m) => ({ default: m.OverlayRuntime })),
);

// DebugBubbleGate: gate the lazy import behind a synchronous debug-mode check.
// isDebugModeActive() reads URL params + sessionStorage + import.meta.env.DEV —
// all synchronous, no hooks. Regular visitors never trigger the network request
// for the DebugBubble chunk.
function DebugBubbleGate() {
  if (!isDebugModeActive()) return null;
  return <Suspense fallback={null}><DebugBubble /></Suspense>;
}

// DeferredTooltipProvider: avoids loading @radix-ui/react-tooltip in the initial
// bundle. Children render immediately without the provider; the Radix chunk is
// fetched after mount so tooltips are available long before any user can open one.
function DeferredTooltipProvider({ children }: { children: ReactNode }) {
  const [Provider, setProvider] = useState<React.ComponentType<{ children: ReactNode }> | null>(null);

  useEffect(() => {
    import("@/components/ui/tooltip").then(({ TooltipProvider }) => {
      setProvider(() => TooltipProvider);
    });
  }, []);

  if (!Provider) return <>{children}</>;
  return <Provider>{children}</Provider>;
}

function LoadingFallback() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="text-center">
        <div
          className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-current border-r-transparent align-[-0.125em] motion-reduce:animate-[spin_1.5s_linear_infinite]"
          role="status"
        >
          <span className="!absolute !-m-px !h-px !w-px !overflow-hidden !whitespace-nowrap !border-0 !p-0 ![clip:rect(0,0,0,0)]">
            Loading...
          </span>
        </div>
      </div>
    </div>
  );
}

const STATIC_ROUTE_TYPES = new Set(["page", "program", "location", "blog"]);

function useDynamicRoutes() {
  const { data: contentTypes, isLoading } = useQuery<ContentTypeApiItem[]>({
    queryKey: ["/api/content-types"],
    staleTime: Infinity,
  });

  const routes = (() => {
    if (!contentTypes) return [];

    const routes: Array<{
      path: string;
      type: string;
      locale: string;
      urlPattern: Record<string, string>;
      isDb: boolean;
      slugParam: string;
      isListingPrefix: boolean;
    }> = [];

    for (const ct of contentTypes) {
      if (STATIC_ROUTE_TYPES.has(ct.name)) continue;

      for (const [locale, pattern] of Object.entries(ct.url_pattern)) {

        const slugParam = "slug";

        if (ct.has_database) {
          const listingPrefix = pattern.replace(/\/:[^/]+.*$/, "");
          if (listingPrefix && listingPrefix !== pattern) {
            routes.push({
              path: listingPrefix,
              type: ct.name,
              locale,
              urlPattern: ct.url_pattern,
              isDb: true,
              slugParam,
              isListingPrefix: true,
            });
          }
          routes.push({
            path: pattern.replace(":slug", "*"),
            type: ct.name,
            locale,
            urlPattern: ct.url_pattern,
            isDb: true,
            slugParam,
            isListingPrefix: false,
          });
        } else {
          routes.push({
            path: pattern,
            type: ct.name,
            locale,
            urlPattern: ct.url_pattern,
            isDb: false,
            slugParam,
            isListingPrefix: false,
          });
        }
      }
    }

    return routes;
  })();

  return { routes, isLoading };
}

function Router() {
  const { routes: dynamicRoutes, isLoading: dynamicRoutesLoading } = useDynamicRoutes();

  return (
    <Suspense fallback={null}>
      <Switch>
        <Route path="/" component={TemplatePage} />
        <Route path="/en/" component={TemplatePage} />
        <Route path="/es/" component={TemplatePage} />
        <Route path="/en/career-programs/:slug">
          {(params) => <ContentTypeDetail type="program" slug={params.slug} locale="en" />}
        </Route>
        <Route path="/es/programas-de-carrera/:slug">
          {(params) => <ContentTypeDetail type="program" slug={params.slug} locale="es" />}
        </Route>
        <Route path="/en/location/:slug">
          {(params) => <ContentTypeDetail type="location" slug={params.slug} locale="en" />}
        </Route>
        <Route path="/es/ubicacion/:slug">
          {(params) => <ContentTypeDetail type="location" slug={params.slug} locale="es" />}
        </Route>
        <Route path="/en/blog">
          {() => <TemplatePage />}
        </Route>
        <Route path="/es/blog">
          {() => <TemplatePage />}
        </Route>
        <Route path="/en/blog/*">
          {() => <DatabaseSinglePage contentType="blog" />}
        </Route>
        <Route path="/es/blog/*">
          {() => <DatabaseSinglePage contentType="blog" />}
        </Route>
        {dynamicRoutes.map((r) => {
          if (r.isDb && r.isListingPrefix) {
            return (
              <Route key={`listing-${r.type}-${r.locale}`} path={r.path}>
                {() => <TemplatePage />}
              </Route>
            );
          }
          if (r.isDb) {
            return (
              <Route key={`db-${r.type}-${r.locale}`} path={r.path}>
                {() => <DatabaseSinglePage contentType={r.type} />}
              </Route>
            );
          }
          return (
            <Route key={`ct-${r.type}-${r.locale}`} path={r.path}>
              {(params) => (
                <ContentTypeDetail
                  type={r.type}
                  slug={params.slug || ""}
                  locale={r.locale}
                  urlPattern={r.urlPattern}
                />
              )}
            </Route>
          );
        })}
        <Route path="/preview-frame" component={PreviewFrame} />
        <Route path="/private/*" component={PrivateRouter} />
        <Route path="/en/:slug" component={TemplatePage} />
        <Route path="/es/:slug" component={TemplatePage} />
        <Route path="/:locale/programas-de-carrera/:slug">
          {(params) => /^[a-z]{2}-[a-z]{2}$/.test(params.locale || "") ? (
            <ContentTypeDetail type="program" slug={params.slug || ""} locale={params.locale || ""} />
          ) : <NotFound />}
        </Route>
        <Route path="/:locale/career-programs/:slug">
          {(params) => /^[a-z]{2}-[a-z]{2}$/.test(params.locale || "") ? (
            <ContentTypeDetail type="program" slug={params.slug || ""} locale={params.locale || ""} />
          ) : <NotFound />}
        </Route>
        <Route path="/:locale/:slug">
          {(params) => /^[a-z]{2}-[a-z]{2}$/.test(params.locale || "") ? (
            <TemplatePage />
          ) : <NotFound />}
        </Route>
        {dynamicRoutesLoading ? (
          <Route>{() => <LoadingFallback />}</Route>
        ) : (
          <Route component={NotFound} />
        )}
      </Switch>
    </Suspense>
  );
}

function PageTracker() {
  usePageTracking();
  return null;
}

function ClientOnly({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return <>{children}</>;
}

interface AppProps {
  ssrQueryClient?: QueryClient;
}

function App({ ssrQueryClient }: AppProps = {}) {
  const client = ssrQueryClient || defaultQueryClient;

  // Safety-net: Radix UI sometimes leaves pointer-events:none on document.body
  // after a dialog closes (race between close animation and react-remove-scroll
  // cleanup). The primary fix is in dialog.tsx's onCloseAutoFocus, but this
  // MutationObserver catches any remaining edge-cases (e.g. programmatic closes
  // where onCloseAutoFocus never fires).
  useEffect(() => {
    const observer = new MutationObserver(() => {
      if (document.body.style.pointerEvents === "none") {
        const hasOpenDialog = document.querySelector(
          '[role="dialog"][data-state="open"]'
        );
        if (!hasOpenDialog) {
          document.body.style.removeProperty("pointer-events");
        }
      }
    });
    observer.observe(document.body, { attributes: true, attributeFilter: ["style"] });
    return () => observer.disconnect();
  }, []);

  return (
    <QueryClientProvider client={client}>
      <SessionProvider>
        <DebugAuthProvider>
        <DeferredTooltipProvider>
          <EditModeWrapper>
            <ImagePickerProvider>
            <PageTracker />
            <Router />
            <ClientOnly>
              <Toaster />
              <Suspense fallback={null}><ChatWidget /></Suspense>
              <DebugBubbleGate />
              <Suspense fallback={null}><VariableModalHost /></Suspense>
              <Suspense fallback={null}><OverlayRuntime /></Suspense>
            </ClientOnly>
            </ImagePickerProvider>
          </EditModeWrapper>
        </DeferredTooltipProvider>
        </DebugAuthProvider>
      </SessionProvider>
    </QueryClientProvider>
  );
}

export default App;
