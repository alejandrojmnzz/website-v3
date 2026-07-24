import { domToWebp } from "modern-screenshot";
import { getSessionHeaders } from "@/lib/sessionHeaders";

export const CAPTURE_WIDTH = 640;
/** Fallback / minimum capture height (16:9 thumb aspect). */
export const CAPTURE_HEIGHT = 360;
/** Cap very tall sections so captures stay bounded. */
export const CAPTURE_MAX_HEIGHT = 2000;

export interface CaptureJob {
  type: string;
  version: string;
  example: string;
  sourceMtime: number;
  sourceSize: number;
  /** Store under `{type}--{example}.webp` instead of primary `{type}.webp` */
  exampleKeyed?: boolean;
}

function previewUrl(job: CaptureJob): string {
  const params = new URLSearchParams({
    debug: "false",
    capture: "1",
    version: job.version,
    example: job.example,
  });
  return `/private/component-showcase/${encodeURIComponent(job.type)}/preview?${params}`;
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
        // Content often loads after ready; wait for a height report or fall through via settle timer
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clampCaptureHeight(height: number): number {
  return Math.min(
    CAPTURE_MAX_HEIGHT,
    Math.max(CAPTURE_HEIGHT, Math.ceil(height)),
  );
}

function measureCaptureHeight(
  target: HTMLElement,
  reportedHeight: number | null,
): number {
  const measured = Math.max(
    reportedHeight ?? 0,
    target.scrollHeight,
    target.offsetHeight,
  );
  return clampCaptureHeight(measured || CAPTURE_HEIGHT);
}

/**
 * Capture one component preview into a webp and upload to the screenshot cache.
 * Uses a single off-screen iframe (caller should serialize jobs).
 */
export async function captureComponentScreenshot(job: CaptureJob): Promise<string> {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("data-testid", `capture-iframe-${job.type}`);
  iframe.title = `Capture ${job.type}`;
  iframe.style.cssText = [
    "position:fixed",
    "left:-10000px",
    "top:0",
    `width:${CAPTURE_WIDTH}px`,
    `height:${CAPTURE_HEIGHT}px`,
    "border:0",
    "opacity:0",
    "pointer-events:none",
    "z-index:-1",
  ].join(";");

  document.body.appendChild(iframe);

  try {
    const readyPromise = waitForPreviewReady(iframe);
    iframe.src = previewUrl(job);
    const reportedHeight = await readyPromise;

    iframe.contentWindow?.postMessage({ type: "theme-update", theme: "dark" }, "*");
    await sleep(500);

    const doc = iframe.contentDocument;
    if (!doc) {
      throw new Error("No preview document");
    }

    // GTM <noscript> in index.html is a sibling of #root; modern-screenshot can
    // still serialize its raw HTML as visible text when cloning from body.
    doc.querySelectorAll("noscript").forEach((el) => el.remove());

    const target =
      doc.querySelector<HTMLElement>("[data-screenshot-root]") ||
      doc.getElementById("root") ||
      doc.body;
    if (!target) {
      throw new Error("No preview document root");
    }

    // First measure may still be constrained by the short iframe; grow the
    // viewport so tall sections can lay out fully, then re-measure.
    let captureHeight = measureCaptureHeight(target, reportedHeight);
    iframe.style.height = `${captureHeight}px`;
    await sleep(300);
    captureHeight = measureCaptureHeight(target, null);
    iframe.style.height = `${captureHeight}px`;
    await sleep(200);

    const dataUrl = await domToWebp(target, {
      width: CAPTURE_WIDTH,
      height: captureHeight,
      backgroundColor: "#0a0a0a",
      filter: (node) => {
        if (!(node instanceof Element)) return true;
        const tag = node.tagName;
        return tag !== "NOSCRIPT" && tag !== "SCRIPT";
      },
    });

    const blob = await (await fetch(dataUrl)).blob();
    const params = new URLSearchParams({
      version: job.version,
      example: job.example,
      sourceMtime: String(job.sourceMtime),
      sourceSize: String(job.sourceSize),
    });
    if (job.exampleKeyed) {
      params.set("keyed", "1");
    }

    const res = await fetch(
      `/api/private/component-screenshots/${encodeURIComponent(job.type)}?${params}`,
      {
        method: "PUT",
        headers: {
          "Content-Type": "image/webp",
          ...getSessionHeaders(),
        },
        body: blob,
        credentials: "include",
      },
    );

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Upload failed: ${res.status} ${text}`);
    }

    const json = (await res.json()) as { url?: string };
    if (json.url) return json.url;
    const fallback = new URLSearchParams({ t: String(Date.now()) });
    if (job.exampleKeyed) fallback.set("example", job.example);
    return `/api/private/component-screenshots/${encodeURIComponent(job.type)}?${fallback}`;
  } finally {
    iframe.remove();
  }
}
