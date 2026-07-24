import {
  CAPTURE_HEIGHT,
  CAPTURE_MAX_HEIGHT,
  CAPTURE_WIDTH,
  captureIframeToWebp,
  uploadWebp,
} from "@/lib/screenshotCapture";

export { CAPTURE_WIDTH, CAPTURE_HEIGHT, CAPTURE_MAX_HEIGHT };

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

/**
 * Capture one component preview into a webp and upload to the screenshot cache.
 * Uses a single off-screen iframe (caller should serialize jobs).
 */
export async function captureComponentScreenshot(job: CaptureJob): Promise<string> {
  const blob = await captureIframeToWebp({
    url: previewUrl(job),
    width: CAPTURE_WIDTH,
    minHeight: CAPTURE_HEIGHT,
    maxHeight: CAPTURE_MAX_HEIGHT,
    theme: "dark",
    testId: `capture-iframe-${job.type}`,
  });

  const query: Record<string, string> = {
    version: job.version,
    example: job.example,
    sourceMtime: String(job.sourceMtime),
    sourceSize: String(job.sourceSize),
  };
  if (job.exampleKeyed) {
    query.keyed = "1";
  }

  const { url } = await uploadWebp(
    `/api/private/component-screenshots/${encodeURIComponent(job.type)}`,
    blob,
    query,
  );

  if (url) return url;
  const fallback = new URLSearchParams({ t: String(Date.now()) });
  if (job.exampleKeyed) fallback.set("example", job.example);
  return `/api/private/component-screenshots/${encodeURIComponent(job.type)}?${fallback}`;
}
