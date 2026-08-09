/** Marker injected by server markdown enhancement — strip before word count. */
export const ARTICLE_HTML_MARKER = "<!--article-html-v1-->";

/**
 * Estimate reading time from markdown/HTML article text (~200 wpm).
 * Shared by ArticleDefault and OG / entry-preview so labels stay consistent.
 */
export function estimateReadingMinutes(content: string): number {
  const text = content
    .replace(ARTICLE_HTML_MARKER, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/[`#>*_\[\]()!|-]/g, " ");
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(words / 200));
}

/** Article body strings from page `sections` in page order. */
export function articleContentsFromSections(sections: unknown): string[] {
  if (!Array.isArray(sections)) return [];
  const out: string[] = [];
  for (const raw of sections) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const s = raw as Record<string, unknown>;
    if (s.type !== "article") continue;
    if (typeof s.content === "string" && s.content.trim()) out.push(s.content);
  }
  return out;
}

/** Concatenated article bodies, or null when none. */
export function combinedArticleContentFromSections(sections: unknown): string | null {
  const parts = articleContentsFromSections(sections);
  if (parts.length === 0) return null;
  return parts.join("\n\n");
}

/** Reading minutes from all article sections on a page (split articles). */
export function estimateReadingMinutesFromSections(sections: unknown): number | undefined {
  const combined = combinedArticleContentFromSections(sections);
  if (!combined) return undefined;
  return estimateReadingMinutes(combined);
}

/** Label like "7 min read", or null when content is empty / not a string. */
export function formatReadingTimeLabel(content: unknown): string | null {
  if (typeof content !== "string" || !content.trim()) return null;
  return `${estimateReadingMinutes(content)} min read`;
}

/** Label from a precomputed minute count (list API may strip body but keep this). */
export function formatReadingMinutesLabel(minutes: unknown): string | null {
  if (typeof minutes !== "number" || !Number.isFinite(minutes) || minutes < 1) return null;
  return `${Math.max(1, Math.ceil(minutes))} min read`;
}
