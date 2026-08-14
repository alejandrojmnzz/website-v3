import { Check, ChevronDown, Monitor, MonitorSmartphone, Smartphone, Tablet } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useEditMode } from "@/contexts/EditModeContext";
import { cn } from "@/lib/utils";
import { getPreviewDevice, PREVIEW_PHONES, PREVIEW_TABLETS } from "@/lib/preview-devices";

type PreviewDeviceMenuTrigger = "icon" | "caption";

export function PreviewDeviceMenu({
  trigger = "icon",
  onNeedEditMode,
}: {
  trigger?: PreviewDeviceMenuTrigger;
  /** Opens `/private/preview/...` when picking a phone/tablet from a public URL (Read or Edit). */
  onNeedEditMode?: () => void;
}) {
  const editMode = useEditMode();
  const isDevicePreview = editMode.isEditMode && editMode.previewBreakpoint === "mobile";
  const activeDevice = isDevicePreview ? getPreviewDevice(editMode.previewDeviceId) : null;
  const previewTitle = activeDevice
    ? `Preview: ${activeDevice.label} (${activeDevice.width} × ${activeDevice.height})`
    : "Preview: Desktop";

  const selectDevice = (deviceId: typeof editMode.previewDeviceId) => {
    if (!editMode.isEditMode) {
      editMode.enableEditMode();
    }
    onNeedEditMode?.();
    editMode.setPreviewDevice(deviceId);
  };

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        {trigger === "caption" ? (
          <button
            type="button"
            onClick={(e) => e.stopPropagation()}
            className="flex items-center gap-1 text-xs text-muted-foreground tabular-nums hover:text-foreground transition-colors"
            data-testid="preview-device-caption"
            title={previewTitle}
          >
            {activeDevice
              ? `${activeDevice.label} · ${activeDevice.width} × ${activeDevice.height}`
              : "Desktop"}
            <ChevronDown className="h-3 w-3" />
          </button>
        ) : (
          <button
            type="button"
            onClick={(e) => e.stopPropagation()}
            className="p-1.5 rounded-full bg-muted text-muted-foreground transition-colors hover-elevate"
            data-testid="toggle-preview-breakpoint"
            title={previewTitle}
          >
            <MonitorSmartphone className="h-3.5 w-3.5" />
          </button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="center"
        className="w-64 z-[10001]"
        onCloseAutoFocus={(e) => e.preventDefault()}
        onClick={(e) => e.stopPropagation()}
      >
        <DropdownMenuLabel className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">
          CSS viewport
        </DropdownMenuLabel>
        <DropdownMenuItem
          onClick={() => editMode.setPreviewBreakpoint("desktop")}
          className={cn(
            "text-xs gap-2",
            !isDevicePreview && "bg-accent font-medium",
          )}
          data-testid="button-preview-desktop"
        >
          <Monitor className="h-3.5 w-3.5" />
          Desktop
          {!isDevicePreview && (
            <Check className="h-3.5 w-3.5 ml-auto text-foreground" />
          )}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {PREVIEW_PHONES.map((device) => {
          const isActive = isDevicePreview && editMode.previewDeviceId === device.id;
          return (
            <DropdownMenuItem
              key={device.id}
              onClick={() => selectDevice(device.id)}
              className={cn("text-xs gap-2", isActive && "bg-accent font-medium")}
              data-testid={`button-preview-${device.id}`}
            >
              <Smartphone className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{device.label}</span>
              <span className="ml-auto text-[10px] text-muted-foreground tabular-nums">
                {device.width} × {device.height}
              </span>
              {isActive && (
                <Check className="h-3.5 w-3.5 text-foreground shrink-0" />
              )}
            </DropdownMenuItem>
          );
        })}
        <DropdownMenuSeparator />
        {PREVIEW_TABLETS.map((device) => {
          const isActive = isDevicePreview && editMode.previewDeviceId === device.id;
          return (
            <DropdownMenuItem
              key={device.id}
              onClick={() => selectDevice(device.id)}
              className={cn("text-xs gap-2", isActive && "bg-accent font-medium")}
              data-testid={`button-preview-${device.id}`}
            >
              <Tablet className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{device.label}</span>
              <span className="ml-auto text-[10px] text-muted-foreground tabular-nums">
                {device.width} × {device.height}
              </span>
              {isActive && (
                <Check className="h-3.5 w-3.5 text-foreground shrink-0" />
              )}
            </DropdownMenuItem>
          );
        })}
        <DropdownMenuSeparator />
        <div
          className="px-2 py-1.5 text-[10px] leading-snug text-muted-foreground space-y-1"
          data-testid="preview-device-education"
          onPointerDown={(e) => e.preventDefault()}
        >
          <p>
            Device preview always lives on <code className="bg-muted px-1 rounded">/private/preview/…</code> (locale, variant, version). Picking a phone or tablet from Read on a public URL (e.g. <code className="bg-muted px-1 rounded">/en/apply</code>) first opens that preview path, same as Edit. The phone is this page only: scroll and in-page anchors work; links do not leave (a dialog offers desktop). Inside is read mode so you see that page’s real header and footer. Desktop and Read clear the stored device so the menu does not keep a phone selected. The phone iframe does not clear storage (shared <code className="bg-muted px-1 rounded">localStorage</code>).
          </p>
          <details>
            <summary className="cursor-pointer hover:text-foreground">Read more (advanced)</summary>
            <ul className="mt-1 list-disc pl-3 space-y-0.5">
              <li>Presets, embed href allowlist, and device storage: <code className="bg-muted px-1 rounded">client/src/lib/preview-devices.ts</code></li>
              <li>Embed flag: <code className="bg-muted px-1 rounded">device_embed=1</code> in <code className="bg-muted px-1 rounded">EditModeContext.tsx</code></li>
              <li>Link lock and blocked-nav dialog: <code className="bg-muted px-1 rounded">useInternalNav.ts</code>, <code className="bg-muted px-1 rounded">DevicePreviewShell.tsx</code> (unsaved in-memory edits are not shown until save; public pages unchanged)</li>
            </ul>
          </details>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
