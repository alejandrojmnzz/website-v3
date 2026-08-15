import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { REDIRECT_TRACE_COOKIE_NAME, type RedirectTraceHop } from "@shared/redirect-trace";
import { loadRedirectTraceHops } from "@/lib/redirectTraceSession";
import { clearRawCookie, readRawCookie } from "@/lib/sessionCookie";

export function useRedirectTraceHops(): RedirectTraceHop[] {
  const [location] = useLocation();
  const pathname = location.split("?")[0];
  const [hops, setHops] = useState<RedirectTraceHop[]>([]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const raw = readRawCookie(REDIRECT_TRACE_COOKIE_NAME);
    const result = loadRedirectTraceHops({
      pathname: window.location.pathname,
      cookieRaw: raw,
      storage: window.sessionStorage,
    });
    if (result.cookieToClear) {
      clearRawCookie(REDIRECT_TRACE_COOKIE_NAME);
    }
    setHops(result.hops);
  }, [pathname]);

  return hops;
}
