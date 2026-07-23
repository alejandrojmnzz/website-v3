import { hydrateRoot, createRoot } from "react-dom/client";
import App from "./App";
import {
  hydrateInitialData,
  clearSSRHydration,
  readInitialDataPayload,
} from "./lib/initialData";
import {
  preloadSectionsFromInitialData,
  prefetchRemainingSectionsFromInitialData,
} from "@/components/sectionRegistry";
import { injectDevSite, resumePendingDomainNavigation } from "./lib/devSite";

// ─── Global fetch interceptor ────────────────────────────────────────────────
// Injects ?__site=<domain> into every relative /api/ fetch call so that direct
// fetch() calls anywhere in the codebase (DebugBubble, edit-mode hooks, future
// code) automatically target the active dev-site without each call site needing
// an explicit injectDevSite() wrapper.
//
// Guards:
//   • Only active in dev builds (injectDevSite() is a no-op in production).
//   • Only applied to relative /api/ URLs to avoid touching external requests.
//   • Skips URLs that already carry __site= (no double-injection).
if (typeof window !== "undefined") {
  const _nativeFetch = window.fetch.bind(window);
  window.fetch = function patchedFetch(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    if (typeof input === "string" && input.startsWith("/api/")) {
      input = injectDevSite(input);
    } else if (input instanceof URL && input.pathname.startsWith("/api/")) {
      const injected = injectDevSite(input.toString());
      if (injected !== input.toString()) input = new URL(injected);
    }
    return _nativeFetch(input, init);
  };
}

const initialDataPayload = readInitialDataPayload();
hydrateInitialData();

if (typeof window !== "undefined") {
  void resumePendingDomainNavigation();
}

const rootEl = document.getElementById("root")!;

(async () => {
  if (rootEl.hasChildNodes()) {
    // Preload the lazy route chunk needed for the current URL before calling
    // hydrateRoot(). Without this, React's <Suspense fallback={null}> fires while
    // chunks load, blanking the entire page (the white-flash bug).
    //
    // Prefer a single page chunk (not all three public pages) so cold loads do
    // not fan out unused JS and trip edge rate limits. SSR __INITIAL_DATA__
    // query keys identify the route type; path heuristics cover the rest.
    // Heavy private chunks (PreviewFrame, PrivateRouter) remain lazy-only.
    // Normalize pathname: strip trailing slash (except root "/") for consistent matching.
    const rawPath = window.location.pathname;
    const path = rawPath.length > 1 ? rawPath.replace(/\/$/, "") : rawPath;

    // MAINTENANCE NOTE: When adding a new lazy() route in App.tsx, add a corresponding
    // preload branch here so the Suspense fallback doesn't blank the page on that route.
    //
    // NOTE: DebugBubble, ChatWidget, and VariableModalHost are intentionally excluded
    // from preloading. They are client-only (rendered inside <ClientOnly> which mounts
    // only after hydration) and therefore never participate in SSR or hydration. There
    // is no risk of a Suspense white-flash for these components — they simply appear
    // after the browser fetches their chunks post-hydration.
    let chunkLoads: Promise<unknown>[];

    /** Infer which public page component matches SSR initial data. */
    const pageChunkFromInitialData = (): Promise<unknown> | null => {
      const queries = initialDataPayload?.queries;
      if (!queries?.length) return null;
      for (const { queryKey } of queries) {
        if (!Array.isArray(queryKey) || queryKey.length === 0) continue;
        const key0 = queryKey[0];
        if (key0 === "/api/database-single") {
          return import("@/pages/DatabaseSinglePage");
        }
        if (key0 === "/api/pages" || key0 === "/api/blog/config") {
          return import("@/pages/page");
        }
        // ContentTypeDetail uses getApiPath() keys like "/api/programs", "/api/locations".
        if (
          typeof key0 === "string" &&
          key0.startsWith("/api/") &&
          key0 !== "/api/menus" &&
          key0 !== "/api/variables" &&
          key0 !== "/api/content-types" &&
          key0 !== "/api/image-registry" &&
          key0 !== "/api/settings/home-page" &&
          key0 !== "/api/blog/posts"
        ) {
          return import("@/pages/ContentTypeDetail");
        }
      }
      return null;
    };

    if (path === "/private" || path.startsWith("/private/")) {
      chunkLoads = [import("@/pages/PrivateRouter")];
    } else if (path === "/preview-frame") {
      chunkLoads = [import("@/pages/PreviewFrame")];
    } else if (
      path === "/terms-conditions" ||
      path === "/terminos-condiciones"
    ) {
      chunkLoads = [import("@/pages/TermsPage")];
    } else if (
      path === "/privacy-policy" ||
      path === "/politica-privacidad"
    ) {
      chunkLoads = [import("@/pages/PrivacyPage")];
    } else {
      const fromData = pageChunkFromInitialData();
      if (fromData) {
        chunkLoads = [fromData];
      } else if (
        /\/blog\//.test(path) ||
        /\/how-to\//.test(path) ||
        /\/lessons?\//.test(path)
      ) {
        // Common DB-backed URL shapes when initial data is missing (client nav).
        chunkLoads = [import("@/pages/DatabaseSinglePage")];
      } else if (
        /\/career-programs\//.test(path) ||
        /\/programas-de-carrera\//.test(path) ||
        /\/location\//.test(path) ||
        /\/ubicacion\//.test(path)
      ) {
        chunkLoads = [import("@/pages/ContentTypeDetail")];
      } else {
        // Template pages (home, listing, generic /:locale/:slug). Fallback to
        // TemplatePage only — dynamic routes hydrate after /api/content-types.
        chunkLoads = [import("@/pages/page")];
      }
    }

    // Await only eager/above-fold section chunks so hydrateRoot can start sooner.
    // Below-fold sections stay in the SSR HTML (DeferredSection keeps them visible
    // during data-ssr-hydrating) and their JS chunks idle-prefetch after hydrate.
    const sectionPreload = preloadSectionsFromInitialData(initialDataPayload, {
      eagerOnly: true,
    });

    // Gracefully handle preload failure — hydration still proceeds but may briefly
    // flash for that route. Better than blocking hydration globally.
    try {
      await Promise.all([...chunkLoads, sectionPreload]);
    } catch {
      // Chunk failed to load; proceed with hydrateRoot anyway.
    }

    hydrateRoot(rootEl, <App />);
    prefetchRemainingSectionsFromInitialData(initialDataPayload);

    requestAnimationFrame(() => {
      if (typeof requestIdleCallback !== "undefined") {
        requestIdleCallback(() => clearSSRHydration());
      } else {
        setTimeout(() => clearSSRHydration(), 200);
      }
    });
  } else {
    clearSSRHydration();
    createRoot(rootEl).render(<App />);
  }
})();
