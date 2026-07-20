import { useEffect } from "react";
import { toOgLocale } from "@shared/locale";

export interface PageMeta {
  page_title?: string;
  description?: string;
  robots?: string;
  og_image?: string;
  canonical_url?: string;
  pagination_prev?: string;
  pagination_next?: string;
  priority?: number;
  change_frequency?: string;
  redirects?: string[];
  alternates?: Record<string, string>;
}

export function usePageMeta(meta: PageMeta | undefined, locale?: string) {
  useEffect(() => {
    if (!meta) return;

    const originalTitle = document.title;
    const addedElements: Element[] = [];
    const modifiedElements: Map<Element, string> = new Map();

    if (meta.page_title && !meta.page_title.includes("{{")) {
      document.title = meta.page_title;
    }

    const setMeta = (name: string, content: string, isProperty = false) => {
      const attr = isProperty ? "property" : "name";
      let element = document.querySelector(`meta[${attr}="${name}"]`);
      if (!element) {
        element = document.createElement("meta");
        element.setAttribute(attr, name);
        document.head.appendChild(element);
        addedElements.push(element);
      } else {
        modifiedElements.set(element, element.getAttribute("content") || "");
      }
      element.setAttribute("content", content);
    };

    if (meta.description) {
      setMeta("description", meta.description);
      setMeta("og:description", meta.description, true);
      setMeta("twitter:description", meta.description);
    }

    if (meta.robots) {
      setMeta("robots", meta.robots);
    }

    if (meta.og_image) {
      setMeta("og:image", meta.og_image, true);
      setMeta("twitter:image", meta.og_image);
    }

    if (meta.page_title && !meta.page_title.includes("{{")) {
      setMeta("og:title", meta.page_title, true);
      setMeta("twitter:title", meta.page_title);
    }

    if (locale) {
      setMeta("og:locale", toOgLocale(locale), true);
      document.documentElement.lang = locale;
    }

    let originalCanonical: string | null = null;
    let addedCanonical = false;
    let canonicalWasClientCreated = false;

    if (meta.canonical_url) {
      let link = document.querySelector('link[rel="canonical"]') as HTMLLinkElement | null;
      if (!link) {
        link = document.createElement("link");
        link.rel = "canonical";
        link.setAttribute("data-pagemeta", "true");
        document.head.appendChild(link);
        addedCanonical = true;
        canonicalWasClientCreated = true;
      } else {
        canonicalWasClientCreated = link.hasAttribute("data-pagemeta");
        originalCanonical = link.href;
        if (!canonicalWasClientCreated) {
          link.setAttribute("data-pagemeta", "updating");
        }
      }
      link.href = meta.canonical_url;
    }

    const addedHreflangLinks: HTMLLinkElement[] = [];
    if (meta.alternates && Object.keys(meta.alternates).length > 0) {
      document.querySelectorAll('link[rel="alternate"][data-pagemeta]').forEach(el => el.remove());
      for (const [lang, href] of Object.entries(meta.alternates)) {
        const link = document.createElement("link");
        link.rel = "alternate";
        link.hreflang = lang;
        link.href = href;
        link.setAttribute("data-pagemeta", "true");
        document.head.appendChild(link);
        addedHreflangLinks.push(link);
      }
    }

    const addedPaginationLinks: HTMLLinkElement[] = [];
    document.querySelectorAll('link[data-pagemeta-pagination]').forEach(el => el.remove());

    if (meta.pagination_prev) {
      const link = document.createElement("link");
      link.rel = "prev";
      link.href = meta.pagination_prev;
      link.setAttribute("data-pagemeta-pagination", "true");
      document.head.appendChild(link);
      addedPaginationLinks.push(link);
    }

    if (meta.pagination_next) {
      const link = document.createElement("link");
      link.rel = "next";
      link.href = meta.pagination_next;
      link.setAttribute("data-pagemeta-pagination", "true");
      document.head.appendChild(link);
      addedPaginationLinks.push(link);
    }

    return () => {
      document.title = originalTitle;

      addedElements.forEach((el) => el.remove());
      addedHreflangLinks.forEach((el) => el.remove());
      addedPaginationLinks.forEach((el) => el.remove());

      modifiedElements.forEach((originalValue, element) => {
        if (originalValue) {
          element.setAttribute("content", originalValue);
        } else {
          element.removeAttribute("content");
        }
      });

      const canonicalLink = document.querySelector('link[rel="canonical"]') as HTMLLinkElement | null;
      if (addedCanonical) {
        if (canonicalLink) canonicalLink.remove();
      } else if (originalCanonical !== null && canonicalLink) {
        canonicalLink.href = originalCanonical;
        if (!canonicalWasClientCreated) {
          canonicalLink.removeAttribute("data-pagemeta");
        }
      }
    };
  }, [meta, locale]);
}
