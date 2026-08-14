import { normalizeLocale } from "@/lib/locale";

/** Public content pages and `/private/preview/*` can use Edit/Read + device chrome. Admin `/private/*` cannot. */
export function isVisualEditPath(pathname: string): boolean {
  const isPrivate =
    pathname === "/private" || pathname.startsWith("/private/");
  if (!isPrivate) return true;
  return isPrivatePreviewPath(pathname);
}

export function isPrivatePreviewPath(pathname: string): boolean {
  return pathname === "/private/preview" || pathname.startsWith("/private/preview/");
}

/** Staff preview URL for a public content page. Returns null when already on `/private/preview`. */
export function buildPrivatePreviewHref(opts: {
  contentType: string;
  slug: string;
  pathname: string;
  search?: string;
  fallbackLocale?: string;
}): string | null {
  if (isPrivatePreviewPath(opts.pathname)) return null;

  const pathSeg = opts.pathname.split("/").filter(Boolean)[0];
  const hasPathLocale = !!pathSeg && /^[a-z]{2}$/.test(pathSeg);
  const params = new URLSearchParams(opts.search ?? "");
  const locale = normalizeLocale(
    hasPathLocale ? pathSeg : params.get("locale") || opts.fallbackLocale || "en",
  );
  const variant = params.get("variant") || params.get("force_variant");

  const qs = new URLSearchParams();
  qs.set("locale", locale);
  if (variant) qs.set("variant", variant);
  return `/private/preview/${opts.contentType}/${opts.slug}?${qs.toString()}`;
}
