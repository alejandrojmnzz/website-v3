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

  const processQueue = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;

    while (queueRef.current.length > 0) {
      const job = queueRef.current.shift()!;
      const key = jobKey(job);
      setStatus((prev) => ({ ...prev, [key]: "capturing" }));
      try {
        const url = await run(job);
        setUrls((prev) => ({ ...prev, [key]: url }));
        setStatus((prev) => ({ ...prev, [key]: "idle" }));
        enqueuedRef.current.delete(key);
        onSuccess?.(job, url);
      } catch (err) {
        console.error("screenshot capture failed", key, err);
        setStatus((prev) => ({ ...prev, [key]: "failed" }));
        enqueuedRef.current.delete(key);
        onError?.(job, err);
      }
    }

    runningRef.current = false;
  }, [jobKey, run, onSuccess, onError]);

  const enqueue = useCallback(
    (job: TJob, force = false) => {
      const key = jobKey(job);
      if (!force && enqueuedRef.current.has(key)) return;
      if (!force) {
        const st = status[key];
        if (st === "capturing" || st === "queued") return;
      }
      enqueuedRef.current.add(key);
      setStatus((prev) => ({ ...prev, [key]: "queued" }));
      queueRef.current = queueRef.current.filter((j) => jobKey(j) !== key);
      queueRef.current.push(job);
      void processQueue();
    },
    [jobKey, processQueue, status],
  );

  return { enqueue, status, urls, setUrls, setStatus };
}
