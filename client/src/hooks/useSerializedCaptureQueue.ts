import { useCallback, useRef, useState } from "react";

export type CaptureQueueStatus = "idle" | "queued" | "capturing" | "failed";

export interface UseSerializedCaptureQueueOptions<TJob> {
  jobKey: (job: TJob) => string;
  run: (job: TJob) => Promise<string>;
  onSuccess?: (job: TJob, url: string) => void;
  onError?: (job: TJob, err: unknown) => void;
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
}: UseSerializedCaptureQueueOptions<TJob>) {
  const [status, setStatus] = useState<Record<string, CaptureQueueStatus>>({});
  const [urls, setUrls] = useState<Record<string, string>>({});
  const queueRef = useRef<TJob[]>([]);
  const runningRef = useRef(false);
  const enqueuedRef = useRef<Set<string>>(new Set());
  const statusRef = useRef(status);
  statusRef.current = status;

  const jobKeyRef = useRef(jobKey);
  const runRef = useRef(run);
  const onSuccessRef = useRef(onSuccess);
  const onErrorRef = useRef(onError);
  jobKeyRef.current = jobKey;
  runRef.current = run;
  onSuccessRef.current = onSuccess;
  onErrorRef.current = onError;

  const processQueue = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;

    while (queueRef.current.length > 0) {
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
    }

    runningRef.current = false;
  }, []);

  const enqueue = useCallback(
    (job: TJob, force = false) => {
      const key = jobKeyRef.current(job);
      if (!force && enqueuedRef.current.has(key)) return;
      if (!force) {
        const st = statusRef.current[key];
        // Skip in-flight and failed (auto-retry only via force / Regenerate).
        if (st === "capturing" || st === "queued" || st === "failed") return;
      }
      enqueuedRef.current.add(key);
      setStatus((prev) => ({ ...prev, [key]: "queued" }));
      queueRef.current = queueRef.current.filter((j) => jobKeyRef.current(j) !== key);
      queueRef.current.push(job);
      void processQueue();
    },
    [processQueue],
  );

  return { enqueue, status, urls, setUrls, setStatus };
}
