/**
 * Unified Icon System (public runtime)
 *
 * Resolves icons for section YAML and shared UI:
 * 1. Custom icons (@/components/custom-icons) — lazy per-icon
 * 2. Lucide — curated per-icon dynamic imports (build-generated map)
 * 3. Fallback — full lucide-react/dynamicIconImports lazy-loaded only on miss
 *
 * Usage:
 *   import { getIcon } from "@/lib/icons";
 *   const Icon = getIcon("Rigobot");       // custom
 *   const Icon = getIcon("brain");         // Lucide kebab slug
 *   const Icon = getIcon("IconRocket");    // legacy Tabler-prefixed YAML
 *
 * Full picker catalog (all Lucide slugs): @/lib/icons-picker — editor only.
 * Tech stack logos (Python, React, …): @/lib/tech-brand-icons — not getIcon().
 */
import { createElement, useEffect, useState, type ComponentType } from "react";
import {
  loadCustomIcon,
  getCachedCustomIcon,
} from "@/components/custom-icons";
import { curatedLucideImports } from "@/lib/lucide-curated-map";
import {
  CUSTOM_ICON_NAMES,
  CURATED_LUCIDE_ICONS,
  TABLER_ICON_NAMES,
  normalizeIconNameForLoad,
  kebabToPascal,
  pascalToKebab,
} from "@/lib/icon-names";

export {
  CUSTOM_ICON_NAMES,
  CURATED_LUCIDE_ICONS,
  TABLER_ICON_NAMES,
  normalizeIconNameForLoad,
  kebabToPascal,
  pascalToKebab,
};

export type IconComponent = ComponentType<{
  className?: string;
  size?: number | string;
  width?: string;
  height?: string;
  color?: string;
  style?: React.CSSProperties;
}>;

const lucideComponentCache = new Map<string, IconComponent>();
const lucideWrapperCache = new Map<string, IconComponent>();
const customWrapperCache = new Map<string, IconComponent>();

type DynamicIconLoader = () => Promise<{ default: IconComponent }>;

/** Lazy-loaded full catalog — only fetched when a curated-map miss occurs. */
let fullCatalogPromise: Promise<Record<string, DynamicIconLoader>> | null = null;

async function getFullCatalog(): Promise<Record<string, DynamicIconLoader>> {
  if (!fullCatalogPromise) {
    fullCatalogPromise = import("lucide-react/dynamicIconImports.js").then(
      (m) => m.default as Record<string, DynamicIconLoader>,
    );
  }
  return fullCatalogPromise;
}

/** Load one Lucide icon by PascalCase export name; results are cached. */
export async function loadLucideIcon(
  pascalName: string,
): Promise<IconComponent | null> {
  if (!pascalName) return null;

  const cached = lucideComponentCache.get(pascalName);
  if (cached) return cached;

  const slug = pascalToKebab(pascalName);
  const curated = curatedLucideImports[slug];
  if (curated) {
    const mod = await curated();
    if (!mod.default) return null;
    lucideComponentCache.set(pascalName, mod.default);
    return mod.default;
  }

  // Runtime safety net for icons added via content sync between deploys.
  try {
    const catalog = await getFullCatalog();
    const loader = catalog[slug];
    if (!loader) return null;
    const mod = await loader();
    if (!mod.default) return null;
    lucideComponentCache.set(pascalName, mod.default);
    return mod.default;
  } catch {
    return null;
  }
}

/** Placeholder component that async-loads Lucide when not yet in cache. */
function createLucideIconWrapper(pascalName: string): IconComponent {
  const Wrapped: IconComponent = (props) => {
    const [Icon, setIcon] = useState<IconComponent | null>(
      () => lucideComponentCache.get(pascalName) ?? null,
    );

    useEffect(() => {
      if (Icon) return;
      let cancelled = false;
      void loadLucideIcon(pascalName).then((loaded) => {
        if (!cancelled && loaded) setIcon(() => loaded);
      });
      return () => {
        cancelled = true;
      };
    }, [Icon, pascalName]);

    if (!Icon) return null;
    return createElement(Icon, props);
  };
  Wrapped.displayName = `LucideIcon(${pascalName})`;
  return Wrapped;
}

function getLucideIconComponent(pascalName: string): IconComponent | null {
  const cached = lucideComponentCache.get(pascalName);
  if (cached) return cached;

  let wrapper = lucideWrapperCache.get(pascalName);
  if (!wrapper) {
    wrapper = createLucideIconWrapper(pascalName);
    lucideWrapperCache.set(pascalName, wrapper);
  }
  return wrapper;
}

function createCustomIconWrapper(name: string): IconComponent {
  const Wrapped: IconComponent = (props) => {
    const [Icon, setIcon] = useState<IconComponent | null>(
      () => getCachedCustomIcon(name) as IconComponent | null,
    );

    useEffect(() => {
      if (Icon) return;
      let cancelled = false;
      void loadCustomIcon(name).then((loaded) => {
        if (!cancelled && loaded) setIcon(() => loaded as IconComponent);
      });
      return () => {
        cancelled = true;
      };
    }, [Icon, name]);

    if (!Icon) return null;
    return createElement(Icon, props);
  };
  Wrapped.displayName = `CustomIcon(${name})`;
  return Wrapped;
}

function getCustomIconComponent(name: string): IconComponent | null {
  const cached = getCachedCustomIcon(name);
  if (cached) return cached as IconComponent;

  // Known custom names get a lazy wrapper; unknown names return null.
  if (!(CUSTOM_ICON_NAMES as readonly string[]).includes(name) && name !== "CustomTarget") {
    // Still try loaders that exist under aliases (BrandSlack → Slack, etc.)
  }

  let wrapper = customWrapperCache.get(name);
  if (!wrapper) {
    wrapper = createCustomIconWrapper(name);
    customWrapperCache.set(name, wrapper);
  }
  return wrapper;
}

/**
 * Get an icon component by name. Custom icons first, then Lucide (cached or wrapper).
 *
 * @param name Icon name from YAML (e.g. Rigobot, brain, Rocket, IconRocket)
 */
export function getIcon(name: string): IconComponent | null {
  if (!name) return null;

  const { normalized, isCustom } = normalizeIconNameForLoad(name);

  if (isCustom) {
    // Map "Target" YAML name to CustomTarget component when present.
    const customName = normalized === "Target" ? "CustomTarget" : normalized;
    const customIcon = getCustomIconComponent(customName);
    if (customIcon) return customIcon;
    // Fall through to Lucide Target if custom missing
  }

  const lucideIcon = getLucideIconComponent(normalized);
  if (lucideIcon) return lucideIcon;

  // Last chance: try original name as custom (e.g. BrandSlack)
  const fallbackCustom = getCustomIconComponent(name);
  if (fallbackCustom) return fallbackCustom;

  return null;
}

/** Whether the name refers to a curated custom icon (PascalCase registry). */
export function isCustomIcon(name: string): boolean {
  const capitalizedName = name.charAt(0).toUpperCase() + name.slice(1);
  return (CUSTOM_ICON_NAMES as readonly string[]).includes(capitalizedName);
}

/** True when the name is a curated Lucide slug (kebab-case), not a custom icon. */
export function isCuratedLucideIcon(name: string): boolean {
  return (CURATED_LUCIDE_ICONS as readonly string[]).includes(name);
}
