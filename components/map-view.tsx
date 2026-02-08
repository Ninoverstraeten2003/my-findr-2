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
import { Download, Copy, Settings, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { Device } from "@/lib/types";

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
}

export default function MapView({ onOpenSettings }: MapViewProps) {
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

  const isMissingRequiredSettings =
    settings.apiURL === "" || settings.devices.length === 0;

  const {
    data: reports = [],
    error,
    isLoading: isSwrLoading,
    isValidating,
    mutate,
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
        mutate();
        if (guessedLocation) {
          setZoom(16);
          setCurrentPosition([guessedLocation[0], guessedLocation[1]]);
        }
      } else {
        shouldZoomRef.current = true;
      }
      setCurrentDevice(device);
    },
    [currentDevice, mutate, guessedLocation]
  );

  // Sync reports
  useEffect(() => {
    if (reports.length > 0 && currentDevice) {
      setFilterRange([1, reports.length]);
      const lastReport = reports[reports.length - 1];
      currentDevice.lastSeen = lastReport.decrypedPayload.date;
      currentDevice.battery = lastReport.decrypedPayload.battery;
    }
  }, [reports, currentDevice]);

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
        setCurrentPosition([best.lat, best.lon]);

        if (shouldZoomRef.current) {
          setZoom(16);
          shouldZoomRef.current = false;
        }
      }
    }
  }, [filteredReports]);

  const getSliderLabel = useCallback(
    (reportIndex: number) => {
      const d = reports[reportIndex - 1]?.decrypedPayload?.date;
      if (!d) return "";
      return `${d.toLocaleTimeString()} ${d.toLocaleDateString()}`;
    },
    [reports]
  );

  const showHistory = settings.showHistory !== false;
  const deviceColor = currentDevice?.hexColor || "#0ea5e9";

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
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[1000]">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-card/90 backdrop-blur-sm border border-border shadow-md">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
            <span className="text-xs text-card-foreground font-medium">
              Loading reports...
            </span>
          </div>
        </div>
      )}

      {/* History Slider and Export */}
      {reports.length > 1 && showHistory && (
        <div className="absolute bottom-6 left-4 right-4 z-[1000] pointer-events-none">
          <div className="max-w-lg mx-auto flex items-center gap-3 px-4 py-3 rounded-xl bg-card/90 backdrop-blur-md border border-border shadow-lg pointer-events-auto">
            <Slider
              value={filterRange}
              onValueChange={(v) =>
                setFilterRange(v as [number, number])
              }
              min={1}
              max={reports.length}
              step={1}
              className="flex-1"
            />
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
      )}

      {/* Guessed Location Info */}
      {guessedLocation && !isLoading && (
        <div className="absolute bottom-6 left-4 z-[1000] md:bottom-auto md:top-3 md:left-3">
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-card/90 backdrop-blur-sm border border-border shadow-md">
            <div className="w-2.5 h-2.5 rounded-full bg-primary shadow-[0_0_8px_hsl(199_89%_48%/0.6)]" />
            <div className="flex flex-col">
              <span className="text-xs font-medium text-card-foreground">
                Best Location
              </span>
              <span className="text-[10px] text-muted-foreground font-mono">
                {guessedLocation[0].toFixed(5)}, {guessedLocation[1].toFixed(5)}
              </span>
            </div>
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7 ml-1"
              onClick={() => {
                const url = `https://www.google.com/maps/search/?api=1&query=${guessedLocation[0]},${guessedLocation[1]}`;
                navigator.clipboard.writeText(url);
                toast({ title: "Map link copied" });
              }}
            >
              <Copy className="h-3.5 w-3.5" />
              <span className="sr-only">Copy map link</span>
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
