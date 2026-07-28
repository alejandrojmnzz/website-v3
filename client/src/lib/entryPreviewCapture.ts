import {
  captureIframeToWebp,
  uploadWebp,
} from "@/lib/screenshotCapture";
import { apiRequest } from "@/lib/queryClient";

export interface EntryPreviewCaptureJob {
  contentType: string;
  slug: string;
  locale: string;
  width: number;
  maxHeight: number;
  theme: "dark" | "light";
  propsHash?: string;
}

export function entryPreviewJobKey(job: EntryPreviewCaptureJob): string {
  return `${job.contentType}:${job.slug}:${job.locale}:${job.width}`;
}

function frameUrl(job: EntryPreviewCaptureJob): string {
  const params = new URLSearchParams({
    locale: job.locale,
    capture: "1",
    // Drive dark/light class + server logo resolve from the capture job theme
    // (not only a late postMessage after preview-ready).
    theme: job.theme,
    // Bust sticky 301 caches from older redirect middleware bugs.
    _: String(Date.now()),
  });
  return `/private/entry-preview-frame/${encodeURIComponent(job.contentType)}/${encodeURIComponent(job.slug)}?${params}`;
}

/**
 * Capture an entry preview frame to WebP and upload to the site media bucket.
 */
export async function captureEntryPreview(job: EntryPreviewCaptureJob): Promise<string> {
  const CAPTURE_TIMEOUT_MS = 45_000;
  try {
    const blob = await Promise.race([
      captureIframeToWebp({
        url: frameUrl(job),
        width: job.width,
        minHeight: Math.min(360, job.maxHeight),
        maxHeight: job.maxHeight,
        theme: job.theme,
        timeoutMs: 20_000,
        testId: `entry-preview-capture-${job.slug}`,
      }),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error("Entry preview capture timed out")),
          CAPTURE_TIMEOUT_MS,
        ),
      ),
    ]);

    const query: Record<string, string> = {
      locale: job.locale,
      width: String(job.width),
    };
    if (job.propsHash) query.propsHash = job.propsHash;

    const { url } = await uploadWebp(
      `/api/content-types/${encodeURIComponent(job.contentType)}/entries/${encodeURIComponent(job.slug)}/preview-image`,
      blob,
      query,
    );
    return url || "";
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    try {
      await apiRequest(
        "POST",
        `/api/content-types/${encodeURIComponent(job.contentType)}/entries/${encodeURIComponent(job.slug)}/preview-failed`,
        { locale: job.locale, width: job.width, error: message },
      );
    } catch {
      /* ignore secondary failure */
    }
    throw err;
  }
}
