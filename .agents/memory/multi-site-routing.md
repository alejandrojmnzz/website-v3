---
name: Multi-site subdomain routing
description: How per-site ContentIndex instances are built, resolved, and used for subdomain-based content routing.
---

## Rule
`sites.yml` at the repo root is **required**. One `ContentIndex` per domain is created and stored in `SiteContext`. `siteResolutionMiddleware` sets `res.locals.site` on every request. Deployments with a single site use the same pipeline — there is no separate single-site mode.

**Why:** One deployment can serve one or many sites differentiated by domain without code duplication. Content folders are fully isolated — each `ContentIndex` only scans its own `contentRoot`.

**How to apply:**
- Route handlers use `getContentRoot(res)` → `(res.locals.site as any)?.contentRoot ?? getDefaultContentRoot()`.
- ContentIndex helpers use `getCI(res)` → `(res.locals.site as any)?.contentIndex ?? contentIndex`.
- Service-layer modules (no `res` context) use `getDefaultContentFolder()` / `getDefaultSite()` from `sites.yml`.
- Static images served dynamically via cached `express.static` handlers in `_imageHandlers` Map keyed by `contentRootName`.
- Webhook handler matches inbound pushes to a site by comparing repository URL against each site's `config.githubRepoUrl`, filtering files by `contentRootName`.
- Navigation manifest functions (`readNavigationEagerManifest`, `regenerateNavigationEagerManifest`) both accept `contentRoot` param so each site gets its own file.
- To test a specific site in dev without DNS, append `?__site=app.example.com` to any URL.
- `getSiteContextMap()` returns the lazily-built `Map<domain, SiteContext>`; safe to call at request time.
- GitHub sync bootstrap/sync-log paths always use per-site `contentRoot` from `SiteContext`, even when only one site is configured.
