"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { DeviceReport } from "@/lib/types";

// Confidence-based radius: higher confidence = larger, more prominent dot
function confidenceToRadius(confidence: number): number {
  switch (confidence) {
    case 3: return 6;   // High confidence – prominent
    case 2: return 4.5; // Medium confidence
    case 1: return 3.5; // Low confidence
    default: return 2.5; // Unknown / 0
  }
}

// Confidence-based fill opacity boost
function confidenceToOpacity(confidence: number, baseFreshness: number): number {
  const base = 0.15 + baseFreshness * 0.45;
  switch (confidence) {
    case 3: return Math.min(1, base + 0.35);
    case 2: return Math.min(1, base + 0.2);
    case 1: return Math.min(1, base + 0.05);
    default: return base * 0.7;
  }
}

// Confidence label helper
function confidenceLabel(confidence: number): string {
  switch (confidence) {
    case 3: return "High";
    case 2: return "Medium";
    case 1: return "Low";
    default: return "Very Low";
  }
}

// Accuracy label helper – describes iPhone GPS quality
function accuracyLabel(accuracy: number): string {
  if (accuracy <= 10) return "Excellent";
  if (accuracy <= 35) return "Good";
  if (accuracy <= 65) return "Fair";
  if (accuracy <= 100) return "Poor";
  return "Very Poor";
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
  deviceId?: string;
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
  deviceId,
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
  const isProgrammaticMoveRef = useRef(false);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const hasInitialFitRef = useRef(false);

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

    // Disable interaction during programmatic moves
    const handleMoveStart = () => {
      if (isProgrammaticMoveRef.current) {
        L.DomUtil.addClass(map.getContainer(), "pointer-events-none");
      }
    };

    const handleMoveEnd = () => {
      L.DomUtil.removeClass(map.getContainer(), "pointer-events-none");
    };

    map.on("movestart", handleMoveStart);
    map.on("moveend", handleMoveEnd);

    // Tile layer managed in separate useEffect

    const layerGroup = L.layerGroup().addTo(map);

    mapRef.current = map;
    layerGroupRef.current = layerGroup;
    
    // Invalidate size on mount if visible
    if (isVisible) {
       map.invalidateSize();
    }

    return () => {
      map.off("movestart", handleMoveStart);
      map.off("moveend", handleMoveEnd);
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
    if (!isVisible) return; 

    // Signal that the next move is programmatic
    isProgrammaticMoveRef.current = true;
    setTimeout(() => {
      isProgrammaticMoveRef.current = false;
    }, 100);

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

  // Only auto-fit on initial load / device switch, not on poll updates
  useEffect(() => {
    if (hasInitialFitRef.current) return; // Already fitted for this device
    if (filteredReports.length === 0) return; // No data yet

    if (isVisible) {
      setTimeout(() => fitMapToState(), 100);
    } else {
      fitMapToState();
    }
    hasInitialFitRef.current = true;
  }, [fitMapToState, zoom, isVisible, filteredReports.length]);

  // Reset initial fit when device changes using explicit deviceId
  useEffect(() => {
    hasInitialFitRef.current = false;
  }, [deviceId]);

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

    // --- Haversine helper (meters between two lat/lon points) ---
    const haversineM = (lat1: number, lon1: number, lat2: number, lon2: number) => {
      const toRad = (d: number) => (d * Math.PI) / 180;
      const R = 6_371_000;
      const dLat = toRad(lat2 - lat1);
      const dLon = toRad(lon2 - lon1);
      const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
      return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    };

    // --- Compute latest-cluster: absorb nearby dots into the latest marker ---
    // Set of report indices that are absorbed into the latest cluster
    const absorbedIndices = new Set<number>();
    let bestClusterLoc: { lat: number; lon: number; accuracy: number; confidence: number } | null = null;
    let latestReport: (typeof filteredReports)[number] | null = null;
    let clusterCount = 0;

    if (showHistory && filteredReports.length > 0) {
      latestReport = filteredReports[filteredReports.length - 1];
      const latestLoc = latestReport.decrypedPayload.location;
      const searchRadius = Math.max(latestLoc.accuracy, 30); // at least 30m radius

      // Find all reports within the accuracy radius of the latest report
      filteredReports.forEach((report, idx) => {
        const loc = report.decrypedPayload.location;
        const dist = haversineM(
          latestLoc.latitude, latestLoc.longitude,
          loc.latitude, loc.longitude
        );
        if (dist <= searchRadius) {
          absorbedIndices.add(idx);
        }
      });

      clusterCount = absorbedIndices.size;

      // Among absorbed reports, pick the one with the best location:
      // highest confidence first, then lowest accuracy (best GPS)
      let bestScore = -Infinity;
      for (const idx of absorbedIndices) {
        const r = filteredReports[idx];
        const loc = r.decrypedPayload.location;
        const conf = r.decrypedPayload.confidence;
        // Score: confidence is primary (x1000), accuracy inverse is secondary
        const score = conf * 1000 + (255 - loc.accuracy);
        if (score > bestScore) {
          bestScore = score;
          bestClusterLoc = {
            lat: loc.latitude,
            lon: loc.longitude,
            accuracy: loc.accuracy,
            confidence: conf,
          };
        }
      }
    }

    // Trail polyline — keep true chronological order; absorbed dots snap to cluster location
    if (showHistory && filteredReports.length > 1) {
      const latlngs: L.LatLngTuple[] = filteredReports.map((r, idx) => {
        if (absorbedIndices.has(idx) && bestClusterLoc) {
          return [bestClusterLoc.lat, bestClusterLoc.lon] as L.LatLngTuple;
        }
        return [
          r.decrypedPayload.location.latitude,
          r.decrypedPayload.location.longitude,
        ] as L.LatLngTuple;
      });

      // Deduplicate consecutive identical points to keep the line clean
      const deduped: L.LatLngTuple[] = [latlngs[0]];
      for (let i = 1; i < latlngs.length; i++) {
        if (latlngs[i][0] !== latlngs[i - 1][0] || latlngs[i][1] !== latlngs[i - 1][1]) {
          deduped.push(latlngs[i]);
        }
      }

      if (deduped.length > 1) {
        L.polyline(deduped, {
          dashArray: "6, 12",
          weight: 2,
          opacity: 0.5,
          color: useDarkMarkers ? "rgba(255,255,255,0.4)" : deviceColor,
        }).addTo(layerGroup);
      }
    }

    // Report markers — skip absorbed indices (they're part of the latest cluster)
    if (showHistory && filteredReports.length > 0) {
      const total = filteredReports.length;
      filteredReports.forEach((report, idx) => {
        // Skip reports absorbed into the latest cluster
        if (absorbedIndices.has(idx)) return;

        const { decrypedPayload: payload } = report;
        const { location } = payload;
        const confidence = payload.confidence;
        const freshness = total > 1 ? idx / (total - 1) : 1;
        const fillOpacity = confidenceToOpacity(confidence, freshness);
        const radius = confidenceToRadius(confidence);

        // Main dot – sized by confidence
        const marker = L.circleMarker(
          [location.latitude, location.longitude],
          {
            color: useDarkMarkers
              ? `rgba(255,255,255,${confidence >= 2 ? 0.5 : 0.25})`
              : `rgba(0,0,0,${confidence >= 2 ? 0.2 : 0.1})`,
            weight: confidence >= 2 ? 1 : 0.5,
            fillColor: deviceColor,
            fillOpacity,
            radius,
          }
        );

        // Confidence badge color
        const confBadgeColor = confidence === 3 ? "#22c55e" : confidence === 2 ? "#eab308" : confidence === 1 ? "#f97316" : "#ef4444";

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

            <div class="map-tooltip-divider"></div>

            <div class="map-tooltip-grid">
              <div class="map-tooltip-item">
                <div class="map-tooltip-label">Confidence</div>
                <div class="map-tooltip-value" style="display:flex;align-items:center;gap:5px;">
                  <span class="map-tooltip-conf-dot" style="background:${confBadgeColor};"></span>
                  ${confidenceLabel(confidence)}
                </div>
              </div>
              <div class="map-tooltip-item">
                <div class="map-tooltip-label">GPS Accuracy</div>
                <div class="map-tooltip-value">${accuracyLabel(location.accuracy)} <span style="opacity:0.5;">(±${location.accuracy}m)</span></div>
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

    // Main Location Marker — positioned at the best location in the cluster
    let mainLocation: [number, number] | undefined;
    let displayAccuracy = 100;

    if (showHistory && bestClusterLoc) {
      mainLocation = [bestClusterLoc.lat, bestClusterLoc.lon];
      displayAccuracy = bestClusterLoc.accuracy;
    } else if (guessedLocation && !showHistory) {
      mainLocation = guessedLocation;
    }

    if (mainLocation) {
      // Accuracy ring — real meters, scales with zoom
      if (displayAccuracy > 0) {
        L.circle(mainLocation, {
          radius: displayAccuracy,
          color: deviceColor,
          weight: 1.5,
          opacity: 0.2,
          fillColor: deviceColor,
          fillOpacity: 0.04,
          dashArray: displayAccuracy > 65 ? "6, 8" : undefined,
        }).addTo(layerGroup);
      }

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

      // Tooltip — uses latest report's time, but best location's coordinates
      if (latestReport && bestClusterLoc) {
        const payload = latestReport.decrypedPayload;
        const conf = bestClusterLoc.confidence;
        const confBadgeColor = conf === 3 ? "#22c55e" : conf === 2 ? "#eab308" : conf === 1 ? "#f97316" : "#ef4444";
        const clusterInfo = clusterCount > 1
          ? `<div class="map-tooltip-divider"></div>
             <div style="font-size:10px;text-align:center;color:hsl(var(--muted-foreground));padding:2px 0;">
               Combined from ${clusterCount} nearby reports
             </div>`
          : "";

        const latestTooltip = `
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
                <div class="map-tooltip-value">${bestClusterLoc.lat.toFixed(5)}°</div>
              </div>
              <div class="map-tooltip-item">
                <div class="map-tooltip-label">Longitude</div>
                <div class="map-tooltip-value">${bestClusterLoc.lon.toFixed(5)}°</div>
              </div>
            </div>

            <div class="map-tooltip-divider"></div>

            <div class="map-tooltip-grid">
              <div class="map-tooltip-item">
                <div class="map-tooltip-label">Confidence</div>
                <div class="map-tooltip-value" style="display:flex;align-items:center;gap:5px;">
                  <span class="map-tooltip-conf-dot" style="background:${confBadgeColor};"></span>
                  ${confidenceLabel(conf)}
                </div>
              </div>
              <div class="map-tooltip-item">
                <div class="map-tooltip-label">GPS Accuracy</div>
                <div class="map-tooltip-value">${accuracyLabel(bestClusterLoc.accuracy)} <span style="opacity:0.5;">(±${bestClusterLoc.accuracy}m)</span></div>
              </div>
            </div>

            <div class="map-tooltip-divider"></div>

            <div class="map-tooltip-grid">
              <div class="map-tooltip-item">
                <div class="map-tooltip-label">Battery</div>
                <div class="map-tooltip-value">${payload.battery}</div>
              </div>
            </div>
            ${clusterInfo}
          </div>
        `;

        marker.bindTooltip(latestTooltip, {
          direction: "top",
          opacity: 1,
          className: "custom-leaflet-tooltip",
          offset: [0, -10],
        });
      }

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

        .map-tooltip-divider {
          height: 1px;
          background: ${activeTheme === "light" || activeTheme === "streets" ? "rgba(0,0,0,0.06)" : "rgba(255,255,255,0.08)"};
          margin: 10px 0;
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

        .map-tooltip-conf-dot {
          display: inline-block;
          width: 6px;
          height: 6px;
          border-radius: 50%;
          flex-shrink: 0;
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
