import { useRef, useMemo } from "react";
import type { CSSProperties, MouseEvent, ReactNode } from "react";
import { useState, useEffect } from "react";
import type { ComponentProps } from "react";
import { ChevronRight } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import type { ArticleSection } from "@shared/schema";
import { cn } from "@/lib/utils";
import { useOrderedPageSections } from "@/contexts/PageSectionsContext";
import { useSectionContext } from "@/contexts/SectionContext";
import { CopyCodeButton } from "../CopyCodeButton";
import "../article-prose.css";

/** Must match server/markdown-enhance.ts ARTICLE_HTML_MARKER */
const ARTICLE_HTML_MARKER = "<!--article-html-v1-->";

interface TocItem {
  id: string;
  text: string;
  level: number;
}

/** Flat TOC entries grouped so h3s nest under the preceding h2. */
type TocBranch =
  | { kind: "heading"; item: TocItem }
  | { kind: "section"; item: TocItem; children: TocItem[] };

function buildTocTree(items: TocItem[]): TocBranch[] {
  const tree: TocBranch[] = [];
  let currentSection: Extract<TocBranch, { kind: "section" }> | null = null;

  for (const item of items) {
    if (item.level <= 2) {
      if (item.level === 2) {
        currentSection = { kind: "section", item, children: [] };
        tree.push(currentSection);
      } else {
        currentSection = null;
        tree.push({ kind: "heading", item });
      }
    } else if (item.level === 3) {
      if (currentSection) {
        currentSection.children.push(item);
      } else {
        tree.push({ kind: "heading", item });
      }
    }
  }

  return tree;
}

function findParentH2Id(tree: TocBranch[], activeId: string): string | null {
  for (const branch of tree) {
    if (branch.kind === "section") {
      if (branch.item.id === activeId) return branch.item.id;
      if (branch.children.some((c) => c.id === activeId)) return branch.item.id;
    }
  }
  return null;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .trim();
}

