"use client";

import { useState } from "react";
import { Map, Settings, Coffee } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import MapView from "@/components/map-view";
import SettingsView from "@/components/settings-view";

type View = "map" | "settings";

export default function Page() {
  const [view, setView] = useState<View>("map");

  return (
    <div className="flex flex-col h-dvh bg-background">
      {/* Top Navigation Bar */}
      <header className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-card/30 backdrop-blur-md z-10 shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-primary/10 text-lg leading-none pt-0.5">
            📍
          </div>
          <span className="text-sm font-semibold text-foreground tracking-tight">
            MyFindr
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            asChild
            className="h-8 gap-2 bg-background/50 backdrop-blur-sm border-amber-200/20 hover:bg-amber-100/20 hover:text-amber-500 hover:border-amber-200/50 transition-all duration-300"
          >
            <a
              href="https://buymeacoffee.com/ninoverstraeten"
              target="_blank"
              rel="noopener noreferrer"
            >
              <Coffee className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Support Me</span>
            </a>
          </Button>
          <nav className="flex items-center gap-1 p-0.5 rounded-lg bg-secondary/50 border border-border">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setView("map")}
              className={cn(
                "h-7 px-3 text-xs font-medium rounded-md transition-all",
                view === "map"
                  ? "bg-primary text-primary-foreground shadow-sm hover:bg-primary hover:text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Map className="h-3.5 w-3.5 mr-1.5" />
              Map
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setView("settings")}
              className={cn(
                "h-7 px-3 text-xs font-medium rounded-md transition-all",
                view === "settings"
                  ? "bg-primary text-primary-foreground shadow-sm hover:bg-primary hover:text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Settings className="h-3.5 w-3.5 mr-1.5" />
              Settings
            </Button>
          </nav>
        </div>
      </header>

      {/* Content Area */}
      <main className="flex-1 overflow-hidden relative">
        <div className={cn("h-full w-full", view === "map" ? "block" : "hidden")}>
          <MapView 
            onOpenSettings={() => setView("settings")} 
            isVisible={view === "map"}
          />
        </div>
        
        {view === "settings" && (
          <div className="h-full overflow-y-auto">
            <SettingsView />
          </div>
        )}
      </main>
    </div>
  );
}
