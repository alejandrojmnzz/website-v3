import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

interface SchemaReference {
  include?: string[];
  overrides?: Record<string, Record<string, unknown>>;
}

interface SchemaResponse {
  schemas: Record<string, unknown>[];
}

async function fetchMergedSchemas(
  schemaRef: SchemaReference,
  locale: string
): Promise<Record<string, unknown>[]> {
  const response = await fetch(`/api/schema/merge?locale=${locale}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(schemaRef),
  });

  if (!response.ok) {
    throw new Error("Failed to fetch schemas");
  }

  const data: SchemaResponse = await response.json();
  return data.schemas;
}

export function useSchemaOrg(schemaRef?: SchemaReference): void {
  const { i18n } = useTranslation();
  const locale = i18n.language?.startsWith("es") ? "es" : "en";
  const scriptRefs = useRef<HTMLScriptElement[]>([]);

  const { data: schemas } = useQuery({
    queryKey: ["/api/schema/merge", schemaRef?.include, schemaRef?.overrides, locale],
    queryFn: () => {
      if (!schemaRef || !schemaRef.include || schemaRef.include.length === 0) {
        return Promise.resolve([]);
      }
      return fetchMergedSchemas(schemaRef, locale);
    },
    enabled: !!schemaRef && !!schemaRef.include && schemaRef.include.length > 0,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });

  useEffect(() => {
    // Clean up previous scripts
    for (const script of scriptRefs.current) {
      if (script.parentNode) {
        script.parentNode.removeChild(script);
      }
    }
    scriptRefs.current = [];

    if (schemas && schemas.length > 0) {
      const hasSsrSchemas = document.querySelector('head script[type="application/ld+json"][data-ssr="true"]') !== null;
      if (hasSsrSchemas) {
        return;
      }

      for (const schema of schemas) {
        const script = document.createElement("script");
        script.type = "application/ld+json";
        script.textContent = JSON.stringify(schema);
        document.head.appendChild(script);
        scriptRefs.current.push(script);
      }
    }

    // Cleanup on unmount
    return () => {
      for (const script of scriptRefs.current) {
        if (script.parentNode) {
          script.parentNode.removeChild(script);
        }
      }
      scriptRefs.current = [];
    };
  }, [schemas]);
}

export function useDefaultSchemas(): void {
  // Retained as a no-op for any leftover imports. Production JSON-LD is SSR-only
  // from section contributors (schema_org / faq / article / breadcrumb + org dual-emit).
}
