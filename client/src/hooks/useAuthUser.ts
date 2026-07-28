import { useCallback, useState } from "react";
import { useQuery } from "@tanstack/react-query";

/**
 * Consumer (visitor) authentication — completely separate from the debug/editor
 * auth in useDebugAuth. Stores its own token key and never touches `debug_mode`,
 * so using it can never surface the debug bubble.
 */

const AUTH_TOKEN_KEY = "4g_auth_token";

export interface AuthUserProfile {
  valid: boolean;
  id?: number;
  username?: string;
  email?: string;
  first_name?: string;
  last_name?: string;
  phone?: string;
}

export function getConsumerToken(): string | null {
  if (typeof window === "undefined") return null;

  const stored = localStorage.getItem(AUTH_TOKEN_KEY);
  if (stored) return stored;

  // Login redirects append ?token=; persist it under the consumer key.
  // We intentionally do NOT set debug_mode or debug_token here.
  const urlToken = new URLSearchParams(window.location.search).get("token");
  if (urlToken) {
    localStorage.setItem(AUTH_TOKEN_KEY, urlToken);
    return urlToken;
  }

  return null;
}

export function setConsumerToken(token: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(AUTH_TOKEN_KEY, token);
}

export function clearConsumerToken(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(AUTH_TOKEN_KEY);
}

interface UseAuthUserOptions {
  /** Fetch the profile only when needed (e.g. a form with is_signup on the page). */
  enabled?: boolean;
}

export function useAuthUser({ enabled = true }: UseAuthUserOptions = {}) {
  // Keep token in React state so setToken/clearToken re-render and refetch profile.
  const [token, setTokenState] = useState<string | null>(() =>
    typeof window !== "undefined" ? getConsumerToken() : null,
  );

  const setToken = useCallback((next: string) => {
    setConsumerToken(next);
    setTokenState(next);
  }, []);

  const clearToken = useCallback(() => {
    clearConsumerToken();
    setTokenState(null);
  }, []);

  const { data: profile, isLoading, isFetching } = useQuery<AuthUserProfile>({
    queryKey: ["/api/auth/profile", token],
    queryFn: async () => {
      const res = await fetch("/api/auth/profile", {
        headers: { Authorization: `Token ${token}` },
      });
      if (!res.ok) return { valid: false };
      return (await res.json()) as AuthUserProfile;
    },
    enabled: enabled && !!token,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const isLoggedIn = !!token && profile?.valid === true;

  return {
    token,
    profile: isLoggedIn ? profile! : null,
    isLoggedIn,
    isLoading: enabled && !!token && (isLoading || isFetching),
    setToken,
    clearToken,
  };
}
