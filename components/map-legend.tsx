"use client";

import { Info } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { QualityIcon } from "@/components/quality-icon";
import { QUALITY_LEGEND } from "@/lib/report-quality";

/** What every mark on the map means. */
export default function MapLegend({ color }: { color: string }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="map-surface flex h-[34px] w-[34px] items-center justify-center rounded-md touch-none"
          aria-label="Legend: what the marks on the map mean"
        >
          <Info className="h-4 w-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="right"
        align="start"
        sideOffset={8}
        collisionPadding={12}
        className="z-[1100] w-[min(20rem,calc(100vw-4rem))] p-3 text-xs"
      >
        <div className="mb-2 font-medium">How accurate a report is</div>
        <ul className="flex flex-col gap-2">
          {QUALITY_LEGEND.map((q) => (
            <li key={q.level} className="flex gap-2.5">
              <span className="mt-0.5 flex w-5 justify-center">
                <QualityIcon level={q.level} color={color} size={14} />
              </span>
              <span>
                <span className="font-medium">{q.label}</span>
                <span className="block text-muted-foreground">{q.description}</span>
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-muted-foreground">
          The latest location uses the same shapes, bigger and pulsing. Doubtful reports stay on the map; the trail
          skips them.
        </p>

        <div className="mb-2 mt-3 border-t border-border pt-3 font-medium">Movement</div>
        <ul className="flex flex-col gap-2">
          <li className="flex gap-2.5">
            <span className="mt-0.5 flex w-5 justify-center">
              <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
                <circle cx="9" cy="9" r="7.5" fill={color} fillOpacity="0.08" stroke={color} strokeWidth="1.5" strokeDasharray="2 3" />
              </svg>
            </span>
            <span>
              <span className="font-medium">Stay</span>
              <span className="block text-muted-foreground">
                Where the tag sat still for 10 minutes or more; the label says how long
              </span>
            </span>
          </li>
          <li className="flex gap-2.5">
            <span className="mt-0.5 flex w-5 justify-center">
              <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
                <line x1="1" y1="13" x2="17" y2="5" stroke="#ffffff" strokeWidth="5" strokeLinecap="round" />
                <line x1="1" y1="13" x2="17" y2="5" stroke={color} strokeWidth="2.5" strokeDasharray="4 3" />
              </svg>
            </span>
            <span>
              <span className="font-medium">Trail</span>
              <span className="block text-muted-foreground">
                The route between stays, in time order; its dashes (and arrows) move in the direction of travel
              </span>
            </span>
          </li>
        </ul>
      </PopoverContent>
    </Popover>
  );
}
