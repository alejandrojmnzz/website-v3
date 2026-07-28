/**
 * Web GTM container status — reads the ID and injection pieces from the live page.
 * Source of truth is settings.yml (optimization.tagmanager.web_container_id),
 * injected into window.__GTM_CONTAINER_ID__ via server/gtm-web-inject.ts.
 */

const GTM_ID_PATTERN = /^GTM-[A-Z0-9]+$/;

declare global {
  interface Window {
    __GTM_CONTAINER_ID__?: string;
  }
}

export type GtmWebInjectMethod =
  | "deferred-interaction-or-15s"
  | "unknown";

export interface GtmWebStatus {
  containerId: string | null;
  valid: boolean;
  issues: string[];
  scriptLoaded: boolean;
  injectMethod: GtmWebInjectMethod;
  hasDataLayer: boolean;
  hasInjectScript: boolean;
  hasNoscript: boolean;
}

function isValidGtmId(id: string): boolean {
  return GTM_ID_PATTERN.test(id);
}

function findNoscriptMarkup(): string | null {
  if (typeof document === "undefined") return null;
  for (const ns of Array.from(document.querySelectorAll("noscript"))) {
    const text = ns.textContent || "";
    if (text.includes("googletagmanager.com/ns.html")) {
      return text;
    }
  }
  return null;
}

function hasDeferredInjectScript(): boolean {
  if (typeof document === "undefined") return false;
  return Array.from(document.scripts).some((script) => {
    const text = script.textContent || "";
    return text.includes("injectGTM") && text.includes("googletagmanager.com/gtm.js");
  });
}

function isGtmScriptLoaded(containerId: string | null): boolean {
  if (typeof document === "undefined") return false;
  const scripts = Array.from(
    document.querySelectorAll<HTMLScriptElement>('script[src*="googletagmanager.com/gtm.js"]'),
  );
  if (!containerId) return scripts.length > 0;
  return scripts.some((s) => s.src.includes(`id=${containerId}`));
}

/**
 * Inspect the current document for web GTM configuration health.
 */
export function getGtmWebStatus(): GtmWebStatus {
  const rawId =
    typeof window !== "undefined" ? window.__GTM_CONTAINER_ID__?.trim() || null : null;

  const issues: string[] = [];
  const hasDataLayer =
    typeof window !== "undefined" && Array.isArray(window.dataLayer);
  const hasInjectScript = hasDeferredInjectScript();
  const noscriptMarkup = findNoscriptMarkup();
  const hasNoscript = noscriptMarkup !== null;

  if (!rawId) {
    issues.push("Missing window.__GTM_CONTAINER_ID__");
  } else if (!isValidGtmId(rawId)) {
    issues.push(`Invalid container ID format: ${rawId}`);
  }

  if (!hasDataLayer) {
    issues.push("Missing window.dataLayer initialization");
  }

  if (!hasInjectScript) {
    issues.push("Missing deferred GTM inject script");
  }

  if (!hasNoscript) {
    issues.push("Missing noscript iframe");
  } else if (rawId && isValidGtmId(rawId) && !noscriptMarkup!.includes(`id=${rawId}`)) {
    issues.push("Noscript iframe ID does not match window.__GTM_CONTAINER_ID__");
  }

  const injectMethod: GtmWebInjectMethod = hasInjectScript
    ? "deferred-interaction-or-15s"
    : "unknown";

  const valid = issues.length === 0;

  return {
    containerId: rawId,
    valid,
    issues,
    scriptLoaded: isGtmScriptLoaded(rawId),
    injectMethod,
    hasDataLayer,
    hasInjectScript,
    hasNoscript,
  };
}
