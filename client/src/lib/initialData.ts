import { queryClient } from "./queryClient";

export const IS_SERVER = typeof document === 'undefined';

interface SingleQuery {
  queryKey: unknown[];
  data: unknown;
}

export type InitialDataPayload =
  | { queries: SingleQuery[]; queryKey?: never; data?: never }
  | { queryKey: unknown[]; data: unknown; queries?: never };

export let isSSRHydration = false;

export function readInitialDataPayload(): InitialDataPayload | null {
  const script = document.getElementById("__INITIAL_DATA__");
  if (!script) return null;

  try {
    return JSON.parse(script.textContent || "") as InitialDataPayload;
  } catch {
    return null;
  }
}

export function hydrateInitialData() {
  const script = document.getElementById("__INITIAL_DATA__");
  const payload = readInitialDataPayload();
  if (!payload || !script) return;

  try {

    if (payload.queries && Array.isArray(payload.queries)) {
      for (const { queryKey, data } of payload.queries) {
        if (queryKey && data !== undefined) {
          queryClient.setQueryData(queryKey, data);
        }
      }
    } else if (payload.queryKey && payload.data !== undefined) {
      queryClient.setQueryData(payload.queryKey, payload.data);
    }
  } catch {
  }

  isSSRHydration = true;
  document.documentElement.setAttribute("data-ssr-hydrating", "");
  script.remove();
}

export function clearSSRHydration() {
  isSSRHydration = false;
  document.documentElement.removeAttribute("data-ssr-hydrating");
}
