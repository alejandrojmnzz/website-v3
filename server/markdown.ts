const markdownCache = new Map<string, { content: string; fetched_at: number }>();
import { child } from "./logger";
const log = child({ module: "markdown" });



export async function fetchMarkdownContent(readmeUrl: string): Promise<string> {
  const ttlMs = 24 * 60 * 60 * 1000;

  const cached = markdownCache.get(readmeUrl);
  if (cached && Date.now() - cached.fetched_at < ttlMs) {
    return cached.content;
  }

  try {
    const response = await fetch(readmeUrl);
    if (!response.ok) return "";
    const text = await response.text();
    const frontmatterRegex = /^---[\s\S]*?---\s*/;
    const content = text.replace(frontmatterRegex, "").trim();
    markdownCache.set(readmeUrl, { content, fetched_at: Date.now() });
    return content;
  } catch (err) {
    log.error({ err: err }, `[Markdown] Failed to fetch from ${readmeUrl}:`);
    return cached?.content || "";
  }
}

export function clearMarkdownCache(slug?: string): void {
  if (!slug) {
    markdownCache.clear();
    log.info("[Markdown] Cleared all cache entries");
    void import("./markdown-enhance").then((m) => m.clearMarkdownEnhanceCache());
    return;
  }
  const keys = Array.from(markdownCache.keys());
  for (const url of keys) {
    if (url.includes(slug)) {
      markdownCache.delete(url);
      log.info(`[Markdown] Cleared cache for slug containing: ${slug}`);
    }
  }
  // Highlight cache is content-hash keyed; clear all when any slug is invalidated.
  void import("./markdown-enhance").then((m) => m.clearMarkdownEnhanceCache());
}

export function clearMarkdownCacheByUrl(readmeUrl: string): boolean {
  return markdownCache.delete(readmeUrl);
}
