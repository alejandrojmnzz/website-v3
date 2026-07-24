/** Pad to 2 digits for HTML date/datetime-local values. */
function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** True when the string carries an explicit timezone (Z or ±HH:MM / ±HHMM). */
export function isTimezoneAwareDate(value: string): boolean {
  return /(?:[zZ]|[+-]\d{2}:?\d{2})$/.test(value.trim());
}

/** True for calendar dates with no time component (YYYY-MM-DD). */
export function isDateOnlyValue(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value.trim());
}

/**
 * Parse a stored date/datetime for editing.
 * - TZ-aware (Z or ±offset): absolute instant → local wall time
 * - Naive datetime (no offset): treat as local wall time (no day-shift)
 * - Date-only: local calendar date at 00:00 (avoid UTC parse of YYYY-MM-DD)
 */
export function parseStoredDateTime(raw: string): Date | null {
  const s = raw.trim();
  if (!s) return null;

  if (isDateOnlyValue(s)) {
    const [y, m, d] = s.split("-").map(Number);
    const date = new Date(y, m - 1, d, 0, 0, 0, 0);
    return isNaN(date.getTime()) ? null : date;
  }

  if (!isTimezoneAwareDate(s)) {
    const m = s.match(
      /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,6}))?)?/,
    );
    if (m) {
      const ms = m[7] ? Number(m[7].padEnd(3, "0").slice(0, 3)) : 0;
      const date = new Date(
        Number(m[1]),
        Number(m[2]) - 1,
        Number(m[3]),
        Number(m[4]),
        Number(m[5]),
        m[6] ? Number(m[6]) : 0,
        ms,
      );
      return isNaN(date.getTime()) ? null : date;
    }
  }

  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

/** Stored value → datetime-local (local wall time). Supports aware + naive + date-only. */
export function toDatetimeLocalValue(raw: string): string {
  const d = parseStoredDateTime(raw);
  if (!d) return "";
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/**
 * datetime-local → UTC ISO-8601.
 * Edits always persist timezone-aware so naive inputs get upgraded on save.
 */
export function fromDatetimeLocalValue(local: string): string {
  if (!local) return "";
  const d = new Date(local);
  if (isNaN(d.getTime())) return local;
  return d.toISOString();
}

/** Stored value → HTML date input (YYYY-MM-DD). Date-only strings keep their calendar day. */
export function toDateInputValue(raw: string): string {
  const s = raw.trim();
  if (!s) return "";
  if (isDateOnlyValue(s)) return s;
  const d = parseStoredDateTime(s);
  if (!d) return s.length >= 10 ? s.slice(0, 10) : "";
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Store date-only fields as YYYY-MM-DD (no timezone). */
export function fromDateInputValue(local: string): string {
  return local || "";
}
