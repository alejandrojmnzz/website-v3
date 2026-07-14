
import type { FeaturesGridStatsCardsSection } from "@shared/schema";
import { StatCard } from "@/components/StatCard";
import { RichTextContent } from "@/components/ui/rich-text-content";

interface FeaturesGridStatsCardsProps {
  data: FeaturesGridStatsCardsSection;
}

export default function FeaturesGridStatsCards({ data }: FeaturesGridStatsCardsProps) {
  return (
    <section 
      className={`py-12 ${data.background || 'bg-primary/5'}`}
      data-testid="section-features-grid-stats-cards"
    >
      <div className="max-w-6xl mx-auto px-4 ">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-12 flex items-center">
          <div className="flex flex-col gap-4 order-2 lg:order-1">
            {data.items.map((item, index) => {
              const itemId = item.id || `stat-${index}`;
              return (
                <StatCard
                  key={itemId}
                  value={item.value}
                  title={item.title}
                  use_card={data.use_card !== false}
                  card_color={data.card_color}
                  data-testid={`card-stat-${itemId}`}
                />
              );
            })}
          </div>

          <div className="lg:pl-4 order-1 lg:order-2">
            {data.title && (
              <h2 
                className="text-h2 mb-2 text-foreground"
                data-testid="text-stats-cards-title"
              >
                {data.title}
              </h2>
            )}
            {data.subtitle && (
              <p 
                className="text-lg mb-2 text-primary"
                data-testid="text-stats-cards-subtitle"
              >
                {data.subtitle}
              </p>
            )}
            {data.description && (
              <RichTextContent
                html={data.description}
                className="text-base text-muted-foreground leading-relaxed"
                data-testid="text-stats-cards-description"
              />
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
