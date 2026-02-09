"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDeviceReports } from "@/lib/use-device-reports";
import { useSettings } from "@/lib/use-settings";
import { calculateBestLocation } from "@/lib/decrypt-payload";
import { exportKML } from "@/lib/export-kml";
import { timeSince } from "@/lib/app-utils";
import DevicesPanel from "@/components/devices-panel";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Download, Copy, Settings, Loader2, Check, Map as MapIcon } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { Device } from "@/lib/types";
import { cn } from "@/lib/utils";

// Dynamically import the Leaflet map to avoid SSR issues
const LeafletMap = dynamic(() => import("@/components/leaflet-map"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-full bg-background">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
    </div>
  ),
});

interface MapViewProps {
  onOpenSettings: () => void;
  isVisible: boolean;
}

export default function MapView({ onOpenSettings, isVisible }: MapViewProps) {
  const { toast } = useToast();
  const [settings] = useSettings();
  const [currentDevice, setCurrentDevice] = useState<Device>();
  const [currentPosition, setCurrentPosition] = useState<[number, number]>([
    50.866667, 4.333333,
  ]);
  const [zoom, setZoom] = useState(7);
  const [guessedLocation, setGuessedLocation] = useState<[number, number]>();
  const [filterRange, setFilterRange] = useState<[number, number]>([0, 0]);
  const shouldZoomRef = useRef(false);

  // Missing settings view logic
  const isMissingRequiredSettings =
    settings.apiURL === "" || settings.devices.length === 0;

  const showHistory = settings.showHistory !== false;

  const {
    data: reports = [],
    error,
    isLoading: isSwrLoading,
    isValidating,
    refresh,
  } = useDeviceReports(
    currentDevice,
    settings.apiURL,
    settings.username,
    settings.password,
    settings.days
  );

  const isLoading = isSwrLoading || isValidating;

  const onDeviceChosen = useCallback(
    (device: Device) => {
      const isSameDevice = currentDevice?.id === device.id;
      if (isSameDevice) {
        // Trigger re-validation (throttled by hook)
        refresh();
        
        if (guessedLocation) {
          setZoom(16);
          setCurrentPosition([guessedLocation[0], guessedLocation[1]]);
        }
      } else {
        shouldZoomRef.current = true;
        setGuessedLocation(undefined);
      }
      setCurrentDevice(device);
    },
    [currentDevice, refresh, guessedLocation]
  );

  // Sync reports
  useEffect(() => {
    if (!currentDevice) return;

    if (reports.length > 0) {
      setFilterRange([1, reports.length]);
      const lastReport = reports[reports.length - 1];
      currentDevice.lastSeen = lastReport.decrypedPayload.date;
      currentDevice.battery = lastReport.decrypedPayload.battery;
    } else if (!isLoading) {
      // No reports found (invalid key or new device)
      setFilterRange([0, 0]);
      currentDevice.lastSeen = null;
      currentDevice.battery = "Unknown";
      setGuessedLocation(undefined);
    }
  }, [reports, currentDevice, isLoading]);

  useEffect(() => {
    if (error) {
      toast({
        title: "Fetch error",
        description: (error as Error).message || "Error",
        variant: "destructive",
      });
    }
  }, [error, toast]);

  const filteredReports = useMemo(() => {
    if (reports.length > 0) {
      return reports.slice(filterRange[0] - 1, filterRange[1]);
    }
    return [];
  }, [filterRange, reports]);

  useEffect(() => {
    if (filteredReports.length > 0) {
      const best = calculateBestLocation(filteredReports);
      if (best) {
        setGuessedLocation([best.lat, best.lon]);

        if (showHistory) {
          const lastReport = filteredReports[filteredReports.length - 1];
          const loc = lastReport.decrypedPayload.location;
          setCurrentPosition([loc.latitude, loc.longitude]);
        } else {
          setCurrentPosition([best.lat, best.lon]);
        }

        if (shouldZoomRef.current) {
          setZoom(16);
          shouldZoomRef.current = false;
        }
      }
    }
  }, [filteredReports, showHistory]);

  const getSliderLabel = useCallback(
    (reportIndex: number) => {
      const d = reports[reportIndex - 1]?.decrypedPayload?.date;
      if (!d) return "";
      return `${d.toLocaleTimeString()} ${d.toLocaleDateString()}`;
    },
    [reports]
  );

  const deviceColor = currentDevice?.hexColor || "#0ea5e9";

  const displayLocation = useMemo(() => {
    if (showHistory && filteredReports.length > 0) {
      const last = filteredReports[filteredReports.length - 1];
      const loc = last.decrypedPayload.location;
      return {
        lat: loc.latitude,
        lon: loc.longitude,
        label: "Latest Location",
      };
    }
    if (guessedLocation && !showHistory) {
      return {
        lat: guessedLocation[0],
        lon: guessedLocation[1],
        label: "Current Location",
      };
    }
    return null;
  }, [showHistory, filteredReports, guessedLocation]);

  // Missing settings view
  if (isMissingRequiredSettings) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 p-8 text-center">
        <div className="rounded-full bg-primary/10 p-4">
          <Settings className="h-8 w-8 text-primary" />
        </div>
        <h2 className="text-xl font-semibold text-foreground">
          Setup Required
        </h2>
        <p className="text-sm text-muted-foreground max-w-sm">
          Configure your API URL and add at least one device to start tracking.
        </p>
        <Button onClick={onOpenSettings}>Open Settings</Button>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full overflow-hidden">
      {/* Map */}
      <LeafletMap
        center={currentPosition}
        zoom={zoom}
        filteredReports={filteredReports}
        guessedLocation={guessedLocation}
        deviceColor={deviceColor}
        showHistory={showHistory}
        mapTheme={settings.mapTheme || "system"}
        isVisible={isVisible}
        onCopyLocation={(lat, lon) => {
          const url = `https://www.google.com/maps/search/?api=1&query=${lat},${lon}`;
          navigator.clipboard.writeText(url);
          toast({ title: "Map link copied" });
        }}
      />


      {/* Device Panel */}
      <DevicesPanel
        devices={settings.devices}
        onDeviceChosen={onDeviceChosen}
        currentDevice={currentDevice}
        isLoading={isLoading}
      />

      {/* Loading Indicator */}
      {isLoading && (
        <div className="absolute bottom-24 md:top-3 left-1/2 -translate-x-1/2 z-[1000] pointer-events-none">
          <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-card/30 backdrop-blur-md border border-border/50 shadow-xl pointer-events-auto">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
            <span className="text-sm font-medium text-foreground">
              Loading reports...
            </span>
          </div>
        </div>
      )}

      {/* History Slider and Export */}
      {reports.length > 1 && showHistory && (
        <>
          {/* Mobile Vertical Slider */}
          <div className="absolute right-4 top-1/2 -translate-y-1/2 z-[1000] pointer-events-none md:hidden">
            <div className="flex items-stretch gap-3 p-3 rounded-xl bg-card/30 backdrop-blur-md border border-border shadow-lg pointer-events-auto h-80">
              <div className="flex flex-col justify-between py-10 w-20">
                <span className="text-[10px] font-medium text-muted-foreground text-right leading-tight">
                  {getSliderLabel(filterRange[1])}
                </span>
                <span className="text-[10px] font-medium text-muted-foreground text-right leading-tight">
                  {getSliderLabel(filterRange[0])}
                </span>
              </div>
              <div className="flex flex-col items-center gap-4 h-full">
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8 shrink-0"
                  onClick={() => exportKML(filteredReports)}
                >
                  <Download className="h-4 w-4" />
                  <span className="sr-only">Export KML</span>
                </Button>
                <Slider
                  orientation="vertical"
                  value={filterRange}
                  onValueChange={(v) =>
                    setFilterRange(v as [number, number])
                  }
                  min={1}
                  max={reports.length}
                  step={1}
                  className="flex-1"
                  color={deviceColor}
                />
              </div>
            </div>
          </div>

          {/* Desktop Horizontal Slider */}
          <div className="absolute bottom-6 left-4 right-4 z-[1000] pointer-events-none hidden md:block">
            <div className="max-w-lg mx-auto flex items-center gap-3 px-4 py-3 rounded-xl bg-card/30 backdrop-blur-md border border-border shadow-lg pointer-events-auto">
              <div className="flex-1 flex flex-col gap-1.5">
                <div className="flex justify-between px-1">
                  <span className="text-[10px] font-medium text-muted-foreground tabular-nums">
                    {getSliderLabel(filterRange[0])}
                  </span>
                  <span className="text-[10px] font-medium text-muted-foreground tabular-nums">
                    {getSliderLabel(filterRange[1])}
                  </span>
                </div>
                <Slider
                  value={filterRange}
                  onValueChange={(v) =>
                    setFilterRange(v as [number, number])
                  }
                  min={1}
                  max={reports.length}
                  step={1}
                  className="w-full"
                  color={deviceColor}
                />
              </div>
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8 shrink-0"
                onClick={() => exportKML(filteredReports)}
              >
                <Download className="h-4 w-4" />
                <span className="sr-only">Export KML</span>
              </Button>
            </div>
          </div>
        </>
      )}

      {/* Location Info */}
      {displayLocation && !isLoading && (
        <div
          className={cn(
            "absolute z-[1000] left-4 transition-all duration-300",
            "bottom-6 md:bottom-auto md:top-3 md:left-14"
          )}
        >
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-card/30 backdrop-blur-md border border-border shadow-md">
            <div
              className="w-2.5 h-2.5 rounded-full transition-colors duration-300"
              style={{
                backgroundColor: deviceColor,
                boxShadow: `0 0 8px ${deviceColor}CC`,
              }}
            />
            <div className="flex flex-col">
              <span className="text-xs font-medium text-card-foreground">
                {displayLocation.label}
              </span>
              <span className="text-[10px] text-muted-foreground font-mono">
                {displayLocation.lat.toFixed(5)}, {displayLocation.lon.toFixed(5)}
              </span>
            </div>
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7 ml-1"
              onClick={() => {
                const url = `https://www.google.com/maps/search/?api=1&query=${displayLocation.lat},${displayLocation.lon}`;
                window.open(url, "_blank");
              }}
            >
              <MapIcon className="h-3.5 w-3.5" />
              <span className="sr-only">Open in Maps</span>
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
