import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import type { Overlay } from "@/hooks/useOverlays";
import { markOverlaySeen } from "@/hooks/useOverlays";
import { UniversalImage } from "@/components/UniversalImage";
import { OverlayActionButtons } from "./OverlayActionButtons";

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
        <OverlayActionButtons
          buttons={content.buttons}
          onDismiss={handleDismiss}
          size="sm"
          className="justify-end pt-2"
        />
      </DialogContent>
    </Dialog>
  );
}
