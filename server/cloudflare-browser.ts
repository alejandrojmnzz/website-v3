/**
 * Cloudflare Browser Run (Browser Rendering) REST client — screenshot Quick Action.
 * Used for entry-preview / OG captures.
 *
 * Credentials: environment variables only (never settings.yml).
 */

import sharp from "sharp";
import { child } from "./logger";

const log = child({ module: "cloudflare-browser" });

export type CloudflareGotoWaitUntil =
  | "load"
  | "domcontentloaded"
  | "networkidle0"
  | "networkidle2";

export type CloudflareScreenshotOptions = {
  url: string;
  width?: number;
  height?: number;
  waitForSelector?: string;
  /** Puppeteer-style navigation wait; default networkidle0 for entry-preview frames. */
  waitUntil?: CloudflareGotoWaitUntil;
  /** Extra settle time after navigation / selector (ms). */
  waitForTimeoutMs?: number;
  timeoutMs?: number;
};

export type CloudflareScreenshotResult = {
  webp: Buffer;
  browserMsUsed: number | null;
  pngBytes: number;
};

export type CredentialSource = "env" | "none";

export function resolveCloudflareAccountId(): {
  value: string;
  source: CredentialSource;
} {
  const fromEnv = process.env.CLOUDFLARE_ACCOUNT_ID?.trim() || "";
  if (fromEnv) return { value: fromEnv, source: "env" };
  return { value: "", source: "none" };
}

export function resolveCloudflareApiToken(): {
  value: string;
  source: CredentialSource;
} {
  const fromEnv = process.env.CLOUDFLARE_API_TOKEN?.trim() || "";
  if (fromEnv) return { value: fromEnv, source: "env" };
  return { value: "", source: "none" };
}

export function resolveEntryPreviewCaptureSecret(): {
  value: string;
  source: CredentialSource | "session";
} {
  const fromEnv = process.env.ENTRY_PREVIEW_CAPTURE_SECRET?.trim() || "";
  if (fromEnv) return { value: fromEnv, source: "env" };
  const session = process.env.SESSION_SECRET?.trim() || "";
  if (session) return { value: session, source: "session" };
  return { value: "", source: "none" };
}

export function isCloudflareBrowserConfigured(): boolean {
  const accountId = resolveCloudflareAccountId().value;
  const token = resolveCloudflareApiToken().value;
  return !!(accountId && token);
}

export function getPublicSiteUrl(): string | null {
  const raw = process.env.SITE_URL?.trim();
  if (!raw) return null;
  return raw.replace(/\/$/, "");
}

/** True when SITE_URL looks reachable from Cloudflare's network (not localhost). */
export function isSiteUrlPubliclyReachable(): boolean {
  const base = getPublicSiteUrl();
  if (!base) return false;
  try {
    const u = new URL(base);
    const host = u.hostname.toLowerCase();
    if (host === "localhost" || host === "127.0.0.1" || host === "::1") return false;
    if (host.endsWith(".local")) return false;
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

export function cloudflareBrowserConfigError(): string | null {
  if (!isCloudflareBrowserConfigured()) {
    return "CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are required for entry-preview capture (set on the host environment)";
  }
  if (!getPublicSiteUrl()) {
    return "SITE_URL is required for Cloudflare entry-preview capture";
  }
  if (!isSiteUrlPubliclyReachable()) {
    return "SITE_URL must be publicly reachable by Cloudflare (not localhost). Use a tunnel or staging URL.";
  }
  return null;
}

/**
 * Capture a URL via Cloudflare Browser Run /screenshot and return WebP bytes.
 */
export async function captureScreenshotToWebp(
  opts: CloudflareScreenshotOptions,
): Promise<CloudflareScreenshotResult> {
  const configErr = cloudflareBrowserConfigError();
  if (configErr) throw new Error(configErr);

  const accountId = resolveCloudflareAccountId().value;
  const token = resolveCloudflareApiToken().value;
  const width = opts.width ?? 1200;
  const height = opts.height ?? 630;
  const timeoutMs = opts.timeoutMs ?? 45_000;
  const waitUntil = opts.waitUntil ?? "networkidle0";
  const waitForSelector =
    opts.waitForSelector ?? "[data-screenshot-root][data-capture-ready='1']";

  const endpoint =
    `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}` +
    `/browser-rendering/screenshot?cacheTTL=0`;

  const body: Record<string, unknown> = {
    url: opts.url,
    viewport: {
      width,
      height,
      deviceScaleFactor: 1,
    },
    screenshotOptions: {
      type: "png",
      clip: { x: 0, y: 0, width, height },
      omitBackground: false,
    },
    gotoOptions: {
      waitUntil,
      timeout: timeoutMs,
    },
    waitForSelector: {
      selector: waitForSelector,
      visible: true,
      timeout: timeoutMs,
    },
  };
  if (opts.waitForTimeoutMs != null && opts.waitForTimeoutMs > 0) {
    body.waitForTimeout = opts.waitForTimeoutMs;
  }

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const browserMsHeader = res.headers.get("X-Browser-Ms-Used");
  const browserMsUsed = browserMsHeader ? Number(browserMsHeader) : null;

  if (!res.ok) {
    let detail = "";
    try {
      detail = await res.text();
    } catch {
      /* ignore */
    }
    log.error(
      { status: res.status, detail: detail.slice(0, 500), browserMsUsed },
      "[cloudflare-browser] screenshot failed",
    );
    throw new Error(
      `Cloudflare screenshot failed (${res.status})${detail ? `: ${detail.slice(0, 200)}` : ""}`,
    );
  }

  const png = Buffer.from(await res.arrayBuffer());
  if (png.length < 100) {
    throw new Error("Cloudflare screenshot returned empty or tiny PNG");
  }

  const webp = await sharp(png).webp({ quality: 85 }).toBuffer();
  log.info(
    { pngBytes: png.length, webpBytes: webp.length, browserMsUsed, url: opts.url },
    "[cloudflare-browser] screenshot ok",
  );

  return { webp, browserMsUsed: Number.isFinite(browserMsUsed) ? browserMsUsed : null, pngBytes: png.length };
}
