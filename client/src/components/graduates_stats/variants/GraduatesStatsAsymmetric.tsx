
import { UniversalImage } from "@/components/UniversalImage";
import type { GraduatesStatsAsymmetric as GraduatesStatsAsymmetricType } from "@shared/schema";

interface GraduatesStatsAsymmetricProps {
  data: GraduatesStatsAsymmetricType;
}

export default function GraduatesStatsAsymmetric({ data }: GraduatesStatsAsymmetricProps) {
  const { heading, subheading, stats, tall_image, stacked_images, background } = data;

  if (!stats || stats.length === 0) {
    return null;
  }

  const renderStats = () => (
    <div 
      className="flex flex-col justify-center h-full"
      data-testid="graduates-stats-numbers"
    >
      <div className="flex flex-col gap-6">
        {stats.map((stat: { value: string; unit?: string; label: string }, index: number) => (
          <div 
            key={index} 
            className="text-left"
            data-testid={`stat-item-${index}`}
          >
            <p 
              className="text-3xl md:text-4xl lg:text-5xl font-bold text-primary mb-1"
              data-testid={`text-stat-value-${index}`}
            >
              {stat.value}
              {stat.unit && <span className="text-xl md:text-2xl font-semibold ml-1">{stat.unit}</span>}
            </p>
            <p 
              className="text-sm md:text-base text-muted-foreground"
              data-testid={`text-stat-label-${index}`}
            >
              {stat.label}
            </p>
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <section 
      className={`py-16 md:py-24 ${background || ''}`}
      data-testid="section-graduates-stats"
    >
      <div className="max-w-6xl mx-auto px-4">
        {(heading || subheading) && (
          <div className="text-center mb-12">
            {heading && (
              <h2 
                className="text-2xl md:text-3xl lg:text-4xl font-bold text-foreground leading-tight mb-4"
                data-testid="text-graduates-stats-heading"
                dangerouslySetInnerHTML={{ __html: heading }}
              />
            )}
            {subheading && (
              <p 
                className="text-muted-foreground text-base md:text-lg max-w-3xl mx-auto"
                data-testid="text-graduates-stats-subheading"
              >
                {subheading}
              </p>
            )}
          </div>
        )}

        <div 
          className="hidden lg:grid lg:grid-cols-12 gap-4 items-stretch" 
          style={{ "--section-height": "480px" } as React.CSSProperties}
          data-testid="graduates-stats-asymmetric-desktop"
        >
          <div className="col-span-4" style={{ height: "var(--section-height)" }}>
            <UniversalImage
              id={tall_image}
              preset="card"
              className="w-full h-full object-cover shadow-sm"
              alt="Featured graduate"
              fieldContext={{ fieldPath: "tall_image" }}
            />
          </div>
          
          <div 
            className="col-span-4 grid grid-rows-2 gap-4" 
            style={{ height: "var(--section-height)" }}
          >
            {stacked_images && stacked_images.length > 0 && (
              <div className="min-h-0 overflow-hidden">
                <UniversalImage
                  id={stacked_images[0]}
                  preset="card"
                  className="w-full h-full object-cover shadow-sm"
                  alt="Graduate photo 1"
                  fieldContext={{ fieldPath: "stacked_images.0" }}
                />
              </div>
            )}
            {stacked_images && stacked_images.length > 1 && (
              <div className="min-h-0 overflow-hidden">
                <UniversalImage
                  id={stacked_images[1]}
                  preset="card"
                  className="w-full h-full object-cover shadow-sm"
                  alt="Graduate photo 2"
                  fieldContext={{ fieldPath: "stacked_images.1" }}
                />
              </div>
            )}
          </div>
          
          <div className="col-span-4 pl-4 flex" style={{ height: "var(--section-height)" }}>
            {renderStats()}
          </div>
        </div>

        <div className="lg:hidden space-y-6" data-testid="graduates-stats-asymmetric-mobile">
          <div className="grid grid-cols-2 gap-3">
            <div className="h-[200px]">
              <UniversalImage
                id={tall_image}
                preset="card"
                className="w-full h-full object-cover shadow-sm"
                alt="Featured graduate"
                fieldContext={{ fieldPath: "tall_image" }}
              />
            </div>
            <div className="flex flex-col gap-3">
              {stacked_images && stacked_images.length > 0 && (
                <div className="flex-1 min-h-0">
                  <UniversalImage
                    id={stacked_images[0]}
                    preset="card"
                    className="w-full h-full object-cover shadow-sm"
                    alt="Graduate photo 1"
                    fieldContext={{ fieldPath: "stacked_images.0" }}
                  />
                </div>
              )}
              {stacked_images && stacked_images.length > 1 && (
                <div className="flex-1 min-h-0">
                  <UniversalImage
                    id={stacked_images[1]}
                    preset="card"
                    className="w-full h-full object-cover shadow-sm"
                    alt="Graduate photo 2"
                    fieldContext={{ fieldPath: "stacked_images.1" }}
                  />
                </div>
              )}
            </div>
          </div>
          
          <div className="pt-4">
            {renderStats()}
          </div>
        </div>
      </div>
    </section>
  );
}
