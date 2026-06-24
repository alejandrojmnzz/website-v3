import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import type { Overlay } from "@/hooks/useOverlays";
import { markOverlaySeen } from "@/hooks/useOverlays";
import { UniversalImage } from "@/components/UniversalImage";

interface OverlayModalProps {
  overlay: Overlay;
  onDismiss: () => void;
}

export function OverlayModal({ overlay, onDismiss }: OverlayModalProps) {
  const { content } = overlay;

  function handleDismiss() {
    markOverlaySeen(overlay);
    onDismiss();
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) handleDismiss(); }}>
      <DialogContent className="sm:max-w-md">
        {content.image_id && (
          <div className="rounded-md overflow-hidden mb-2">
            <UniversalImage
              imageId={content.image_id}
              alt={content.title}
              className="w-full object-cover max-h-48"
            />
          </div>
        )}
        <DialogHeader>
          <DialogTitle>{content.title}</DialogTitle>
          {content.body && (
            <DialogDescription>{content.body}</DialogDescription>
          )}
        </DialogHeader>
        {content.cta?.href && content.cta?.label && (
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" size="sm" onClick={handleDismiss}>
              Dismiss
            </Button>
            <Button asChild onClick={handleDismiss}>
              <Link href={content.cta.href}>{content.cta.label}</Link>
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
