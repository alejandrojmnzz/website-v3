import { useCallback, useEffect, useRef, useState } from "react";

export type CaptureQueueStatus = "idle" | "queued" | "capturing" | "failed";

export interface UseSerializedCaptureQueueOptions<TJob> {
  jobKey: (job: TJob) => string;
  run: (job: TJob) => Promise<string>;
  onSuccess?: (job: TJob, url: string) => void;
  onError?: (job: TJob, err: unknown) => void;
  delayBetweenJobsMs?: number;
  pauseWhenHidden?: boolean;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Single-flight capture queue: one job at a time, deduped by jobKey.
 *
 * Callbacks (`run`, `onSuccess`, `onError`, `jobKey`) are read from refs so
 * `enqueue` stays referentially stable — callers can safely put it in effect
 * deps without re-firing on every status update (which would re-queue forever).
 */
export function useSerializedCaptureQueue<TJob>({
  jobKey,
  run,
  onSuccess,
  onError,
  delayBetweenJobsMs = 0,
  pauseWhenHidden = false,
}: UseSerializedCaptureQueueOptions<TJob>) {
  const [status, setStatus] = useState<Record<string, CaptureQueueStatus>>({});
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [paused, setPaused] = useState(false);
  const queueRef = useRef<TJob[]>([]);
  const runningRef = useRef(false);
  const pausedRef = useRef(false);
  const enqueuedRef = useRef<Set<string>>(new Set());
  const statusRef = useRef(status);
  statusRef.current = status;

  const jobKeyRef = useRef(jobKey);
  const runRef = useRef(run);
  const onSuccessRef = useRef(onSuccess);
  const onErrorRef = useRef(onError);
  const delayRef = useRef(delayBetweenJobsMs);
  const pauseWhenHiddenRef = useRef(pauseWhenHidden);
  jobKeyRef.current = jobKey;
  runRef.current = run;
  onSuccessRef.current = onSuccess;
  onErrorRef.current = onError;
  delayRef.current = delayBetweenJobsMs;
  pauseWhenHiddenRef.current = pauseWhenHidden;

  const processQueue = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;

    while (queueRef.current.length > 0) {
      if (pauseWhenHiddenRef.current && typeof document !== "undefined" && document.hidden) {
        pausedRef.current = true;
        setPaused(true);
        runningRef.current = false;
        return;
      }

      pausedRef.current = false;
      setPaused(false);

      const job = queueRef.current.shift()!;
      const key = jobKeyRef.current(job);
      setStatus((prev) => ({ ...prev, [key]: "capturing" }));
      try {
        const url = await runRef.current(job);
        setUrls((prev) => ({ ...prev, [key]: url }));
        setStatus((prev) => ({ ...prev, [key]: "idle" }));
        enqueuedRef.current.delete(key);
        onSuccessRef.current?.(job, url);
      } catch (err) {
        console.error("screenshot capture failed", key, err);
        setStatus((prev) => ({ ...prev, [key]: "failed" }));
        enqueuedRef.current.delete(key);
        onErrorRef.current?.(job, err);
      }

      if (queueRef.current.length > 0 && delayRef.current > 0) {
        await sleep(delayRef.current);
      }
    }

    runningRef.current = false;
    pausedRef.current = false;
    setPaused(false);
  }, []);

  useEffect(() => {
    if (!pauseWhenHidden || typeof document === "undefined") return;

    const onVisibilityChange = () => {
      if (document.hidden) {
        if (queueRef.current.length > 0 || runningRef.current) {
          pausedRef.current = true;
          setPaused(true);
        }
        return;
      }
      if (pausedRef.current && queueRef.current.length > 0) {
        pausedRef.current = false;
        setPaused(false);
        void processQueue();
      }
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [pauseWhenHidden, processQueue]);

  const enqueue = useCallback(
    (job: TJob, force = false) => {
      const key = jobKeyRef.current(job);
      if (!force && enqueuedRef.current.has(key)) return;
      if (!force) {
        const st = statusRef.current[key];
        // Only skip in-flight. Failed jobs may be re-queued after Retry / dirty
        // (enqueue is referentially stable, so the page effect will not loop).
        if (st === "capturing" || st === "queued") return;
      }
      enqueuedRef.current.add(key);
      setStatus((prev) => ({ ...prev, [key]: "queued" }));
      queueRef.current = queueRef.current.filter((j) => jobKeyRef.current(j) !== key);
      queueRef.current.push(job);
      void processQueue();
    },
    [processQueue],
  );

  return { enqueue, status, urls, setUrls, setStatus, paused };
}
