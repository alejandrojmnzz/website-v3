import { useState, useRef, useEffect } from "react";
import { FileText, Lock, Check, Code } from "lucide-react";
import type { SyllabusTimeline } from "@shared/schema";
import { UniversalVideo } from "@/components/UniversalVideo";

const ITEM_ICONS: Record<string, React.ElementType> = {
  CODE:    Code,
  LESSON:  FileText,
  PROJECT: Lock,
  QUIZ:    Check,
};
const MAX_VISIBLE_PARENT_LESSONS = 5;

function normalizeVideoUrl(value: unknown): string | null {
  const fromLocalizedObject = (obj: Record<string, unknown>): string | null => {
    const preferred = [obj.us, obj.en, obj.es];
    for (const candidate of preferred) {
      if (typeof candidate === "string" && candidate.trim()) return candidate;
    }
    for (const candidate of Object.values(obj)) {
      if (typeof candidate === "string" && candidate.trim()) return candidate;
    }
    return null;
  };

  let raw: string | null = null;
  if (typeof value === "string") {
    raw = value;
  } else if (value && typeof value === "object" && !Array.isArray(value)) {
    raw = fromLocalizedObject(value as Record<string, unknown>);
  }
  if (!raw) return null;

  const trimmed = raw.trim();
  if (!trimmed || trimmed === "null" || trimmed === "undefined") return null;
  if (/\{\{.*\}\}/.test(trimmed)) return null;
  return trimmed;
}

