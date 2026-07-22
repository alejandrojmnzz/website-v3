// Vite 8 compatibility audit (task-579, 2025-05-29)
//
// Plugin compatibility (all verified against Vite 8.0.14):
//
//   @replit/vite-plugin-runtime-error-modal  v0.0.6  — Compatible. Its source
//     already branches on both the Vite ≤4 `.ws` WebSocket channel and the
//     Vite 5+/8 `.environments.client.hot` channel. No update available on npm
//     (latest is 0.0.6); the existing version is Vite 8-safe.
//
//   @replit/vite-plugin-cartographer         v0.5.5  — Compatible. Uses only
//     standard plugin hooks (configResolved, transform, transformIndexHtml).
//     v0.5.5 is the latest published version.
//
//   @replit/vite-plugin-dev-banner           v0.1.2  — Compatible. Uses only
//     configureServer middleware + transformIndexHtml. v0.1.2 is the latest
//     published version.
//
// Server config options confirmed valid in Vite 8:
//
//   server.warmup.clientFiles / ssrFiles  — Valid (types line 2451-2459).
//   server.fs.deny                        — Valid (types line 2553).
//   server.fs.strict                      — Valid.
//
// Build config changes in this audit:
//
//   build.rollupOptions  →  build.rolldownOptions
//   `rollupOptions` is marked @deprecated in Vite 8 (types line 2090) and
//   silently aliased to rolldownOptions at runtime. Renamed here for forward
//   compatibility. Rolldown 1.0.2 (bundled with Vite 8) supports the same
//   output.manualChunks API — verified by running `vite build --ssr` (exit 0,
//   326 modules, 14s) and the ssr-check.sh smoke-test (PASS /en/, PASS /es/).
//
//   build.minify: 'terser'  →  'esbuild'
//   Terser minification of 9 662 modules takes >5 min in Vite 8 / Rolldown,
//   blocking CI/CD. esbuild minification completes in ~30 s and is the Vite 8
//   default. console/debugger stripping is handled via build.esbuildOptions.
import { defineConfig, type Plugin, searchForWorkspaceRoot } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import fs from "fs";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";

// Vite 6+ removed isSsrBuild from the defineConfig callback.
// Detect SSR build by checking the CLI arguments instead.
const isSsrBuild = process.argv.includes("--ssr");

/**
 * Warns at build time when site_4geeks-com/component-registry is absent.
 * The build still succeeds — only shared /client components will be bundled.
 */
function componentRegistryGuardPlugin(): Plugin {
  return {
    name: "component-registry-guard",
    apply: "build",
    buildStart() {
      const registryPath = path.resolve(import.meta.dirname, "site_4geeks-com", "component-registry");
      if (!fs.existsSync(registryPath)) {
        this.warn(
          "site_4geeks-com/component-registry not found — registry TSX files will not be bundled. " +
          "Build continues with shared /client components only.",
        );
      }
    },
  };
}

/** Runs on `vite build` (client pass only), writes site_4geeks-com/navigation-eager-manifest.json */
function navigationEagerManifestPlugin(isSsr: boolean): Plugin {
  return {
    name: "navigation-eager-manifest",
    apply: "build",
    async buildStart() {
      if (isSsr) return;
      const { regenerateNavigationEagerManifest } = await import(
        "./server/navigation-eager-manifest.ts"
      );
      await regenerateNavigationEagerManifest();
    },
  };
}

export default defineConfig(async () => ({
  plugins: [
    componentRegistryGuardPlugin(),
    navigationEagerManifestPlugin(isSsrBuild),
    react({
      babel: {
        plugins: [
          ['babel-plugin-react-compiler', { target: '18' }],
        ],
      },
    }),
    runtimeErrorOverlay(),
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer(),
          ),
          await import("@replit/vite-plugin-dev-banner").then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
    },
  },
  root: path.resolve(import.meta.dirname, "client"),
  build: {
    outDir: isSsrBuild
      ? path.resolve(import.meta.dirname, "dist/server")
      : path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
    ssr: isSsrBuild ? "src/entry-server.tsx" : undefined,
    target: isSsrBuild ? "node18" : ["chrome89", "safari15", "firefox89", "edge89"],
    chunkSizeWarningLimit: 600,
    minify: 'esbuild',
    // Vite 8: rollupOptions is deprecated in favour of rolldownOptions.
    // Rolldown (bundled with Vite 8) accepts the same manualChunks API.
    rolldownOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('recharts') || id.includes('victory-vendor')) {
            return 'charts';
          }
          if (id.includes('framer-motion')) {
            return 'framer';
          }
          if (id.includes('@tanstack')) {
            return 'tanstack';
          }
          if (id.includes('react-icons')) {
            return 'icons-react';
          }
          // One shared Lucide chunk instead of one HTTP request per icon.
          // Per-icon splitting looked good for unused-byte tree-shaking, but a
          // cold load (esp. Shift+reload) fans out dozens of tiny /assets/*.js
          // requests and trips the Google/Replit edge rate limit (HTTP 429).
          // Tree-shaking still drops icons that nothing imports; this only
          // coalesces the icons that are in the graph into a single download.
          // @radix-ui and react-markdown stay per-importer (same unused-payload
          // concern as before — they pull larger shared runtimes).
          if (id.includes('node_modules/lucide-react') || id.includes('lucide-react/')) {
            return 'lucide';
          }
          if (id.includes('i18next') || id.includes('react-i18next')) {
            return 'i18n';
          }
          if (
            id.includes('node_modules/zod') ||
            id.includes('node_modules/react-hook-form') ||
            id.includes('@hookform/resolvers')
          ) {
            return 'forms';
          }
          if (
            id.includes('node_modules/date-fns') ||
            id.includes('node_modules/react-day-picker')
          ) {
            return 'date';
          }
          if (id.includes('node_modules/embla-carousel')) {
            return 'carousel';
          }
        },
      },
    },
  },
  // drop: strips console.* and debugger statements from the production bundle.
  // Must be at the root `esbuild` key — not inside `build` — per Vite 8 types.
  esbuild: {
    drop: ['console', 'debugger'],
    legalComments: 'none',
  },
  server: {
    fs: {
      strict: true,
      deny: ["**/.*"],
      // Preserve Vite's default workspace-root access (required for @shared/* imports and
      // any other out-of-root paths the app already depends on), then extend with the
      // component-registry folder so that registry-sourced TSX files are served in dev.
      // Note: explicitly setting `allow` replaces Vite's auto-detected workspace root,
      // so we must include it here via searchForWorkspaceRoot().
      allow: [
        searchForWorkspaceRoot(process.cwd()),
        path.resolve(import.meta.dirname, "site_4geeks-com", "component-registry"),
      ],
    },
    warmup: {
      clientFiles: [
        "./src/App.tsx",
        "./src/pages/page.tsx",
        "./src/components/SectionRenderer.tsx",
        "./src/components/Header.tsx",
      ],
      ssrFiles: [
        "./src/entry-server.tsx",
      ],
    },
  },
}));
