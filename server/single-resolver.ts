const SINGLE_VAR_PATTERN = /\{\{\s*single\.([a-zA-Z_][a-zA-Z0-9_.]*)\s*(?:\|\s*([^}]*?))?\s*\}\}/g;
const EXACT_SINGLE_VAR_PATTERN = /^\{\{\s*single\.([a-zA-Z_][a-zA-Z0-9_.]*)\s*(?:\|\s*([^}]*?))?\s*\}\}$/;

function getNestedValue(obj: Record<string, unknown>, dotPath: string): unknown {
  const parts = dotPath.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function resolveString(str: string, singleItem: Record<string, unknown>): unknown {
  const exactMatch = str.match(EXACT_SINGLE_VAR_PATTERN);
  if (exactMatch) {
    const fieldPath = exactMatch[1];
    // Group 2 is present only when `| fallback` was written (may be empty string).
    const hasFallback = exactMatch[2] !== undefined;
    const fallback = exactMatch[2]?.trim();
    const value = getNestedValue(singleItem, fieldPath);
    if (value !== undefined && value !== null) return value;
    if (hasFallback) return fallback ?? "";
    return null;
  }

  if (!SINGLE_VAR_PATTERN.test(str)) return str;
  SINGLE_VAR_PATTERN.lastIndex = 0;

  return str.replace(SINGLE_VAR_PATTERN, (_match, fieldPath: string, fallback?: string) => {
    const value = getNestedValue(singleItem, fieldPath);
    if (value !== undefined && value !== null) {
      if (typeof value === "object") return JSON.stringify(value);
      return String(value);
    }
    if (fallback !== undefined) return fallback.trim();
    return "";
  });
}

export function resolveSingleVars(data: unknown, singleItem: Record<string, unknown>): unknown {
  if (typeof data === "string") {
    return resolveString(data, singleItem);
  }

  if (Array.isArray(data)) {
    return data.map((item) => resolveSingleVars(item, singleItem));
  }

  if (data !== null && typeof data === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
      result[key] = resolveSingleVars(value, singleItem);
    }
    return result;
  }

  return data;
}
