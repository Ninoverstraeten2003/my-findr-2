"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { DeviceReport } from "@/lib/types";
import { timeSince } from "@/lib/app-utils";

const MARKER_MIN_RADIUS = 2.5;
const MARKER_MAX_RADIUS = 6;
const LAST_MARKER_RADIUS = 8; // Declared LAST_MARKER_RADIUS variable

function accuracyToRadius(accuracy: number): number {
  if (accuracy <= 0) return MARKER_MIN_RADIUS;
  return (
    Math.round(
      Math.max(MARKER_MIN_RADIUS, Math.min(accuracy / 20, MARKER_MAX_RADIUS)) *
        10
    ) / 10
  );
}

const TILE_LAYERS = {
  dark: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
  light: "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
  satellite:
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  streets: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
};

const ATTRIBUTIONS = {
  carto: '&copy; <a href="https://carto.com">CARTO</a>',
  esri: 'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community',
  osm: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
};

interface LeafletMapProps {
  center: [number, number];
  zoom: number;
  filteredReports: DeviceReport[];
  guessedLocation?: [number, number];
  deviceColor: string;
  showHistory: boolean;
  mapTheme: "system" | "light" | "dark" | "satellite" | "streets";
  onCopyLocation: (lat: number, lon: number) => void;
  isVisible: boolean;
}

