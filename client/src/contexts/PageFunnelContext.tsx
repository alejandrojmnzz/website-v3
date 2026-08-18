import { createContext, useContext, type ReactNode } from "react";
import type { FunnelBlock } from "@shared/funnel";

const PageFunnelContext = createContext<FunnelBlock | null | undefined>(undefined);

export function PageFunnelProvider({
  funnel,
  children,
}: {
  funnel?: FunnelBlock | null;
  children: ReactNode;
}) {
  return (
    <PageFunnelContext.Provider value={funnel ?? null}>{children}</PageFunnelContext.Provider>
  );
}

export function usePageFunnel(): FunnelBlock | null {
  const ctx = useContext(PageFunnelContext);
  return ctx ?? null;
}
