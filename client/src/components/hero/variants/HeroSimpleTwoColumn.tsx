
import type { HeroSimpleTwoColumn as HeroSimpleTwoColumnType } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { RichTextContent } from "@/components/ui/rich-text-content";
import { UniversalVideo } from "@/components/UniversalVideo";
import { UniversalImage } from "@/components/UniversalImage";
import { createElement } from "react";
import { getIcon } from "@/lib/icons";
import { useInternalNav } from "@/hooks/useInternalNav";
import { coerceToText, coerceToHtml } from "@/lib/variable-manager";

interface HeroSimpleTwoColumnProps {
  data: HeroSimpleTwoColumnType;
}

const DEFAULT_IMAGE_SRC = "https://images.unsplash.com/photo-1522202176988-66273c2fd55f?w=800&h=600&fit=crop";
const DEFAULT_IMAGE_ALT = "Students learning together";

export default function HeroSimpleTwoColumn({ data }: HeroSimpleTwoColumnProps) {
  const handleLinkClick = useInternalNav();
  const fullData = data as HeroSimpleTwoColumnType & { video?: { url: string; ratio?: string; mobile_ratio?: string; muted?: boolean; autoplay?: boolean; loop?: boolean; preview_image_url?: string; with_shadow_border?: boolean } };
  const video = fullData.video ?? null;

  const imageSrc = typeof data.image === "string"
    ? (data.image || DEFAULT_IMAGE_SRC)
    : (data.image?.src || DEFAULT_IMAGE_SRC);
  const imageAlt = typeof data.image === "string"
    ? (data.image_alt || DEFAULT_IMAGE_ALT)
    : (data.image?.alt || data.image_alt || DEFAULT_IMAGE_ALT);
  const imageObjectFit = data.image_object_fit || "cover";
  const imageObjectPosition = data.image_object_position || "center";
  const imageFieldPath = typeof data.image === "string" ? "image" : "image.src";
  
  return (
    <section 
      data-testid="section-hero"
    >
      <div className="max-w-6xl mx-auto px-4">

        
        <div className="grid md:grid-cols-12 gap-4 lg:gap-12 items-start flex items-center">
          <div className="hidden md:block md:col-span-4 lg:col-span-5">
            {video ? (
              <UniversalVideo
                url={video.url}
                ratio={video.ratio || "16:9"}
                mobileRatio={video.mobile_ratio || "16:11"}
                muted={video.muted}
                autoplay={video.autoplay}
                loop={video.loop}
                preview_image_url={video.preview_image_url}
                withShadowBorder={video.with_shadow_border}
                className="w-full"
                data-testid="video-hero"
              />
            ) : (
              <UniversalImage
                id={imageSrc}
                alt={imageAlt}
                className="w-full h-auto rounded-card shadow-card"
                style={{ objectFit: imageObjectFit as "cover" | "contain" | "fill", objectPosition: imageObjectPosition }}
                fieldContext={{ fieldPath: imageFieldPath }}
                loading="eager"
                data-testid="img-hero"
              />
            )}
          </div>

          <div className="md:col-span-7 lg:col-span-7 text-center md:text-left">
            <h1 
              className="text-h1 mb-4 text-foreground text-center md:text-left"
              data-testid="text-hero-title"
            >
              {coerceToText(data.title)}
            </h1>
            {coerceToHtml(data.subtitle) && (
              <RichTextContent
                html={coerceToHtml(data.subtitle)}
                className="text-base mb-4 leading-relaxed"
                data-testid="text-hero-subtitle"
              />
            )}
            {coerceToText(data.badge) && (
              <span 
                className="inline-block bg-primary/10 text-primary px-4 py-2 rounded-full text-sm font-medium mb-4"
                data-testid="text-hero-badge"
              >
                {coerceToText(data.badge)}
              </span>
            )}

            {data.cta_buttons && data.cta_buttons.length > 0 && (
              <div className="flex flex-wrap gap-4 justify-center md:justify-start">
                {data.cta_buttons.map((button, index) => (
                  <Button
                    key={index}
                    variant={button.variant === "primary" ? "default" : button.variant}
                    size="lg"
                    asChild
                    data-testid={`button-hero-cta-${index}`}
                  >
                    <a href={button.url} onClick={handleLinkClick} className="flex items-center gap-2">
                      {button.icon && (() => { const Ic = getIcon(button.icon); return Ic ? createElement(Ic, { className: "h-4 w-4" }) : null; })()}
                      {button.text}
                    </a>
                  </Button>
                ))}
              </div>
            )}
            <div className="md:hidden lg:col-span-5 mt-5">
              {video ? (
                <UniversalVideo
                  url={video.url}
                  ratio={video.ratio || "16:9"}
                  mobileRatio={video.mobile_ratio || "16:11"}
                  muted={video.muted}
                  autoplay={video.autoplay}
                  loop={video.loop}
                  preview_image_url={video.preview_image_url}
                  withShadowBorder={video.with_shadow_border}
                  className="w-full"
                  data-testid="video-hero-mobile"
                />
              ) : (
                <UniversalImage
                  id={imageSrc}
                  alt={imageAlt}
                  className="w-full h-auto rounded-card shadow-card"
                  style={{ objectFit: imageObjectFit as "cover" | "contain" | "fill", objectPosition: imageObjectPosition }}
                  fieldContext={{ fieldPath: imageFieldPath }}
                  loading="eager"
                  data-testid="img-hero"
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
