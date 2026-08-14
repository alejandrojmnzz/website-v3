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
