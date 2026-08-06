/**
 * Resolve a program / content slug for ecommerce tracking from the current URL or CTA.
 */

export function programIdFromCtaUrl(url: unknown): string | undefined {
  if (typeof url !== "string") return undefined;
  try {
    const u = new URL(url, "https://placeholder.local");
    const q = u.searchParams.get("program");
    if (q) return q;
  } catch {
    const m = url.match(/[?&]program=([^&]+)/);
    if (m?.[1]) return decodeURIComponent(m[1]);
  }
  return undefined;
}

export function programIdFromPathname(pathname: string): string | undefined {
  const programEn = pathname.match(/^\/en\/career-programs\/([^/?#]+)/);
  if (programEn?.[1]) return programEn[1];
  const programEs = pathname.match(/^\/es\/programas-de-carrera\/([^/?#]+)/);
  if (programEs?.[1]) return programEs[1];
  // Fallback: /us/<slug> style used in some local paths
  const us = pathname.match(/^\/us\/([^/?#]+)/);
  if (us?.[1] && !["en", "es", "payment-component", "checkout"].includes(us[1])) {
    return us[1];
  }
  return undefined;
}

export function resolveProgramIdForPage(ctaUrl?: unknown): string | undefined {
  if (typeof window === "undefined") return programIdFromCtaUrl(ctaUrl);
  return (
    programIdFromCtaUrl(ctaUrl) ||
    programIdFromPathname(window.location.pathname) ||
    undefined
  );
}
