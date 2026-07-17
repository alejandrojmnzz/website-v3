const TEMPLATE_REGEX = /\{\{\s*([^|}]+?)\s*(?:\|\s*([\s\S]*?))?\s*\}\}/g;
const SINGLE_PREFIX = "single.";
const EXACT_SINGLE_VAR_PATTERN = /^\{\{\s*single\.([a-zA-Z_][a-zA-Z0-9_.]*)\s*(?:\|\s*([^}]*?))?\s*\}\}$/;

export interface VariableCondition {
  query: Record<string, string>;
  value: string;
}

export interface VariableDefinition {
  default?: string;
  conditions?: VariableCondition[];
  by_locale?: Record<string, string>;
  by_region?: Record<string, string>;
  by_location?: Record<string, string>;
}

export interface VariableContext {
  location?: string;
  region?: string;
  locale?: string;
}

export interface ResolvedVariable {
  original: string;
  variableName: string;
  resolvedValue: string;
  source: "condition" | "location" | "region" | "locale" | "default" | "inline" | "single";
  defaultValue: string;
}

export interface ResolveOptions {
  preserveTemplate?: boolean;
  singleEntry?: Record<string, unknown>;
}

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

export function resolveVariable(
  name: string,
  definitions: Record<string, VariableDefinition>,
  context: VariableContext,
): { value: string; source: ResolvedVariable["source"] } | null {
  const def = definitions[name];
  if (!def) return null;

  if (def.conditions && def.conditions.length > 0) {
    for (const condition of def.conditions) {
      const matches = Object.entries(condition.query).every(([key, val]) => {
        const contextVal = (context as Record<string, string | undefined>)[key];
        return contextVal === val;
      });
      if (matches) {
        return { value: condition.value, source: "condition" };
      }
    }
  }

  if (context.location && def.by_location?.[context.location]) {
    return { value: def.by_location[context.location], source: "location" };
  }
  if (context.region && def.by_region?.[context.region]) {
    return { value: def.by_region[context.region], source: "region" };
  }
  if (context.locale && def.by_locale?.[context.locale]) {
    return { value: def.by_locale[context.locale], source: "locale" };
  }
  if (def.default !== undefined) {
    return { value: def.default, source: "default" };
  }
  return null;
}

function resolveSingleVariable(
  fieldPath: string,
  singleEntry: Record<string, unknown>,
): { value: unknown; source: "single" } | null {
  const value = getNestedValue(singleEntry, fieldPath);
  if (value !== undefined && value !== null) {
    return { value, source: "single" };
  }
  return null;
}

export function resolveTemplateString(
  text: string,
  definitions: Record<string, VariableDefinition>,
  context: VariableContext,
  options?: ResolveOptions,
): { text: string; variables: ResolvedVariable[] } {
  const variables: ResolvedVariable[] = [];
  const regex = new RegExp(TEMPLATE_REGEX.source, TEMPLATE_REGEX.flags);
  const preserveTemplate = options?.preserveTemplate ?? false;
  const singleEntry = options?.singleEntry;

  const resolved = text.replace(regex, (match, expression: string, inlineDefault: string) => {
    const name = expression.trim();
    const defVal = (inlineDefault || "").trim();

    if (name.startsWith(SINGLE_PREFIX)) {
      if (!singleEntry) {
        return match;
      }
      const fieldPath = name.slice(SINGLE_PREFIX.length);
      const singleResult = resolveSingleVariable(fieldPath, singleEntry);

      if (preserveTemplate) {
        if (!singleResult && !defVal) {
          return match;
        }
        const displayValue = singleResult ? String(typeof singleResult.value === "object" ? JSON.stringify(singleResult.value) : singleResult.value) : defVal;
        variables.push({
          original: match,
          variableName: name,
          resolvedValue: displayValue,
          source: singleResult ? "single" : "inline",
          defaultValue: defVal,
        });
        return `{{ ${name} | ${displayValue} }}`;
      }

      const singleValue = singleResult ? String(typeof singleResult.value === "object" ? JSON.stringify(singleResult.value) : singleResult.value) : defVal || name;
      variables.push({
        original: match,
        variableName: name,
        resolvedValue: singleValue,
        source: singleResult ? "single" : "inline",
        defaultValue: defVal,
      });
      return singleValue;
    }

    const result = resolveVariable(name, definitions, context);
    const value = result?.value || defVal || name;
    const source = result?.source || "inline";

    variables.push({
      original: match,
      variableName: name,
      resolvedValue: value,
      source,
      defaultValue: defVal,
    });

    if (preserveTemplate) {
      if (!result && !defVal) {
        return match;
      }
      return `{{ ${name} | ${value} }}`;
    }
    return value;
  });

  return { text: resolved, variables };
}

