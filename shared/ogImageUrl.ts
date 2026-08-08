/**
 * Whether an og_image value can be used as a browser/crawler image URL.
 *
 * Accepts absolute http(s) URLs and locally served paths
 * (`/attached_assets/...`, `/<contentRoot>/images/...`).
 * Rejects empty values, template placeholders, and legacy `/images/...`
 * paths that this app does not serve.
 */
export function isUsableOgImageUrl(value: string | null | undefined): boolean {
  const url = (value ?? "").trim();
  if (!url || /\{\{/.test(url)) return false;
  if (/^https?:\/\//i.test(url)) return true;
  if (url.startsWith("/attached_assets/")) return true;
  // Per-site local images: /site_4geeks-com/images/...
  if (/^\/[^/]+\/images\//.test(url)) return true;
  return false;
}
