
import { UniversalImage } from "@/components/UniversalImage";
import type { GraduatesStatsSection, GraduatesCollageImage, GraduatesFeaturedImage } from "@shared/schema";

interface GraduatesStatsFullBleedProps {
  data: GraduatesStatsSection;
}

export default function GraduatesStatsFullBleed({ data }: GraduatesStatsFullBleedProps) {
  const heading = data.heading;
  const subheading = data.subheading;
  const stats = data.stats;
  const background = data.background;
  const collage_images = 'collage_images' in data ? data.collage_images : undefined;
  const featured_images = 'featured_images' in data ? data.featured_images : undefined;

  if (!stats || stats.length === 0) {
    return null;
  }

  if (!featured_images || featured_images.length < 2) {
    return null;
  }

  const renderCollageImages = () => (
    <div 
      className="grid grid-cols-2 gap-3"
      data-testid="graduates-stats-collage"
    >
      {collage_images && collage_images.slice(0, 4).map((img, index) => (
        <div key={index} className="h-[120px] md:h-[140px]">
          <UniversalImage
            id={img.image_id}
            preset="card"
            className="w-full h-full object-cover shadow-sm rounded-lg"
            alt={`Graduate photo ${index + 1}`}
            style={{
              objectPosition: img.object_position ?? "center center",
              transform: `scale(${img.object_scale ?? 1})`,
              transformOrigin: img.transform_origin ?? "50% 50%",
            }}
            fieldContext={{ arrayPath: "collage_images", index, srcField: "image_id" }}
          />
        </div>
      ))}
    </div>
  );

  const renderStatsCompact = () => (
    <div 
      className="flex flex-col justify-center"
      data-testid="graduates-stats-numbers"
    >
      <div className="grid grid-cols-2 lg:grid-cols-1 gap-y-6 gap-x-4 lg:gap-4">
        {stats.map((stat, index) => {
          const isEven = index % 2 === 0;
          const isLastOdd = index === stats.length - 1 && stats.length % 2 !== 0;
          
          return (
            <div 
              key={index} 
              className={`text-center lg:text-left lg:max-w-[200px] ${isLastOdd ? 'col-span-2 lg:col-span-1' : ''} ${isEven ? 'lg:mr-auto' : 'lg:ml-auto'}`}
              data-testid={`stat-item-${index}`}
            >
              <p 
                className="text-3xl md:text-4xl lg:text-6xl font-bold text-primary mb-1"
                data-testid={`text-stat-value-${index}`}
              >
                {stat.value}
                {stat.unit && <span className="text-lg md:text-xl lg:text-2xl font-semibold ml-1">{stat.unit}</span>}
              </p>
              <p 
                className="text-sm md:text-base text-muted-foreground max-w-[180px] mx-auto lg:mx-0"
                data-testid={`text-stat-label-${index}`}
              >
                {stat.label}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );

  return (
    <section 
      className={`py-16 md:py-24 overflow-hidden ${background || ''}`}
      data-testid="section-graduates-stats"
    >
      {(heading || subheading) && (
        <div className="max-w-6xl mx-auto px-4 text-center mb-12">
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

      <div className="hidden lg:block">
        <div className="flex items-stretch">
          <div 
            className="flex-shrink-0"
            style={{ width: 'calc(50vw - 576px + 700px)', minWidth: '500px' }}
          >
            <div 
              className="grid grid-cols-12 auto-rows-[80px] gap-3 h-[320px]"
              data-testid="graduates-stats-collage-full"
            >
              {featured_images.map((img, index) => {
                const colSpan = img.col_span || (index === 0 ? 5 : 3);
                const rowSpan = img.row_span || 2;
                const colStart = img.col_start || 1;
                const rowStart = img.row_start || (index === 0 ? 1 : 3);
                return (
                  <div 
                    key={`featured-${index}`}
                    style={{
                      gridColumn: colStart ? `${colStart} / span ${colSpan}` : `span ${colSpan}`,
                      gridRow: rowStart ? `${rowStart} / span ${rowSpan}` : `span ${rowSpan}`,
                    }}
                  >
                    <UniversalImage
                      id={img.image_id}
                      preset="card"
                      className="w-full h-full object-cover shadow-sm rounded-lg"
                      alt={`Featured graduate photo ${index + 1}`}
                      style={{
                        objectPosition: img.object_position ?? "center center",
                        transform: `scale(${img.object_scale ?? 1})`,
                        transformOrigin: img.transform_origin ?? "50% 50%",
                      }}
                      fieldContext={{ arrayPath: "featured_images", index, srcField: "image_id" }}
                    />
                  </div>
                );
              })}
              {collage_images && collage_images.map((img, index) => {
                const colSpan = img.col_span || 4;
                const rowSpan = img.row_span || 2;
                const colStart = img.col_start || (index < 2 ? 6 + index * 4 : 4 + index * 2);
                const rowStart = img.row_start || (index < 2 ? 1 : 3);
                return (
                  <div 
                    key={`collage-${index}`}
                    style={{
                      gridColumn: colStart ? `${colStart} / span ${colSpan}` : `span ${colSpan}`,
                      gridRow: rowStart ? `${rowStart} / span ${rowSpan}` : `span ${rowSpan}`,
                    }}
                  >
                    <UniversalImage
                      id={img.image_id}
                      preset="card"
                      className="w-full h-full object-cover shadow-sm rounded-lg"
                      alt={`Graduate photo ${index + 1}`}
                      style={{
                        objectPosition: img.object_position ?? "center center",
                        transform: `scale(${img.object_scale ?? 1})`,
                        transformOrigin: img.transform_origin ?? "50% 50%",
                      }}
                      fieldContext={{ arrayPath: "collage_images", index, srcField: "image_id" }}
                    />
                  </div>
                );
              })}
            </div>
          </div>

          <div 
            className="flex flex-col justify-center pl-12"
            style={{ 
              width: 'calc(50vw - 576px + 452px)',
              maxWidth: '452px',
              marginRight: 'max(1rem, calc(50vw - 576px))'
            }}
          >
            {renderStatsCompact()}
          </div>
        </div>
      </div>

      <div className="lg:hidden">
        <div className="max-w-6xl mx-auto px-4">
          <div className="grid grid-cols-1 gap-6 items-center">
            <div className="order-1">
              {renderStatsCompact()}
            </div>
            <div className="order-2">
              {renderCollageImages()}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
