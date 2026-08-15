import {
  encodeRedirectTraceCookie,
  parseRedirectTraceCookie,
  type RedirectTraceHop,
} from "@shared/redirect-trace";

export const REDIRECT_TRACE_STORAGE_PREFIX = "4g_redir_trace:";

export type RedirectTraceStorage = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
  length: number;
  key: (index: number) => string | null;
};

export function redirectTraceStorageKey(pathname: string): string {
  return `${REDIRECT_TRACE_STORAGE_PREFIX}${pathname}`;
}

export function listStorageKeys(storage: RedirectTraceStorage): string[] {
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const k = storage.key(i);
    if (k) keys.push(k);
  }
  return keys;
}

export function clearRedirectTraceStorageExcept(
  storage: RedirectTraceStorage,
  keepPathname: string,
): void {
  const keep = redirectTraceStorageKey(keepPathname);
  for (const key of listStorageKeys(storage)) {
    if (key.startsWith(REDIRECT_TRACE_STORAGE_PREFIX) && key !== keep) {
      storage.removeItem(key);
    }
  }
}

/**
 * Cookie wins when present. Persist hops under the pathname (search ignored so
 * `?rebuilt=1` does not change the key). Drop keys for other pathnames.
 */
export function loadRedirectTraceHops(args: {
  pathname: string;
  cookieRaw: string | null | undefined;
  storage: RedirectTraceStorage;
}): { hops: RedirectTraceHop[]; cookieToClear: boolean } {
  const key = redirectTraceStorageKey(args.pathname);
  const fromCookie = parseRedirectTraceCookie(args.cookieRaw);
  if (fromCookie.length > 0) {
    args.storage.setItem(key, encodeRedirectTraceCookie(fromCookie));
    clearRedirectTraceStorageExcept(args.storage, args.pathname);
    return { hops: fromCookie, cookieToClear: true };
  }
  const stored = parseRedirectTraceCookie(args.storage.getItem(key));
  clearRedirectTraceStorageExcept(args.storage, args.pathname);
  return { hops: stored, cookieToClear: !!args.cookieRaw };
}
