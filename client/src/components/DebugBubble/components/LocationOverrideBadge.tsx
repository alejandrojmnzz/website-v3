import { useMemo, useState } from "react";
import { MapPin } from "lucide-react";
import { LocationOverrideModal } from "./LocationOverrideModal";
import { badgeVariants } from "@/components/ui/badge";
import { useSession } from "@/contexts/SessionContext";
import { locations } from "@/lib/locations";
import { cn } from "@/lib/utils";

const REGION_LABELS: Record<string, string> = {
  "usa-canada": "USA & Canada",
  latam: "Latin America",
  europe: "Europe",
};

export function LocationOverrideBadge() {
  const { session } = useSession();
  const [open, setOpen] = useState(false);
  const [selectedLocationSlug, setSelectedLocationSlug] = useState("");

  const currentLocationOverride =
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("location")
      : null;

  const locationsByRegion = useMemo(
    () =>
      locations.reduce(
        (acc, loc) => {
          if (!acc[loc.region]) acc[loc.region] = [];
          acc[loc.region].push(loc);
          return acc;
        },
        {} as Record<string, typeof locations>,
      ),
    [],
  );

  const handleLocationOverride = () => {
    if (!selectedLocationSlug) return;
    const url = new URL(window.location.href);
    url.searchParams.set("location", selectedLocationSlug);
    window.location.href = url.toString();
  };

  const handleClearLocationOverride = () => {
    const url = new URL(window.location.href);
    url.searchParams.delete("location");
    window.location.href = url.toString();
  };

  return (
    <>
      <button
        type="button"
        className={cn(
          badgeVariants({ variant: "outline" }),
          "cursor-pointer text-xs gap-1 no-default-active-elevate",
        )}
        onClick={() => {
          setSelectedLocationSlug(session.location?.slug || "");
          setOpen(true);
        }}
        data-testid="button-location-override"
        title={
          currentLocationOverride
            ? `Location override: ${currentLocationOverride}`
            : "Click to override location"
        }
      >
        <MapPin className="h-3 w-3" />
        <span className="max-w-[80px] truncate">{session.location?.name || "Detecting..."}</span>
      </button>
      <LocationOverrideModal
        open={open}
        onOpenChange={setOpen}
        selectedLocationSlug={selectedLocationSlug}
        setSelectedLocationSlug={setSelectedLocationSlug}
        currentLocationOverride={currentLocationOverride}
        handleLocationOverride={handleLocationOverride}
        handleClearLocationOverride={handleClearLocationOverride}
        locationsByRegion={locationsByRegion}
        regionLabels={REGION_LABELS}
      />
    </>
  );
}
