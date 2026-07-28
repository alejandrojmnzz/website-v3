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
