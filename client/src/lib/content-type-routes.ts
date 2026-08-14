import type { ContentTypeApiItem } from "@/hooks/useContentTypes";

export const REGIONAL_LOCALE_RE = /^[a-z]{2}-[a-z]{2}$/;

export type ContentRouteKind = "template" | "database-single" | "content-type-detail";

export interface ContentTypeRoute {
  path: string;
  type: string;
  locale: string;
  urlPattern: Record<string, string>;
  kind: ContentRouteKind;
  isListingPrefix: boolean;
  regional: boolean;
}

export type ContentTypeRouteInput = Pick<
  ContentTypeApiItem,
  "name" | "url_pattern" | "has_database" | "single_template"
>;

function routeKind(ct: ContentTypeRouteInput): ContentRouteKind {
  if (ct.name === "page") return "template";
  if (ct.has_database || ct.single_template) return "database-single";
  return "content-type-detail";
}

function wouterPath(pattern: string, splatSlug: boolean): string {
  if (splatSlug) return pattern.replace(":slug", "*");
  return pattern;
}

function listingPrefix(pattern: string): string | null {
  const prefix = pattern.replace(/\/:[^/]+.*$/, "");
  if (!prefix || prefix === pattern) return null;
  return prefix;
}

/** `/en/foo/:slug` → `/:locale/foo/:slug`. Null if the pattern is not locale-prefixed. */
export function regionalAlias(pattern: string): string | null {
  const m = pattern.match(/^\/(en|es)(\/.*)$/);
  if (!m?.[2]) return null;
  return `/:locale${m[2]}`;
}

function pathScore(path: string): { staticSegs: number; segs: number } {
  const segs = path.split("/").filter(Boolean);
  return {
    segs: segs.length,
    staticSegs: segs.filter((s) => !s.startsWith(":")).length,
  };
}

function sortContentTypeRoutes(routes: ContentTypeRoute[]): ContentTypeRoute[] {
  return [...routes].sort((a, b) => {
    const aPage = a.type === "page" ? 1 : 0;
    const bPage = b.type === "page" ? 1 : 0;
    if (aPage !== bPage) return aPage - bPage;
    const as = pathScore(a.path);
    const bs = pathScore(b.path);
    if (bs.staticSegs !== as.staticSegs) return bs.staticSegs - as.staticSegs;
    if (bs.segs !== as.segs) return bs.segs - as.segs;
    return a.path.localeCompare(b.path);
  });
}

function pushRoute(
  routes: ContentTypeRoute[],
  seen: Set<string>,
  route: ContentTypeRoute,
): void {
  const key = `${route.path}\0${route.type}\0${route.kind}\0${route.isListingPrefix}\0${route.regional}`;
  if (seen.has(key)) return;
  seen.add(key);
  routes.push(route);
}

export function buildContentTypeRoutes(
  contentTypes: ContentTypeRouteInput[] | null | undefined,
): ContentTypeRoute[] {
  if (!contentTypes?.length) return [];

  const routes: ContentTypeRoute[] = [];
  const seen = new Set<string>();

  for (const ct of contentTypes) {
    if (!ct.url_pattern) continue;
    const kind = routeKind(ct);

    for (const [locale, pattern] of Object.entries(ct.url_pattern)) {
      if (!pattern) continue;

      const splatSlug = ct.has_database && kind !== "template";

      if (splatSlug) {
        const prefix = listingPrefix(pattern);
        if (prefix) {
          pushRoute(routes, seen, {
            path: prefix,
            type: ct.name,
            locale,
            urlPattern: ct.url_pattern,
            kind: "template",
            isListingPrefix: true,
            regional: false,
          });
          const regionalPrefix = regionalAlias(prefix);
          if (regionalPrefix) {
            pushRoute(routes, seen, {
              path: regionalPrefix,
              type: ct.name,
              locale: "regional",
              urlPattern: ct.url_pattern,
              kind: "template",
              isListingPrefix: true,
              regional: true,
            });
          }
        }
      }

      pushRoute(routes, seen, {
        path: wouterPath(pattern, splatSlug),
        type: ct.name,
        locale,
        urlPattern: ct.url_pattern,
        kind,
        isListingPrefix: false,
        regional: false,
      });

      const alias = regionalAlias(pattern);
      if (alias) {
        pushRoute(routes, seen, {
          path: wouterPath(alias, splatSlug),
          type: ct.name,
          locale: "regional",
          urlPattern: ct.url_pattern,
          kind,
          isListingPrefix: false,
          regional: true,
        });
      }
    }
  }

  return sortContentTypeRoutes(routes);
}

function patternToRegex(pattern: string): RegExp {
  const body = pattern
    .split("/")
    .map((seg) => {
      if (!seg) return "";
      if (seg === "*") return ".+";
      if (seg.startsWith(":")) return "[^/]+";
      return seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    })
    .join("/");
  return new RegExp(`^${body}/?$`);
}

export function matchContentTypeRoute(
  pathname: string,
  routes: ContentTypeRoute[],
): ContentTypeRoute | null {
  const path = pathname.length > 1 ? pathname.replace(/\/$/, "") : pathname;
  for (const route of routes) {
    if (!patternToRegex(route.path).test(path)) continue;
    if (route.regional) {
      const locale = path.split("/").filter(Boolean)[0] ?? "";
      if (!REGIONAL_LOCALE_RE.test(locale)) continue;
    }
    return route;
  }
  return null;
}

/** Which lazy page chunk to preload for a public URL. */
export function inferPublicPageChunk(
  pathname: string,
  contentTypes?: ContentTypeRouteInput[] | null,
): ContentRouteKind {
  const match = matchContentTypeRoute(pathname, buildContentTypeRoutes(contentTypes));
  return match?.kind ?? "template";
}
