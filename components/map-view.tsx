"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDeviceReports } from "@/lib/use-device-reports";
import { DECRYPT_PROGRESS_EVENT, type DecryptProgress } from "@/lib/get-reports";
import { useSettings } from "@/lib/use-settings";
import { calculateBestLocation } from "@/lib/decrypt-payload";
import { exportKML } from "@/lib/export-kml";
import { timeSince } from "@/lib/app-utils";
import DevicesPanel from "@/components/devices-panel";
import { Button } from "@/components/ui/button";
import TimelineControl from "@/components/timeline-control";
import AiPanel, { type AiTab } from "@/components/ai-panel";
import { useAiChatSession } from "@/lib/use-ai-chat-session";
import { getLabelsForTool } from "@/lib/jev-tool";
import { jevAuthHeaders } from "@/lib/jev-runner";
import { useAiChatConfig } from "@/lib/use-ai-chat-config";
import { createReportLoader } from "@/lib/report-loader";
import type { AiPath } from "@/lib/ai-tools";
import { useJevConfig } from "@/lib/use-jev-config";
import { useJevLabels } from "@/lib/use-jev-labels";
import { jevTooltipHtml, labelAnswer } from "@/lib/jev";
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

const EMPTY_REPORTS: any[] = [];
/** The timeline slider (range filter) is currently disabled in the UI. */
const TIMELINE_ENABLED = false;

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
  const [isSwitchingDevice, setIsSwitchingDevice] = useState(false);
  const shouldZoomRef = useRef(false);
  const lastSyncedDeviceIdRef = useRef<string | undefined>(undefined);
  const lastReportsLengthRef = useRef<number>(0);

  // Missing settings view logic
  const isMissingRequiredSettings =
    settings.apiURL === "" || settings.devices.length === 0;

  const showHistory = settings.showHistory !== false;

  const {
    data: reportsData,
    error,
    isLoading: isSwrLoading,
    isValidating,
    refresh,
  } = useDeviceReports(
    currentDevice,
    settings.apiURL,
    settings.username,
    settings.password,
    settings.days,
    settings.usePoller,
    settings.pollerApiKey,
    settings.pollerTier,
    settings.pollInterval
  );

  const reports = useMemo(() => {
    if (!reportsData) return EMPTY_REPORTS;
    
    // Filter out low quality reports if the setting is enabled (default true)
    if (settings.filterLowQuality !== false) {
      const minConfidence = settings.filterMinConfidence ?? 1;
      const maxAccuracy = settings.filterMaxAccuracy ?? 200;
      
      return reportsData.filter(r => {
        const payload = r.decrypedPayload;
        const confidenceOk = payload.confidence >= minConfidence;
        const accuracyOk = payload.location.accuracy <= maxAccuracy;
        
        return confidenceOk && accuracyOk;
      });
    }
    
    return reportsData;
  }, [reportsData, settings.filterLowQuality, settings.filterMinConfidence, settings.filterMaxAccuracy]);

  const isLoading = isSwrLoading || isValidating;

  // Progress of decrypting reports not cached on this device yet (shown in the loading pill).
  const [decryptProgress, setDecryptProgress] = useState<DecryptProgress | null>(null);
  useEffect(() => {
    const onProgress = (e: Event) => setDecryptProgress((e as CustomEvent<DecryptProgress>).detail);
    window.addEventListener(DECRYPT_PROGRESS_EVENT, onProgress);
    return () => window.removeEventListener(DECRYPT_PROGRESS_EVENT, onProgress);
  }, []);
  useEffect(() => {
    if (!isLoading) setDecryptProgress(null);
  }, [isLoading]);

  const onDeviceChosen = useCallback(
    (device: Device) => {
      setIsSwitchingDevice(true);
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
    if (!currentDevice) {
      lastSyncedDeviceIdRef.current = undefined;
      lastReportsLengthRef.current = 0;
      return;
    }

    // Changing History Length starts a new query with no data yet. Don't record that empty moment as the
    // previous length, or the range stays at the old count and hides the newest reports when data arrives.
    if (reports.length === 0 && isLoading) return;

    const deviceIdChanged = lastSyncedDeviceIdRef.current !== currentDevice.id;

    if (reports.length > 0) {
      const lastReport = reports[reports.length - 1];
      currentDevice.lastSeen = lastReport.decrypedPayload.date;
      currentDevice.battery = lastReport.decrypedPayload.battery;

      if (deviceIdChanged) {
        setFilterRange([1, reports.length]);
        lastSyncedDeviceIdRef.current = currentDevice.id;
      } else {
        const prevLength = lastReportsLengthRef.current;
        const currentLength = reports.length;
        
        if (currentLength !== prevLength) {
          setFilterRange((prevRange) => {
            // If the range was [0, 0] (no reports loaded yet), reset to full range
            if (prevRange[0] === 0 && prevRange[1] === 0) {
              return [1, currentLength];
            }
            
            // If they were looking at the very end of the range, expand to keep showing the end.
            const wasAtEnd = prevRange[1] === prevLength || prevRange[1] === 0;
            const newStart = Math.min(prevRange[0] || 1, currentLength);
            const newEnd = wasAtEnd ? currentLength : Math.min(prevRange[1], currentLength);
            
            return [newStart, newEnd];
          });
        }
      }
    } else if (!isLoading) {
      // No reports found (invalid key or new device)
      setFilterRange([0, 0]);
      currentDevice.lastSeen = null;
      currentDevice.battery = "Unknown";
      setGuessedLocation(undefined);
      lastSyncedDeviceIdRef.current = currentDevice.id;
    }

    lastReportsLengthRef.current = reports.length;
  }, [reports, currentDevice, isLoading]);

  useEffect(() => {
    if (!isLoading && isSwitchingDevice) {
      // Small delay to ensure map has started moving (and thus self-locked)
      // before we release the parent lock.
      const timer = setTimeout(() => {
        setIsSwitchingDevice(false);
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [isLoading, isSwitchingDevice]);

  useEffect(() => {
    if (error) {
      toast({
        title: "Fetch error",
        description: (error as Error).message || "Error",
        variant: "destructive",
      });
    }
  }, [error, toast]);

  // The range only matters while the timeline slider is shown (it's disabled below). Without it, always use every
  // loaded report: the range is synced in an effect, so right after a device switch it still holds the previous
  // device's count for one render, and the map zoomed to that partial (oldest) slice.
  const filteredReports = useMemo(() => {
    if (reports.length === 0) return [];
    return TIMELINE_ENABLED ? reports.slice(filterRange[0] - 1, filterRange[1]) : reports;
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

  const deviceColor = currentDevice?.hexColor || "#0ea5e9";

  // Jev labels: shapes and tooltip notes on the dots in view (never removes a dot).
  const [jevConfig, updateJevConfig] = useJevConfig();
  const addJevSpend = useCallback(
    (usd: number) => updateJevConfig((c) => ({ ...c, spentUsd: c.spentUsd + usd })),
    [updateJevConfig],
  );
  const jev = useJevLabels(
    jevConfig.enabled ? filteredReports : EMPTY_REPORTS,
    jevConfig,
    addJevSpend,
    currentDevice?.id,
  );
  const jevLabels = useMemo(
    () => jev.labelsFor(jevConfig.activeQuestionId),
    [jev.labelsFor, jevConfig.activeQuestionId],
  );
  const jevTooltips = useMemo(() => {
    const out = new Map<string, string>();
    for (const [key, rec] of jev.answers) {
      const rows = jev.questions.flatMap((q) => {
        const l = labelAnswer(q, rec[q.id]);
        return l ? [{ title: q.title, label: l.label, detail: l.detail, active: q.id === jevConfig.activeQuestionId }] : [];
      });
      out.set(key, jevTooltipHtml(rows));
    }
    return out;
  }, [jev.answers, jev.questions, jevConfig.activeQuestionId]);
  const [focusRequest, setFocusRequest] = useState<{ key: string; nonce: number } | null>(null);

  // AI chat: tools read reports through this loader (same fetch + decrypt cache as the map) and can draw a path.
  const [aiConfig, updateAiConfig] = useAiChatConfig();
  const [aiPath, setAiPath] = useState<AiPath | null>(null);
  const loadReportsForAi = useMemo(() => createReportLoader(settings), [settings]);
  const addAiSpend = useCallback(
    (usd: number) => updateAiConfig((c) => ({ ...c, spentUsd: c.spentUsd + usd })),
    [updateAiConfig],
  );
  // Same OpenRouter key rules as Jev: the user's own key, else the owner token (dev servers need neither).
  const aiHasKey =
    !!jevConfig.userApiKey.trim() || !!jevConfig.accessToken || process.env.NODE_ENV !== "production";

  // One AI sheet (Ask + Labels). The chat session lives here so closing the sheet keeps the conversation.
  const [aiOpen, setAiOpen] = useState(false);
  const [aiTab, setAiTab] = useState<AiTab>("ask");
  const chatSession = useAiChatSession({
    model: aiConfig.model,
    budgetUsd: aiConfig.maxCostPerChatUsd,
    authHeaders: jevAuthHeaders(jevConfig),
    onSpend: addAiSpend,
    ctx: {
      devices: settings.devices,
      loadReports: loadReportsForAi,
      drawPath: (p) => {
        setAiPath(p);
        if (p) setAiOpen(false); // show the map
      },
      getLabels: async (device, from, to, runMissing) =>
        getLabelsForTool(await loadReportsForAi(device, from, to), jevConfig, runMissing, addJevSpend),
    },
  });

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
    // `isolate` keeps Leaflet's high z-indexes inside the map so drawers and dialogs stay on top.
    <div className="relative isolate h-full w-full overflow-hidden">
      {/* Map */}
      <div
        className={cn("h-full w-full", isSwitchingDevice && "pointer-events-none")}
      >
        <LeafletMap
          deviceId={currentDevice?.id}
          center={currentPosition}
          zoom={zoom}
          filteredReports={filteredReports}
          guessedLocation={guessedLocation}
          deviceColor={deviceColor}
          showHistory={showHistory}
          showDirectionArrows={settings.showDirectionArrows !== false}
          simplifyTrail={settings.simplifyTrail !== false}
          mapTheme={settings.mapTheme || "system"}
          isVisible={isVisible}
          isLoading={isLoading}
          aiPath={aiPath}
          jevLabels={jevConfig.enabled ? jevLabels : undefined}
          jevTooltips={jevConfig.enabled ? jevTooltips : undefined}
          focusRequest={focusRequest}
          onCopyLocation={(lat, lon) => {
            const url = `https://www.google.com/maps/search/?api=1&query=${lat},${lon}`;
            navigator.clipboard.writeText(url);
            toast({ title: "Map link copied" });
          }}
        />
      </div>

      {/* Device Panel */}
      <DevicesPanel
        devices={settings.devices}
        onDeviceChosen={onDeviceChosen}
        currentDevice={currentDevice}
        isLoading={isLoading}
      />

      {/* AI: chat (Ask) and Jev labels (Labels) in one sheet */}
      <AiPanel
        open={aiOpen}
        onOpenChange={setAiOpen}
        tab={aiTab}
        onTabChange={setAiTab}
        jevConfig={jevConfig}
        jev={jev}
        reports={filteredReports}
        deviceName={currentDevice?.name}
        deviceColor={deviceColor}
        onSelectQuestion={(id) => updateJevConfig((c) => ({ ...c, activeQuestionId: id }))}
        onFocusReport={(key) => setFocusRequest({ key, nonce: Date.now() })}
        chatConfig={aiConfig}
        session={chatSession}
        hasKey={aiHasKey}
        exampleDevice={currentDevice?.name ?? settings.devices[0]?.name ?? "my tag"}
        aiPath={aiPath}
        onDrawPath={setAiPath}
        onOpenSettings={onOpenSettings}
      />

      {/* Loading Indicator */}
      {isLoading && (
        <div className="absolute bottom-24 md:top-3 left-1/2 -translate-x-1/2 z-[1000] pointer-events-none">
          <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-card/30 backdrop-blur-md border border-border/50 shadow-xl pointer-events-auto touch-none">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
            <span className="text-sm font-medium text-foreground tabular-nums">
              {decryptProgress && decryptProgress.done < decryptProgress.total
                ? `Decrypting ${decryptProgress.done.toLocaleString()} / ${decryptProgress.total.toLocaleString()}`
                : "Loading reports..."}
            </span>
          </div>
        </div>
      )}

      {/* Timeline Control with minimap, date picker, and slider (disabled for now) */}
      {/*
      {reports.length > 1 && showHistory && (
        <TimelineControl
          reports={reports}
          filterRange={filterRange}
          onFilterRangeChange={setFilterRange}
          deviceColor={deviceColor}
          onExport={() => exportKML(filteredReports)}
        />
      )}
      */}

      {/* Location Info */}
      {displayLocation && !isLoading && (
        <div
          className={cn(
            "absolute z-[1000] left-4 transition-all duration-300",
            "bottom-6 md:bottom-auto md:top-3 md:left-14",
            "touch-none pointer-events-auto"
          )}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
          onWheel={(e) => e.stopPropagation()}
        >
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-card/30 backdrop-blur-md border border-border shadow-md touch-none">
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