export function resolveDeep(
  data: unknown,
  definitions: Record<string, VariableDefinition>,
  context: VariableContext,
  options?: ResolveOptions,
): { data: unknown; variables: ResolvedVariable[] } {
  const allVariables: ResolvedVariable[] = [];
  const singleEntry = options?.singleEntry;

  function walk(value: unknown): unknown {
    if (typeof value === "string") {
      if (singleEntry && !options?.preserveTemplate) {
        const exactMatch = value.match(EXACT_SINGLE_VAR_PATTERN);
        if (exactMatch) {
          const fieldPath = exactMatch[1];
          const fallback = exactMatch[2]?.trim();
          const resolved = getNestedValue(singleEntry, fieldPath);
          const resolvedValue = resolved !== undefined && resolved !== null ? resolved : (fallback !== undefined ? fallback : value);
          const displayValue = typeof resolvedValue === "object" ? JSON.stringify(resolvedValue) : String(resolvedValue);

          allVariables.push({
            original: value,
            variableName: `single.${fieldPath}`,
            resolvedValue: displayValue,
            source: resolved !== undefined && resolved !== null ? "single" : "inline",
            defaultValue: fallback || "",
          });

          return resolvedValue;
        }
      }

      const { text, variables } = resolveTemplateString(value, definitions, context, options);
      allVariables.push(...variables);
      return text;
    }
    if (Array.isArray(value)) {
      return value.map(walk);
    }
    if (value !== null && typeof value === "object") {
      const result: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        result[k] = walk(v);
      }
      return result;
    }
    return value;
  }

  const resolved = walk(data);
  return { data: resolved, variables: allVariables };
}

export function resolveTemplateFallback(text: string): string {
  return text.replace(
    new RegExp(TEMPLATE_REGEX.source, TEMPLATE_REGEX.flags),
    (match, _expr: string, fallback: string) => {
      const val = (fallback || "").trim();
      return val || match;
    }
  );
}

/**
 * Coerces a resolved single-entry value to a renderable string. Static YAML
 * content can resolve template variables like {{ single.category }} to raw
 * objects (e.g. { slug: "..." }); rendering those directly as React children
 * crashes the page. Picks a sensible text field from objects, else "".
 */
export function coerceToText(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    const candidate = obj.text ?? obj.label ?? obj.name ?? obj.title ?? obj.slug;
    if (typeof candidate === "string" || typeof candidate === "number") return String(candidate);
  }
  return "";
}

export function hasTemplateVariables(text: string): boolean {
  return new RegExp(TEMPLATE_REGEX.source, TEMPLATE_REGEX.flags).test(text);
}

export function extractTemplateTokens(text: string): Array<{ original: string; variableName: string; defaultValue: string; start: number; end: number }> {
  const tokens: Array<{ original: string; variableName: string; defaultValue: string; start: number; end: number }> = [];
  const regex = new RegExp(TEMPLATE_REGEX.source, TEMPLATE_REGEX.flags);
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    tokens.push({
      original: match[0],
      variableName: match[1].trim(),
      defaultValue: (match[2] || "").trim(),
      start: match.index,
      end: match.index + match[0].length,
    });
  }
  return tokens;
}
