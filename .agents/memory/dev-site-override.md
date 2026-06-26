---
name: Dev-site override architecture
description: How site switching works in dev mode — file-based server truth + localStorage client mirror. Cookies are blocked in Replit's cross-origin iframe environment.
---

# Dev-site override: file-based approach

## The rule
Never use cookies for the dev-site override. Use `.local/dev-site-override` (server) + `localStorage.__dev_site` (client) written atomically together.

**Why:** Replit's workspace embeds the app at `worf.replit.dev` inside `replit.com`. Modern browsers block all cookies (both `document.cookie` writes and `Set-Cookie` response headers) for cross-origin iframes — this applies to `SameSite=Lax` AND `SameSite=None; Secure`. No cookie attribute makes cookies reliable in this context.

## How to apply

**Server (`server/site-manager.ts`):**
- `readDevSiteFile()` — reads `.local/dev-site-override` synchronously; returns null if absent
- `writeDevSiteFile(domain)` — writes the file (creates `.local/` dir if needed)
- `clearDevSiteFile()` — deletes the file
- `siteResolutionMiddleware` reads the file as first priority (non-production only); falls back to `req.hostname`

**Server endpoints (`server/routes/index.ts`, non-production only):**
- `GET /api/dev/set-site?domain=X` → calls `writeDevSiteFile(domain)`, returns `{ok:true, domain}`
- `GET /api/dev/clear-site` → calls `clearDevSiteFile()`, returns `{ok:true}`

**Client (`client/src/lib/devSite.ts`):**
- `getDevSiteOverride()` → `localStorage.getItem("__dev_site")` (returns null in production)
- `setDevSiteOverride(domain)` → localStorage write + `await fetch("/api/dev/set-site?domain=X")`
- `clearDevSiteOverride()` → localStorage remove + `await fetch("/api/dev/clear-site")`
- `injectDevSite(url)` → appends `?__site=domain` to every API call via `queryClient.ts`

**Write sequence (always atomic before reload):**
1. `localStorage.setItem(...)` — synchronous
2. `await fetch("/api/dev/set-site?domain=X")` — server writes file
3. `window.location.reload()` — only after both complete

**In production:** `siteResolutionMiddleware` skips the file check entirely; `req.hostname` is the only source.
