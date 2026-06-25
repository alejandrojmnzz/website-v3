---
name: Multi-site subdomain routing
description: How per-site ContentIndex instances are built, resolved, and used for subdomain-based content routing.
---

## Rule
When `sites.yml` exists at repo root, one `ContentIndex` per domain is created and stored in `SiteContext`. `siteResolutionMiddleware` sets `res.locals.site` on every request. Single-site fallback uses `process.env.CONTENT_FOLDER` env var — in this deployment `CONTENT_FOLDER=marketing-content` so the content lives in `marketing-content/`. Never change this default without verifying the env var.

**Why:** Allows one deployment to serve multiple sites differentiated by subdomain without code duplication. Content folders are fully isolated — each `ContentIndex` only scans its own `contentRoot`.

**How to apply:**
- Route handlers use `getContentRoot(res)` → `(res.locals.site as any)?.contentRoot ?? path.join(process.cwd(), process.env.CONTENT_FOLDER || "marketing-content")`.
- ContentIndex helpers use `getCI(res)` → `(res.locals.site as any)?.contentIndex ?? contentIndex`.
- Service-layer modules (no `res` context) use `process.env.CONTENT_FOLDER || "marketing-content"` as path fallback.
- Static images served dynamically via cached `express.static` handlers in `_imageHandlers` Map keyed by `contentRootName`.
- Webhook handler matches inbound pushes to a site by comparing repository URL against each site's `config.githubRepoUrl`, filtering files by `contentRootName`.
- Navigation manifest functions (`readNavigationEagerManifest`, `regenerateNavigationEagerManifest`) both accept `contentRoot` param so each site gets its own file.
- To test a specific site in dev without DNS, append `?__site=app.example.com` to any URL.
- `getSiteContextMap()` returns the lazily-built `Map<domain, SiteContext>`; safe to call at request time.
