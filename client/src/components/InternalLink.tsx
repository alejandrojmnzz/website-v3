import {
  useRef,
  useEffect,
  type AnchorHTMLAttributes,
  type MouseEvent,
  type ReactNode,
} from "react";
import { useInternalNav } from "@/hooks/useInternalNav";
import {
  isExternalHref,
  isInternalHref,
  isPrefetchableHref,
  prefetchNavigationHref,
} from "@/lib/prefetchNavigation";

export type InternalLinkPrefetch = "none" | "hover";

export interface InternalLinkProps
  extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> {
  href: string;
  children: ReactNode;
  onNavigate?: () => void;
  /** Preload eager section chunks from build manifest on mouse enter (internal paths only). */
  prefetch?: InternalLinkPrefetch;
}

export function InternalLink({
  href,
  children,
  onNavigate,
  prefetch = "hover",
  onClick,
  onMouseEnter,
  target,
  rel,
  ...rest
}: InternalLinkProps) {
  const isExternal = isExternalHref(href);
  const useSpaNav = isInternalHref(href) && !isExternal;
  const handleClick = useInternalNav(useSpaNav ? onNavigate : undefined);
  const prefetchedRef = useRef(false);

  useEffect(() => {
    prefetchedRef.current = false;
  }, [href]);

  const handleMouseEnter = (e: MouseEvent<HTMLAnchorElement>) => {
    onMouseEnter?.(e);
    if (
      !useSpaNav ||
      prefetch === "none" ||
      prefetchedRef.current ||
      !isPrefetchableHref(href)
    ) {
      return;
    }
    prefetchedRef.current = true;
    prefetchNavigationHref(href);
  };

  const externalProps =
    isExternal && target === undefined
      ? { target: "_blank" as const, rel: rel ?? "noopener noreferrer" }
      : { target, rel };

  return (
    <a
      href={href}
      onClick={(e) => {
        handleClick(e);
        onClick?.(e);
      }}
      onMouseDown={(e) => {
        handleClick.onMouseDown(e);
      }}
      onMouseEnter={handleMouseEnter}
      {...externalProps}
      {...rest}
    >
      {children}
    </a>
  );
}
