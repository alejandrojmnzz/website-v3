import { useCallback, useEffect, useRef, type RefObject } from "react";

export interface UseScreenshotFrameProtocolOptions {
  rootRef: RefObject<HTMLElement | null>;
  /** When true, emit ready/height and listen for theme-update. */
  enabled?: boolean;
  onThemeUpdate?: (theme: "light" | "dark") => void;
}

/**
 * Shared iframe handshake for screenshot capture and live previews:
 * emits preview-ready / preview-height, listens for theme-update.
 */
export function useScreenshotFrameProtocol({
  rootRef,
  enabled = true,
  onThemeUpdate,
}: UseScreenshotFrameProtocolOptions): void {
  const reportHeight = useCallback(() => {
    if (!enabled) return;
    if (rootRef.current && window.parent !== window) {
      const height = rootRef.current.scrollHeight;
      window.parent.postMessage({ type: "preview-height", height }, "*");
    }
  }, [enabled, rootRef]);

  useEffect(() => {
    if (!enabled) return;

    const isInIframe = window.parent !== window;

    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === "theme-update") {
        const theme = event.data.theme === "light" ? "light" : "dark";
        onThemeUpdate?.(theme);
      }
    };

    window.addEventListener("message", handleMessage);

    if (isInIframe) {
      window.parent.postMessage({ type: "preview-ready" }, "*");
    }

    return () => {
      window.removeEventListener("message", handleMessage);
    };
  }, [enabled, onThemeUpdate]);

  useEffect(() => {
    if (!enabled || !rootRef.current) return;

    const observer = new ResizeObserver(() => {
      reportHeight();
    });

    observer.observe(rootRef.current);
    return () => observer.disconnect();
  }, [enabled, rootRef, reportHeight]);

  useEffect(() => {
    if (!enabled) return;
    const timeouts = [50, 200, 500, 1000].map((delay) => setTimeout(reportHeight, delay));
    return () => timeouts.forEach(clearTimeout);
  }, [enabled, reportHeight]);
}
