import type { ComponentType } from "react";

type CustomIconComponent = ComponentType<{
  width?: string;
  height?: string;
  color?: string;
  style?: React.CSSProperties;
  className?: string;
}>;

type CustomIconLoader = () => Promise<{ default: CustomIconComponent }>;

/**
 * Per-icon dynamic imports so public pages only download icons they render.
 * Import individual files (e.g. `@/components/custom-icons/Matplotlib`) for
 * static named usage — do not re-export them from this barrel.
 */
const customIconLoaders: Record<string, CustomIconLoader> = {
  Briefcase: () => import("./Briefcase"),
  ChecklistVerify: () => import("./ChecklistVerify"),
  CodeWindow: () => import("./CodeWindow"),
  Contract: () => import("./Contract"),
  FolderCheck: () => import("./FolderCheck"),
  "4GeeksAvatar": () => import("./FourGeeksAvatar"),
  Graduation: () => import("./Graduation"),
  GrowthChart: () => import("./GrowthChart"),
  HandsGroup: () => import("./HandsGroup"),
  Handshake: () => import("./Handshake"),
  Interview: () => import("./Interview"),
  JobSearch: () => import("./JobSearch"),
  Matplotlib: () => import("./Matplotlib"),
  Mentor2: () => import("./Mentor2"),
  Monitor: () => import("./Monitor"),
  Optimization: () => import("./Optimization"),
  PeopleGroup: () => import("./PeopleGroup"),
  Rigobot: () => import("./Rigobot"),
  RigobotIconTiny: () => import("./RigobotIconTiny"),
  Rocket: () => import("./Rocket"),
  Security: () => import("./Security"),
  Slack: () => import("./Slack"),
  BrandSlack: () => import("./Slack"),
  StairsWithFlag: () => import("./StairsWithFlag"),
  CustomTarget: () => import("./CustomTarget"),
  Target: () => import("./CustomTarget"),
};

const customIconCache = new Map<string, CustomIconComponent>();

export function getCachedCustomIcon(name: string): CustomIconComponent | null {
  return customIconCache.get(name) ?? null;
}

export async function loadCustomIcon(
  name: string,
): Promise<CustomIconComponent | null> {
  if (!name) return null;
  const cached = customIconCache.get(name);
  if (cached) return cached;
  const loader = customIconLoaders[name];
  if (!loader) return null;
  const mod = await loader();
  if (!mod.default) return null;
  customIconCache.set(name, mod.default);
  if (name === "BrandSlack") customIconCache.set("Slack", mod.default);
  if (name === "Slack") customIconCache.set("BrandSlack", mod.default);
  if (name === "Target") customIconCache.set("CustomTarget", mod.default);
  if (name === "CustomTarget") customIconCache.set("Target", mod.default);
  return mod.default;
}

/** Sync lookup — only returns icons already loaded into cache. Prefer getIcon(). */
export function getCustomIcon(name: string): CustomIconComponent | null {
  return getCachedCustomIcon(name);
}
