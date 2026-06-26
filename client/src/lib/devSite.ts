const IS_DEV = import.meta.env.DEV;

export function getDevSiteOverride(): string | null {
  if (!IS_DEV) return null;
  try { return localStorage.getItem("__dev_site"); } catch { return null; }
}

export function setDevSiteOverride(domain: string): void {
  try { localStorage.setItem("__dev_site", domain); } catch {}
}

export function clearDevSiteOverride(): void {
  try { localStorage.removeItem("__dev_site"); } catch {}
}

export function injectDevSite(url: string): string {
  const site = getDevSiteOverride();
  if (!site) return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}__site=${encodeURIComponent(site)}`;
}
