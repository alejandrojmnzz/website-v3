/** Short-lived cookie capturing internal redirect hops for staff 404 UI. */

export const REDIRECT_TRACE_COOKIE_NAME = "4g_redir_trace";
export const REDIRECT_TRACE_MAX_HOPS = 8;
export const REDIRECT_TRACE_MAX_AGE_SECONDS = 120;

export type RedirectTraceMatchType = "exact" | "regex" | "canonical" | "fallback";

export interface RedirectTraceHop {
  from: string;
  to: string;
  status: number;
  matchType: RedirectTraceMatchType;
  priority?: string;
  source?: string;
}

function isHop(value: unknown): value is RedirectTraceHop {
  if (!value || typeof value !== "object") return false;
  const hop = value as Record<string, unknown>;
  return (
    typeof hop.from === "string" &&
    typeof hop.to === "string" &&
    typeof hop.status === "number" &&
    (hop.matchType === "exact" ||
      hop.matchType === "regex" ||
      hop.matchType === "canonical" ||
      hop.matchType === "fallback")
  );
}

export function parseRedirectTraceCookie(raw: string | undefined | null): RedirectTraceHop[] {
  if (!raw || typeof raw !== "string") return [];
  try {
    let text = raw;
    try {
      text = decodeURIComponent(raw);
    } catch {
      // already decoded
    }
    const parsed = JSON.parse(text) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isHop).slice(0, REDIRECT_TRACE_MAX_HOPS);
  } catch {
    return [];
  }
}

export function encodeRedirectTraceCookie(hops: RedirectTraceHop[]): string {
  return JSON.stringify(hops.slice(0, REDIRECT_TRACE_MAX_HOPS));
}

export function appendRedirectTraceHop(
  hops: RedirectTraceHop[],
  hop: RedirectTraceHop,
): RedirectTraceHop[] {
  return [...hops, hop].slice(0, REDIRECT_TRACE_MAX_HOPS);
}

export function formatRedirectMatchLabel(hop: RedirectTraceHop): string {
  if (hop.matchType === "fallback") {
    return /[()[\]{.*+]/.test(hop.from) ? "fallback regex" : "fallback";
  }
  return hop.matchType;
}

export function redirectTraceOriginalUrl(hops: RedirectTraceHop[]): string | null {
  return hops[0]?.from ?? null;
}
