"use client";

import { useEffect, useMemo, useRef } from "react";
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
    });

    L.control.zoom({ position: "topleft" }).addTo(map);

    // Tile layer managed in separate useEffect

    const layerGroup = L.layerGroup().addTo(map);

    mapRef.current = map;
    layerGroupRef.current = layerGroup;

    return () => {
      map.remove();
      mapRef.current = null;
      layerGroupRef.current = null;
    };
    // Only run on mount/unmount - we handle view changes via setView below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update map view when center/zoom changes
  useEffect(() => {
    if (mapRef.current) {
      mapRef.current.setView(center, zoom, { animate: true, duration: 0.5 });
    }
  }, [center, zoom]);

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

        const tooltipContent = `<div style="text-align:center;padding:4px;min-width:100px;">
          <div style="font-size:12px;font-weight:600;margin-bottom:4px;font-family:var(--font-sans);">
            ${payload.date.toLocaleDateString()}
          </div>
          <div style="font-size:11px;opacity:0.9;margin-bottom:2px;font-family:var(--font-sans);">
            ${payload.date.toLocaleTimeString()}
          </div>
          <div style="font-size:10px;font-family:monospace;opacity:0.7;">
            ${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)}
          </div>
        </div>`;

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
      
      marker.bindPopup(
        `<div style="text-align:center;padding:4px;">
          <div style="font-size:12px;font-weight:600;margin-bottom:4px;">${popupTitle}</div>
          ${popupSubtitle}
          <div style="font-size:10px;font-family:monospace;opacity:0.7;margin-bottom:8px;">
            ${mainLocation[0].toFixed(5)}, ${mainLocation[1].toFixed(5)}
          </div>
          ${additionalInfo}
          <button id="copy-loc-btn" style="font-size:11px;padding:4px 10px;border:1px solid #ccc;border-radius:6px;cursor:pointer;background:transparent;margin-top:4px;">
            Copy Link
          </button>
        </div>`
      );

      marker.on("popupopen", () => {
        setTimeout(() => {
          const btn = document.getElementById("copy-loc-btn");
          if (btn) {
            btn.onclick = () => {
              if (mainLocation) {
                 onCopyLocation(mainLocation[0], mainLocation[1]);
                 // Visual feedback for button
                 btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
                 setTimeout(() => {
                    btn.innerHTML = "Copy Link";
                 }, 2000);
              }
            };
          }
        }, 0);
      });

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

  return (
    <>
      <style>{`
        .leaflet-container {
          background-color: ${
            activeTheme === "light" || activeTheme === "streets"
              ? "#ffffff" // Ocean color usually works well, or just white/light gray
              : "#000000"
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
      `}</style>
      <div ref={containerRef} className="h-full w-full" />
    </>
  );
}
