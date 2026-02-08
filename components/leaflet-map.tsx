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

const DARK_TILE_URL =
  "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png";
const LIGHT_TILE_URL =
  "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png";

interface LeafletMapProps {
  center: [number, number];
  zoom: number;
  filteredReports: DeviceReport[];
  guessedLocation?: [number, number];
  deviceColor: string;
  showHistory: boolean;
  onCopyLocation: (lat: number, lon: number) => void;
}

export default function LeafletMap({
  center,
  zoom,
  filteredReports,
  guessedLocation,
  deviceColor,
  showHistory,
  onCopyLocation,
}: LeafletMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerGroupRef = useRef<L.LayerGroup | null>(null);

  const isDark =
    typeof window !== "undefined" &&
    document.documentElement.classList.contains("dark");

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

    L.tileLayer(isDark ? DARK_TILE_URL : LIGHT_TILE_URL, {
      attribution: '&copy; <a href="https://carto.com">CARTO</a>',
    }).addTo(map);

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
        color: isDark ? "rgba(255,255,255,0.4)" : deviceColor,
      }).addTo(layerGroup);
    }

    // Report markers
    if (showHistory) {
      const total = filteredReports.length;
      filteredReports.forEach((report, idx) => {
        const { decrypedPayload: payload } = report;
        const { location } = payload;
        const isLast = idx === total - 1;
        const freshness = total > 1 ? idx / (total - 1) : 1;
        const fillOpacity = 0.2 + freshness * 0.6;
        const radius = isLast
          ? LAST_MARKER_RADIUS
          : accuracyToRadius(location.accuracy);

        const marker = L.circleMarker(
          [location.latitude, location.longitude],
          isLast
            ? {
                color: "#ffffff",
                weight: 3,
                fillColor: deviceColor,
                fillOpacity: 1,
                radius: LAST_MARKER_RADIUS,
              }
            : {
                color: isDark
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
            ${isLast ? "Last Seen" : payload.date.toLocaleDateString()}
          </div>
          ${
            !isLast
              ? `<div style="font-size:11px;opacity:0.9;margin-bottom:2px;font-family:var(--font-sans);">
                  ${payload.date.toLocaleTimeString()}
                 </div>`
              : `<div style="font-size:11px;opacity:0.9;margin-bottom:2px;font-family:var(--font-sans);">
                  ${timeSince(payload.date)} ago
                 </div>`
          }
          <div style="font-size:10px;font-family:monospace;opacity:0.7;">
            ${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)}
          </div>
          ${
            isLast
              ? `<div style="font-size:10px;font-family:monospace;opacity:0.7;margin-top:2px;">
                  Battery: ${payload.battery}
                 </div>`
              : ""
          }
        </div>`;

        marker.bindTooltip(tooltipContent, {
          direction: "top",
          opacity: 1,
          className: "custom-leaflet-tooltip",
        });
        marker.addTo(layerGroup);
      });
    }

    // Guessed location marker
    if (guessedLocation) {
      const icon = L.divIcon({
        className: "blue-dot-marker",
        html: '<div class="blue-dot"></div>',
        iconSize: [20, 20],
        iconAnchor: [10, 10],
      });

      const marker = L.marker(guessedLocation, { icon });
      marker.bindPopup(
        `<div style="text-align:center;padding:4px;">
          <div style="font-size:12px;font-weight:600;margin-bottom:4px;">Best Location</div>
          <div style="font-size:10px;font-family:monospace;opacity:0.7;margin-bottom:8px;">
            ${guessedLocation[0].toFixed(5)}, ${guessedLocation[1].toFixed(5)}
          </div>
          <button id="copy-loc-btn" style="font-size:11px;padding:4px 10px;border:1px solid #ccc;border-radius:6px;cursor:pointer;background:transparent;">
            Copy Link
          </button>
        </div>`
      );

      marker.on("popupopen", () => {
        setTimeout(() => {
          const btn = document.getElementById("copy-loc-btn");
          if (btn) {
            btn.onclick = () =>
              onCopyLocation(guessedLocation[0], guessedLocation[1]);
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
    isDark,
    onCopyLocation,
  ]);

  return <div ref={containerRef} className="h-full w-full" />;
}
