"use client";

import { useState, useEffect, useRef } from "react";
import {
  MapPin,
  Circle,
  Star,
  Flower2,
  Car,
  Bus,
  User,
  Camera,
  Smartphone,
  Laptop,
  Key,
  TreePine,
  Baby,
  Bike,
  ChevronDown,
  BatteryFull,
  BatteryMedium,
  BatteryLow,
  BatteryWarning,
  Battery,
  Loader2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import PeriodPicker from "@/components/period-picker";
import { pluralize, timeSince } from "@/lib/app-utils";
import type { Device, BatteryStatus, ReportPeriod } from "@/lib/types";
import { cn } from "@/lib/utils";

const iconMap: Record<string, LucideIcon> = {
  MapPin, Circle, Star, Flower2, Car, Bus, User, Camera,
  Smartphone, Laptop, Key, TreePine, Baby, Bike,
};

const batteryConfig: Record<BatteryStatus, { icon: LucideIcon; color: string }> = {
  Full: { icon: BatteryFull, color: "text-emerald-400" },
  Medium: { icon: BatteryMedium, color: "text-amber-400" },
  Low: { icon: BatteryLow, color: "text-amber-500" },
  Critical: { icon: BatteryWarning, color: "text-red-500" },
  Unknown: { icon: Battery, color: "text-muted-foreground" },
};

function TimeAgo({ date }: { date: Date | string | number }) {
  const [time, setTime] = useState(timeSince(date));

  useEffect(() => {
    const updateTime = () => setTime(timeSince(date));
    updateTime(); // Initial update
    
    // Update every 10 seconds to keep relative time fresh
    const interval = setInterval(updateTime, 10000);
    return () => clearInterval(interval);
  }, [date]);

  return <>{time}</>;
}

interface DevicesPanelProps {
  devices: Device[];
  onDeviceChosen: (device: Device) => void;
  currentDevice: Device | undefined;
  isLoading?: boolean;
  /** Which reports the map shows; picked in the header. */
  period: ReportPeriod;
  onPeriodChange: (period: ReportPeriod) => void;
}

export default function DevicesPanel({
  devices,
  onDeviceChosen,
  currentDevice,
  isLoading,
  period,
  onPeriodChange,
}: DevicesPanelProps) {
  const [isOpen, setIsOpen] = useState(true);
  const listRef = useRef<HTMLDivElement>(null);

  // The chosen device moves to the top of the list; scroll up so it stays in view.
  useEffect(() => {
    listRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, [currentDevice?.id]);

  if (!devices || devices.length === 0) return null;

  const ordered = currentDevice
    ? [...devices.filter((d) => d.id === currentDevice.id), ...devices.filter((d) => d.id !== currentDevice.id)]
    : devices;

  const status = pluralize(devices.length, "Device");

  return (
    <div className="absolute top-3 right-3 z-[1001] w-72 touch-none">
      <div className="map-surface rounded-xl overflow-hidden">
        {/* Header: device count (collapses the list), the period shown on the map, collapse chevron */}
        <div className="flex items-center gap-1 pr-2">
          <button
            type="button"
            onClick={() => setIsOpen(!isOpen)}
            className="flex flex-1 items-center gap-2 py-3 pl-4 text-left text-sm font-medium text-card-foreground touch-none"
          >
            <span className="whitespace-nowrap">{status}</span>
            {isLoading && (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
            )}
          </button>
          <PeriodPicker period={period} onChange={onPeriodChange} />
          <button
            type="button"
            onClick={() => setIsOpen(!isOpen)}
            className="rounded-md p-1.5 hover:bg-secondary/60 touch-none"
            aria-label={isOpen ? "Hide devices" : "Show devices"}
          >
            <ChevronDown
              className={cn(
                "h-4 w-4 text-muted-foreground transition-transform",
                !isOpen && "-rotate-90"
              )}
            />
          </button>
        </div>

        {/* Device List */}
        {isOpen && (
          <div ref={listRef} className="border-t border-border max-h-60 overflow-y-auto touch-pan-y">
            {ordered.map((device) => {
              const IconComp = iconMap[device.icon] || MapPin;
              const isActive = currentDevice?.id === device.id;
              
              // Use currentDevice for dynamic data (battery, lastSeen) to preserve live updates
              // because device from props might be a fresh object from settings having no live data.
              const effectiveDevice = isActive && currentDevice ? currentDevice : device;
              
              // However, prefer static data (name, color, icon) from the props device 
              // as that reflects recent settings changes.
              const battery = effectiveDevice.battery;
              const lastSeen = effectiveDevice.lastSeen;
              
              const bat = batteryConfig[battery] || batteryConfig.Unknown;
              const BatIcon = bat.icon;

              return (
                <Button
                  key={device.id}
                  variant="ghost"
                  onClick={() => onDeviceChosen(device)}
                  className={cn(
                    "flex items-center w-full justify-start gap-3 rounded-none px-4 py-3 h-auto text-left transition-all duration-300 touch-pan-y",
                    isActive
                      ? "bg-secondary/60 border-l-2 border-l-primary"
                      : "hover:pl-5 border-l-2 border-l-transparent"
                  )}
                >
                  <div
                    className="flex items-center justify-center w-8 h-8 rounded-lg shrink-0"
                    style={{ backgroundColor: device.hexColor + "22" }}
                  >
                    <IconComp
                      className="h-4 w-4"
                      style={{ color: device.hexColor }}
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm text-card-foreground truncate">
                      {device.name}
                    </div>
                    {isActive && (
                      <div className="text-xs font-medium text-foreground/80 drop-shadow-sm">
                        {lastSeen ? (
                          <>
                            <TimeAgo date={lastSeen} /> ago
                          </>
                        ) : isLoading ? (
                          <span className="text-muted-foreground font-medium">
                            Loading...
                          </span>
                        ) : (
                          <span className="text-destructive font-semibold">
                            No Data
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                  {isActive && (
                    <BatIcon className={cn("h-4 w-4 shrink-0", bat.color)} />
                  )}
                </Button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
