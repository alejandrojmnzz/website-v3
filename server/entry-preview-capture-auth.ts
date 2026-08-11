/**
 * HMAC-signed capture URLs for Cloudflare Browser Run to open EntryPreviewFrame
 * without a staff session cookie.
 */

import * as crypto from "crypto";
import { getPublicSiteUrl, resolveEntryPreviewCaptureSecret } from "./cloudflare-browser";

const DEFAULT_TTL_SEC = 10 * 60;

function captureSecret(): string {
  return resolveEntryPreviewCaptureSecret().value;
}

export function stripOgCacheBust(url: string): string {
  try {
    if (url.startsWith("http://") || url.startsWith("https://")) {
      const u = new URL(url);
      u.searchParams.delete("t");
      return u.toString();
    }
  } catch {
    /* fall through */
  }
  return url.replace(/([?&])t=\d+(&|$)/, (_, sep, end) => (end === "&" ? sep : "")).replace(/\?$/, "");
}

function signPayload(payload: string): string {
  const secret = captureSecret();
  if (!secret) {
    throw new Error(
      "ENTRY_PREVIEW_CAPTURE_SECRET or SESSION_SECRET required for signed capture URLs (set on the host environment)",
    );
  }
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

export type CaptureTokenParts = {
  contentType: string;
  slug: string;
  locale: string;
  exp: number;
};

export function signEntryPreviewCaptureToken(parts: CaptureTokenParts): string {
  const payload = `${parts.contentType}|${parts.slug}|${parts.locale}|${parts.exp}`;
  return signPayload(payload);
}

export function verifyEntryPreviewCaptureToken(
  parts: CaptureTokenParts & { token: string },
): { ok: true } | { ok: false; error: string } {
  if (!captureSecret()) {
    return { ok: false, error: "Capture signing secret not configured" };
  }
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(parts.exp) || parts.exp < now) {
    return { ok: false, error: "Capture token expired" };
  }
  const expected = signEntryPreviewCaptureToken({
    contentType: parts.contentType,
    slug: parts.slug,
    locale: parts.locale,
    exp: parts.exp,
  });
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(parts.token, "utf8");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, error: "Invalid capture token" };
  }
  return { ok: true };
}

/**
 * Absolute URL to the SPA frame with capture=1 and HMAC token.
 */
export function buildSignedEntryPreviewFrameUrl(opts: {
  contentType: string;
  slug: string;
  locale: string;
  theme?: "dark" | "light";
  ttlSec?: number;
}): string {
  const base = getPublicSiteUrl();
  if (!base) throw new Error("SITE_URL is required to build capture frame URLs");

  const exp = Math.floor(Date.now() / 1000) + (opts.ttlSec ?? DEFAULT_TTL_SEC);
  const token = signEntryPreviewCaptureToken({
    contentType: opts.contentType,
    slug: opts.slug,
    locale: opts.locale,
    exp,
  });

  const qs = new URLSearchParams({
    locale: opts.locale,
    capture: "1",
    capture_token: token,
    exp: String(exp),
    _: String(Date.now()),
  });
  if (opts.theme === "light" || opts.theme === "dark") {
    qs.set("theme", opts.theme);
  }

  return (
    `${base}/private/entry-preview-frame/` +
    `${encodeURIComponent(opts.contentType)}/${encodeURIComponent(opts.slug)}?${qs}`
  );
}
