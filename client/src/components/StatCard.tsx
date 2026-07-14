import { useState, useEffect, useRef } from "react";
import { Card } from "@/components/ui/card";
import { resolveTemplateFallback, hasTemplateVariables } from "@/lib/variable-manager";

export interface StatCardProps {
  value: string;
  title: string;
  use_card?: boolean;
  card_color?: string;
  className?: string;
  layout?: "vertical" | "horizontal-mobile";
  size?: "default" | "small";
  value_size?: string;
  animate?: boolean;
  animationDelay?: number;
}

function parseNumericValue(numStr: string): number {
  return parseFloat(numStr.replace(/,/g, ""));
}

function formatNumber(num: number, template: string): string {
  const hasComma = template.includes(",");
  if (hasComma) {
    return num.toLocaleString("en-US", { maximumFractionDigits: 0 });
  }
  if (template.includes(".")) {
    const decimals = template.split(".")[1]?.length || 0;
    return num.toFixed(decimals);
  }
  return Math.round(num).toString();
}

interface AnimatedValueProps {
  value: string;
  animate: boolean;
  animationDelay: number;
}

function useCountUp(target: number, duration: number, shouldAnimate: boolean, delay: number = 0): number {
  const [current, setCurrent] = useState(0);
  const startTimeRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const hasStartedRef = useRef(false);

  useEffect(() => {
    if (!shouldAnimate) {
      return;
    }

    if (hasStartedRef.current) {
      return;
    }

    const delayTimer = setTimeout(() => {
      hasStartedRef.current = true;
      setCurrent(0);
      startTimeRef.current = null;

      const animate = (timestamp: number) => {
        if (startTimeRef.current === null) {
          startTimeRef.current = timestamp;
        }
        const elapsed = timestamp - startTimeRef.current;
        const progress = Math.min(elapsed / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 3);
        setCurrent(eased * target);

        if (progress < 1) {
          rafRef.current = requestAnimationFrame(animate);
        }
      };

      rafRef.current = requestAnimationFrame(animate);
    }, delay);

    return () => {
      clearTimeout(delayTimer);
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, [shouldAnimate, target, duration, delay]);

  return current;
}

function AnimatedValue({ value, animate, animationDelay }: AnimatedValueProps) {
  const match = value.match(/^(~)?(\$?)([0-9.,]+)([A-Za-z%x]+)?(-)?(\$?)([0-9.,]+)?([A-Za-z%x]+)?$/);
  
  if (!match) {
    return <>{value}</>;
  }

  const [, tilde, prefix1, num1, unit1, separator, prefix2, num2, unit2] = match;
  
  const targetNum1 = parseNumericValue(num1);
  const targetNum2 = num2 ? parseNumericValue(num2) : null;
  
  const count1 = useCountUp(targetNum1, 1500, animate, animationDelay);
  const count2 = useCountUp(targetNum2 ?? 0, 1500, animate && targetNum2 !== null, animationDelay);

  return (
    <>
      {tilde && <span>{tilde}</span>}
      {prefix1 && <span>{prefix1}</span>}
      <span>{formatNumber(count1, num1)}</span>
      {unit1 && <span>{unit1}</span>}
      {separator && <span>{separator}</span>}
      {prefix2 && <span>{prefix2}</span>}
      {targetNum2 !== null && <span>{formatNumber(count2, num2!)}</span>}
      {unit2 && <span>{unit2}</span>}
    </>
  );
}

function formatValueWithUnit(value: string) {
  const match = value.match(/^(~)?(\$?)([0-9.,]+)([A-Za-z%x]+)?(-)?(\$?)([0-9.,]+)?([A-Za-z%x]+)?$/);
  
  if (!match) {
    return <>{value}</>;
  }

  const [, tilde, prefix1, num1, unit1, separator, prefix2, num2, unit2] = match;

  return (
    <>
      {tilde && <span>{tilde}</span>}
      {prefix1 && <span>{prefix1}</span>}
      <span>{num1}</span>
      {unit1 && <span>{unit1}</span>}
      {separator && <span>{separator}</span>}
      {prefix2 && <span>{prefix2}</span>}
      {num2 && <span>{num2}</span>}
      {unit2 && <span>{unit2}</span>}
    </>
  );
}

export function StatCard({ 
  value, 
  title, 
  use_card = true, 
  card_color = "bg-primary/5",
  className = "",
  layout = "vertical",
  size = "default",
  value_size,
  animate = false,
  animationDelay = 0
}: StatCardProps) {
  const isTemplate = hasTemplateVariables(value);
  const numericValue = isTemplate ? resolveTemplateFallback(value) : value;
  const isHorizontalMobile = layout === "horizontal-mobile";
  const isSmall = size === "small";
  
  const valueSizeClass = value_size 
    ? value_size
    : isSmall 
      ? (isHorizontalMobile ? "text-2xl sm:text-3xl md:text-4xl lg:text-5xl" : "text-2xl md:text-4xl lg:text-5xl")
      : (isHorizontalMobile ? "text-4xl sm:text-5xl" : "text-5xl");
  
  const content = (
    <div className={`font-inter ${isHorizontalMobile ? "flex items-center gap-4 sm:block" : ""}`}>
      <div className={`font-bold text-primary ${valueSizeClass} shrink-0`}>
        {isTemplate ? (
          value
        ) : animate ? (
          <AnimatedValue value={numericValue} animate={animate} animationDelay={animationDelay} />
        ) : (
          formatValueWithUnit(numericValue)
        )}
      </div>
      <div className={`text-sm text-foreground ${isHorizontalMobile ? "sm:mt-2" : "mt-2"}`}>
        {title}
      </div>
    </div>
  );

  if (use_card) {
    return (
      <Card className={`items-center gap-2 rounded-card px-16 py-4 min-w-[280px] text-center ${card_color} ${className}`}>
        {content}
      </Card>
    );
  }

  return (
    <div className={`items-center gap-2 rounded-card py-4 ${card_color} ${className}`}>
      {content}
    </div>
  );
}
