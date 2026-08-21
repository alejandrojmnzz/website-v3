import { getTokenUsername } from "./oauth.js";
import type { CatalogGrant } from "./tool-catalog.js";
import { hasCapAnyScope } from "./tool-catalog.js";

const MAIN_SERVER_PORT = process.env.PORT || "5000";
// MCP_SERVER_SECRET is the internal credential used only for the MCP server's own
// loopback requests to the main app. It is NOT accepted as an inbound caller credential.
// MCP_API_KEY is supported as a backward-compatible alias.
const MCP_SERVER_SECRET = process.env.MCP_SERVER_SECRET || process.env.MCP_API_KEY || "";

/**
 * Check whether the user associated with the given MCP bearer token holds the
 * required capability, optionally scoped to a content type.
 *
 * Delegates to the main server's /api/auth/check-capability endpoint so that
 * all authorisation logic remains in one place.
 *
 * Fails closed (returns false) on any network error or when the token cannot
 * be resolved to a username.
 */
export async function checkCap(
  mcpToken: string,
  cap: string,
  contentType?: string,
): Promise<boolean> {
  const username = getTokenUsername(mcpToken);
  if (!username) return false;

  try {
    const params = new URLSearchParams({ cap, username });
    if (contentType) params.set("contentType", contentType);
    const url = `http://localhost:${MAIN_SERVER_PORT}/api/auth/check-capability?${params}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${MCP_SERVER_SECRET}` },
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { allowed?: boolean };
    return data.allowed === true;
  } catch {
    return false;
  }
}

/** Load capability grants for the MCP caller. null = fetch failed. */
export async function fetchCallerGrants(mcpToken: string): Promise<CatalogGrant[] | null> {
  const username = getTokenUsername(mcpToken);
  if (!username) return null;
  try {
    const params = new URLSearchParams({ username });
    const url = `http://localhost:${MAIN_SERVER_PORT}/api/auth/user-info?${params}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${MCP_SERVER_SECRET}` },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { capabilities?: CatalogGrant[] };
    return Array.isArray(data.capabilities) ? data.capabilities : [];
  } catch {
    return null;
  }
}

export async function denyUnlessContentView(
  mcpToken: string | undefined,
  contentType: string | undefined,
  grants: CatalogGrant[] | undefined,
) {
  if (!mcpToken) return null;
  if (contentType) {
    if (!(await checkCap(mcpToken, "content_view", contentType))) {
      return denyResponse("content_view", contentType);
    }
    return null;
  }
  if (grants && !hasCapAnyScope(grants, "content_view")) {
    return denyResponse("content_view");
  }
  return null;
}

export async function denyUnlessContentViewOrSeo(
  mcpToken: string | undefined,
  contentType: string | undefined,
  grants: CatalogGrant[] | undefined,
) {
  if (!mcpToken) return null;
  if (contentType) {
    if (await checkCap(mcpToken, "content_view", contentType)) return null;
    if (await checkCap(mcpToken, "seo_edit")) return null;
    return denyResponse("content_view|seo_edit", contentType);
  }
  if (grants) {
    if (hasCapAnyScope(grants, "content_view") || hasCapAnyScope(grants, "seo_edit")) return null;
    return denyResponse("content_view|seo_edit");
  }
  return null;
}

/**
 * Return the standard MCP error shape for a capability denial.
 * Keeps individual tool handlers concise.
 */
export function denyResponse(cap: string, contentType?: string) {
  const scopeMsg = contentType ? ` for content type '${contentType}'` : "";
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({
          error: "forbidden",
          message: `Insufficient permissions: capability '${cap}' required${scopeMsg}.`,
        }),
      },
    ],
    isError: true,
  };
}
