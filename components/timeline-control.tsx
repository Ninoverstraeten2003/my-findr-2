"use client";

import { useCallback, useMemo, useState } from "react";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import {
  Download,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react";
import type { DeviceReport } from "@/lib/types";
import type { DateRange } from "react-day-picker";

interface TimelineControlProps {
  reports: DeviceReport[];
  filterRange: [number, number];
  onFilterRangeChange: (range: [number, number]) => void;
  deviceColor: string;
  onExport: () => void;
}

export default function TimelineControl({
  reports,
  filterRange,
  onFilterRangeChange,
  deviceColor,
  onExport,
}: TimelineControlProps) {
  const [datePickerOpen, setDatePickerOpen] = useState(false);

  // Calculate date range from reports
  const dateExtent = useMemo(() => {
    if (reports.length === 0) return null;
    const first = reports[0].decrypedPayload.date;
    const last = reports[reports.length - 1].decrypedPayload.date;
    return { from: first, to: last };
  }, [reports]);

  // Get dates for current filter range
  const currentRangeDates = useMemo(() => {
    if (reports.length === 0) return null;
    const from = reports[Math.max(0, filterRange[0] - 1)]?.decrypedPayload?.date;
    const to = reports[Math.min(reports.length - 1, filterRange[1] - 1)]?.decrypedPayload?.date;
    return { from, to };
  }, [reports, filterRange]);

  // Format date for display
  const formatDate = useCallback((date: Date | undefined) => {
    if (!date) return "";
    return date.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  }, []);

  const formatTime = useCallback((date: Date | undefined) => {
    if (!date) return "";
    return date.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    });
  }, []);

  // Handle date selection from calendar
  const handleDateSelect = useCallback(
    (range: DateRange | undefined) => {
      if (!range || !range.from || reports.length === 0) return;

      const fromDate = range.from;
      const toDate = range.to || range.from;

      // Set fromDate to start of day, toDate to end of day
      const fromStart = new Date(fromDate);
      fromStart.setHours(0, 0, 0, 0);
      const toEnd = new Date(toDate);
      toEnd.setHours(23, 59, 59, 999);

      let fromIdx = 1;
      let toIdx = reports.length;

      // Find the first report >= fromStart
      for (let i = 0; i < reports.length; i++) {
        if (reports[i].decrypedPayload.date >= fromStart) {
          fromIdx = i + 1;
          break;
        }
      }

      // Find the last report <= toEnd
      for (let i = reports.length - 1; i >= 0; i--) {
        if (reports[i].decrypedPayload.date <= toEnd) {
          toIdx = i + 1;
          break;
        }
      }

      if (fromIdx > toIdx) fromIdx = toIdx;
      onFilterRangeChange([fromIdx, toIdx]);
      setDatePickerOpen(false);
    },
    [reports, onFilterRangeChange]
  );

  // Unique days that have reports (for calendar highlighting)
  const reportDays = useMemo(() => {
    const days = new Set<string>();
    reports.forEach((r) => {
      const d = r.decrypedPayload.date;
      days.add(`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`);
    });
    return Array.from(days).map((key) => {
      const [y, m, d] = key.split("-").map(Number);
      return new Date(y, m, d);
    });
  }, [reports]);

  // Boundary checks for disabling buttons
  const isAtStart = filterRange[0] === 1;
  const isAtEnd = filterRange[1] === reports.length;

  // Step size: ~5% of total, but at least 1
  const stepSize = Math.max(1, Math.floor(reports.length / 20));

  // Nudge left: slides the entire window left without changing its size
  const nudgeLeft = useCallback(() => {
    const shift = Math.min(stepSize, filterRange[0] - 1);
    if (shift <= 0) return;
    onFilterRangeChange([filterRange[0] - shift, filterRange[1] - shift]);
  }, [filterRange, onFilterRangeChange, stepSize]);

  // Nudge right: slides the entire window right without changing its size
  const nudgeRight = useCallback(() => {
    const shift = Math.min(stepSize, reports.length - filterRange[1]);
    if (shift <= 0) return;
    onFilterRangeChange([filterRange[0] + shift, filterRange[1] + shift]);
  }, [filterRange, onFilterRangeChange, reports.length, stepSize]);

  // Jump to start: move window to the very beginning, keep span
  const jumpToStart = useCallback(() => {
    if (isAtStart) return;
    const span = filterRange[1] - filterRange[0];
    onFilterRangeChange([1, Math.min(reports.length, 1 + span)]);
  }, [filterRange, onFilterRangeChange, reports.length, isAtStart]);

  // Jump to end: move window to the very end, keep span
  const jumpToEnd = useCallback(() => {
    if (isAtEnd) return;
    const span = filterRange[1] - filterRange[0];
    onFilterRangeChange([Math.max(1, reports.length - span), reports.length]);
  }, [filterRange, onFilterRangeChange, reports.length, isAtEnd]);

  // Timeline ticks for the slider (date markers)
  const timelineTicks = useMemo(() => {
    if (reports.length < 2) return [];

    const ticks: { position: number; label: string }[] = [];
    let lastDate = "";

    reports.forEach((r, i) => {
      const d = r.decrypedPayload.date;
      const dateStr = d.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      });
      if (dateStr !== lastDate) {
        ticks.push({
          position: ((i + 1) / reports.length) * 100,
          label: dateStr,
        });
        lastDate = dateStr;
      }
    });

    // Limit ticks to avoid clutter
    if (ticks.length > 8) {
      const step = Math.ceil(ticks.length / 8);
      return ticks.filter((_, i) => i % step === 0 || i === ticks.length - 1);
    }
    return ticks;
  }, [reports]);

  const reportCountText = useMemo(() => {
    const count = filterRange[1] - filterRange[0] + 1;
    return `${count} of ${reports.length} reports`;
  }, [filterRange, reports.length]);

  if (reports.length < 2) return null;

  return (
    <>
      {/* Desktop Timeline */}
      <div className="absolute bottom-6 left-4 right-4 z-[1000] pointer-events-none hidden md:block">
        <div className="max-w-2xl mx-auto pointer-events-auto touch-none">
          {/* Main Controls */}
          <div className="rounded-xl bg-card/30 backdrop-blur-md border border-border/50 shadow-lg px-4 py-3">
            {/* Date labels row */}
            <div className="flex items-center justify-between mb-2">
              <Popover open={datePickerOpen} onOpenChange={setDatePickerOpen}>
                <PopoverTrigger asChild>
                  <button className="flex items-center gap-1.5 px-2 py-1 rounded-md hover:bg-accent/50 transition-colors text-xs font-medium text-foreground">
                    <CalendarDays className="h-3 w-3 text-muted-foreground" />
                    <span className="tabular-nums">
                      {formatDate(currentRangeDates?.from)}{" "}
                      <span className="text-muted-foreground">
                        {formatTime(currentRangeDates?.from)}
                      </span>
                    </span>
                    <span className="text-muted-foreground mx-1">→</span>
                    <span className="tabular-nums">
                      {formatDate(currentRangeDates?.to)}{" "}
                      <span className="text-muted-foreground">
                        {formatTime(currentRangeDates?.to)}
                      </span>
                    </span>
                  </button>
                </PopoverTrigger>
                <PopoverContent
                  className="w-auto p-0 z-[1100]"
                  align="start"
                  side="top"
                  sideOffset={8}
                >
                  <Calendar
                    mode="range"
                    selected={
                      currentRangeDates
                        ? {
                            from: currentRangeDates.from,
                            to: currentRangeDates.to,
                          }
                        : undefined
                    }
                    onSelect={handleDateSelect}
                    modifiers={{ hasReport: reportDays }}
                    modifiersStyles={{
                      hasReport: {
                        fontWeight: "bold",
                        textDecoration: "underline",
                        textDecorationColor: deviceColor,
                        textUnderlineOffset: "3px",
                      },
                    }}
                    disabled={(date) => {
                      if (!dateExtent) return true;
                      const start = new Date(dateExtent.from);
                      start.setHours(0, 0, 0, 0);
                      const end = new Date(dateExtent.to);
                      end.setHours(23, 59, 59, 999);
                      return date < start || date > end;
                    }}
                    defaultMonth={currentRangeDates?.from}
                    numberOfMonths={1}
                  />
                </PopoverContent>
              </Popover>

              <span className="text-[10px] text-muted-foreground tabular-nums">
                {reportCountText}
              </span>
            </div>

            {/* Slider with date ticks */}
            <div className="relative">
              {/* Date tick marks */}
              <div className="absolute -top-0.5 left-0 right-0 pointer-events-none">
                {timelineTicks.map((tick, i) => (
                  <div
                    key={i}
                    className="absolute flex flex-col items-center"
                    style={{
                      left: `${tick.position}%`,
                      transform: "translateX(-50%)",
                    }}
                  >
                    <div
                      className="w-px h-1.5 bg-muted-foreground/30"
                      style={{ marginBottom: "1px" }}
                    />
                  </div>
                ))}
              </div>

              <Slider
                value={filterRange}
                onValueChange={(v) =>
                  onFilterRangeChange(v as [number, number])
                }
                min={1}
                max={reports.length}
                step={1}
                className="w-full"
                color={deviceColor}
              />

              {/* Date labels under ticks */}
              <div className="relative h-4 mt-1">
                {timelineTicks.map((tick, i) => (
                  <span
                    key={i}
                    className="absolute text-[8px] text-muted-foreground/60 tabular-nums whitespace-nowrap"
                    style={{
                      left: `${tick.position}%`,
                      transform: "translateX(-50%)",
                    }}
                  >
                    {tick.label}
                  </span>
                ))}
              </div>
            </div>

            {/* Control buttons */}
            <div className="flex items-center justify-between mt-1">
              <div className="flex items-center gap-0.5">
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7"
                  onClick={jumpToStart}
                  disabled={isAtStart}
                  title="Jump to start"
                >
                  <ChevronsLeft className="h-3.5 w-3.5" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7"
                  onClick={nudgeLeft}
                  disabled={isAtStart}
                  title="Step back"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7"
                  onClick={nudgeRight}
                  disabled={isAtEnd}
                  title="Step forward"
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7"
                  onClick={jumpToEnd}
                  disabled={isAtEnd}
                  title="Jump to end"
                >
                  <ChevronsRight className="h-3.5 w-3.5" />
                </Button>
              </div>

              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                onClick={onExport}
                title="Export KML"
              >
                <Download className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Mobile Timeline */}
      <div className="absolute right-4 top-1/2 -translate-y-1/2 z-[900] pointer-events-none md:hidden">
        <div className="flex items-stretch gap-3 p-3 rounded-xl bg-card/30 backdrop-blur-xs border border-border shadow-lg pointer-events-auto h-80 touch-none">
          {/* Labels */}
          <div className="flex flex-col justify-between py-10 w-16">
            <span className="text-[10px] font-medium text-foreground text-right leading-tight">
              {formatTime(currentRangeDates?.to)}
              <br />
              {formatDate(currentRangeDates?.to)}
            </span>
            <span className="text-[10px] font-medium text-foreground text-right leading-tight">
              {formatTime(currentRangeDates?.from)}
              <br />
              {formatDate(currentRangeDates?.from)}
            </span>
          </div>

          {/* Vertical slider + buttons */}
          <div className="flex flex-col items-center gap-4 h-full">
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8 shrink-0"
              onClick={onExport}
            >
              <Download className="h-4 w-4" />
              <span className="sr-only">Export KML</span>
            </Button>
            <Slider
              orientation="vertical"
              value={filterRange}
              onValueChange={(v) =>
                onFilterRangeChange(v as [number, number])
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
    </>
  );
}
