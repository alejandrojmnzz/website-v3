import { useState, useEffect, useRef, useMemo } from "react";
import type { CSSProperties, MouseEvent, ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import type { ArticleSection } from "@shared/schema";
import { cn } from "@/lib/utils";
import { useOrderedPageSections } from "@/contexts/PageSectionsContext";
import { useSectionContext } from "@/contexts/SectionContext";

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
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1") // images → alt text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1") // links → label
    .replace(/`([^`]+)`/g, "$1") // inline code
    .replace(/(\*\*|__)(.*?)\1/g, "$2") // bold
    .replace(/(\*|_)(.*?)\1/g, "$2") // italic
    .replace(/~~(.*?)~~/g, "$1") // strikethrough
    .replace(/<\/?[^>]+>/g, "") // HTML tags
    .replace(/\s+/g, " ")
    .trim();
}

function extractTocItems(markdown: string, idPrefix = ""): TocItem[] {
  const lines = markdown.split("\n");
  const items: TocItem[] = [];
  const slugCounts: Record<string, number> = {};
  let inCodeBlock = false;

  for (const line of lines) {
    if (line.trim().startsWith("```")) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) continue;

    const match = line.match(/^(#{1,3})\s+(.+)$/);
    if (match) {
      const level = match[1].length;
      const text = stripInlineMarkdown(match[2].trim());
      let id = `${idPrefix}${slugify(text)}`;

      if (slugCounts[id] !== undefined) {
        slugCounts[id]++;
        id = `${id}-${slugCounts[id]}`;
      } else {
        slugCounts[id] = 0;
      }

      items.push({ id, text, level });
    }
  }

  return items;
}

function useTocScrollSpy(items: TocItem[]) {
  const [activeId, setActiveId] = useState<string>("");
  // Offset roughly matches heading scroll-mt-24 so the "current" heading
  // is the last one that has crossed under the sticky header band.
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
          // Headings are in document order — stop once one is still below the band.
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

  // Auto-expand the h2 that owns the active heading (accordion: only one open).
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
          // Keep the h2 highlighted while reading its body or any nested h3.
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

interface ArticleProps {
  data: ArticleSection & { section_id?: string };
}

export function Article({ data }: ArticleProps) {
  const {
    content,
    show_toc = false,
    toc_position = "side",
    toc_group,
    section_id,
  } = data;

  const orderedSections = useOrderedPageSections();
  const { sectionIndex } = useSectionContext();

  const sectionKey = section_id || `article-${sectionIndex >= 0 ? sectionIndex : "0"}`;
  const idPrefix = toc_group ? `${sectionKey}--` : "";

  const groupMembers = useMemo(() => {
    if (!toc_group) return null;
    return orderedSections.filter(
      (s) => s.data.type === "article" && s.data.toc_group === toc_group,
    );
  }, [orderedSections, toc_group]);

  const tocItems = useMemo(() => {
    if (toc_group && groupMembers && groupMembers.length > 0) {
      // Every piece in the group shows the same merged TOC when any member opted in.
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

  // Prefer this section's toc_position; fall back to any group member's (default side).
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
          {/*
            Flex row scopes sticky TOC to this article piece's height:
            it stops following when you scroll past this section, then the next
            piece's identical TOC sticks within its own scroll range.
          */}
          <div className="flex gap-10">
            <article className="min-w-0 flex-1" data-testid="article-content">
              <MarkdownRenderer content={content} getHeadingId={getHeadingId} />
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
            <MarkdownRenderer content={content} getHeadingId={getHeadingId} />
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
  ],
  attributes: {
    ...defaultSchema.attributes,
    iframe: ["src", "width", "height", "allowFullScreen", "allow", "title", "frameBorder"],
    video: ["src", "controls", "width", "height", "poster", "autoPlay", "loop", "muted"],
    source: ["src", "type"],
  },
};

function MarkdownRenderer({ content, getHeadingId }: { content: string; getHeadingId: (text: string) => string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeRaw, [rehypeSanitize, sanitizeSchema]]}
      components={{
        h1: ({ children, ...props }) => {
          const text = extractTextFromChildren(children);
          const id = getHeadingId(text);
          return (
            <h1
              id={id}
              className="mb-4 mt-8 scroll-mt-24 text-3xl font-bold tracking-tight first:mt-0 md:text-4xl"
              data-testid={`heading-${id}`}
              {...props}
            >
              {children}
            </h1>
          );
        },
        h2: ({ children, ...props }) => {
          const text = extractTextFromChildren(children);
          const id = getHeadingId(text);
          return (
            <h2
              id={id}
              className="mb-3 mt-8 scroll-mt-24 text-2xl font-bold tracking-tight first:mt-0"
              data-testid={`heading-${id}`}
              {...props}
            >
              {children}
            </h2>
          );
        },
        h3: ({ children, ...props }) => {
          const text = extractTextFromChildren(children);
          const id = getHeadingId(text);
          return (
            <h3
              id={id}
              className="mb-2 mt-6 scroll-mt-24 text-xl font-semibold tracking-tight first:mt-0"
              data-testid={`heading-${id}`}
              {...props}
            >
              {children}
            </h3>
          );
        },
        h4: ({ children, ...props }) => (
          <h4 className="mb-2 mt-4 text-lg font-semibold first:mt-0" {...props}>
            {children}
          </h4>
        ),
        p: ({ children, ...props }) => (
          <p className="mb-4 leading-7 text-foreground/90" {...props}>
            {children}
          </p>
        ),
        ul: ({ children, ...props }) => (
          <ul className="mb-4 ml-6 list-disc space-y-1" {...props}>
            {children}
          </ul>
        ),
        ol: ({ children, ...props }) => (
          <ol className="mb-4 ml-6 list-decimal space-y-1" {...props}>
            {children}
          </ol>
        ),
        li: ({ children, ...props }) => (
          <li className="leading-7 text-foreground/90" {...props}>
            {children}
          </li>
        ),
        a: ({ href, children, ...props }) => (
          <a
            href={href}
            className="text-primary underline underline-offset-4 transition-colors hover:text-primary/80"
            target={href?.startsWith("http") ? "_blank" : undefined}
            rel={href?.startsWith("http") ? "noopener noreferrer" : undefined}
            {...props}
          >
            {children}
          </a>
        ),
        blockquote: ({ children, ...props }) => (
          <blockquote
            className="mb-4 border-l-4 border-primary/30 pl-4 italic text-muted-foreground"
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
                className="rounded-md bg-muted px-1.5 py-0.5 text-sm font-mono"
                {...props}
              >
                {children}
              </code>
            );
          }
          return (
            <code className={cn("text-sm font-mono", className)} {...props}>
              {children}
            </code>
          );
        },
        pre: ({ children, ...props }) => (
          <pre
            className="mb-4 overflow-x-auto rounded-md bg-muted p-4 text-sm"
            {...props}
          >
            {children}
          </pre>
        ),
        hr: ({ ...props }) => <hr className="my-8 border-border" {...props} />,
        table: ({ children, ...props }) => (
          <div className="mb-4 overflow-x-auto">
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
          <th className="px-4 py-2 text-left font-semibold" {...props}>
            {children}
          </th>
        ),
        td: ({ children, ...props }) => (
          <td className="border-b border-border px-4 py-2" {...props}>
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
      }}
    >
      {content}
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