/** Strip inline markdown markers so TOC labels read as plain text. */
function stripInlineMarkdown(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/(\*|_)(.*?)\1/g, "$2")
    .replace(/~~(.*?)~~/g, "$1")
    .replace(/<\/?[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractTocItems(content: string, idPrefix = ""): TocItem[] {
  const body = content.startsWith(ARTICLE_HTML_MARKER)
    ? content.slice(ARTICLE_HTML_MARKER.length)
    : content;
  const items: TocItem[] = [];
  const slugCounts: Record<string, number> = {};

  const pushItem = (level: number, rawText: string, existingId?: string) => {
    const text = stripInlineMarkdown(rawText.trim());
    if (!text) return;
    let id = existingId?.trim() || `${idPrefix}${slugify(text)}`;
    if (!existingId && idPrefix && !id.startsWith(idPrefix)) {
      id = `${idPrefix}${id}`;
    }
    if (slugCounts[id] !== undefined) {
      slugCounts[id]++;
      id = `${id}-${slugCounts[id]}`;
    } else {
      slugCounts[id] = 0;
    }
    items.push({ id, text, level });
  };

  // Pre-rendered HTML path (server-enhanced articles)
  if (content.startsWith(ARTICLE_HTML_MARKER) || /^\s*</.test(body)) {
    const headingRe = /<h([1-3])([^>]*)>([\s\S]*?)<\/h\1>/gi;
    let m: RegExpExecArray | null;
    while ((m = headingRe.exec(body)) !== null) {
      const level = Number(m[1]);
      const attrs = m[2] || "";
      const inner = m[3] || "";
      const idMatch = attrs.match(/\sid=["']([^"']+)["']/i);
      pushItem(level, stripInlineMarkdown(inner), idMatch?.[1]);
    }
    if (items.length > 0) return items;
  }

  // Markdown path
  const lines = body.split("\n");
  let inCodeBlock = false;
  for (const line of lines) {
    if (line.trim().startsWith("```")) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) continue;
    const match = line.match(/^(#{1,3})\s+(.+)$/);
    if (match) {
      pushItem(match[1].length, match[2]);
    }
  }
  return items;
}

function estimateReadingMinutes(content: string): number {
  const text = content
    .replace(ARTICLE_HTML_MARKER, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/[`#>*_\[\]()!|-]/g, " ");
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(words / 200));
}

function normalizeCategory(category: unknown): string | undefined {
  if (!category) return undefined;
  if (typeof category === "string") {
    const trimmed = category.trim();
    if (!trimmed || trimmed.includes("{{")) return undefined;
    return trimmed;
  }
  if (typeof category === "object") {
    const o = category as Record<string, unknown>;
    for (const key of ["title", "name", "slug", "category_title"]) {
      if (typeof o[key] === "string" && (o[key] as string).trim()) {
        return (o[key] as string).trim();
      }
    }
  }
  return undefined;
}

function normalizeTags(tags: unknown): string[] {
  if (!tags) return [];
  if (Array.isArray(tags)) {
    return tags.map(String).map((t) => t.trim()).filter(Boolean);
  }
  if (typeof tags === "string") {
    const trimmed = tags.trim();
    if (!trimmed || trimmed.startsWith("{{")) return [];
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return normalizeTags(parsed);
    } catch {
      /* not JSON */
    }
    return trimmed.split(/[,|]/).map((t) => t.trim()).filter(Boolean);
  }
  return [];
}

function useTocScrollSpy(items: TocItem[]) {
  const [activeId, setActiveId] = useState<string>("");
  const OFFSET_PX = 120;

  useEffect(() => {
    if (items.length === 0) return;

    let ticking = false;

    const computeActiveId = () => {
      let current = items[0]?.id ?? "";
      for (const item of items) {
        const el = document.getElementById(item.id);
        if (!el) continue;
        if (el.getBoundingClientRect().top <= OFFSET_PX) {
          current = item.id;
        } else {
          break;
        }
      }
      setActiveId((prev) => (prev === current ? prev : current));
    };

    const onScrollOrResize = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        computeActiveId();
        ticking = false;
      });
    };

    computeActiveId();
    window.addEventListener("scroll", onScrollOrResize, { passive: true });
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      window.removeEventListener("scroll", onScrollOrResize);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [items]);

  const scrollTo = (e: MouseEvent<HTMLAnchorElement>, id: string) => {
    e.preventDefault();
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      setActiveId(id);
    }
  };

  return { activeId, setActiveId, scrollTo };
}

function TocLink({
  item,
  isActive,
  onNavigate,
  className,
  style,
}: {
  item: TocItem;
  isActive: boolean;
  onNavigate: (e: MouseEvent<HTMLAnchorElement>, id: string) => void;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <a
      href={`#${item.id}`}
      onClick={(e) => onNavigate(e, item.id)}
      className={cn(
        "block border-l-2 py-1 text-sm transition-colors",
        isActive
          ? "border-primary text-foreground font-medium"
          : "border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground/50",
        className,
      )}
      style={style}
      data-testid={`toc-link-${item.id}`}
      aria-current={isActive ? "location" : undefined}
    >
      {item.text}
    </a>
  );
}

function CollapsibleTocNav({
  items,
  variant,
}: {
  items: TocItem[];
  variant: "side" | "top";
}) {
  const tree = useMemo(() => buildTocTree(items), [items]);
  const { activeId, scrollTo } = useTocScrollSpy(items);
  const [expandedH2Id, setExpandedH2Id] = useState<string | null>(null);

  useEffect(() => {
    if (!activeId) return;
    const parentId = findParentH2Id(tree, activeId);
    if (parentId) setExpandedH2Id(parentId);
  }, [activeId, tree]);

  const toggleH2 = (id: string) => {
    setExpandedH2Id((prev) => (prev === id ? null : id));
  };

  const handleH2Navigate = (e: MouseEvent<HTMLAnchorElement>, id: string) => {
    scrollTo(e, id);
    setExpandedH2Id(id);
  };

  const isSide = variant === "side";

  return (
    <nav
      className={cn(
        isSide
          ? "sticky top-24 hidden lg:block"
          : "mb-8 rounded-md border border-border bg-muted/30 p-5",
      )}
      aria-label="Table of contents"
      data-testid={isSide ? "toc-side" : "toc-top"}
    >
      <p
        className={cn(
          "mb-3 font-semibold uppercase tracking-wider text-muted-foreground",
          isSide ? "text-xs" : "text-sm",
        )}
      >
        {isSide ? "On this page" : "Table of Contents"}
      </p>
      <ul className={cn("space-y-0.5", isSide && "border-l border-border")}>
        {tree.map((branch) => {
          if (branch.kind === "heading") {
            return (
              <li key={branch.item.id}>
                <TocLink
                  item={branch.item}
                  isActive={activeId === branch.item.id}
                  onNavigate={scrollTo}
                  style={{
                    paddingLeft: isSide
                      ? `${8 + (branch.item.level - 1) * 12}px`
                      : `${(branch.item.level - 1) * 16}px`,
                  }}
                  className={!isSide ? "border-l-0" : undefined}
                />
              </li>
            );
          }

          const { item, children } = branch;
          const hasChildren = children.length > 0;
          const isExpanded = expandedH2Id === item.id;
          const childActive = children.some((c) => c.id === activeId);
          const h2Active = activeId === item.id || childActive;

          return (
            <li key={item.id}>
              <div className="flex items-start gap-0.5">
                {hasChildren ? (
                  <button
                    type="button"
                    aria-expanded={isExpanded}
                    aria-controls={`toc-children-${item.id}`}
                    onClick={() => toggleH2(item.id)}
                    className={cn(
                      "mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:text-foreground",
                      isSide ? "ml-0.5" : "ml-0",
                      h2Active && "text-foreground",
                    )}
                    data-testid={`toc-expand-${item.id}`}
                  >
                    <ChevronRight
                      className={cn(
                        "h-3.5 w-3.5 transition-transform duration-200",
                        isExpanded && "rotate-90",
                      )}
                    />
                  </button>
                ) : (
                  <span className="w-5 shrink-0" aria-hidden />
                )}
                <TocLink
                  item={item}
                  isActive={h2Active}
                  onNavigate={handleH2Navigate}
                  className={cn("min-w-0 flex-1", !isSide && "border-l-0")}
                  style={{
                    paddingLeft: isSide ? "4px" : undefined,
                  }}
                />
              </div>
              {hasChildren && isExpanded && (
                <ul
                  id={`toc-children-${item.id}`}
                  className="mt-0.5 space-y-0.5"
                  data-testid={`toc-children-${item.id}`}
                >
                  {children.map((child) => (
                    <li key={child.id}>
                      <TocLink
                        item={child}
                        isActive={activeId === child.id}
                        onNavigate={scrollTo}
                        className={!isSide ? "border-l-0" : undefined}
                        style={{
                          paddingLeft: isSide ? "28px" : "32px",
                        }}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function TocTop({ items }: { items: TocItem[] }) {
  return <CollapsibleTocNav items={items} variant="top" />;
}

function TocSide({ items }: { items: TocItem[] }) {
  return <CollapsibleTocNav items={items} variant="side" />;
}

function ArticleMeta({
  tags,
  category,
  categoryUrl,
  readingMinutes,
}: {
  tags: string[];
  category?: string;
  categoryUrl?: string;
  readingMinutes?: number;
}) {
  const hasTags = tags.length > 0;
  const hasCategory = Boolean(category && category.trim() && !category.includes("{{"));
  const hasReading = typeof readingMinutes === "number" && readingMinutes > 0;
  if (!hasTags && !hasCategory && !hasReading) return null;

  return (
    <div
      className="mb-6 flex flex-wrap items-center gap-2 text-sm text-muted-foreground"
      data-testid="article-meta"
    >
      {hasReading && (
        <span data-testid="article-reading-time">{readingMinutes} min read</span>
      )}
      {hasCategory && (
        categoryUrl ? (
          <a
            href={categoryUrl}
            className="rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            data-testid="article-category-chip"
          >
            {category}
          </a>
        ) : (
          <span
            className="rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-foreground"
            data-testid="article-category-chip"
          >
            {category}
          </span>
        )
      )}
      {tags.map((tag) => (
        <span
          key={tag}
          className="rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-foreground"
          data-testid={`article-tag-${tag}`}
        >
          {tag}
        </span>
      ))}
    </div>
  );
}

function CodeBlock({
  children,
  language,
  ...props
}: {
  children?: ReactNode;
  language?: string;
} & React.HTMLAttributes<HTMLPreElement>) {
  const preRef = useRef<HTMLPreElement>(null);
  const label =
    language && language !== "plaintext" && language !== "text"
      ? language
      : null;

  return (
    <div className="group/codeblock relative mb-5 overflow-hidden rounded-md border border-border bg-muted">
      <div className="flex h-9 items-center justify-end gap-2 border-b border-border/60 px-3">
        {label ? (
          <span className="mr-auto font-mono text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            {label}
          </span>
        ) : (
          <span className="mr-auto" aria-hidden />
        )}
        <CopyCodeButton
          getText={() => preRef.current?.textContent ?? ""}
        />
      </div>
      <pre
        ref={preRef}
        className="overflow-x-auto p-4 text-sm leading-relaxed"
        tabIndex={0}
        {...props}
      >
        {children}
      </pre>
    </div>
  );
}

interface ArticleProps {
  data: ArticleSection & { section_id?: string; toc_group?: string };
}

export function Article({ data }: ArticleProps) {
  const {
    content,
    show_toc = false,
    toc_position = "side",
    toc_group,
    section_id,
    tags: rawTags,
    category,
    category_url,
    show_reading_time = true,
  } = data;

  const orderedSections = useOrderedPageSections();
  const { sectionIndex } = useSectionContext();

  const sectionKey = section_id || `article-${sectionIndex >= 0 ? sectionIndex : "0"}`;
  const idPrefix = toc_group ? `${sectionKey}--` : "";

  const tags = useMemo(() => normalizeTags(rawTags), [rawTags]);
  const categoryLabel = useMemo(() => normalizeCategory(category), [category]);
  const readingMinutes = useMemo(
    () => (show_reading_time && content ? estimateReadingMinutes(content) : undefined),
    [show_reading_time, content],
  );

  const groupMembers = useMemo(() => {
    if (!toc_group) return null;
    return orderedSections.filter(
      (s) => s.data.type === "article" && s.data.toc_group === toc_group,
    );
  }, [orderedSections, toc_group]);

  const tocItems = useMemo(() => {
    if (toc_group && groupMembers && groupMembers.length > 0) {
      const anyShowToc = groupMembers.some((m) => m.data.show_toc === true);
      if (!anyShowToc && !show_toc) return [];

      const items: TocItem[] = [];
      for (const member of groupMembers) {
        const memberContent = typeof member.data.content === "string" ? member.data.content : "";
        const memberPrefix = `${member.sectionKey}--`;
        items.push(...extractTocItems(memberContent, memberPrefix));
      }
      return items;
    }

    return show_toc ? extractTocItems(content) : [];
  }, [toc_group, groupMembers, show_toc, content]);

  const effectiveTocPosition = useMemo(() => {
    if (!toc_group || !groupMembers || groupMembers.length === 0) {
      return toc_position;
    }
    if (data.toc_position === "top" || data.toc_position === "side") {
      return data.toc_position;
    }
    const fromGroup = groupMembers.find(
      (m) => m.data.toc_position === "top" || m.data.toc_position === "side",
    );
    return (fromGroup?.data.toc_position as "top" | "side" | undefined) || "side";
  }, [toc_group, groupMembers, toc_position, data.toc_position]);

  const showSideToc = tocItems.length > 0 && effectiveTocPosition === "side";
  const showTopToc = tocItems.length > 0 && effectiveTocPosition === "top";

  const slugCountsRef = useRef<Record<string, number>>({});

  const getHeadingId = (text: string) => {
    let id = `${idPrefix}${slugify(text)}`;
    const counts = slugCountsRef.current;
    if (counts[id] !== undefined) {
      counts[id]++;
      id = `${id}-${counts[id]}`;
    } else {
      counts[id] = 0;
    }
    return id;
  };

  slugCountsRef.current = {};

  const meta = (
    <ArticleMeta
      tags={tags}
      category={categoryLabel}
      categoryUrl={category_url}
      readingMinutes={readingMinutes}
    />
  );

  const body = (
    <div className="article-prose mx-auto max-w-[68ch]">
      {meta}
      <MarkdownRenderer content={content} getHeadingId={getHeadingId} />
    </div>
  );

  return (
    <div
      className="w-full px-4 py-8 md:px-6 lg:px-8"
      data-testid="article-section"
      data-toc-group={toc_group || undefined}
    >
      {showSideToc ? (
        <>
          <div className="lg:hidden">
            <TocTop items={tocItems} />
          </div>
          <div className="flex gap-10">
            <article className="min-w-0 flex-1" data-testid="article-content">
              {body}
            </article>
            <aside className="hidden w-56 shrink-0 self-stretch lg:block xl:w-64">
              <TocSide items={tocItems} />
            </aside>
          </div>
        </>
      ) : (
        <>
          {showTopToc && <TocTop items={tocItems} />}
          <article data-testid="article-content">
            {body}
          </article>
        </>
      )}
    </div>
  );
}

const sanitizeSchema = {
  ...defaultSchema,
  tagNames: [
    ...(defaultSchema.tagNames ?? []),
    "iframe",
    "video",
    "source",
    "figure",
    "figcaption",
    "div",
    "span",
  ],
  attributes: {
    ...defaultSchema.attributes,
    code: [
      ...(defaultSchema.attributes?.code ?? []),
      ["className", /^language-/],
      ["className", /^line$/],
      "dataLanguage",
      "dataTheme",
    ],
    span: [
      ...(defaultSchema.attributes?.span ?? []),
      "className",
      "style",
      "dataLine",
    ],
    pre: [
      ...(defaultSchema.attributes?.pre ?? []),
      "className",
      "style",
      "dataLanguage",
      "dataTheme",
      "tabIndex",
    ],
    figure: ["dataRehypePrettyCodeFigure", "className"],
    figcaption: ["dataRehypePrettyCodeTitle", "className"],
    div: [
      ...(defaultSchema.attributes?.div ?? []),
      "className",
      "dataArticleAlert",
      "role",
    ],
    p: [...(defaultSchema.attributes?.p ?? []), "className"],
    iframe: ["src", "width", "height", "allowFullScreen", "allow", "title", "frameBorder"],
    video: ["src", "controls", "width", "height", "poster", "autoPlay", "loop", "muted"],
    source: ["src", "type"],
    "*": [
      ...((defaultSchema.attributes as Record<string, unknown>)?.["*"] as unknown[] ?? []),
      "className",
      "style",
      "dataLanguage",
      "dataTheme",
      "dataLine",
      "dataRehypePrettyCodeFigure",
      "dataArticleAlert",
    ],
  },
};

function getDataLanguage(props: Record<string, unknown>): string | undefined {
  const raw =
    props["data-language"] ??
    props.dataLanguage ??
    props["data-language"] ??
    undefined;
  return typeof raw === "string" ? raw : undefined;
}

function MarkdownRenderer({
  content,
  getHeadingId,
}: {
  content: string;
  getHeadingId: (text: string) => string;
}) {
  const isEnhanced = content.startsWith(ARTICLE_HTML_MARKER);
  const source = isEnhanced
    ? content.slice(ARTICLE_HTML_MARKER.length).trim()
    : content;

  // Server-enhanced HTML was already sanitized before Shiki; re-sanitizing
  // would strip token `style` / data-* attributes. Raw markdown still goes
  // through rehypeSanitize on the client.
  const rehypePlugins = (
    isEnhanced
      ? [rehypeRaw]
      : [rehypeRaw, [rehypeSanitize, sanitizeSchema]]
  ) as ComponentProps<typeof ReactMarkdown>["rehypePlugins"];

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={rehypePlugins}
      components={{
        h1: ({ children, ...props }) => {
          const text = extractTextFromChildren(children);
          const id = (props as { id?: string }).id || getHeadingId(text);
          return (
            <h1
              id={id}
              className="mb-4 mt-10 scroll-mt-24 text-3xl font-bold tracking-tight first:mt-0 md:text-4xl"
              data-testid={`heading-${id}`}
              {...props}
            >
              {children}
            </h1>
          );
        },
        h2: ({ children, ...props }) => {
          const text = extractTextFromChildren(children);
          const id = (props as { id?: string }).id || getHeadingId(text);
          return (
            <h2
              id={id}
              className="mb-3 mt-12 scroll-mt-24 text-2xl font-bold tracking-tight text-foreground first:mt-0 md:text-[1.75rem]"
              data-testid={`heading-${id}`}
              {...props}
            >
              {children}
            </h2>
          );
        },
        h3: ({ children, ...props }) => {
          const text = extractTextFromChildren(children);
          const id = (props as { id?: string }).id || getHeadingId(text);
          return (
            <h3
              id={id}
              className="mb-2 mt-8 scroll-mt-24 text-lg font-medium tracking-tight text-foreground/90 first:mt-0 md:text-xl"
              data-testid={`heading-${id}`}
              {...props}
            >
              {children}
            </h3>
          );
        },
        h4: ({ children, ...props }) => (
          <h4 className="mb-2 mt-6 text-base font-semibold first:mt-0" {...props}>
            {children}
          </h4>
        ),
        p: ({ children, ...props }) => (
          <p className="mb-4 mt-0 leading-8 text-foreground/90" {...props}>
            {children}
          </p>
        ),
        ul: ({ children, ...props }) => (
          <ul className="mb-4 ml-6 list-disc space-y-2 marker:text-muted-foreground" {...props}>
            {children}
          </ul>
        ),
        ol: ({ children, ...props }) => (
          <ol className="mb-4 ml-6 list-decimal space-y-2 marker:text-muted-foreground" {...props}>
            {children}
          </ol>
        ),
        li: ({ children, ...props }) => (
          <li className="leading-8 text-foreground/90" {...props}>
            {children}
          </li>
        ),
        a: ({ href, children, ...props }) => (
          <a
            href={href}
            className="text-primary underline underline-offset-4 hover:text-primary/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            target={href?.startsWith("http") ? "_blank" : undefined}
            rel={href?.startsWith("http") ? "noopener noreferrer" : undefined}
            {...props}
          >
            {children}
          </a>
        ),
        blockquote: ({ children, ...props }) => (
          <blockquote
            className="mb-5 rounded-r-md border-l-4 border-primary bg-muted/30 py-3 pl-4 pr-3 text-foreground/90 not-italic"
            {...props}
          >
            {children}
          </blockquote>
        ),
        code: ({ className, children, ...props }) => {
          const isInline = !className;
          if (isInline) {
            return (
              <code
                className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.875em] text-foreground"
                {...props}
              >
                {children}
              </code>
            );
          }
          return (
            <code className={cn("font-mono text-sm", className)} {...props}>
              {children}
            </code>
          );
        },
        pre: ({ children, ...props }) => {
          const rest = props as Record<string, unknown>;
          const language = getDataLanguage(rest);
          // Drop react-markdown internal `node` before spreading to DOM.
          const { node: _node, ...domProps } = rest;
          return (
            <CodeBlock language={language} {...(domProps as React.HTMLAttributes<HTMLPreElement>)}>
              {children}
            </CodeBlock>
          );
        },
        figure: ({ children, ...props }) => (
          <figure className="mb-0 contents" {...props}>
            {children}
          </figure>
        ),
        hr: ({ ...props }) => (
          <hr className="my-10 border-0 border-t-2 border-border" {...props} />
        ),
        table: ({ children, ...props }) => (
          <div className="mb-5 overflow-x-auto rounded-md border border-border">
            <table className="w-full border-collapse text-sm" {...props}>
              {children}
            </table>
          </div>
        ),
        thead: ({ children, ...props }) => (
          <thead className="border-b border-border bg-muted/50" {...props}>
            {children}
          </thead>
        ),
        th: ({ children, ...props }) => (
          <th className="border-b border-border px-4 py-2.5 text-left font-semibold" {...props}>
            {children}
          </th>
        ),
        td: ({ children, ...props }) => (
          <td className="border-b border-border px-4 py-2.5" {...props}>
            {children}
          </td>
        ),
        img: ({ src, alt, ...props }) => (
          <img
            src={src}
            alt={alt}
            className="my-4 max-w-full rounded-md"
            loading="lazy"
            {...props}
          />
        ),
        strong: ({ children, ...props }) => (
          <strong className="font-semibold text-foreground" {...props}>
            {children}
          </strong>
        ),
        div: ({ className, children, ...props }) => (
          <div className={className} {...props}>
            {children}
          </div>
        ),
      }}
    >
      {source}
    </ReactMarkdown>
  );
}

function extractTextFromChildren(children: ReactNode): string {
  if (typeof children === "string") return children;
  if (typeof children === "number") return String(children);
  if (Array.isArray(children)) return children.map(extractTextFromChildren).join("");
  if (children && typeof children === "object" && "props" in children) {
    return extractTextFromChildren((children as { props: { children?: ReactNode } }).props.children);
  }
  return "";
}

export default Article;
