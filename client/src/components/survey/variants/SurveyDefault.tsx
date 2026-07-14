import { useState, useEffect, useRef } from "react";
import { getIcon } from "@/lib/icons";
import UniversalImage from "@/components/UniversalImage";
import { useInternalNav } from "@/hooks/useInternalNav";
import { usePageSections } from "@/contexts/PageSectionsContext";
import { loadSectionComponent } from "@/components/sectionRegistry";
import { renderSection } from "@/components/SectionRenderer";
import type { SurveyDefault, Section } from "@shared/schema";

type SurveyOption = SurveyDefault["questions"][0]["options"][0];
type SurveyQuestion = SurveyDefault["questions"][0];
type SurveyAction = { url?: string; message?: string; next_question?: string | number };
type ConcatRoutes = Record<string, SurveyAction>;
type SumThreshold = { until: number } & SurveyAction;
type SumRoutes = { thresholds?: SumThreshold[]; fallback?: SurveyAction };

/** Returns the bare ID (no q/o prefix). Explicit id used as-is; implicit fallback is "1", "2", etc. */
function resolveQId(question: SurveyQuestion, idx: number): string {
  return question.id ?? String(idx + 1);
}

function resolveOId(option: SurveyOption, optIdx: number): string {
  return option.id ?? String(optIdx + 1);
}

/** Builds route key parts always in q{id}o{id} format, e.g. "qgoalodata" or "q1o1". */
function buildAnswerParts(answers: Record<string, string>, questions: SurveyQuestion[]): string[] {
  return questions
    .map((q, i) => {
      const qId = resolveQId(q, i);
      const oId = answers[qId];
      return oId ? `q${qId}o${oId}` : null;
    })
    .filter(Boolean) as string[];
}

function resolveFromConcatRoutes(
  answers: Record<string, string>,
  questions: SurveyQuestion[],
  routes: ConcatRoutes,
  maxQuestions?: number,
): SurveyAction | null {
  const answerParts = buildAnswerParts(answers, questions);
  const fullKey = answerParts.join("-");

  // Strict exact key lookup only
  if (routes[fullKey]) return routes[fullKey];

  const stepsRequired = maxQuestions ?? questions.length;
  if (routes.default && Object.keys(answers).length >= stepsRequired) {
    return routes.default;
  }

  return null;
}

function resolveFromSumRoutes(
  answers: Record<string, string>,
  questions: SurveyQuestion[],
  routes: SumRoutes,
  maxQuestions: number,
): SurveyAction | null {
  if (Object.keys(answers).length < maxQuestions) return null;

  let total = 0;
  for (const [qId, oId] of Object.entries(answers)) {
    const qIdx = questions.findIndex((q, i) => resolveQId(q, i) === qId);
    if (qIdx === -1) continue;
    const optIdx = questions[qIdx].options.findIndex((o, i) => resolveOId(o, i) === oId);
    if (optIdx === -1) continue;
    total += questions[qIdx].options[optIdx].value ?? 1;
  }

  const thresholds = routes.thresholds ?? [];
  for (const t of thresholds) {
    if (total <= t.until) {
      return { url: t.url, message: t.message, next_question: t.next_question };
    }
  }

  return routes.fallback ?? null;
}

function resolveRoutes(
  answers: Record<string, string>,
  questions: SurveyQuestion[],
  routes: unknown,
  method: "concat" | "sum",
  maxQuestions?: number,
): SurveyAction | null {
  if (!routes || typeof routes !== "object") return null;
  if (method === "sum") {
    const stepsRequired = maxQuestions ?? questions.length;
    return resolveFromSumRoutes(answers, questions, routes as SumRoutes, stepsRequired);
  }
  return resolveFromConcatRoutes(answers, questions, routes as ConcatRoutes, maxQuestions);
}

/** Recursively extract all `inline#...` URL strings from a route object. */
function extractInlineUrls(obj: unknown): string[] {
  if (!obj || typeof obj !== "object") return [];
  const urls: string[] = [];
  for (const val of Object.values(obj as Record<string, unknown>)) {
    if (typeof val === "string" && val.startsWith("inline#")) {
      urls.push(val);
    } else if (val && typeof val === "object") {
      urls.push(...extractInlineUrls(val));
    }
  }
  return urls;
}

