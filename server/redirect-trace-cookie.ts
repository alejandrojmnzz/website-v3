import type { Request, Response } from "express";
import { getParentCookieDomain } from "./versioning/cookie-utils";
import {
  REDIRECT_TRACE_COOKIE_NAME,
  REDIRECT_TRACE_MAX_AGE_SECONDS,
  appendRedirectTraceHop,
  encodeRedirectTraceCookie,
  parseRedirectTraceCookie,
  type RedirectTraceHop,
} from "@shared/redirect-trace";

export function applyRedirectTraceCookie(req: Request, res: Response, hop: RedirectTraceHop): void {
  const existing = parseRedirectTraceCookie(req.cookies?.[REDIRECT_TRACE_COOKIE_NAME]);
  const hops = appendRedirectTraceHop(existing, hop);
  const domain = getParentCookieDomain(req.hostname);
  res.cookie(REDIRECT_TRACE_COOKIE_NAME, encodeRedirectTraceCookie(hops), {
    maxAge: REDIRECT_TRACE_MAX_AGE_SECONDS * 1000,
    httpOnly: false,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    ...(domain ? { domain } : {}),
  });
}
