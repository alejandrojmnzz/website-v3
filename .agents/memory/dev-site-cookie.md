---
name: Dev-site override must use server-side cookie
description: Why the __dev_site dev override sets cookies via a server endpoint and must never use document.cookie writes or localStorage.
---

## The rule
`getDevSiteOverride()` reads `document.cookie.__dev_site` (client-readable because the cookie is httpOnly:false).
`setDevSiteOverride()` and `clearDevSiteOverride()` call server endpoints (`/api/dev/set-site` and `/api/dev/clear-site`) which respond with `Set-Cookie` headers.
`document.cookie` writes must not be used. localStorage must not be used.

## Server endpoints (dev-only, non-production)
- `GET /api/dev/set-site?domain=X` — responds with `Set-Cookie: __dev_site=X; Path=/; SameSite=Lax; httpOnly:false`
- `GET /api/dev/clear-site` — responds with a cookie-clearing header

Both registered in `server/routes/index.ts` inside `if (process.env.NODE_ENV !== "production")`.

**Why server-side Set-Cookie instead of document.cookie:**
The Replit workspace preview pane is an iframe embedded in `replit.com`. Modern browsers (Chrome, Safari, Firefox) block or restrict `document.cookie` writes from pages embedded in cross-origin iframes (third-party cookie restrictions). The write appears to succeed silently but the cookie is never actually stored, so the server never receives it. Server-side `Set-Cookie` response headers bypass these restrictions because the cookie is set by the same origin that serves the requests.

**Why not localStorage:**
The server reads `req.cookies.__dev_site` in `siteResolutionMiddleware` (server/site-manager.ts) on EVERY request, including the initial HTML GET that produces SSR output. Only a cookie is sent automatically with HTTP requests — localStorage is invisible to the server. If localStorage is used, the server always SSR's the default site regardless of the override, causing a visible flash of wrong content on every page load.

**Historical regressions:**
1. Commit 20a8d9ee replaced original cookie-based implementation (Task #820, commit 75c54dbf) with localStorage + `?__site=` query injection → caused SSR flash, required full session to diagnose and fix.
2. After restoring cookie-based approach, `document.cookie` writes failed silently in Replit iframe environment → server never saw the new cookie → switching appeared broken. Fixed by moving writes to server-side Set-Cookie headers.

**How to apply:**
- Any future change to dev-site override storage must keep server endpoints as the write mechanism
- Verify `server/site-manager.ts` still reads `req.cookies.__dev_site`
- Verify the endpoints remain registered in the non-production guard
- Test by switching to a non-default site and doing a hard refresh — SSR must show the correct site's content immediately with no flash of the default site
