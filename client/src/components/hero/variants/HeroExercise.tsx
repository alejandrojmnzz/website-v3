/**
 * HeroExercise — `exercise` variant of the Hero section.
 *
 * Two-column layout: left has badge, title, description, and "This exercise includes" card;
 * right has the enrollment form card. A stats bar overlaps the bottom of the hero.
 *
 * Rules:
 * - Every text value comes from props — nothing hardcoded.
 * - If a prop is absent the block is not rendered.
 * - No maxWidth, no lateral padding — the section wrapper handles that.
 */

import { lazy, Suspense, type CSSProperties } from "react";
import type { LeadFormData } from "@shared/schema";
import { getIcon } from "@/lib/icons";
import { Card } from "@/components/ui/card";
import { UniversalImage } from "@/components/UniversalImage";

const LeadForm = lazy(
  () => import("@/components/lead_form/variants/LeadFormDefault"),
);

interface Feature {
  icon?: string;
  text?: string;
}

interface Stat {
  icon?: string;
  label?: string;
  value?: string | null;
  /** Optional unit/suffix shown after value (e.g. "hours"). Only rendered when value is present. */
  value_label?: string;
}

/** Display slug-like tags: "react-native" → "REACT NATIVE" */
function formatTagLabel(raw: string): string {
  return raw.replace(/[-_]+/g, " ").trim().toUpperCase();
}

export interface HeroExerciseData {
  badge?: string;
  exercise_type?: string;

  title?: string;
  description?: string;

  includes_title?: string;
  category?: string;
  technologies?: string[] | string;
  features?: Feature[];

  stats?: Stat[];

  form_card_title?: string;
  form_card_subtitle?: string;
  form_card_disclaimer?: string;
  /** Decorative badge/image at the top-right of the form card (same as productShowcase). */
  form_card_image?: string | { src: string; alt?: string };
  form_card_image_alt?: string;
  form_card_image_object_fit?: string;
  form_card_image_object_position?: string;
  form_card_image_width?: string;
  form_card_image_height?: string;
  form_card_image_opacity?: number;
  form_card_image_border_radius?: string;
  form?: LeadFormData;
}

interface HeroExerciseProps {
  data: HeroExerciseData;
}

