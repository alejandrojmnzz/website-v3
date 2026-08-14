export type PreviewDeviceId =
  | "iphone-se"
  | "iphone-16"
  | "iphone-16-pro-max"
  | "pixel-8"
  | "ipad-mini"
  | "ipad-pro-11";

export type PreviewDeviceGroup = "phone" | "tablet";

export type PreviewDevice = {
  id: PreviewDeviceId;
  label: string;
  width: number;
  height: number;
  group: PreviewDeviceGroup;
};

export const DEFAULT_PREVIEW_DEVICE_ID: PreviewDeviceId = "iphone-se";

export const PREVIEW_DEVICE_KEY = "4geeks_preview_device";
export const PREVIEW_BREAKPOINT_KEY = "4geeks_preview_breakpoint";

/** Drop stored device chrome so Read / Desktop do not keep a phone selected. */
export function clearStoredPreviewSelection(): void {
  if (typeof localStorage === "undefined") return;
  localStorage.removeItem(PREVIEW_BREAKPOINT_KEY);
  localStorage.removeItem(PREVIEW_DEVICE_KEY);
}

export function persistPreviewSelection(
  breakpoint: "desktop" | "mobile",
  deviceId: PreviewDeviceId,
): void {
  if (typeof localStorage === "undefined") return;
  if (breakpoint === "desktop") {
    clearStoredPreviewSelection();
    return;
  }
  localStorage.setItem(PREVIEW_BREAKPOINT_KEY, breakpoint);
  localStorage.setItem(PREVIEW_DEVICE_KEY, deviceId);
}

/** CSS-pixel viewports (same numbers Chrome DevTools uses). */
export const PREVIEW_DEVICES: PreviewDevice[] = [
  { id: "iphone-se", label: "iPhone SE", width: 375, height: 667, group: "phone" },
  { id: "iphone-16", label: "iPhone 16", width: 393, height: 852, group: "phone" },
  { id: "iphone-16-pro-max", label: "iPhone 16 Pro Max", width: 440, height: 956, group: "phone" },
  { id: "pixel-8", label: "Pixel 8", width: 412, height: 915, group: "phone" },
  { id: "ipad-mini", label: "iPad Mini", width: 768, height: 1024, group: "tablet" },
  { id: "ipad-pro-11", label: "iPad Pro 11\"", width: 834, height: 1194, group: "tablet" },
];

export const PREVIEW_PHONES = PREVIEW_DEVICES.filter((d) => d.group === "phone");
export const PREVIEW_TABLETS = PREVIEW_DEVICES.filter((d) => d.group === "tablet");

export function isPreviewDeviceId(id: string | null | undefined): id is PreviewDeviceId {
  return PREVIEW_DEVICES.some((d) => d.id === id);
}

export function getPreviewDevice(id: string | null | undefined): PreviewDevice {
  return PREVIEW_DEVICES.find((d) => d.id === id)
    ?? PREVIEW_DEVICES.find((d) => d.id === DEFAULT_PREVIEW_DEVICE_ID)!;
}

/** Map the legacy `4geeks_preview_breakpoint=mobile` value to a device id. */
export function migrateLegacyPreviewDevice(storedDevice: string | null, storedBreakpoint: string | null): PreviewDeviceId {
  if (isPreviewDeviceId(storedDevice)) return storedDevice;
  if (storedBreakpoint === "mobile") return DEFAULT_PREVIEW_DEVICE_ID;
  return DEFAULT_PREVIEW_DEVICE_ID;
}

/** Inner iframe of device preview — same private preview URL, read mode. */
export function isDeviceEmbedPreview(): boolean {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("device_embed") === "1";
}

/** Same-page hashes and inline section modals; everything else leaves the embed page. */
export function shouldAllowDeviceEmbedHref(href: string): boolean {
  return href.startsWith("#") || href.startsWith("inline#");
}

export const DEVICE_EMBED_NAV_BLOCKED = "device-embed-nav-blocked";

/** Tell the staff shell a link was blocked so it can offer switching to desktop. */
export function notifyDeviceEmbedNavBlocked(): void {
  if (typeof window === "undefined" || window.parent === window) return;
  window.parent.postMessage({ type: DEVICE_EMBED_NAV_BLOCKED }, window.location.origin);
}

/** Current private-preview path + query, with embed flags for the phone iframe. */
export function buildDeviceEmbedSrc(pathname?: string, search?: string): string {
  const path = pathname ?? (typeof window !== "undefined" ? window.location.pathname : "/");
  const params = new URLSearchParams(
    search ?? (typeof window !== "undefined" ? window.location.search : ""),
  );
  params.set("device_embed", "1");
  params.set("hide_debug", "true");
  return `${path}?${params.toString()}`;
}
