import { InternalLink } from "@/components/InternalLink";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface NavButtonProps {
  label: string;
  href: string;
  variant?: "default" | "outline" | "secondary" | "ghost";
}

export function NavButton({ label, href, variant = "default" }: NavButtonProps) {
  return (
    <InternalLink
      href={href}
      className={cn(buttonVariants({ variant, size: "sm" }), "px-3 lg:px-4")}
      data-testid={`nav-button-${label.toLowerCase().replace(/\s+/g, "-")}`}
    >
      {label}
    </InternalLink>
  );
}
