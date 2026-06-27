import { ContentInfo, MenuView, STORAGE_KEY } from "../types";

export function deslugify(slug: string): string {
  return slug
    .split("-")
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const PLURAL_TO_SINGULAR: Record<string, string> = {
  programs: "program",
  pages: "page",
  landings: "landing",
  locations: "location",
};

const HOME_PATH_RE = /^\/(?:en|es)?\/?$/;

export function detectContentInfo(
  pathname: string,
  contentTypes?: Record<string, { directory: string; url_pattern: Record<string, string> }> | null,
  homePage?: { type: string; slug: string } | null
): ContentInfo {
  if (HOME_PATH_RE.test(pathname)) {
    const hp = homePage ?? { type: "page", slug: "home" };
    return { type: hp.type, slug: hp.slug, label: capitalize(hp.type) };
  }

  const previewMatch = pathname.match(/^\/private\/preview\/([^/]+)\/([^/]+)\/?$/);
  if (previewMatch) {
    let type = previewMatch[1];
    type = PLURAL_TO_SINGULAR[type] || type;
    if (contentTypes) {
      for (const [name, ct] of Object.entries(contentTypes)) {
        if (ct.directory === previewMatch[1] || name === type) {
          type = name;
          break;
        }
      }
    }
    return { type, slug: previewMatch[2], label: capitalize(type) };
  }

  const versionsMatch = pathname.match(/^\/private\/([^/]+)\/([^/]+)\/versions\/?$/);
  if (versionsMatch) {
    let type = versionsMatch[1];
    type = PLURAL_TO_SINGULAR[type] || type;
    if (contentTypes) {
      for (const [name, ct] of Object.entries(contentTypes)) {
        if (ct.directory === versionsMatch[1] || name === type) {
          type = name;
          break;
        }
      }
    }
    return { type, slug: versionsMatch[2], label: capitalize(type) };
  }

  if (contentTypes) {
    const sortedTypes = Object.entries(contentTypes).sort(([a], [b]) => {
      if (a === 'page') return 1;
      if (b === 'page') return -1;
      return 0;
    });

    for (const [typeName, ct] of sortedTypes) {
      for (const [locale, pattern] of Object.entries(ct.url_pattern ?? {})) {
        let slugGroupIndex = 1;
        let paramIndex = 0;
        const regexStr = '^' + pattern.replace(/:([a-zA-Z_]+)/g, (_m, name) => {
          paramIndex++;
          if (name === 'slug') slugGroupIndex = paramIndex;
          return '([^/]+)';
        }) + '\\/?$';
        try {
          const regex = new RegExp(regexStr);
          const match = pathname.match(regex);
          if (match) {
            return { type: typeName, slug: match[slugGroupIndex], label: capitalize(typeName) };
          }
        } catch {}
      }
    }
  }

  const pageMatch = pathname.match(/^\/(en|es)\/([^/]+)\/?$/);
  if (pageMatch) {
    return { type: "page", slug: pageMatch[2], label: "Page" };
  }

  return { type: null, slug: null, label: "" };
}

export function getContentFilePath(type: string | null, slug: string | null, locale?: string | null, variant?: string | null): string {
  if (!type || !slug) return "";
  
  if (variant && locale) {
    return `${type}/${slug}/${variant}.${locale}.yml`;
  }
  
  if (locale) {
    return `${type}/${slug}/${locale}.yml`;
  }
  
  return `${type}/${slug}/`;
}

export const getPersistedMenuView = (): MenuView => {
  if (typeof window !== "undefined") {
    const stored = sessionStorage.getItem(STORAGE_KEY);
    if (stored === "main" || stored === "components" || stored === "sitemap" || stored === "versioning" || stored === "menus") {
      return stored;
    }
  }
  return "main";
};