export default function HeroExercise({ data }: HeroExerciseProps) {
  const {
    badge,
    exercise_type,
    title,
    description,
    includes_title,
    category,
    technologies: technologiesRaw,
    features,
    stats,
    form_card_title,
    form_card_subtitle,
    form_card_disclaimer,
    form_card_image: rawFormCardImage,
    form_card_image_alt,
    form_card_image_object_fit,
    form_card_image_object_position,
    form_card_image_width,
    form_card_image_height,
    form_card_image_opacity,
    form_card_image_border_radius,
    form,
  } = data;

  const formCardImageSrc =
    typeof rawFormCardImage === "string"
      ? rawFormCardImage
      : (rawFormCardImage?.src ?? null);
  const formCardImageAlt =
    form_card_image_alt ||
    (typeof rawFormCardImage === "object" ? rawFormCardImage?.alt : undefined) ||
    "";

  const technologies: string[] | undefined = (() => {
    if (Array.isArray(technologiesRaw)) return technologiesRaw;
    if (typeof technologiesRaw === "string") {
      const trimmed = technologiesRaw.trim();
      if (!trimmed) return undefined;
      return trimmed.split(",").map((t: string) => t.trim()).filter(Boolean);
    }
    return undefined;
  })();

  const visibleStats = (stats ?? []).filter((stat) => {
    if (stat.value == null) return false;
    const raw = String(stat.value).trim();
    if (!raw) return false;
    // Unresolved template (preview / missed resolution)
    if (/\{\{\s*single\./i.test(raw)) return false;
    return true;
  });

  const hasIncludesCard =
    includes_title ||
    category ||
    (technologies && technologies.length > 0) ||
    (features && features.length > 0);

  const hasFormCard =
    form_card_title ||
    form_card_subtitle ||
    form ||
    form_card_disclaimer ||
    formCardImageSrc;

  return (
    <div>
      {/* ── HERO ── */}
      <div className="w-full relative">
        <div className="flex flex-col lg:flex-row justify-between gap-12 items-stretch">

          {/* LEFT COLUMN */}
          <div className="w-full lg:w-[58%] flex flex-col">

            {/* Eyebrow: badge + type label */}
            {(badge || exercise_type) && (
              <div className="flex items-center gap-2 mb-3">
                {badge && (
                  <span className="bg-primary text-primary-foreground text-[12px] font-bold uppercase tracking-widest px-3 py-1 rounded-full">
                    {badge}
                  </span>
                )}
                {badge && exercise_type && (
                  <span className="text-muted-foreground/60 font-bold">·</span>
                )}
                {exercise_type && (
                  <span className="text-muted-foreground font-medium text-sm">
                    {exercise_type}
                  </span>
                )}
              </div>
            )}

            {title && (
              <h1 className="font-inter text-[28px] lg:text-[38px] font-black text-foreground leading-[1.12] tracking-tight mb-3">
                {title}
              </h1>
            )}

            {description && (
              <p className="text-muted-foreground text-base leading-relaxed mb-3 line-clamp-2">
                {description}
              </p>
            )}

            {/* "This exercise includes" card */}
            {hasIncludesCard && (
              <div
                className="mt-auto rounded-[16px] overflow-hidden bg-card"
                style={{
                  border: "1.5px solid hsl(var(--primary) / 0.22)",
                  boxShadow:
                    "0 3px 10px hsl(var(--primary) / 0.06), 0 8px 22px hsl(var(--primary) / 0.04)",
                }}
              >
                {(includes_title || category) && (
                  <>
                    <div className="flex items-center justify-between px-4 pt-3 pb-2.5">
                      {includes_title && (
                        <p className="font-inter text-[13px] font-extrabold tracking-[1.5px] uppercase text-foreground mb-0">
                          {includes_title}
                        </p>
                      )}
                      {category && (
                        <span className="inline-flex items-center rounded-full bg-primary px-3 py-1 text-[12.5px] font-medium text-primary-foreground">
                          {category}
                        </span>
                      )}
                    </div>
                    <hr className="mx-4 border-border" />
                  </>
                )}

                {technologies && technologies.length > 0 && (
                  <div className="flex flex-wrap gap-2 px-4 pt-3">
                    {technologies.map((tech) => (
                      <span
                        key={tech}
                        className="inline-flex items-center rounded-full bg-primary/10 text-primary px-3 py-1 text-[10.5px] font-medium"
                      >
                        {formatTagLabel(tech)}
                      </span>
                    ))}
                  </div>
                )}

                {features && features.length > 0 && (
                  <div className="mx-3 mb-3 mt-3 rounded-[10px] px-2 pt-1.5 pb-1" style={{ background: "hsl(var(--muted-foreground) / 0.04)" }}>
                    <div className="grid grid-cols-2 gap-x-3">
                      {features.map((item, i) => {
                        const IconComponent = item.icon
                          ? getIcon(item.icon)
                          : null;
                        return (
                          <div key={i} className="flex items-center gap-2 py-1">
                            {IconComponent && (
                              <IconComponent className="w-[18px] h-[18px] text-primary shrink-0" />
                            )}
                            {item.text && (
                              <span className="text-[14px] text-muted-foreground">
                                {item.text}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* RIGHT COLUMN — form card */}
          {hasFormCard && (
            <div className="w-full lg:w-[38%] flex flex-col justify-end">
              {/* Badge is positioned relative to this box (hugs the Card), not the tall column */}
              <div className={`relative w-full ${formCardImageSrc ? "md:mt-16" : ""}`}>
                {formCardImageSrc && (
                  <div
                    className="hidden md:block absolute flex items-center top-0 right-0 pointer-events-none z-[1001]"
                    style={{ transform: "translate(40%, -40%)" }}
                    data-testid="img-form-card-image"
                  >
                    <UniversalImage
                      id={formCardImageSrc}
                      alt={formCardImageAlt}
                      style={{
                        objectFit:
                          (form_card_image_object_fit as CSSProperties["objectFit"]) ||
                          "contain",
                        objectPosition: form_card_image_object_position || "top right",
                        width: form_card_image_width || "140px",
                        height: form_card_image_height || "140px",
                        opacity: form_card_image_opacity ?? 1,
                        borderRadius: form_card_image_border_radius || undefined,
                      }}
                      fieldContext={{ fieldPath: "form_card_image" }}
                    />
                  </div>
                )}
                <Card className="rounded-[16px] shadow-lg shadow-black/5 border border-border bg-card relative z-10">
                  {formCardImageSrc && (
                    <div className="flex justify-center mb-4 pt-5 px-5 md:hidden" data-testid="img-form-card-image-mobile">
                      <UniversalImage
                        id={formCardImageSrc}
                        alt={formCardImageAlt}
                        style={{
                          objectFit:
                            (form_card_image_object_fit as CSSProperties["objectFit"]) ||
                            "contain",
                          width: form_card_image_width || "140px",
                          height: form_card_image_height || "140px",
                          opacity: form_card_image_opacity ?? 1,
                          borderRadius: form_card_image_border_radius || undefined,
                        }}
                        fieldContext={{ fieldPath: "form_card_image" }}
                      />
                    </div>
                  )}
                  {(form_card_title || form_card_subtitle) && (
                    <div className={`pb-1 px-5 ${formCardImageSrc ? "pt-1 md:pt-5" : "pt-5"}`}>
                      {form_card_title && (
                        <p className="font-inter text-[19px] font-semibold tracking-tight text-foreground">
                          {form_card_title}
                        </p>
                      )}
                      {form_card_subtitle && (
                        <p className="text-[12.5px] text-muted-foreground leading-snug mt-1">
                          {form_card_subtitle}
                        </p>
                      )}
                    </div>
                  )}

                  {form && (
                    <div className="px-5 pb-3" data-hero-inline-form>
                      <Suspense
                        fallback={
                          <div className="min-h-24 flex items-center justify-center text-muted-foreground text-sm">
                            Loading...
                          </div>
                        }
                      >
                        <LeadForm data={form} />
                      </Suspense>
                    </div>
                  )}

                  {form_card_disclaimer && (
                    <p className="text-[11px] text-muted-foreground/60 pb-4 px-5 font-medium text-center">
                      {form_card_disclaimer}
                    </p>
                  )}
                </Card>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── STATS BAR — overlaps hero bottom ── */}
      {visibleStats.length > 0 && (
        <div className="mt-8 relative z-10">
          <div className="bg-card rounded-[16px] border border-border shadow-lg shadow-black/5 flex flex-col md:flex-row py-5 md:divide-x divide-y md:divide-y-0 divide-border">
            {visibleStats.map((stat, i) => {
              const IconComponent = stat.icon ? getIcon(stat.icon) : null;
              return (
                <div
                  key={i}
                  className="flex-1 px-8 py-3 md:py-0 flex flex-col items-center justify-center gap-0.5"
                >
                  {(IconComponent || stat.label) && (
                    <div className="flex items-center gap-1.5">
                      {IconComponent && (
                        <IconComponent className="w-[16px] h-[16px] text-primary shrink-0" />
                      )}
                      {stat.label && (
                        <p className="text-[12px] uppercase tracking-wider text-muted-foreground/60 font-semibold">
                          {stat.label}
                        </p>
                      )}
                    </div>
                  )}
                  {stat.value != null && String(stat.value).trim() !== "" && (
                    <p className="font-inter text-[18px] font-bold text-foreground leading-tight">
                      {String(stat.value).trim()}
                      {stat.value_label ? ` ${stat.value_label}` : null}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
