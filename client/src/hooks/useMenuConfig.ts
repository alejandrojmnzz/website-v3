import { useQuery } from "@tanstack/react-query";
import type { NavbarConfig } from "@/components/menus";

interface MenuResponse {
  name: string;
  data: NavbarConfig;
}

interface MenuLayout {
  menu?: {
    top?: string | null;
    bottom?: string | null;
  };
}

interface UseMenuConfigOptions {
  menuId?: string | null;
  layout?: MenuLayout | null;
  locale?: string;
  enabled?: boolean;
}

function normalizeUseMenuConfigArgs(
  menuIdOrOptions?: string | null | UseMenuConfigOptions,
  locale?: string,
  enabled = true,
): Required<UseMenuConfigOptions> {
  if (typeof menuIdOrOptions === "object" && menuIdOrOptions !== null && !Array.isArray(menuIdOrOptions)) {
    return {
      menuId: menuIdOrOptions.menuId ?? null,
      layout: menuIdOrOptions.layout ?? null,
      locale: menuIdOrOptions.locale ?? "en",
      enabled: menuIdOrOptions.enabled ?? true,
    };
  }

  const normalizedMenuId = typeof menuIdOrOptions === "string" ? menuIdOrOptions : null;

  return {
    menuId: normalizedMenuId,
    layout: null,
    locale: locale ?? "en",
    enabled,
  };
}

export function useMenuConfig(menuId?: string | null, locale?: string, enabled?: boolean): {
  menuConfig: NavbarConfig | undefined;
  topMenuConfig: NavbarConfig | undefined;
  topMenuId: string | null;
  bottomMenuId: string | null;
  sectionBackgroundOverlapsMenu: boolean;
  isTopMenuLoading: boolean;
} & ReturnType<typeof useQuery<MenuResponse>>;
export function useMenuConfig(options: UseMenuConfigOptions): {
  menuConfig: NavbarConfig | undefined;
  topMenuConfig: NavbarConfig | undefined;
  topMenuId: string | null;
  bottomMenuId: string | null;
  sectionBackgroundOverlapsMenu: boolean;
  isTopMenuLoading: boolean;
} & ReturnType<typeof useQuery<MenuResponse>>;
export function useMenuConfig(
  menuIdOrOptions?: string | null | UseMenuConfigOptions,
  locale?: string,
  enabled = true,
) {
  const normalized = normalizeUseMenuConfigArgs(menuIdOrOptions, locale, enabled);
  const topMenuId = normalized.layout?.menu?.top ?? normalized.menuId ?? null;
  const bottomMenuId = normalized.layout?.menu?.bottom ?? null;

  const query = useQuery<MenuResponse>({
    queryKey: ["/api/menus", topMenuId, normalized.locale],
    queryFn: async () => {
      const response = await fetch(`/api/menus/${topMenuId}?locale=${normalized.locale}`);
      if (!response.ok) throw new Error("Failed to load menu");
      return response.json();
    },
    enabled: normalized.enabled && !!topMenuId,
  });

  return {
    ...query,
    menuConfig: query.data?.data,
    topMenuConfig: query.data?.data,
    topMenuId,
    bottomMenuId,
    sectionBackgroundOverlapsMenu: !!query.data?.data?.navbar?.subtle_at_top,
    isTopMenuLoading: query.isLoading,
  };
}
