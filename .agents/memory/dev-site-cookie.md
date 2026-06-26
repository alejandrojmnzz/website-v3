---
name: Dev-site override must use cookie
description: Why the __dev_site dev override uses a cookie and must never be changed to localStorage or any other client-only storage.
---

## The rule
`getDevSiteOverride()` reads `document.cookie.__dev_site`.
`setDevSiteOverride()` and `clearDevSiteOverride()` write/clear the cookie only.
localStorage must never be used for this value.

**Why:** The server reads `req.cookies.__dev_site` in `siteResolutionMiddleware`
(server/site-manager.ts) on every request, including the initial HTML GET that
produces SSR output. Only a cookie is sent automatically with HTTP requests —
localStorage is invisible to the server. If localStorage is used, the server
always SSR's the default site regardless of the override, causing a visible flash
of wrong content on every page load.

**Historical regression to avoid repeating:** Commit 20a8d9ee replaced the
original cookie-based implementation (Task #820, commit 75c54dbf) with
localStorage + `?__site=` query injection. This caused exactly the SSR flash
described above and required a full session to diagnose and fix.

**How to apply:** Any future change to dev-site override storage must:
1. Keep the cookie as the read/write mechanism in `client/src/lib/devSite.ts`
2. Verify `server/site-manager.ts` still reads `req.cookies.__dev_site`
3. Test by switching to a non-default site and doing a hard refresh — SSR must
   show the correct site's content immediately with no flash of the default site.