export default function LeafletMap({
  center,
  zoom,
  filteredReports,
  guessedLocation,
  deviceColor,
  showHistory,
  mapTheme,
  onCopyLocation,
  isVisible,
}: LeafletMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerGroupRef = useRef<L.LayerGroup | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);

  const isDark =
    typeof window !== "undefined" &&
    document.documentElement.classList.contains("dark");

  const activeTheme =
    mapTheme === "system" ? (isDark ? "dark" : "light") : mapTheme;
  const useDarkMarkers = activeTheme === "dark" || activeTheme === "satellite";

  // Handle visibility changes
  useEffect(() => {
    if (isVisible && mapRef.current) {
      mapRef.current.invalidateSize();
    }
  }, [isVisible]);

  // Initialize map once
  useEffect(() => {
    if (!containerRef.current) return;

    // If a map already exists on this container, remove it first
    if (mapRef.current) {
      mapRef.current.remove();
      mapRef.current = null;
    }

    const map = L.map(containerRef.current, {
      center,
      zoom: 7,
      zoomControl: false,
      attributionControl: false,
      minZoom: 3,
    });

    L.control.zoom({ position: "topleft" }).addTo(map);

    // Tile layer managed in separate useEffect

    const layerGroup = L.layerGroup().addTo(map);

    mapRef.current = map;
    layerGroupRef.current = layerGroup;
    
    // Invalidate size on mount if visible
    if (isVisible) {
       map.invalidateSize();
    }

    return () => {
      map.remove();
      mapRef.current = null;
      layerGroupRef.current = null;
    };
    // Only run on mount/unmount - we handle view changes via setView below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update map view when center/zoom changes
  const fitMapToState = useCallback(() => {
    if (!mapRef.current) return;
    
    // If not visible, we can skip specific bounds calculations, 
    // but usually setting view is fine. 
    // However, fitBounds might be weird if map has 0 size.
    // So better to guard it or invalidateSize first.
    if (!isVisible) return; 

    if (showHistory && filteredReports.length > 0) {
      const latlngs: L.LatLngTuple[] = filteredReports.map((r) => [
        r.decrypedPayload.location.latitude,
        r.decrypedPayload.location.longitude,
      ]);

      const bounds = L.latLngBounds(latlngs);

      mapRef.current.fitBounds(bounds, {
        padding: [50, 50],
        animate: true,
        duration: 0.5,
        maxZoom: 18,
      });
    } else {
      mapRef.current.setView(center, 18, { animate: true, duration: 0.5 });  
    }
  }, [center, showHistory, filteredReports, isVisible]);

  // Update map view when center/zoom changes
  useEffect(() => {
    // We also want to fit map to state when it becomes visible
    if (isVisible) {
        // slight delay to ensure invalidateSize happened
        setTimeout(() => fitMapToState(), 100);
    } else {
        fitMapToState();
    }
  }, [fitMapToState, zoom, isVisible]);

  // Handle Map Theme
  useEffect(() => {
    if (!mapRef.current) return;

    if (tileLayerRef.current) {
      tileLayerRef.current.remove();
    }

    let url = TILE_LAYERS.light;
    let attr = ATTRIBUTIONS.carto;

    switch (activeTheme) {
      case "dark":
        url = TILE_LAYERS.dark;
        attr = ATTRIBUTIONS.carto;
        break;
      case "light":
        url = TILE_LAYERS.light;
        attr = ATTRIBUTIONS.carto;
        break;
      case "satellite":
        url = TILE_LAYERS.satellite;
        attr = ATTRIBUTIONS.esri;
        break;
      case "streets":
        url = TILE_LAYERS.streets;
        attr = ATTRIBUTIONS.osm;
        break;
    }

    const layer = L.tileLayer(url, {
      attribution: attr,
      className: activeTheme === "dark" ? "map-tiles-dark" : "",
    });
    layer.addTo(mapRef.current);
    layer.bringToBack();
    tileLayerRef.current = layer;
  }, [activeTheme]);

  // Update markers/polylines when data changes
  useEffect(() => {
    const layerGroup = layerGroupRef.current;
    if (!layerGroup) return;

    layerGroup.clearLayers();

    // Trail polyline
    if (showHistory && filteredReports.length > 1) {
      const latlngs: L.LatLngTuple[] = filteredReports.map((r) => [
        r.decrypedPayload.location.latitude,
        r.decrypedPayload.location.longitude,
      ]);

      L.polyline(latlngs, {
        dashArray: "6, 12",
        weight: 2,
        opacity: 0.5,
        color: useDarkMarkers ? "rgba(255,255,255,0.4)" : deviceColor,
      }).addTo(layerGroup);
    }

    // Report markers (excluding the last one)
    if (showHistory && filteredReports.length > 0) {
      const total = filteredReports.length;
      // Only render up to the second to last marker
      filteredReports.slice(0, total - 1).forEach((report, idx) => {
        const { decrypedPayload: payload } = report;
        const { location } = payload;
        const freshness = total > 1 ? idx / (total - 1) : 1;
        const fillOpacity = 0.2 + freshness * 0.6;
        const radius = accuracyToRadius(location.accuracy);

        const marker = L.circleMarker(
          [location.latitude, location.longitude],
          {
            color: useDarkMarkers
              ? "rgba(255,255,255,0.3)"
              : "rgba(0,0,0,0.15)",
            weight: 0.5,
            fillColor: deviceColor,
            fillOpacity,
            radius,
          }
        );

        const tooltipContent = `
          <div class="map-tooltip-card">
            <div class="map-tooltip-header">
              <div>
                <div class="map-tooltip-date">${payload.date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</div>
                <div class="map-tooltip-time">${payload.date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</div>
              </div>
              <div class="map-tooltip-status-dot" style="background-color: ${deviceColor}; box-shadow: 0 0 0 3px ${deviceColor}40;"></div>
            </div>
            
            <div class="map-tooltip-grid">
              <div class="map-tooltip-item">
                <div class="map-tooltip-label">Latitude</div>
                <div class="map-tooltip-value">${location.latitude.toFixed(5)}°</div>
              </div>
              <div class="map-tooltip-item">
                <div class="map-tooltip-label">Longitude</div>
                <div class="map-tooltip-value">${location.longitude.toFixed(5)}°</div>
              </div>
            </div>
          </div>
        `;

        marker.bindTooltip(tooltipContent, {
          direction: "top",
          opacity: 1,
          className: "custom-leaflet-tooltip",
        });
        marker.addTo(layerGroup);
      });
    }

    // Main Location Marker (Always render the "latest" point with consistent styling)
    let mainLocation: [number, number] | undefined;
    let popupTitle = "Current Location";
    let popupSubtitle = "";
    let additionalInfo = "";

    if (showHistory && filteredReports.length > 0) {
      const lastReport = filteredReports[filteredReports.length - 1];
      const { location } = lastReport.decrypedPayload;
      mainLocation = [location.latitude, location.longitude];
      popupTitle = "Latest Location";
      
      const timeStr = lastReport.decrypedPayload.date.toLocaleTimeString();
      const relativeTime = timeSince(lastReport.decrypedPayload.date);
      popupSubtitle = `<div style="margin-bottom:4px;">${timeStr} (${relativeTime} ago)</div>`;
      additionalInfo = `<div style="font-size:10px;font-family:monospace;opacity:0.7;margin-top:2px;">
         Battery: ${lastReport.decrypedPayload.battery}
      </div>`;
    } else if (guessedLocation && !showHistory) {
      mainLocation = guessedLocation;
    }

    if (mainLocation) {
      const icon = L.divIcon({
        className: "custom-location-marker",
        html: `<div style="position: relative; width: 100%; height: 100%;">
          <div style="
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            border-radius: 50%;
            background-color: ${deviceColor};
            opacity: 0.6;
            animation: map-pulse 2s infinite;
          "></div>
          <div style="
            position: relative;
            width: 100%;
            height: 100%;
            background-color: ${deviceColor};
            border: 2px solid white;
            border-radius: 50%;
            box-shadow: 0 0 12px ${deviceColor};
            z-index: 2;
          "></div>
        </div>`,
        iconSize: [20, 20],
        iconAnchor: [10, 10],
      });

      const marker = L.marker(mainLocation, { icon });
      marker.addTo(layerGroup);
    }
  }, [
    filteredReports,
    guessedLocation,
    deviceColor,
    showHistory,
    useDarkMarkers,
    onCopyLocation,
  ]);


  // Calculate the expected center point (either latest device or bounds center)
  const targetMapCenter = useMemo(() => {
    if (showHistory && filteredReports.length > 0) {
      const latlngs: L.LatLngTuple[] = filteredReports.map((r) => [
        r.decrypedPayload.location.latitude,
        r.decrypedPayload.location.longitude,
      ]);
      const bounds = L.latLngBounds(latlngs);
      return bounds.getCenter();
    }
    return L.latLng(center);
  }, [showHistory, filteredReports, center]);

  // Check if map is centered
  const [isCentered, setIsCentered] = useState(true);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const checkCenter = () => {
      const mapCenter = map.getCenter();

      // Calculate distance in pixels to be zoom-independent for "closeness"
      const mapPoint = map.latLngToContainerPoint(mapCenter);
      const targetPoint = map.latLngToContainerPoint(targetMapCenter);
      const dist = mapPoint.distanceTo(targetPoint);

      setIsCentered(dist < 50); // Threshold of 50 pixels
    };

    map.on("move", checkCenter);
    map.on("moveend", checkCenter);

    // Initial check
    checkCenter();

    return () => {
      map.off("move", checkCenter);
      map.off("moveend", checkCenter);
    };
  }, [targetMapCenter]);

  return (
    <>
      <style>{`
        .leaflet-container {
          background-color: ${
            activeTheme === "light" || activeTheme === "streets"
              ? "#aad3df"
: "#191a1a" // dark grey background for dark mode tiles
          } !important;
        }
        .map-tiles-dark {
          filter: brightness(1.2) contrast(0.9);
        }
        @keyframes map-pulse {
          0% { transform: scale(1); opacity: 0.6; }
          70% { transform: scale(3); opacity: 0; }
          100% { transform: scale(3); opacity: 0; }
        }
        .leaflet-bar a {
          background-color: ${
            activeTheme === "light" || activeTheme === "streets" 
              ? "rgba(255, 255, 255, 0.3)" 
              : "rgba(0, 0, 0, 0.3)"
          } !important;
          backdrop-filter: blur(12px) !important;
          -webkit-backdrop-filter: blur(12px) !important;
          color: ${
            activeTheme === "light" || activeTheme === "streets"
              ? "#000"
              : "#fff"
          } !important;
          border-color: rgba(128, 128, 128, 0.2) !important;
        }
        .leaflet-bar a:hover {
          background-color: ${
            activeTheme === "light" || activeTheme === "streets"
              ? "rgba(255, 255, 255, 0.8)"
              : "rgba(0, 0, 0, 0.8)"
          } !important;
        }

        /* Custom Tooltip Styles */
        .leaflet-tooltip.custom-leaflet-tooltip {
          background: transparent !important;
          border: none !important;
          box-shadow: none !important;
          padding: 0 !important;
        }
        
        .leaflet-tooltip.custom-leaflet-tooltip::before {
          display: none !important;
        }

        .map-tooltip-card {
          background-color: ${
            activeTheme === "light" || activeTheme === "streets"
              ? "rgba(255, 255, 255, 0.75)"
              : "rgba(20, 20, 20, 0.75)"
          };
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          border-radius: 12px;
          padding: 16px;
          min-width: 180px;
          box-shadow: 0 10px 40px -10px rgba(0,0,0,0.2);
          border: 1px solid ${
            activeTheme === "light" || activeTheme === "streets"
              ? "rgba(0, 0, 0, 0.05)"
              : "rgba(255, 255, 255, 0.1)"
          };
          font-family: var(--font-sans, system-ui, sans-serif);
          color: hsl(var(--foreground));
        }

        .map-tooltip-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 12px;
          padding-bottom: 12px;
          border-bottom: 1px solid ${
            activeTheme === "light" || activeTheme === "streets"
              ? "rgba(0, 0, 0, 0.05)"
              : "rgba(255, 255, 255, 0.1)"
          };
        }

        .map-tooltip-date {
          font-size: 16px;
          font-weight: 700;
          line-height: 1;
          color: hsl(var(--foreground));
        }

        .map-tooltip-time {
          font-size: 12px;
          color: hsl(var(--muted-foreground));
          margin-top: 4px;
          font-weight: 500;
        }

        .map-tooltip-status-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: hsl(var(--primary));
          box-shadow: 0 0 0 3px hsl(var(--primary) / 0.2);
        }

        .map-tooltip-grid {
          display: flex;
          justify-content: space-between;
          gap: 16px;
        }

        .map-tooltip-item {
          text-align: left;
        }

        .map-tooltip-label {
          font-size: 10px;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: hsl(var(--muted-foreground));
          font-weight: 600;
          margin-bottom: 4px;
        }

        .map-tooltip-value {
          font-family: monospace;
          font-size: 12px;
          color: hsl(var(--foreground));
          font-weight: 600;
        }
      `}</style>
      <div className="relative h-full w-full">
        <div ref={containerRef} className="h-full w-full" />
        
        {/* Recenter Button */}
        {!isCentered && (
           <button
             onClick={fitMapToState}
             className="absolute bottom-24 right-4 z-[999] p-2 rounded-lg shadow-lg transition-all duration-200 hover:scale-105 active:scale-95 bg-card/30 backdrop-blur-md border border-border text-card-foreground"
             aria-label="Recenter Map"
           >
             <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
               <line x1="12" y1="5" x2="12" y2="19"></line>
               <line x1="5" y1="12" x2="19" y2="12"></line>
               <circle cx="12" cy="12" r="3"></circle>
               <path d="M12 2a10 10 0 0 1 10 10"></path>
               <path d="M12 22a10 10 0 0 1-10-10"></path>
             </svg>
             <span className="sr-only">Recenter</span>
           </button>
        )}
      </div>
    </>
  );
}
