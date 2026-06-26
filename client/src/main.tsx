import { hydrateRoot, createRoot } from "react-dom/client";
import App from "./App";
import {
  hydrateInitialData,
  clearSSRHydration,
  readInitialDataPayload,
} from "./lib/initialData";
import { preloadSectionsFromInitialData } from "@/components/sectionRegistry";

const initialDataPayload = readInitialDataPayload();
hydrateInitialData();

const rootEl = document.getElementById("root")!;

(async () => {
  if (rootEl.hasChildNodes()) {
    // Preload the lazy route chunk(s) needed for the current URL before calling
    // hydrateRoot(). Without this, React's <Suspense fallback={null}> fires while
    // chunks load, blanking the entire page (the white-flash bug).
    //
    // Strategy: specific admin/utility routes get a single targeted chunk; all
    // public/CMS-driven routes preload the three public page components together
    // (TemplatePage + ContentTypeDetail + DatabaseSinglePage). These three cover
    // every public route including dynamic CMS routes added via useDynamicRoutes().
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
      // All public/CMS routes (static and dynamic) use one of these three components.
      // Preload all three to cover every possible CMS-driven route without needing to
      // replicate the server's route-to-component mapping in this file.
      chunkLoads = [
        import("@/pages/page"),
        import("@/pages/ContentTypeDetail"),
        import("@/pages/DatabaseSinglePage"),
      ];
    }

    const sectionPreload = preloadSectionsFromInitialData(initialDataPayload);

    // Gracefully handle preload failure — hydration still proceeds but may briefly
    // flash for that route. Better than blocking hydration globally.
    try {
      await Promise.all([...chunkLoads, sectionPreload]);
    } catch {
      // Chunk failed to load; proceed with hydrateRoot anyway.
    }

    hydrateRoot(rootEl, <App />);

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
