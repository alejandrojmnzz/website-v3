import { useEffect, useMemo, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { PreviewDeviceMenu } from "@/components/editing/PreviewDeviceMenu";
import { useEditModeOptional } from "@/contexts/EditModeContext";
import { buildDeviceEmbedSrc, getPreviewDevice } from "@/lib/preview-devices";

export function DevicePreviewShell() {
  const editMode = useEditModeOptional();
  const [pathname] = useLocation();
  const search = useSearch();
  const device = getPreviewDevice(editMode?.previewDeviceId);
  const [scale, setScale] = useState(1);

  const iframeSrc = useMemo(
    () => buildDeviceEmbedSrc(pathname, search),
    [pathname, search],
  );

  useEffect(() => {
    const updateScale = () => {
      const captionAndPadding = 96;
      const availW = Math.max(120, window.innerWidth - 32);
      const availH = Math.max(120, window.innerHeight - captionAndPadding);
      setScale(Math.min(1, availW / device.width, availH / device.height));
    };
    updateScale();
    window.addEventListener("resize", updateScale);
    return () => window.removeEventListener("resize", updateScale);
  }, [device.width, device.height]);

  const isTablet = device.group === "tablet";

  return (
    <div className="flex flex-col items-center justify-center bg-muted/50 min-h-screen py-8 px-4 gap-3">
      <PreviewDeviceMenu trigger="caption" />
      <div
        style={{
          width: device.width * scale,
          height: device.height * scale,
        }}
      >
        <div
          className={`bg-background shadow-2xl overflow-hidden outline outline-4 outline-foreground/20 origin-top-left ${
            isTablet ? "rounded-[20px]" : "rounded-[32px]"
          }`}
          style={{
            width: device.width,
            height: device.height,
            transform: `scale(${scale})`,
          }}
        >
          <iframe
            src={iframeSrc}
            className="block border-0"
            style={{ width: device.width, height: device.height }}
            title={`Vista previa · ${device.label}`}
          />
        </div>
      </div>
    </div>
  );
}
