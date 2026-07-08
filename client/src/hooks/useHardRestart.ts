import { useCallback, useRef, useState } from "react";
import { getDebugToken } from "@/hooks/useDebugAuth";

export type HardRestartPhase = "idle" | "restarting" | "online" | "failed";

interface HealthResponse {
  status?: string;
  bootId?: string | null;
}

const POLL_INTERVAL_MS = 2000;
const RESTART_TIMEOUT_MS = 90_000;

async function fetchBootId(): Promise<string | null> {
  const res = await fetch("/health", { cache: "no-store" });
  if (!res.ok) throw new Error(`health ${res.status}`);
  const data = (await res.json()) as HealthResponse;
  return data.bootId ?? null;
}

/**
 * Drives a hard restart: captures the current process boot id, POSTs to the
 * staff-gated hard-restart endpoint, then polls /health until a *different*
 * boot id comes back online (proving the process actually relaunched) or a
 * timeout elapses. Shared by the Server tab and the Site Manager modal.
 */
export function useHardRestart() {
  const [phase, setPhase] = useState<HardRestartPhase>("idle");
  const [message, setMessage] = useState<string>("");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const reset = useCallback(() => {
    clearTimer();
    setPhase("idle");
    setMessage("");
  }, [clearTimer]);

  const start = useCallback(async () => {
    clearTimer();
    setPhase("restarting");
    setMessage("Sending restart signal…");

    // Capture the boot id we're restarting away from (best effort).
    let prevBootId: string | null = null;
    try {
      prevBootId = await fetchBootId();
    } catch {
      /* server may already be unavailable; polling will still detect recovery */
    }

    // Trigger the restart. A network error here often just means the process
    // exited before the response flushed — treat it as "restart in progress".
    try {
      const token = getDebugToken();
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers.Authorization = `Token ${token}`;
      const res = await fetch("/api/admin/server/hard-restart", { method: "POST", headers });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setPhase("failed");
        setMessage((data as { error?: string }).error || `Failed to trigger restart (${res.status}).`);
        return;
      }
    } catch {
      /* ignore — fall through to polling */
    }

    setMessage("Restarting… waiting for the server to come back online.");

    const deadline = Date.now() + RESTART_TIMEOUT_MS;
    let sawDown = false;

    const poll = async () => {
      if (Date.now() > deadline) {
        setPhase("failed");
        setMessage(
          "The server did not come back online within 90 seconds. It may need a manual rollback or redeploy from the platform.",
        );
        return;
      }
      try {
        const bootId = await fetchBootId();
        const bootChanged = !!prevBootId && !!bootId && bootId !== prevBootId;
        // Online when either the boot id changed (definitive) or we observed the
        // server go down and then respond again (covers a failed prev capture).
        if (bootChanged || (sawDown && bootId)) {
          setPhase("online");
          setMessage("Back online ✓");
          return;
        }
        // Reachable but same boot id and never saw it drop yet — keep waiting.
      } catch {
        sawDown = true;
      }
      timerRef.current = setTimeout(poll, POLL_INTERVAL_MS);
    };

    timerRef.current = setTimeout(poll, POLL_INTERVAL_MS);
  }, [clearTimer]);

  return { phase, message, start, reset };
}
