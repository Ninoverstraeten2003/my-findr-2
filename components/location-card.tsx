"use client";

import { useMemo, useState } from "react";
import { ChevronDown, Map as MapIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MarkIcon } from "@/components/jev-panel";
import { reportKey } from "@/lib/report-features";
import type { JevLabel } from "@/lib/jev";
import type { DeviceReport } from "@/lib/types";
import { cn } from "@/lib/utils";

const PAGE = 100;

interface LocationCardProps {
  label: string;
  lat: number;
  lon: number;
  deviceColor: string;
  /** Reports in time order (oldest first); empty hides the history list. */
  reports: DeviceReport[];
  /** Jev labels for the active question, per report key. */
  labels?: Map<string, JevLabel>;
  onFocusReport: (key: string) => void;
}

function LocationDot({ color, label, size }: { color: string; label?: JevLabel; size: number }) {
  if (label && label.mark !== "dot") return <MarkIcon mark={label.mark} color={color} size={size} />;
  return (
    <span
      className="inline-block shrink-0 rounded-full"
      style={{ width: size * 0.7, height: size * 0.7, margin: size * 0.15, backgroundColor: color }}
      aria-hidden
    />
  );
}

/** The latest location, with a dropdown listing every report newest first (tap one to show it on the map). */
export default function LocationCard({ label, lat, lon, deviceColor, reports, labels, onFocusReport }: LocationCardProps) {
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState(PAGE);

  const newestFirst = useMemo(() => [...reports].reverse(), [reports]);
  const latestLabel = newestFirst[0] ? labels?.get(reportKey(newestFirst[0])) : undefined;
  const hasList = newestFirst.length > 0;

  return (
    // Opens upwards on phones (the card sits at the bottom), downwards on larger screens (top left).
    <div className="flex w-[min(18rem,calc(100vw-2rem))] flex-col-reverse gap-2 md:w-80 md:flex-col">
      <div className="map-surface flex max-w-full items-center gap-2 self-start rounded-lg px-3 py-2 touch-none">
        <LocationDot color={deviceColor} label={latestLabel} size={14} />
        <button
          type="button"
          className="flex min-w-0 flex-col text-left disabled:cursor-default"
          onClick={() => setOpen((o) => !o)}
          disabled={!hasList}
          aria-expanded={hasList ? open : undefined}
        >
          {/* One line: a long Jev label is cut off ("…"), never wrapped; the full label is in its title. */}
          <span className="flex min-w-0 items-center gap-1 whitespace-nowrap text-xs font-medium">
            <span className="shrink-0">{label}</span>
            {latestLabel && (
              <span className="hidden min-w-0 truncate font-normal text-muted-foreground md:inline" title={latestLabel.label}>
                · {latestLabel.label}
              </span>
            )}
            {hasList && (
              <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
            )}
          </span>
          <span className="font-mono text-[10px] text-muted-foreground">
            {lat.toFixed(5)}, {lon.toFixed(5)}
          </span>
        </button>
        <Button
          size="icon"
          variant="ghost"
          className="ml-1 h-7 w-7 shrink-0"
          onClick={() => window.open(`https://www.google.com/maps/search/?api=1&query=${lat},${lon}`, "_blank")}
        >
          <MapIcon className="h-3.5 w-3.5" />
          <span className="sr-only">Open in Maps</span>
        </Button>
      </div>

      {open && hasList && (
        <div className="map-surface flex max-h-64 flex-col overflow-y-auto overscroll-contain rounded-lg touch-pan-y md:max-h-[50vh]">
          <div className="flex flex-col divide-y divide-border">
            {newestFirst.slice(0, shown).map((r) => {
              const key = reportKey(r);
              const p = r.decrypedPayload;
              const l = labels?.get(key);
              return (
                <button
                  key={key}
                  onClick={() => onFocusReport(key)}
                  className="flex items-center gap-2 px-2.5 py-2 text-left text-xs hover:bg-secondary/60"
                >
                  <LocationDot color={deviceColor} label={l} size={14} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate" title={l?.label}>
                      {new Date(p.date).toLocaleString(undefined, {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                      {l && <span className="text-muted-foreground"> · {l.label}</span>}
                    </span>
                    <span className="block font-mono text-[10px] text-muted-foreground">
                      {p.location.latitude.toFixed(5)}, {p.location.longitude.toFixed(5)}
                    </span>
                  </span>
                  <span className="tabular-nums text-muted-foreground">±{p.location.accuracy} m</span>
                </button>
              );
            })}
          </div>
          {shown < newestFirst.length && (
            <button
              onClick={() => setShown((n) => n + PAGE)}
              className="border-t border-border px-2.5 py-2 text-xs font-medium text-muted-foreground hover:bg-secondary/60"
            >
              Show {Math.min(PAGE, newestFirst.length - shown)} more of {newestFirst.length - shown}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
