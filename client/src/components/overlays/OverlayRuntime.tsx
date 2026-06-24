import { useOverlays } from "@/hooks/useOverlays";
import { OverlayModal } from "./OverlayModal";
import { OverlayTopBanner } from "./OverlayTopBanner";
import { OverlaySlideIn } from "./OverlaySlideIn";

export function OverlayRuntime() {
  const { activeOverlay, setActiveOverlay } = useOverlays();

  if (!activeOverlay) return null;

  const dismiss = () => setActiveOverlay(null);

  if (activeOverlay.component === "modal") {
    return <OverlayModal overlay={activeOverlay} onDismiss={dismiss} />;
  }
  if (activeOverlay.component === "top_banner") {
    return <OverlayTopBanner overlay={activeOverlay} onDismiss={dismiss} />;
  }
  if (activeOverlay.component === "slide_in") {
    return <OverlaySlideIn overlay={activeOverlay} onDismiss={dismiss} />;
  }

  return null;
}