export default function SyllabusTimeline({ data }: { data: SyllabusTimeline }) {
  const { title, subtitle, modules } = data;

  const [expandedSections, setExpandedSections] = useState<string[]>([]);
  const [hoveredSection,   setHoveredSection]   = useState<string | null>(null);
  const [revealed,         setRevealed]         = useState(false);
  const [showAllParents,   setShowAllParents]   = useState(false);
  const sectionRef = useRef<HTMLDivElement>(null);
  const safeModules = Array.isArray(modules) ? modules : [];
  const hasHiddenParents = safeModules.length > MAX_VISIBLE_PARENT_LESSONS;
  const visibleModules = showAllParents || !hasHiddenParents
    ? safeModules
    : safeModules.slice(0, MAX_VISIBLE_PARENT_LESSONS);
  const hiddenParentsCount = Math.max(0, safeModules.length - MAX_VISIBLE_PARENT_LESSONS);
  const truncationLabel = "...";

  // Fire animation when section enters the viewport
  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setRevealed(true);
          observer.disconnect();
        }
      },
      { threshold: 0.1 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const toggleSection = (id: string) =>
    setExpandedSections(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id],
    );

  return (
    <div ref={sectionRef} className="w-full">
      <style>{`
        @keyframes syllabus-row-reveal {
          0%   { opacity: 0; transform: translateY(14px) scale(0.97); }
          100% { opacity: 1; transform: translateY(0)    scale(1);    }
        }
      `}</style>

      <div>

        {/* Header */}
        <div className="mb-8">
          <h2 className="font-inter text-[24px] font-bold text-foreground tracking-tight">{title}</h2>
          {subtitle && (
            <p className="text-muted-foreground mt-1.5 font-medium text-[15px]">{subtitle}</p>
          )}
        </div>

        {/* Timeline rows */}
        <div className="flex flex-col">
          {visibleModules.map((section, idx, arr) => {
            const id     = `module-${idx}`;
            const isLastVisible = idx === arr.length - 1;
            const isLast = isLastVisible && !(hasHiddenParents && !showAllParents);
            const isOpen = expandedSections.includes(id);
            const items = (section.items ?? []).filter(
              (item) => Boolean(item?.type && item?.label),
            );
            const isExpandable = items.length > 0;
            const videoUrl = normalizeVideoUrl(section.video);
            const hasVideo = Boolean(videoUrl);
            const showInlineVideo = !isExpandable && hasVideo;
            const compactExpandableVideo = isExpandable && hasVideo && items.length < 3;
            const expandableVideoWidth = !compactExpandableVideo
              ? 300
              : items.length === 1
                ? 130
                : 150;
            const expandableVideoPaddingRight = !compactExpandableVideo
              ? 324
              : items.length === 1
                ? 154
                : 174;
            const expandableVideoTop = compactExpandableVideo ? 4 : 12;
            const compactExpandableVideoMinHeight = compactExpandableVideo
              ? (isOpen ? `${Math.ceil((expandableVideoWidth * 9) / 16) + 16}px` : "0px")
              : undefined;

            return (
              <div
                key={id}
                className="relative flex gap-5 items-start"
                style={{
                  opacity:   revealed ? undefined : 0,
                  animation: revealed
                    ? (showAllParents
                        ? undefined
                        : `syllabus-row-reveal 420ms cubic-bezier(.4,0,.2,1) ${idx * 120 + 80}ms both`)
                    : undefined,
                }}
              >
                {/* LEFT — timeline */}
                <div className="flex flex-col items-center flex-shrink-0 self-stretch w-8">
                  {/* incoming segment (keeps line continuous, aligns circle with title) */}
                  {idx > 0
                    ? <div className="w-[2px]" style={{ height: 10, background: "rgba(0,132,255,0.25)" }} />
                    : <div style={{ height: 10 }} />
                  }

                  {/* numbered circle */}
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center text-[13px] font-bold flex-shrink-0 z-10"
                    style={{ background: "hsl(var(--primary))", color: "hsl(var(--primary-foreground))" }}
                  >
                    {idx + 1}
                  </div>

                  {/* outgoing connector line */}
                  {!isLast && (
                    <div className="w-[2px] flex-1" style={{ background: "rgba(0,132,255,0.25)" }} />
                  )}
                </div>

                {/* RIGHT — card */}
                <div className={`flex-1 min-w-0 ${isLast ? "" : "pb-3"}`}>
                  <div
                    className={`rounded-[13px] overflow-hidden select-none ${isExpandable ? "cursor-pointer" : ""}`}
                    style={{
                      background: isExpandable && hoveredSection === id ? "hsl(215 60% 99%)" : "hsl(var(--card))",
                      border:     "1.5px solid hsl(var(--border))",
                      boxShadow:  isExpandable && hoveredSection === id
                        ? "0 3px 10px rgba(0,132,255,0.1), 0 8px 22px rgba(0,132,255,0.07)"
                        : "0 1px 3px rgba(0,0,0,0.04), 0 3px 10px rgba(0,0,0,0.03)",
                      transform:  isExpandable && hoveredSection === id ? "translateY(-2px)" : "none",
                      transition: "border-color .2s, box-shadow .2s, transform .18s ease",
                    }}
                    onClick={isExpandable ? () => toggleSection(id) : undefined}
                    onMouseEnter={isExpandable ? () => setHoveredSection(id) : undefined}
                    onMouseLeave={isExpandable ? () => setHoveredSection(null) : undefined}
                  >
                    {/* Card header */}
                    <div className={`flex justify-between gap-4 px-5 ${showInlineVideo ? "items-center py-2.5" : "items-start py-4"}`}>
                      <div className="flex-1 min-w-0">
                        <h3 className="font-inter text-[19px] font-bold text-foreground leading-[1.25] mb-1">
                          {section.title}
                        </h3>
                        {section.description && (
                          <p className="text-[14px] text-muted-foreground leading-[1.5]">
                            {section.description}
                          </p>
                        )}
                      </div>

                      {/* View content button — only when there are expandable items */}
                      {isExpandable && (
                        <div
                          className="flex-shrink-0 self-center inline-flex items-center gap-1.5 text-[12px] font-semibold px-[11px] py-[5px] rounded-[8px] whitespace-nowrap pointer-events-none"
                          style={{
                            color:      "hsl(var(--primary))",
                            background: "hsl(var(--primary) / 0.10)",
                            border:     "none",
                          }}
                        >
                          View content
                          <span
                            className="text-[13px] leading-none"
                            style={{
                              display:    "inline-block",
                              transform:  isOpen ? "rotate(180deg)" : "none",
                              transition: "transform 200ms",
                            }}
                          >▾</span>
                        </div>
                      )}

                      {/* Inline video for non-expandable rows */}
                      {showInlineVideo && (
                        <div
                          className="flex-shrink-0 self-center ml-auto w-[130px] rounded-[10px] overflow-hidden"
                          style={{
                            boxShadow: "0 2px 12px rgba(0,0,0,0.13)",
                            border: "1.5px solid hsl(var(--border))",
                          }}
                        >
                          <UniversalVideo
                            url={videoUrl!}
                            ratio="16:9"
                            muted={false}
                            autoplay={false}
                            compactPlayButton
                          />
                        </div>
                      )}
                    </div>

                    {/* Expandable items */}
                    {isExpandable && (
                      <div style={{ display: "grid", gridTemplateRows: isOpen ? "1fr" : "0fr", transition: "grid-template-rows 280ms ease" }}>
                        <div
                          style={{
                            overflow: "hidden",
                            position: "relative",
                            minHeight: compactExpandableVideoMinHeight,
                            transition: compactExpandableVideo ? "min-height 280ms ease" : undefined,
                          }}
                        >
                          <ul
                            className="flex flex-col pb-1"
                            style={{ paddingRight: hasVideo ? expandableVideoPaddingRight : 0 }}
                          >
                            {items.map((item, i) => {
                              const Icon = ITEM_ICONS[item.type] ?? FileText;
                              return (
                                <li key={i}>
                                  {i > 0 && (
                                    <div style={{
                                      height:      0,
                                      borderTop:   "1px solid hsl(var(--border))",
                                      marginTop:    0,
                                      marginBottom: 0,
                                      marginLeft:   20,
                                      marginRight:  20,
                                    }} />
                                  )}
                                  <div className="flex items-center gap-4 py-3.5 px-5 hover:bg-muted/40 transition-colors cursor-pointer group">
                                    <div className="flex justify-center shrink-0 w-24">
                                      <span
                                        className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-medium"
                                        style={{
                                          background: "hsl(var(--primary) / 0.10)",
                                          color:      "hsl(var(--primary))",
                                        }}
                                      >
                                        <Icon className="w-3.5 h-3.5 shrink-0" />
                                        {item.type}
                                      </span>
                                    </div>
                                    <span className="text-foreground/80 font-semibold text-[14px] group-hover:text-foreground transition-colors">
                                      {item.label}
                                    </span>
                                  </div>
                                </li>
                              );
                            })}
                          </ul>

                          {/* Video — floats absolutely over the item rows, right side */}
                          {hasVideo && (
                            <div style={{
                              position:     "absolute",
                              right:        28,
                              top:          expandableVideoTop,
                              width:        expandableVideoWidth,
                              borderRadius: 10,
                              overflow:     "hidden",
                              boxShadow:    "0 2px 12px rgba(0,0,0,0.13)",
                              border:       "1.5px solid hsl(var(--border))",
                            }}>
                              <UniversalVideo
                                url={videoUrl!}
                                ratio="16:9"
                                muted={false}
                                autoplay={false}
                                compactPlayButton={compactExpandableVideo}
                              />
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                  </div>
                </div>
              </div>
            );
          })}

          {/* Truncation marker row (only when collapsed) */}
          {hasHiddenParents && !showAllParents && (
            <div className="relative flex gap-5 items-start">
              <div className="flex flex-col items-center flex-shrink-0 self-stretch w-8">
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center text-[14px] font-bold flex-shrink-0 z-10"
                  style={{
                    background: "hsl(var(--primary))",
                    color: "hsl(var(--primary-foreground))",
                  }}
                >
                  {truncationLabel}
                </div>
              </div>
              <div className="flex-1 min-w-0 pt-0.5">
                <div className="flex justify-center">
                  <button
                    type="button"
                    onClick={() => setShowAllParents(true)}
                    className="inline-flex items-center gap-1.5 text-[12px] font-semibold px-[11px] py-[5px] rounded-[8px] whitespace-nowrap"
                    style={{
                      color: "hsl(var(--primary))",
                      background: "hsl(var(--primary) / 0.10)",
                      border: "none",
                    }}
                  >
                    {`Show ${hiddenParentsCount} more`}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Show less when expanded */}
        {hasHiddenParents && showAllParents && (
          <div className="mt-3 flex justify-center">
            <button
              type="button"
              onClick={() => setShowAllParents(false)}
              className="inline-flex items-center gap-1.5 text-[12px] font-semibold px-[11px] py-[5px] rounded-[8px] whitespace-nowrap"
              style={{
                color: "hsl(var(--primary))",
                background: "hsl(var(--primary) / 0.10)",
                border: "none",
              }}
            >
              Show less
            </button>
          </div>
        )}

      </div>
    </div>
  );
}
