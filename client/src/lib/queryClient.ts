import { QueryClient, QueryFunction } from "@tanstack/react-query";
import { getSessionHeaders } from "./sessionHeaders";
import { getDebugToken } from "@/hooks/useDebugAuth";
import { injectDevSite } from "./devSite";

export { getDevSiteOverride, setDevSiteOverride, clearDevSiteOverride } from "./devSite";

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

export function apiFetch(url: string, init?: RequestInit): Promise<Response> {
  return fetch(injectDevSite(url), {
    ...init,
    headers: {
      ...(init?.headers || {}),
      ...getSessionHeaders(),
    },
  });
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const res = await fetch(injectDevSite(url), {
    method,
    headers: {
      ...(data ? { "Content-Type": "application/json" } : {}),
      ...getSessionHeaders(),
    },
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  await throwIfResNotOk(res);
  return res;
}

export async function apiRequestWithAuth(
  method: string,
  url: string,
  data?: unknown,
): Promise<Response> {
  const token = getDebugToken();
  const res = await fetch(injectDevSite(url), {
    method,
    headers: {
      ...(data ? { "Content-Type": "application/json" } : {}),
      ...getSessionHeaders(),
      ...(token ? { Authorization: `Token ${token}` } : {}),
    },
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const res = await fetch(injectDevSite(queryKey[0] as string), {
      credentials: "include",
      headers: getSessionHeaders(),
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
