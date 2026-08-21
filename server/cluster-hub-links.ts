import type { ContentIndex } from "./content-index";
import { createPublicUrlResolver, toPublicUrlPath } from "./redirects";

const HREF_RE = /<a\b[^>]*\shref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;

/** Extract raw href values from rendered HTML. */
export function extractHrefPaths(html: string): string[] {
  const out: string[] = [];
  let m: RegExpExecArray | null;
  HREF_RE.lastIndex = 0;
  while ((m = HREF_RE.exec(html)) !== null) {
    const raw = (m[1] ?? m[2] ?? m[3] ?? "").trim();
    if (!raw || raw.startsWith("#") || raw.startsWith("mailto:") || raw.startsWith("tel:")) {
      continue;
    }
    out.push(raw);
  }
  return out;
}

function hrefToPathname(href: string): string | null {
  const trimmed = href.trim();
  if (!trimmed) return null;
  try {
    if (/^https?:\/\//i.test(trimmed)) {
      return new URL(trimmed).pathname;
    }
  } catch {
    return null;
  }
  const path = trimmed.split("?")[0].split("#")[0];
  return path.startsWith("/") ? path : null;
}

function normalizePathForMatch(
  rawPath: string,
  locale: string,
  ci: ContentIndex,
): string {
  let current = toPublicUrlPath(rawPath);
  const resolver = createPublicUrlResolver(ci, { freshRedirects: true });
  const seen = new Set<string>();
  for (let i = 0; i < 12; i++) {
    if (seen.has(current)) break;
    seen.add(current);
    const result = resolver.test(current, locale);
    if (result.match && result.resolvedTo && !/^https?:\/\//i.test(result.resolvedTo)) {
      const next = toPublicUrlPath(result.resolvedTo);
      if (next === current) break;
      current = next;
      continue;
    }
    break;
  }
  const stripped = current.endsWith("/") && current.length > 1 ? current.slice(0, -1) : current;
  return stripped.toLowerCase();
}

export type ClusterMemberLinkTarget = {
  memberId: string;
  memberSlug: string;
  memberPath: string;
  locale: string;
};

export function findMissingMemberLinks(opts: {
  html: string;
  members: ClusterMemberLinkTarget[];
  ci: ContentIndex;
}): { memberPath: string; memberSlug: string; memberId: string }[] {
  const hrefs = extractHrefPaths(opts.html);
  const linked = new Set<string>();
  for (const href of hrefs) {
    const pathname = hrefToPathname(href);
    if (!pathname) continue;
    for (const locale of [...new Set(opts.members.map((m) => m.locale))]) {
      linked.add(normalizePathForMatch(pathname, locale, opts.ci));
    }
  }

  const missing: { memberPath: string; memberSlug: string; memberId: string }[] = [];
  for (const member of opts.members) {
    const path = member.memberPath?.trim();
    if (!path) continue;
    const norm = normalizePathForMatch(path, member.locale, opts.ci);
    if (!linked.has(norm)) {
      missing.push({
        memberPath: path,
        memberSlug: member.memberSlug,
        memberId: member.memberId,
      });
    }
  }
  return missing;
}