export default function SurveyDefault({ data }: { data: SurveyDefault }) {
  const [currentQIdx, setCurrentQIdx] = useState(0);
  const [history, setHistory] = useState<number[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [animating, setAnimating] = useState(false);
  const [slideDir, setSlideDir] = useState<"none" | "exit-fwd" | "enter-fwd" | "exit-back" | "enter-back">("none");
  const [phase, setPhase] = useState<"questions" | "inline" | "message">("questions");
  const [inlineSectionData, setInlineSectionData] = useState<Record<string, unknown> | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const inlineRef = useRef<HTMLDivElement>(null);
  const nav = useInternalNav();
  const pageSections = usePageSections();

  const questionCount = data.questions.length;
  const displayTotal = data.max_questions ?? questionCount;
  const aggregationMethod = data.aggregation_method ?? "concat";
  const SectionIcon = data.icon ? getIcon(data.icon) : null;
  const stepLabel = data.step_label ?? "Question";
  const stepOfLabel = data.step_of_label ?? "of";

  function renderSectionMedia(size: "sm" | "lg") {
    if (data.image_id) {
      const px = size === "sm" ? 40 : 40;
      return (
        <UniversalImage
          id={data.image_id}
          style={{ objectFit: "contain", width: `${px}px`, height: `${px}px` }}
        />
      );
    }
    if (SectionIcon) {
      const px = size === "sm" ? "28" : "85";
      return (
        <SectionIcon width={px} height={px} style={{ color: "hsl(var(--foreground))" }} />
      );
    }
    return null;
  }

  const hasSectionMedia = Boolean(data.image_id || SectionIcon);

  // Scroll to inline section after transition animation completes (offset for sticky navbar)
  useEffect(() => {
    if (phase === "inline" && inlineRef.current) {
      const el = inlineRef.current;
      const delay = data.scroll_delay ?? 250;
      const extraOffset = data.scroll_offset ?? 0;
      setTimeout(() => {
        const navEl = document.querySelector('nav[data-testid="navbar"]') ?? document.querySelector("header");
        const navHeight = navEl ? navEl.getBoundingClientRect().height : 80;
        const y = el.getBoundingClientRect().top + window.scrollY - navHeight - 45 + extraOffset;
        window.scrollTo({ top: Math.max(0, y), behavior: "smooth" });
      }, delay);
    }
  }, [phase]);

  // Preload all inline section components referenced in routes on mount
  useEffect(() => {
    const inlineUrls = new Set(extractInlineUrls(data.routes));
    const alternateUrl = data.alternate_link?.url;
    if (alternateUrl?.startsWith("inline#")) {
      inlineUrls.add(alternateUrl);
    }
    for (const url of inlineUrls) {
      const sectionId = url.slice("inline#".length);
      const sectionData = pageSections[sectionId];
      if (!sectionData) continue;
      const type = sectionData.type as string | undefined;
      const variant = (sectionData.variant as string | undefined) ?? "default";
      if (!type) continue;
      void loadSectionComponent(type, variant).catch((err) => {
        console.error(
          `[SurveyDefault] Failed to preload section chunk "${type}/${variant}":`,
          err,
        );
      });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function animateTransition(direction: "fwd" | "back", onSwitch: () => void) {
    if (animating) return;
    setAnimating(true);
    setSlideDir(direction === "fwd" ? "exit-fwd" : "exit-back");
    setTimeout(() => {
      onSwitch();
      setSlideDir(direction === "fwd" ? "enter-fwd" : "enter-back");
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          setSlideDir("none");
          setAnimating(false);
        }),
      );
    }, 200);
  }

  function handleAction(action: SurveyAction, fromQIdx: number) {
    if (action.url) {
      const sectionData = nav.navigate(action.url);
      if (sectionData) {
        setInlineSectionData(sectionData);
        setPhase("inline");
      }
      return;
    }
    if (action.message) {
      setMessage(action.message);
      setPhase("message");
      return;
    }
    if (action.next_question !== undefined) {
      const nextIdx = findQuestionIndex(action.next_question, fromQIdx);
      setHistory((h) => [...h, fromQIdx]);
      setCurrentQIdx(nextIdx);
    }
  }

  function findQuestionIndex(nextQ: string | number, currentIdx: number): number {
    if (typeof nextQ === "number") {
      return Math.max(0, Math.min(questionCount - 1, nextQ - 1));
    }
    const idx = data.questions.findIndex((q, i) => resolveQId(q, i) === String(nextQ));
    return idx !== -1 ? idx : currentIdx + 1;
  }

  function pick(qIdx: number, oIdx: number, option: SurveyOption) {
    if (animating) return;

    const qId = resolveQId(data.questions[qIdx], qIdx);
    const oId = resolveOId(option, oIdx);
    const newAnswers = { ...answers, [qId]: oId };
    setAnswers(newAnswers);

    // Priority: routes > option.url > option.message > option.next_question > sequential
    const action = option.action;

    // Routes take priority over individual option actions
    const resolved = resolveRoutes(
      newAnswers,
      data.questions,
      data.routes,
      aggregationMethod,
      data.max_questions,
    );
    if (resolved) {
      animateTransition("fwd", () => handleAction(resolved, qIdx));
      return;
    }

    if (action?.url) {
      const sectionData = nav.navigate(action.url);
      if (sectionData) {
        animateTransition("fwd", () => {
          setInlineSectionData(sectionData);
          setPhase("inline");
        });
      }
      return;
    }
    if (action?.message) {
      animateTransition("fwd", () => {
        setMessage(action.message!);
        setPhase("message");
      });
      return;
    }
    if (action?.next_question !== undefined) {
      const nextIdx = findQuestionIndex(action.next_question, qIdx);
      animateTransition("fwd", () => {
        setHistory((h) => [...h, qIdx]);
        setCurrentQIdx(nextIdx);
      });
      return;
    }

    // Fallback: advance sequentially, do nothing on last question
    if (qIdx < questionCount - 1) {
      animateTransition("fwd", () => {
        setHistory((h) => [...h, qIdx]);
        setCurrentQIdx(qIdx + 1);
      });
    }
  }

  function followAlternateLink(e: React.MouseEvent<HTMLAnchorElement>) {
    if (animating) return;
    const url = data.alternate_link?.url;
    if (!url) return;

    e.preventDefault();

    const sectionData = nav.navigate(url);
    if (sectionData) {
      animateTransition("fwd", () => {
        setInlineSectionData(sectionData);
        setPhase("inline");
      });
    }
  }

  function goBack() {
    if (animating || history.length === 0) return;
    animateTransition("back", () => {
      const prev = history[history.length - 1];
      setHistory((h) => h.slice(0, -1));
      setCurrentQIdx(prev);
    });
  }

  function restart() {
    if (animating) return;
    animateTransition("back", () => {
      setCurrentQIdx(0);
      setHistory([]);
      setAnswers({});
      setPhase("questions");
      setInlineSectionData(null);
      setMessage(null);
    });
  }

  const slideStyle: React.CSSProperties =
    slideDir === "exit-fwd"
      ? { opacity: 0, transform: "translateX(-16px)", transition: "opacity .2s, transform .2s" }
      : slideDir === "enter-fwd"
        ? { opacity: 0, transform: "translateX(16px)" }
        : slideDir === "exit-back"
          ? { opacity: 0, transform: "translateX(16px)", transition: "opacity .2s, transform .2s" }
          : slideDir === "enter-back"
            ? { opacity: 0, transform: "translateX(-16px)" }
            : { opacity: 1, transform: "none", transition: "opacity .2s, transform .2s" };

  // Progress
  const isInfinite = data.infinite_progress_bar === true;
  const progressTotal = displayTotal;
  const progressFilled =
    phase === "inline" || phase === "message"
      ? progressTotal
      : Math.min(history.length, progressTotal);
  // For infinite mode, completed = answers given so far
  const infiniteCompleted = history.length;

  // Per-question subtitle: explicit subtitle > auto-computed step label
  const stepNum = history.length + 1;
  const autoStepSubtitle = `${stepLabel} ${stepNum} ${stepOfLabel} ${displayTotal}`;
  const currentSubtitle = data.questions[currentQIdx]?.subtitle ?? autoStepSubtitle;

  const isDone = phase === "inline" || phase === "message";

  return (
    <div
      className="py-4 md:px-4"
      style={{ fontFamily: "'Inter Variable',system-ui,-apple-system,sans-serif" }}
    >
      <div className="mx-auto">
        {data.badge_text && (
          <div className="flex justify-center md:justify-start mb-5">
          <div
            className="inline-flex items-center gap-1.5 text-[11px] font-bold tracking-[0.08em] uppercase px-[13px] py-[5px] rounded-full"
            style={{ background: "hsl(var(--primary))", color: "hsl(var(--primary-foreground))" }}
          >
            {data.badge_text}
          </div>
          </div>
        )}

        {data.title && (
          <h1
            className="text-[26px] md:text-[36px] font-extrabold tracking-[-0.025em] leading-[1.1] mb-[0.6rem] text-center md:text-left"
            style={{ color: "hsl(var(--foreground))", fontFamily: "'Inter Variable'" }}
          >
            <span dangerouslySetInnerHTML={{ __html: data.title }} />
            {data.title_highlight && (
              <>
                <br />
                <span
                  style={{ color: "hsl(var(--primary))" }}
                  dangerouslySetInnerHTML={{ __html: data.title_highlight }}
                />
              </>
            )}
          </h1>
        )}
        {data.subtitle && (
          <p
            className="text-[13px] md:text-[15px] leading-[1.6] mb-1.5 text-center md:text-left"
            style={{ color: "hsl(var(--muted-foreground))" }}
          >
            {data.subtitle}
          </p>
        )}

        {/* Restart button — own row, above progress bar; always rendered to avoid layout shift */}
        <div className="flex justify-end mb-2" style={{ visibility: isDone ? "visible" : "hidden" }}>
            <button
              className="text-[12px] font-medium bg-transparent border-none cursor-pointer flex items-center gap-1 transition-colors duration-150"
              style={{ color: "hsl(var(--muted-foreground) / 0.5)" }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = "hsl(var(--muted-foreground))";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = "hsl(var(--muted-foreground) / 0.5)";
              }}
              onClick={restart}
              data-testid="survey-restart-button"
            >
              <svg
                width="11"
                height="11"
                viewBox="0 0 12 12"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  d="M8 10L4 6L8 2"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              {data.restart_label ?? "Start over"}
            </button>
          </div>

          {/* Progress bar */}
        <div className="flex gap-[8px] mb-9 items-center">
          {isInfinite
            ? Array.from(
                { length: isDone ? infiniteCompleted + 1 : infiniteCompleted + 2 },
                (_, i) => {
                  const isCompleted = i < infiniteCompleted;
                  const isActive = i === infiniteCompleted;
                  const isPeek = !isDone && i === infiniteCompleted + 1;
                  // flex-grow: completed=1, active=2.5, peek=0.4, done-active=1
                  const grow = isCompleted ? 1 : isPeek ? 0.4 : isDone ? 1 : 2.5;
                  return (
                    <div
                      key={i}
                      className="h-[2.2px] rounded-full"
                      style={{
                        flexGrow: grow,
                        flexShrink: 1,
                        flexBasis: 0,
                        transition: "flex-grow .35s ease, background .4s",
                        background:
                          isCompleted || isActive
                            ? "hsl(var(--primary))"
                            : "hsl(var(--secondary))",
                      }}
                    />
                  );
                },
              )
            : Array.from({ length: progressTotal }, (_, i) => (
                <div
                  key={i}
                  className="h-[2.2px] flex-1 rounded-full"
                  style={{
                    transition: "background .4s",
                    background:
                      i < progressFilled
                        ? "hsl(var(--primary))"
                        : i === progressFilled && phase === "questions"
                          ? "hsl(var(--primary) / 0.35)"
                          : "hsl(var(--secondary))",
                  }}
                />
              ))}
        </div>

        {/* QUIZ */}
        {phase === "questions" && (
          <div style={slideStyle} className="md:mr-28">
            <div className="flex">
              <div className="hidden md:flex w-28 flex-shrink-0 items-start justify-center -mt-[19px]">
                <div className="mt-5">{renderSectionMedia("lg")}</div>
              </div>
              <div className="flex-1 min-w-0">
            <div className="mb-4 md:mb-0">
              {hasSectionMedia && (
                <div className="flex justify-center mb-1 md:hidden">
                  {renderSectionMedia("sm")}
                </div>
              )}
              <div className="text-center md:text-left">
              {currentSubtitle && (
                <div
                  className="text-[11px] md:text-[11px] font-bold tracking-[0.09em] uppercase mb-1"
                  style={{ color: "hsl(var(--muted-foreground) / 0.5)" }}
                >
                  {currentSubtitle}
                </div>
              )}
              <div
                className="text-[18px] md:text-[20px] font-bold leading-[1.25] tracking-[-0.01em] md:mb-6"
                style={{ color: "hsl(var(--foreground))" }}
              >
                {data.questions[currentQIdx]?.text}
              </div>
              </div>
            </div>
            <div className="flex flex-col gap-2" key={currentQIdx}>
              {data.questions[currentQIdx]?.options.map((opt, optIdx) => {
                const qId = resolveQId(data.questions[currentQIdx], currentQIdx);
                const oId = resolveOId(opt, optIdx);
                const sel = answers[qId] === oId;
                return (
                  <button
                    key={optIdx}
                    className="flex items-start gap-[9px] md:gap-[14px] px-2.5 md:px-4 py-[10px] md:py-[11px] border-[1.5px] rounded-[12px] cursor-pointer text-left w-full transition-all duration-200 shadow-[0_1px_3px_rgba(0,0,0,0.04)]"
                    style={{
                      borderColor: sel ? "hsl(var(--primary))" : "hsl(var(--border))",
                      background: sel
                        ? "hsl(var(--primary) / 0.08)"
                        : "hsl(var(--background))",
                    }}
                    onMouseEnter={(e) => {
                      if (!sel) {
                        e.currentTarget.style.borderColor =
                          "hsl(var(--primary) / 0.4)";
                        e.currentTarget.style.background =
                          "hsl(var(--primary) / 0.03)";
                        e.currentTarget.style.transform = "translateY(-1px)";
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!sel) {
                        e.currentTarget.style.borderColor = "hsl(var(--border))";
                        e.currentTarget.style.background =
                          "hsl(var(--background))";
                        e.currentTarget.style.transform = "none";
                      }
                    }}
                    onClick={() => pick(currentQIdx, optIdx, opt)}
                    data-testid={`survey-option-${currentQIdx}-${optIdx}`}
                  >
                    <div
                      className="w-4 h-4 md:w-5 md:h-5 mt-0.5 md:mt-0 rounded-full border-[1.5px] flex-shrink-0 flex items-center justify-center transition-all duration-200"
                      style={{
                        background: sel ? "hsl(var(--primary))" : "transparent",
                        borderColor: sel
                          ? "hsl(var(--primary))"
                          : "hsl(var(--border) / 0.8)",
                      }}
                    >
                      <div
                        className="w-[7px] h-[7px] rounded-full transition-all duration-200"
                        style={{
                          background: "hsl(var(--background))",
                          opacity: sel ? 1 : 0,
                          transform: sel ? "scale(1)" : "scale(0.4)",
                        }}
                      />
                    </div>
                    <span
                      className="text-[13px] md:text-[15px] flex-1 font-medium leading-[1.4]"
                      style={{
                        color: sel
                          ? "hsl(var(--primary))"
                          : "hsl(var(--foreground) / 0.7)",
                      }}
                    >
                      {opt.label}
                    </span>
                  </button>
                );
              })}
            </div>
            {(history.length > 0 || (currentQIdx === 0 && data.alternate_link?.label)) && (
              <div className="w-full mt-3 md:mt-4 flex items-center justify-between gap-3">
                {history.length > 0 ? (
                <button
                  className="text-[12px] md:text-[13px] font-medium bg-transparent border-none cursor-pointer flex items-center gap-1.5 transition-colors duration-150 px-0"
                  style={{ color: "hsl(var(--muted-foreground) / 0.5)" }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.color = "hsl(var(--muted-foreground))";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.color =
                      "hsl(var(--muted-foreground) / 0.5)";
                  }}
                  onClick={goBack}
                  data-testid="survey-back-button"
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 14 14"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <path
                      d="M9 11L5 7L9 3"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  {data.back_label ?? "Back"}
                </button>
                ) : (
                  <span aria-hidden className="shrink-0" />
                )}
                {currentQIdx === 0 && data.alternate_link?.label && (
                  data.alternate_link.url ? (
                    <a
                      href={data.alternate_link.url}
                      onClick={followAlternateLink}
                      className="text-[12px] md:text-[13px] font-medium transition-colors duration-150 shrink-0 flex items-center gap-1.5"
                      style={{ color: "hsl(var(--muted-foreground) / 0.5)", textDecoration: "none" }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.color = "hsl(var(--muted-foreground))";
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.color = "hsl(var(--muted-foreground) / 0.5)";
                      }}
                      data-testid="survey-alternate-link"
                    >
                      {data.alternate_link.label}
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 14 14"
                        fill="none"
                        xmlns="http://www.w3.org/2000/svg"
                      >
                        <path
                          d="M5 11L9 7L5 3"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </a>
                  ) : (
                    <span
                      className="text-[13px] font-medium shrink-0 flex items-center gap-1.5"
                      style={{ color: "hsl(var(--muted-foreground) / 0.5)" }}
                      data-testid="survey-alternate-link"
                    >
                      {data.alternate_link.label}
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 14 14"
                        fill="none"
                        xmlns="http://www.w3.org/2000/svg"
                      >
                        <path
                          d="M5 11L9 7L5 3"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </span>
                  )
                )}
              </div>
            )}
            </div>
            </div>
          </div>
        )}

        {/* MESSAGE */}
        {phase === "message" && (
          <div style={slideStyle} className="relative mx-0 md:mx-28">
            <div
              className="text-[18px] leading-[1.5] font-medium"
              style={{ color: "hsl(var(--foreground))" }}
            >
              {message}
            </div>
          </div>
        )}

        {/* INLINE — renders within survey container, respects section's own YAML styles */}
        {phase === "inline" && inlineSectionData && (
          <div ref={inlineRef} style={slideStyle}>
            {renderSection(inlineSectionData as Parameters<typeof renderSection>[0], 0)}
          </div>
        )}
      </div>
    </div>
  );
}
