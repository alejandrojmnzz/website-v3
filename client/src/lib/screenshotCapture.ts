import { domToWebp } from "modern-screenshot";
import { getSessionHeaders } from "@/lib/sessionHeaders";

/** Default gallery capture width. */
export const CAPTURE_WIDTH = 640;
/** Fallback / minimum capture height (16:9 thumb aspect). */
export const CAPTURE_HEIGHT = 360;
/** Cap very tall sections so captures stay bounded. */
export const CAPTURE_MAX_HEIGHT = 2000;

export type CaptureTheme = "dark" | "light";

export interface CaptureIframeOptions {
  url: string;
  width?: number;
  minHeight?: number;
  maxHeight?: number;
  theme?: CaptureTheme;
  backgroundColor?: string;
  timeoutMs?: number;
  testId?: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitForPreviewReady(
  iframe: HTMLIFrameElement,
  timeoutMs = 20000,
): Promise<number | null> {
  return new Promise((resolve, reject) => {
    let ready = false;
    let settled = false;
    let lastHeight: number | null = null;

    const finish = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(lastHeight);
    };

    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("Timed out waiting for preview"));
    }, timeoutMs);

    const onMessage = (event: MessageEvent) => {
      if (event.source !== iframe.contentWindow) return;
      if (event.data?.type === "preview-ready") {
        ready = true;
      }
      if (event.data?.type === "preview-height" && ready) {
        const height = Number(event.data.height);
        if (Number.isFinite(height) && height > 40) {
          lastHeight = height;
          finish();
        }
      }
    };

    const settleTimer = setTimeout(() => {
      if (ready) finish();
    }, 2500);

    const cleanup = () => {
      clearTimeout(timer);
      clearTimeout(settleTimer);
      window.removeEventListener("message", onMessage);
    };

    window.addEventListener("message", onMessage);
  });
}

function clampCaptureHeight(
  height: number,
  minHeight: number,
  maxHeight: number,
): number {
  return Math.min(maxHeight, Math.max(minHeight, Math.ceil(height)));
}

function measureCaptureHeight(
  target: HTMLElement,
  reportedHeight: number | null,
  minHeight: number,
  maxHeight: number,
): number {
  const measured = Math.max(
    reportedHeight ?? 0,
    target.scrollHeight,
    target.offsetHeight,
  );
  return clampCaptureHeight(measured || minHeight, minHeight, maxHeight);
}

/**
 * Load a preview URL in an off-screen iframe and capture `[data-screenshot-root]` to WebP.
 * Caller should serialize jobs so only one capture iframe runs at a time.
 */
export async function captureIframeToWebp(options: CaptureIframeOptions): Promise<Blob> {
  const width = options.width ?? CAPTURE_WIDTH;
  const minHeight = options.minHeight ?? CAPTURE_HEIGHT;
  const maxHeight = options.maxHeight ?? CAPTURE_MAX_HEIGHT;
  const theme = options.theme ?? "dark";
  const backgroundColor = options.backgroundColor ?? (theme === "dark" ? "#0a0a0a" : "#ffffff");

  const iframe = document.createElement("iframe");
  if (options.testId) iframe.setAttribute("data-testid", options.testId);
  iframe.title = "Screenshot capture";
  iframe.style.cssText = [
    "position:fixed",
    "left:-10000px",
    "top:0",
    `width:${width}px`,
    `height:${minHeight}px`,
    "border:0",
    "opacity:0",
    "pointer-events:none",
    "z-index:-1",
  ].join(";");

  document.body.appendChild(iframe);

  try {
    const readyPromise = waitForPreviewReady(iframe, options.timeoutMs);
    iframe.src = options.url;
    const reportedHeight = await readyPromise;

    iframe.contentWindow?.postMessage({ type: "theme-update", theme }, "*");
    await sleep(500);

    const doc = iframe.contentDocument;
    if (!doc) {
      throw new Error("No preview document");
    }

    doc.querySelectorAll("noscript").forEach((el) => el.remove());

    const target =
      doc.querySelector<HTMLElement>("[data-screenshot-root]") ||
      doc.getElementById("root") ||
      doc.body;
    if (!target) {
      throw new Error("No preview document root");
    }

    let captureHeight = measureCaptureHeight(target, reportedHeight, minHeight, maxHeight);
    iframe.style.height = `${captureHeight}px`;
    await sleep(300);
    captureHeight = measureCaptureHeight(target, null, minHeight, maxHeight);
    iframe.style.height = `${captureHeight}px`;
    await sleep(200);

    const dataUrl = await domToWebp(target, {
      width,
      height: captureHeight,
      backgroundColor,
      filter: (node) => {
        if (!(node instanceof Element)) return true;
        const tag = node.tagName;
        return tag !== "NOSCRIPT" && tag !== "SCRIPT";
      },
    });

    return await (await fetch(dataUrl)).blob();
  } finally {
    iframe.remove();
  }
}

export async function uploadWebp(
  putUrl: string,
  blob: Blob,
  query?: Record<string, string>,
): Promise<{ url: string }> {
  const url = query && Object.keys(query).length > 0
    ? `${putUrl}${putUrl.includes("?") ? "&" : "?"}${new URLSearchParams(query)}`
    : putUrl;

  const res = await fetch(url, {
    method: "PUT",
    headers: {
      "Content-Type": "image/webp",
      ...getSessionHeaders(),
    },
    body: blob,
    credentials: "include",
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Upload failed: ${res.status} ${text}`);
  }

  const json = (await res.json()) as { url?: string };
  return { url: json.url || putUrl };
}
