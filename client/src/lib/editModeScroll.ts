const STORAGE_KEY = "4geeks_edit_mode_scroll";

let restoreGeneration = 0;

/** Save window scroll before Edit ↔ Read route switches. */
export function saveEditModeScrollPosition(): void {
  if (typeof window === "undefined") return;
  restoreGeneration += 1;
  sessionStorage.setItem(STORAGE_KEY, String(window.scrollY));
}

function readStoredScrollY(): number | null {
  if (typeof window === "undefined") return null;
  const raw = sessionStorage.getItem(STORAGE_KEY);
  if (raw == null) return null;
  const y = Number(raw);
  if (!Number.isFinite(y) || y <= 0) {
    sessionStorage.removeItem(STORAGE_KEY);
    return null;
  }
  return y;
}

/**
 * Restore scroll saved by {@link saveEditModeScrollPosition}.
 * Retries until the document is tall enough (content loaded) or `maxMs` elapses.
 * No-ops when nothing is stored, or when the URL has a hash (hash scroll wins).
 */
export function restoreEditModeScrollPosition(options?: { maxMs?: number }): void {
  if (typeof window === "undefined") return;
  if (window.location.hash) {
    sessionStorage.removeItem(STORAGE_KEY);
    return;
  }

  const y = readStoredScrollY();
  if (y == null) return;

  const maxMs = options?.maxMs ?? 5000;
  const gen = ++restoreGeneration;
  const startedAt = performance.now();

  const apply = () => {
    window.scrollTo(0, y);
  };

  const tick = () => {
    if (gen !== restoreGeneration) return;

    const scrollHeight = Math.max(
      document.documentElement.scrollHeight,
      document.body.scrollHeight,
    );
    const enoughHeight = scrollHeight >= y + Math.min(window.innerHeight, 400);
    const timedOut = performance.now() - startedAt >= maxMs;

    if (enoughHeight || timedOut) {
      apply();
      sessionStorage.removeItem(STORAGE_KEY);
      requestAnimationFrame(apply);
      return;
    }

    requestAnimationFrame(tick);
  };

  requestAnimationFrame(tick);
}
