import { lazy, Suspense } from "react";
import { IconCheck } from "@tabler/icons-react";
import { getIcon } from "@/lib/icons";
import type { CtaBannerResourceShowcase } from "@shared/schema";

const LeadForm = lazy(() => import("@/components/lead_form/variants/LeadFormDefault"));

interface Props {
  data: CtaBannerResourceShowcase;
}

/** Fallback PDF illustration when no image or icon is provided */
function PdfIcon() {
  return (
    <svg width="46" height="46" viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="rs-pdf-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FFFFFF" />
          <stop offset="100%" stopColor="#F1F4F9" />
        </linearGradient>
      </defs>
      <path d="M14 4H40L52 16V58C52 60.2 50.2 62 48 62H14C11.8 62 10 60.2 10 58V8C10 5.8 11.8 4 14 4Z" fill="url(#rs-pdf-grad)" />
      <path d="M40 4L52 16H42C40.9 16 40 15.1 40 14V4Z" fill="#C9D9F5" />
      <rect x="18" y="26" width="26" height="3" rx="1.5" fill="#C7CFDD" />
      <rect x="18" y="33" width="26" height="3" rx="1.5" fill="#C7CFDD" />
      <rect x="18" y="40" width="17" height="3" rx="1.5" fill="#C7CFDD" />
      <rect x="12" y="44" width="34" height="16" rx="4" fill="#FF7A45" />
      <text x="29" y="55" fontFamily="sans-serif" fontSize="11" fontWeight="700" fill="#FFFFFF" textAnchor="middle">PDF</text>
    </svg>
  );
}

export function CtaBannerResourceShowcase({ data }: Props) {
  const { eyebrow, title, subtitle, preview, benefits, form, form_card_title, form_card_subtitle } = data;
  const hasForm = !!form;

  return (
    <div
      className="overflow-hidden rounded-[20px] bg-background p-5 sm:p-7 w-full"
      style={{
        border: "1.5px solid rgba(37,99,235,0.22)",
        boxShadow: "0 3px 10px rgba(37,99,235,0.06), 0 8px 22px rgba(37,99,235,0.04)",
      }}
    >
        <div className={`grid grid-cols-1 items-center gap-9 ${hasForm ? "md:grid-cols-[1.25fr_1fr]" : ""}`}>

          {/* Left column: content */}
          <section className="min-w-0">
            {eyebrow && (
              <span className="inline-flex rounded-full bg-primary/10 px-3 py-1 text-[12px] font-bold tracking-[0.12em] text-primary">
                {eyebrow}
              </span>
            )}

            {title && (
              <h2
                className="mt-3 max-w-[450px] font-inter font-bold leading-[1.05] tracking-[-0.045em]"
                dangerouslySetInnerHTML={{ __html: title }}
              />
            )}

            {subtitle && (
              <p className="mt-2.5 text-base leading-7 text-muted-foreground">
                {subtitle}
              </p>
            )}

            {/* Preview box */}
            {preview && (preview.title || preview.description || preview.image || preview.icon) && (() => {
              const PreviewIcon = preview.icon ? getIcon(preview.icon) : null;
              return (
                <div className="mt-4 mr-10 flex items-center gap-4 rounded-2xl border border-border bg-muted/50 p-4">
                  <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-background shadow-sm">
                    {preview.image ? (
                      <img
                        src={preview.image.src}
                        alt={preview.image.alt}
                        className="h-10 w-10 object-contain"
                      />
                    ) : PreviewIcon ? (
                      <PreviewIcon size={32} className="text-primary" />
                    ) : (
                      <PdfIcon />
                    )}
                  </div>
                  <div className="min-w-0">
                    {preview.title && (
                      <p className="truncate text-sm font-bold">{preview.title}</p>
                    )}
                    {preview.description && (
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">{preview.description}</p>
                    )}
                  </div>
                </div>
              );
            })()}

            {/* Benefits list */}
            {benefits && benefits.length > 0 && (
              <ul className="mt-4 space-y-3.5">
                {benefits.map((benefit, i) => {
                  const BenefitIcon = benefit.icon ? getIcon(benefit.icon) : null;
                  return (
                    <li key={i} className="flex items-start gap-3 text-sm font-medium leading-5">
                      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                        {BenefitIcon
                          ? <BenefitIcon size={13} />
                          : <IconCheck size={13} strokeWidth={3} />
                        }
                      </span>
                      {benefit.label}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {/* Right column: LeadForm (optional) */}
          {hasForm && (
            <section className="rounded-2xl border border-primary/20 bg-primary/5 overflow-hidden">
              {(form_card_title || form_card_subtitle) && (
                <div className="px-5 pt-5 pb-1">
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
              <div className="px-5 sm:px-6 pb-5 sm:pb-6 pt-1.5">
                <Suspense fallback={
                  <div className="min-h-24 flex items-center justify-center text-sm text-muted-foreground">
                    Loading…
                  </div>
                }>
                  <LeadForm data={form!} />
                </Suspense>
              </div>
            </section>
          )}
        </div>
    </div>
  );
}

export default CtaBannerResourceShowcase;
