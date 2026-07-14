import { useState, useEffect, useRef } from "react";
import type { MouseEvent, ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ArticleSection } from "@shared/schema";
import { cn } from "@/lib/utils";

interface TocItem {
  id: string;
  text: string;
  level: number;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .trim();
}

function extractTocItems(markdown: string): TocItem[] {
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
      const text = match[2].trim();
      let id = slugify(text);

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


function TocTop({ items }: { items: TocItem[] }) {
  return (
    <nav
      className="mb-8 rounded-md border border-border bg-muted/30 p-5"
      aria-label="Table of contents"
      data-testid="toc-top"
    >
      <p className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
        Table of Contents
      </p>
      <ul className="space-y-1">
        {items.map((item) => (
          <li
            key={item.id}
            style={{ paddingLeft: `${(item.level - 1) * 16}px` }}
          >
            <a
              href={`#${item.id}`}
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
              data-testid={`toc-link-${item.id}`}
            >
              {item.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function TocSide({ items }: { items: TocItem[] }) {
  const [activeId, setActiveId] = useState<string>("");
  const observerRef = useRef<IntersectionObserver | null>(null);

  useEffect(() => {
    const headingElements = items
      .map((item) => document.getElementById(item.id))
      .filter(Boolean) as HTMLElement[];

    if (headingElements.length === 0) return;

    observerRef.current = new IntersectionObserver(
      (entries) => {
        const visibleEntries = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);

        if (visibleEntries.length > 0) {
          setActiveId(visibleEntries[0].target.id);
        }
      },
      {
        rootMargin: "-80px 0px -60% 0px",
        threshold: 0,
      }
    );

    headingElements.forEach((el) => observerRef.current?.observe(el));

    return () => {
      observerRef.current?.disconnect();
    };
  }, [items]);

  const handleClick = (e: MouseEvent<HTMLAnchorElement>, id: string) => {
    e.preventDefault();
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      setActiveId(id);
    }
  };

  return (
    <nav
      className="sticky top-24 hidden lg:block"
      aria-label="Table of contents"
      data-testid="toc-side"
    >
      <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        On this page
      </p>
      <ul className="space-y-1 border-l border-border">
        {items.map((item) => (
          <li key={item.id}>
            <a
              href={`#${item.id}`}
              onClick={(e) => handleClick(e, item.id)}
              className={cn(
                "block border-l-2 py-1 text-sm transition-colors",
                activeId === item.id
                  ? "border-primary text-foreground font-medium"
                  : "border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground/50",
              )}
              style={{ paddingLeft: `${8 + (item.level - 1) * 12}px` }}
              data-testid={`toc-link-${item.id}`}
            >
              {item.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

interface ArticleProps {
  data: ArticleSection;
}

export function Article({ data }: ArticleProps) {
  const {
    content,
    show_toc = false,
    toc_position = "side",
  } = data;

  const tocItems = show_toc ? extractTocItems(content) : [];

  const showSideToc = show_toc && toc_position === "side" && tocItems.length > 0;
  const showTopToc = show_toc && toc_position === "top" && tocItems.length > 0;

  const slugCountsRef = useRef<Record<string, number>>({});

  const getHeadingId = (text: string) => {
    let id = slugify(text);
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
    >
      {showSideToc ? (
        <>
          <div className="lg:hidden">
            <TocTop items={tocItems} />
          </div>
          <div className="flex gap-10">
            <article className="min-w-0 flex-1" data-testid="article-content">
              <MarkdownRenderer content={content} getHeadingId={getHeadingId} />
            </article>
            <aside className="hidden w-56 shrink-0 lg:block xl:w-64">
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

function MarkdownRenderer({ content, getHeadingId }: { content: string; getHeadingId: (text: string) => string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
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
