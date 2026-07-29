/**
 * Flexible date normalization for content `updated_at` / sitemap lastmod.
 * Accepts ISO dates, ISO datetimes, unix seconds/ms — rejects ambiguous MDY/DMY.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATETIME =
  /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:?\d{2})?$/i;

/** Ambiguous calendar formats we refuse to guess (e.g. 01/02/2024). */
const AMBIGUOUS_SLASH_OR_DASH =
  /^\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}$/;

function fromUnixNumber(n: number): Date | null {
  if (!Number.isFinite(n)) return null;
  // ms if absolute value looks like milliseconds (>= year ~2001 in ms)
  const ms = Math.abs(n) >= 1e12 ? n : n * 1000;
  const d = new Date(ms);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Parse a flexible date/datetime into a Date, or null if unparseable / ambiguous.
 */
export function parseFlexibleDate(raw: unknown): Date | null {
  if (raw === null || raw === undefined || raw === "") return null;

  if (raw instanceof Date) {
    return isNaN(raw.getTime()) ? null : raw;
  }

  if (typeof raw === "number") {
    return fromUnixNumber(raw);
  }

  if (typeof raw === "bigint") {
    return fromUnixNumber(Number(raw));
  }

  if (typeof raw !== "string") {
    return null;
  }

  const s = raw.trim();
  if (!s) return null;

  // Numeric string → unix
  if (/^-?\d+(\.\d+)?$/.test(s)) {
    return fromUnixNumber(Number(s));
  }

  if (AMBIGUOUS_SLASH_OR_DASH.test(s) && !ISO_DATE.test(s)) {
    return null;
  }

  if (ISO_DATE.test(s)) {
    const [y, m, d] = s.split("-").map(Number);
    const date = new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0));
    return isNaN(date.getTime()) ? null : date;
  }

  if (ISO_DATETIME.test(s) || /^\d{4}-\d{2}-\d{2}T/.test(s)) {
    const d = new Date(s.includes(" ") ? s.replace(" ", "T") : s);
    return isNaN(d.getTime()) ? null : d;
  }

  // Last resort: Date.parse only for clearly ISO-like strings with year first
  if (/^\d{4}-/.test(s)) {
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }

  return null;
}

/**
 * Normalize to canonical ISO-8601 UTC string, or null if unparseable.
 */
export function normalizeFlexibleDate(raw: unknown): string | null {
  const d = parseFlexibleDate(raw);
  if (!d) return null;
  return d.toISOString();
}

/**
 * Sitemap &lt;lastmod&gt; date (YYYY-MM-DD) from a normalized ISO string or raw value.
 * Falls back to today's UTC date when raw is missing/invalid.
 */
export function toSitemapLastmod(raw: unknown, fallbackToday = true): string {
  const iso = typeof raw === "string" && /^\d{4}-\d{2}-\d{2}/.test(raw)
    ? raw
    : normalizeFlexibleDate(raw);
  if (iso) {
    return iso.split("T")[0];
  }
  if (fallbackToday) {
    return new Date().toISOString().split("T")[0];
  }
  return "";
}
