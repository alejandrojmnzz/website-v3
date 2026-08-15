import { describe, expect, it } from "vitest";
import { encodeRedirectTraceCookie, type RedirectTraceHop } from "@shared/redirect-trace";
import {
  REDIRECT_TRACE_STORAGE_PREFIX,
  loadRedirectTraceHops,
  redirectTraceStorageKey,
  type RedirectTraceStorage,
} from "./redirectTraceSession";

function hop(from: string, to: string): RedirectTraceHop {
  return { from, to, status: 301, matchType: "fallback" };
}

function memoryStorage(initial: Record<string, string> = {}): RedirectTraceStorage {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
    get length() {
      return map.size;
    },
    key: (index) => [...map.keys()][index] ?? null,
  };
}

describe("redirectTraceSession", () => {
  it("keys by pathname only so ?rebuilt=1 does not change the key", () => {
    const path = "/private/preview/blog/foo";
    expect(redirectTraceStorageKey(path)).toBe(`${REDIRECT_TRACE_STORAGE_PREFIX}${path}`);
    expect(redirectTraceStorageKey(path)).not.toContain("rebuilt");
  });

  it("cookie wins and is copied to pathname-keyed sessionStorage", () => {
    const pathname = "/private/preview/blog/foo";
    const hops = [hop("/es/a", "/es/blog/a")];
    const storage = memoryStorage();
    const result = loadRedirectTraceHops({
      pathname,
      cookieRaw: encodeRedirectTraceCookie(hops),
      storage,
    });
    expect(result.hops).toEqual(hops);
    expect(result.cookieToClear).toBe(true);
    expect(storage.getItem(redirectTraceStorageKey(pathname))).toBe(encodeRedirectTraceCookie(hops));
  });

  it("falls back to sessionStorage when cookie is empty (rebuild reload)", () => {
    const pathname = "/private/preview/blog/foo";
    const hops = [hop("/es/a", "/es/blog/a")];
    const storage = memoryStorage({
      [redirectTraceStorageKey(pathname)]: encodeRedirectTraceCookie(hops),
    });
    const result = loadRedirectTraceHops({
      pathname,
      cookieRaw: null,
      storage,
    });
    expect(result.hops).toEqual(hops);
    expect(result.cookieToClear).toBe(false);
  });

  it("pathname change clears other path keys", () => {
    const hopsA = [hop("/es/a", "/es/blog/a")];
    const hopsB = [hop("/es/b", "/es/blog/b")];
    const storage = memoryStorage({
      [redirectTraceStorageKey("/old")]: encodeRedirectTraceCookie(hopsA),
    });
    const result = loadRedirectTraceHops({
      pathname: "/new",
      cookieRaw: encodeRedirectTraceCookie(hopsB),
      storage,
    });
    expect(result.hops).toEqual(hopsB);
    expect(storage.getItem(redirectTraceStorageKey("/old"))).toBeNull();
    expect(storage.getItem(redirectTraceStorageKey("/new"))).toBe(encodeRedirectTraceCookie(hopsB));
  });
});
