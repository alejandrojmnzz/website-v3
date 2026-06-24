import { createPortal } from "react-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { IconX } from "@tabler/icons-react";
import type { Overlay } from "@/hooks/useOverlays";
import { markOverlaySeen } from "@/hooks/useOverlays";

interface OverlaySlideInProps {
  overlay: Overlay;
  onDismiss: () => void;
}

export function OverlaySlideIn({ overlay, onDismiss }: OverlaySlideInProps) {
  const { content } = overlay;

  function handleDismiss() {
    markOverlaySeen(overlay);
    onDismiss();
  }

  const panel = (
    <div
      className="fixed bottom-4 right-4 z-[9999] w-80 animate-in slide-in-from-bottom-4 duration-300"
      data-testid="overlay-slide-in"
    >
      <Card className="shadow-lg">
        <CardHeader className="pb-2 flex flex-row items-start justify-between gap-2">
          <CardTitle className="text-base leading-snug">{content.title}</CardTitle>
          <Button
            size="icon"
            variant="ghost"
            onClick={handleDismiss}
            aria-label="Close"
            data-testid="button-dismiss-slide-in"
          >
            <IconX size={16} />
          </Button>
        </CardHeader>
        {content.body && (
          <CardContent className="pt-0 pb-3">
            <p className="text-sm text-muted-foreground">{content.body}</p>
          </CardContent>
        )}
        {content.cta?.href && content.cta?.label && (
          <CardContent className="pt-0 pb-4 flex gap-2">
            <Button asChild className="w-full" onClick={handleDismiss}>
              <Link href={content.cta.href}>{content.cta.label}</Link>
            </Button>
          </CardContent>
        )}
      </Card>
    </div>
  );

  return createPortal(panel, document.body);
}
