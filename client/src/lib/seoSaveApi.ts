import type { SeoMeta } from "@/components/DebugBubble/types";
import { getDebugToken, resolveAuthorName } from "@/hooks/useDebugAuth";
import {
  buildMetaSaveOperations,
  liveSnippetClearBlocked,
  type MetaSaveOperation,
} from "@/lib/buildMetaSaveOperations";

export const VISIBILITY_META_KEYS = [
  "robots",
  "priority",
  "change_frequency",
] as const;

export const OPTIONAL_META_KEYS = ["canonical_url", "og_image"] as const;

export const SNIPPET_META_KEYS = ["page_title", "description"] as const;

async function authHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const token = getDebugToken();
  if (token) headers["X-Debug-Token"] = token;
  return headers;
}

export async function postMetaPatch(opts: {
  contentType: string;
  slug: string;
  locale: string;
  operations: MetaSaveOperation[];
  variant?: string;
}): Promise<void> {
  if (opts.operations.length === 0) return;
  const headers = await authHeaders();
  const author = await resolveAuthorName();
  const body: Record<string, unknown> = {
    contentType: opts.contentType,
    slug: opts.slug,
    locale: opts.locale,
    author: author || undefined,
    operations: opts.operations,
  };
  if (opts.variant) body.variant = opts.variant;
  const res = await fetch("/api/content/edit-sections", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error((errData as { error?: string }).error || "Failed to save meta");
  }
}

export async function saveLandingLocations(opts: {
  slug: string;
  locations: string[];
}): Promise<void> {
  const headers = await authHeaders();
  const author = await resolveAuthorName();
  const res = await fetch("/api/content/update-locations", {
    method: "POST",
    headers,
    body: JSON.stringify({
      contentType: "landing",
      slug: opts.slug,
      locations: opts.locations,
      author: author || undefined,
    }),
  });
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error((errData as { error?: string }).error || "Failed to save locations");
  }
}

function opsForDirtyKeys(
  input: Omit<Parameters<typeof buildMetaSaveOperations>[0], "dirtyKeys"> & {
    dirtyKeys: Iterable<string>;
  },
): MetaSaveOperation[] {
  return buildMetaSaveOperations({
    ...input,
    dirtyKeys: new Set(input.dirtyKeys),
  });
}

export function buildVisibilityOperations(
  input: Omit<Parameters<typeof buildMetaSaveOperations>[0], "dirtyKeys"> & {
    dirtyKeys: Set<string>;
  },
): MetaSaveOperation[] {
  const keys = [...VISIBILITY_META_KEYS].filter((k) => input.dirtyKeys.has(k));
  return opsForDirtyKeys({ ...input, dirtyKeys: keys });
}

export function buildOptionalMetaOperations(
  input: Omit<Parameters<typeof buildMetaSaveOperations>[0], "dirtyKeys"> & {
    dirtyKeys: Set<string>;
  },
): MetaSaveOperation[] {
  const keys = [...OPTIONAL_META_KEYS].filter((k) => input.dirtyKeys.has(k));
  return opsForDirtyKeys({ ...input, dirtyKeys: keys });
}

export function buildSnippetOperations(
  input: Omit<Parameters<typeof buildMetaSaveOperations>[0], "dirtyKeys"> & {
    dirtyKeys: Set<string>;
  },
): MetaSaveOperation[] {
  const keys = [...SNIPPET_META_KEYS].filter((k) => input.dirtyKeys.has(k));
  return opsForDirtyKeys({ ...input, dirtyKeys: keys });
}

export type MetaSaveContext = {
  context: "live" | "variant";
  seoMeta: SeoMeta;
  dirtyKeys: Set<string>;
  displayMeta?: Record<string, unknown>;
  liveMeta?: Record<string, unknown>;
  metaOverrides?: string[];
};

export async function saveVisibilitySettings(
  ctx: MetaSaveContext & {
    contentType: string;
    slug: string;
    locale: string;
    variant?: string;
  },
): Promise<void> {
  const operations = buildVisibilityOperations(ctx);
  if (operations.length === 0) return;
  await postMetaPatch({
    contentType: ctx.contentType,
    slug: ctx.slug,
    locale: ctx.locale,
    variant: ctx.variant,
    operations,
  });
}

export async function saveOptionalMetaFields(
  ctx: MetaSaveContext & {
    contentType: string;
    slug: string;
    locale: string;
    variant?: string;
    keys: readonly string[];
  },
): Promise<void> {
  const operations = buildOptionalMetaOperations({
    ...ctx,
    dirtyKeys: new Set([...ctx.dirtyKeys].filter((k) => ctx.keys.includes(k))),
  });
  if (operations.length === 0) return;
  await postMetaPatch({
    contentType: ctx.contentType,
    slug: ctx.slug,
    locale: ctx.locale,
    variant: ctx.variant,
    operations,
  });
}

export async function saveSnippetMeta(
  ctx: MetaSaveContext & {
    contentType: string;
    slug: string;
    locale: string;
    variant?: string;
  },
): Promise<void> {
  if (ctx.context === "live" && liveSnippetClearBlocked(ctx.seoMeta, ctx.dirtyKeys)) {
    throw new Error(
      "Title and description cannot be cleared on a live locale. Enter a value or cancel.",
    );
  }
  const operations = buildSnippetOperations(ctx);
  if (operations.length === 0) return;
  await postMetaPatch({
    contentType: ctx.contentType,
    slug: ctx.slug,
    locale: ctx.locale,
    variant: ctx.variant,
    operations,
  });
}
