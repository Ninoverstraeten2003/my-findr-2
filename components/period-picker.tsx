"use client";

import { useState } from "react";
import { CalendarDays } from "lucide-react";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { ReportPeriod } from "@/lib/types";
import { cn } from "@/lib/utils";

/** "Last N days" choices; 9999 = everything (same value as Settings › History Length). */
const RECENT_DAYS = [1, 3, 7, 14, 30, 90, 9999];

function recentLabel(days: number): string {
  if (days === 9999) return "All";
  if (days === 1) return "24 h";
  return `${days} days`;
}

const dayLabel = (d: Date) => d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
const shortDay = (d: Date) => d.toLocaleDateString(undefined, { day: "numeric", month: "short" });

export function periodLabel(period: ReportPeriod): string {
  if (period.kind === "recent") return period.days === 9999 ? "All history" : `Last ${recentLabel(period.days)}`;
  const sameDay = period.from.toDateString() === period.to.toDateString();
  return sameDay ? dayLabel(period.from) : `${shortDay(period.from)} – ${shortDay(period.to)}`;
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function endOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}

interface PeriodPickerProps {
  period: ReportPeriod;
  onChange: (period: ReportPeriod) => void;
}

/**
 * Picks which reports the map loads: the last N days, or calendar days. A tap on a day shows that day; a tap on a
 * second day then shows every day from the first to the second; the tap after that starts over with one day.
 */
export default function PeriodPicker({ period, onChange }: PeriodPickerProps) {
  const [open, setOpen] = useState(false);
  // First day of a range being picked: set after the first tap, cleared after the second.
  const [anchor, setAnchor] = useState<Date | null>(null);
  const today = new Date();

  const pickDay = (day: Date) => {
    if (anchor) {
      const [a, b] = anchor <= day ? [anchor, day] : [day, anchor];
      onChange({ kind: "days", from: startOfDay(a), to: endOfDay(b) });
      setAnchor(null);
    } else {
      onChange({ kind: "days", from: startOfDay(day), to: endOfDay(day) });
      setAnchor(day);
    }
  };

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setAnchor(null);
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex min-w-0 items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-card-foreground hover:bg-secondary/60"
          aria-label={`Showing ${periodLabel(period)}; change period`}
        >
          <CalendarDays className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate">{periodLabel(period)}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={8} className="z-[1100] w-auto max-w-[calc(100vw-1.5rem)] p-0">
        <div className="border-b border-border p-3">
          <div className="mb-2 text-xs font-medium text-muted-foreground">Last</div>
          <div className="grid grid-cols-4 gap-1.5">
            {RECENT_DAYS.map((d) => {
              const active = period.kind === "recent" && period.days === d;
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => {
                    onChange({ kind: "recent", days: d });
                    setOpen(false);
                  }}
                  className={cn(
                    "rounded-md border px-2 py-1.5 text-xs font-medium transition-colors",
                    active
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-card hover:bg-secondary/60",
                  )}
                >
                  {recentLabel(d)}
                </button>
              );
            })}
          </div>
        </div>
        <div className="px-3 pt-3 text-xs text-muted-foreground">
          {anchor ? "Tap another day to show every day in between" : "Or tap a day; tap a second day for a range"}
        </div>
        <Calendar
          mode="range"
          selected={period.kind === "days" ? { from: period.from, to: period.to } : undefined}
          onSelect={(_, day) => pickDay(day)}
          disabled={{ after: today }}
          toDate={today}
          defaultMonth={period.kind === "days" ? period.from : today}
          weekStartsOn={1}
        />
      </PopoverContent>
    </Popover>
  );
}
