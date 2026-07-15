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

// Confidence-based fill opacity boost (no chronological fading)
function confidenceToOpacity(confidence: number): number {
  switch (confidence) {
    case 3: return 0.85; // High confidence – very solid
    case 2: return 0.65; // Medium confidence
    case 1: return 0.45; // Low confidence
    default: return 0.25; // Very low confidence
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

// Adjusts device marker color and brightness/saturation based on chronological freshness (comet tail)
function adjustColorForFreshness(hex: string, freshness: number, isDarkTheme: boolean): string {
  let r = 0, g = 0, b = 0;
  if (/^#?[0-9A-Fa-f]{6}$/.test(hex)) {
    const clean = hex.replace("#", "");
    r = parseInt(clean.substring(0, 2), 16);
    g = parseInt(clean.substring(2, 4), 16);
    b = parseInt(clean.substring(4, 6), 16);
  } else if (/^#?[0-9A-Fa-f]{3}$/.test(hex)) {
    const clean = hex.replace("#", "");
    r = parseInt(clean[0] + clean[0], 16);
    g = parseInt(clean[1] + clean[1], 16);
    b = parseInt(clean[2] + clean[2], 16);
  } else {
    return hex;
  }

  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0, l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }

  h = Math.round(h * 360);
  s = Math.round(s * 100);
  l = Math.round(l * 100);

  // Desaturate older points to make them look faded
  const adjustedS = Math.round(s * (0.35 + freshness * 0.65));
  
  let adjustedL = l;
  if (isDarkTheme) {
    // Sinks into darkness (fade to dark)
    adjustedL = Math.round(l * (0.35 + freshness * 0.65));
  } else {
    // Fades into light background (fade to white/light grey)
    adjustedL = Math.round(l + (92 - l) * (0.65 * (1 - freshness)));
  }

  return `hsl(${h}, ${adjustedS}%, ${adjustedL}%)`;
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
  showDirectionArrows: boolean;
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
  showDirectionArrows,
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

    const safeCenter: [number, number] = isNaN(center[0]) || isNaN(center[1]) ? [50.866667, 4.333333] : center;

    const map = L.map(containerRef.current, {
      center: safeCenter,
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
      const latlngs: L.LatLngTuple[] = filteredReports
        .map((r) => [
          r.decrypedPayload.location.latitude,
          r.decrypedPayload.location.longitude,
        ] as L.LatLngTuple)
        .filter((ll) => !isNaN(ll[0]) && !isNaN(ll[1]));

      if (latlngs.length > 0) {
        const bounds = L.latLngBounds(latlngs);
        mapRef.current.fitBounds(bounds, {
          padding: [50, 50],
          animate: true,
          duration: 0.5,
          maxZoom: 18,
        });
      } else if (!isNaN(center[0]) && !isNaN(center[1])) {
        mapRef.current.setView(center, 18, { animate: true, duration: 0.5 });
      }
    } else if (!isNaN(center[0]) && !isNaN(center[1])) {
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

    const ticksHtml = Array.from({ length: 12 }).map((_, i) => {
      const angle = i * 30;
      const isMain = i % 3 === 0;
      const width = isMain ? "2px" : "1px";
      const height = isMain ? (isMain && i % 6 === 0 ? "7px" : "5.5px") : "4px";
      const opacity = isMain ? "0.9" : "0.55";
      const color = i === 0 
        ? deviceColor 
        : (useDarkMarkers ? "rgba(255, 255, 255, 0.85)" : "rgba(0, 0, 0, 0.5)");
      return `<div style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; transform: rotate(${angle}deg); pointer-events: none;">
        <div style="position: absolute; top: 3px; left: 50%; transform: translateX(-50%); width: ${width}; height: ${height}; background-color: ${color}; opacity: ${opacity}; border-radius: 0.5px;"></div>
      </div>`;
    }).join("");

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
      const latlngs: L.LatLngTuple[] = filteredReports
        .map((r, idx) => {
          if (absorbedIndices.has(idx) && bestClusterLoc) {
            return [bestClusterLoc.lat, bestClusterLoc.lon] as L.LatLngTuple;
          }
          return [
            r.decrypedPayload.location.latitude,
            r.decrypedPayload.location.longitude,
          ] as L.LatLngTuple;
        })
        .filter((ll) => !isNaN(ll[0]) && !isNaN(ll[1]));

      if (latlngs.length > 1) {
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

        // Draw directional arrows on segments
        if (showDirectionArrows) {
          const getBearing = (lat1: number, lon1: number, lat2: number, lon2: number) => {
            const dLon = ((lon2 - lon1) * Math.PI) / 180;
            const lat1Rad = (lat1 * Math.PI) / 180;
            const lat2Rad = (lat2 * Math.PI) / 180;
            const y = Math.sin(dLon) * Math.cos(lat2Rad);
            const x =
              Math.cos(lat1Rad) * Math.sin(lat2Rad) -
              Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLon);
            const brng = (Math.atan2(y, x) * 180) / Math.PI;
            return (brng + 360) % 360;
          };

          for (let i = 0; i < deduped.length - 1; i++) {
            const p1 = deduped[i];
            const p2 = deduped[i + 1];
            const dist = haversineM(p1[0], p1[1], p2[0], p2[1]);
            
            // Only draw arrows for long distance segments (> 100m)
            if (dist > 100) {
              const midLat = (p1[0] + p2[0]) / 2;
              const midLon = (p1[1] + p2[1]) / 2;
              const bearing = getBearing(p1[0], p1[1], p2[0], p2[1]);
              const arrowIcon = L.divIcon({
                className: "trail-arrow-marker",
                html: `<div style="transform: rotate(${bearing}deg); width: 12px; height: 12px; display: flex; align-items: center; justify-content: center; color: ${useDarkMarkers ? "rgba(255,255,255,0.7)" : deviceColor}; opacity: 0.8;">
                  <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="18 15 12 9 6 15"></polyline>
                  </svg>
                </div>`,
                iconSize: [12, 12],
                iconAnchor: [6, 6],
              });
              L.marker([midLat, midLon], { icon: arrowIcon, interactive: false }).addTo(layerGroup);
            }
          }
        }
      }
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
        
        // Guard against invalid coordinates
        if (isNaN(location.latitude) || isNaN(location.longitude)) return;

        const confidence = payload.confidence;
        const freshness = total > 1 ? idx / (total - 1) : 1;
        const fillOpacity = confidenceToOpacity(confidence);
        const radius = confidenceToRadius(confidence);

        // Main dot – sized and opaque by confidence, color saturation/lightness adjusted by freshness
        const marker = L.circleMarker(
          [location.latitude, location.longitude],
          {
            color: useDarkMarkers
              ? `rgba(255,255,255,${confidence >= 2 ? 0.4 : 0.2})`
              : `rgba(0,0,0,${confidence >= 2 ? 0.15 : 0.08})`,
            weight: confidence >= 2 ? 1 : 0.5,
            fillColor: adjustColorForFreshness(deviceColor, freshness, useDarkMarkers),
            fillOpacity,
            radius,
          }
        );

        // Confidence badge color
        const confBadgeColor = confidence === 3 ? "#22c55e" : confidence === 2 ? "#eab308" : confidence === 1 ? "#f97316" : "#ef4444";

        const date = payload.date;
        const hours = date.getHours();
        const minutes = date.getMinutes();
        const hourAngle = (hours % 12) * 30 + minutes * 0.5;
        const minuteAngle = minutes * 6;
        const day = date.getDate();
        const monthStr = date.toLocaleDateString(undefined, { month: 'short' }).toUpperCase();
        const year = date.getFullYear();
        const confLabel = confidence === 3 ? "HI" : confidence === 2 ? "MED" : "LO";

        const tooltipContent = `
          <div class="map-tooltip-card watch-face" style="border-color: ${deviceColor}; box-shadow: 0 0 15px ${deviceColor}40, inset 0 0 10px ${deviceColor}20;">
            <!-- Ticks -->
            ${ticksHtml}

            <!-- Complications -->
            <div class="watch-complication-year">${year}</div>
            <div class="watch-complication-ampm">${hours >= 12 ? 'PM' : 'AM'}</div>
            <div class="watch-complication-logo">${confLabel}</div>
            <div class="watch-complication-date">${day} ${monthStr}</div>

            <!-- Hands -->
            <div class="watch-hand watch-hand-hour" style="transform: rotate(${hourAngle}deg); background-color: ${deviceColor};"></div>
            <div class="watch-hand watch-hand-minute" style="transform: rotate(${minuteAngle}deg); background-color: ${useDarkMarkers ? "#ffffff" : "#000000"};"></div>

            <!-- Pin -->
            <div class="watch-pin" style="background-color: ${deviceColor};"></div>
          </div>
        `;

        marker.bindTooltip(tooltipContent, {
          direction: "top",
          opacity: 1,
          className: "custom-leaflet-tooltip",
          offset: [0, -10],
        });

        // Dynamic hover range coverage circle
        let hoverCircle: L.Circle | null = null;
        marker.on("tooltipopen", () => {
          if (location.accuracy > 0) {
            // Encode time/recency in the opacity of the range circle
            const opacity = 0.1 + freshness * 0.25; // 0.1 (oldest) to 0.35 (newest)
            const fillOpacity = 0.02 + freshness * 0.06; // 0.02 (oldest) to 0.08 (newest)
            hoverCircle = L.circle([location.latitude, location.longitude], {
              radius: location.accuracy,
              color: deviceColor,
              weight: 1.5,
              opacity: opacity,
              fillColor: deviceColor,
              fillOpacity: fillOpacity,
              dashArray: location.accuracy > 65 ? "6, 8" : undefined,
            });
            layerGroup.addLayer(hoverCircle);
            hoverCircle.bringToBack();
          }
        });

        marker.on("tooltipclose", () => {
          if (hoverCircle) {
            layerGroup.removeLayer(hoverCircle);
            hoverCircle = null;
          }
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

    if (mainLocation && !isNaN(mainLocation[0]) && !isNaN(mainLocation[1])) {
      // Accuracy ring — real meters, scales with zoom
      if (displayAccuracy > 0) {
        L.circle(mainLocation, {
          radius: displayAccuracy,
          color: deviceColor,
          weight: 1.5,
          opacity: 0.35,
          fillColor: deviceColor,
          fillOpacity: 0.08,
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

        const date = payload.date;
        const hours = date.getHours();
        const minutes = date.getMinutes();
        const hourAngle = (hours % 12) * 30 + minutes * 0.5;
        const minuteAngle = minutes * 6;
        const day = date.getDate();
        const monthStr = date.toLocaleDateString(undefined, { month: 'short' }).toUpperCase();
        const year = date.getFullYear();
        const confLabel = conf === 3 ? "HI" : conf === 2 ? "MED" : "LO";

        const latestTooltip = `
          <div class="map-tooltip-card watch-face" style="border-color: ${deviceColor}; box-shadow: 0 0 15px ${deviceColor}40, inset 0 0 10px ${deviceColor}20;">
            <!-- Ticks -->
            ${ticksHtml}

            <!-- Complications -->
            <div class="watch-complication-year">${year}</div>
            <div class="watch-complication-ampm">${hours >= 12 ? 'PM' : 'AM'}</div>
            <div class="watch-complication-logo">${confLabel}</div>
            <div class="watch-complication-date">${day} ${monthStr}</div>

            <!-- Hands -->
            <div class="watch-hand watch-hand-hour" style="transform: rotate(${hourAngle}deg); background-color: ${deviceColor};"></div>
            <div class="watch-hand watch-hand-minute" style="transform: rotate(${minuteAngle}deg); background-color: ${useDarkMarkers ? "#ffffff" : "#000000"};"></div>

            <!-- Pin -->
            <div class="watch-pin" style="background-color: ${deviceColor};"></div>
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
    showDirectionArrows,
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

        .map-tooltip-card.watch-face {
          position: relative;
          background-color: ${
            activeTheme === "light" || activeTheme === "streets"
              ? "rgba(255, 255, 255, 0.9)"
              : "rgba(15, 15, 15, 0.9)"
          };
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          border-radius: 50%;
          width: 104px;
          height: 104px;
          border: 2.5px solid transparent;
          box-sizing: border-box;
          overflow: hidden;
        }

        /* Complications (sub rectangles) */
        .watch-complication-year {
          position: absolute;
          top: 16px;
          left: 50%;
          transform: translateX(-50%);
          font-family: var(--font-mono, monospace);
          font-size: 8px;
          font-weight: 700;
          line-height: 1;
          color: ${useDarkMarkers ? "#ffffff" : "#000000"};
          background: ${
            activeTheme === "light" || activeTheme === "streets"
              ? "rgba(0, 0, 0, 0.03)"
              : "rgba(255, 255, 255, 0.08)"
          };
          border: 0.5px solid ${
            activeTheme === "light" || activeTheme === "streets"
              ? "rgba(0, 0, 0, 0.12)"
              : "rgba(255, 255, 255, 0.2)"
          };
          padding: 2px 4px;
          border-radius: 3px;
          letter-spacing: 0.5px;
          box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.1);
        }

        .watch-complication-ampm {
          position: absolute;
          left: 14px;
          top: 50%;
          transform: translateY(-50%);
          font-family: var(--font-mono, monospace);
          font-size: 7px;
          font-weight: 700;
          line-height: 1;
          color: ${useDarkMarkers ? "#ffffff" : "#000000"};
          background: ${
            activeTheme === "light" || activeTheme === "streets"
              ? "rgba(0, 0, 0, 0.03)"
              : "rgba(255, 255, 255, 0.08)"
          };
          border: 0.5px solid ${
            activeTheme === "light" || activeTheme === "streets"
              ? "rgba(0, 0, 0, 0.12)"
              : "rgba(255, 255, 255, 0.2)"
          };
          padding: 2px 3px;
          border-radius: 2.5px;
          letter-spacing: 0.5px;
          box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.1);
        }

        .watch-complication-logo {
          position: absolute;
          right: 14px;
          top: 50%;
          transform: translateY(-50%);
          font-family: var(--font-mono, monospace);
          font-size: 7px;
          font-weight: 700;
          line-height: 1;
          color: ${useDarkMarkers ? "rgba(255, 255, 255, 0.6)" : "rgba(0, 0, 0, 0.5)"};
          background: ${
            activeTheme === "light" || activeTheme === "streets"
              ? "rgba(0, 0, 0, 0.03)"
              : "rgba(255, 255, 255, 0.08)"
          };
          border: 0.5px solid ${
            activeTheme === "light" || activeTheme === "streets"
              ? "rgba(0, 0, 0, 0.12)"
              : "rgba(255, 255, 255, 0.2)"
          };
          padding: 2px 3px;
          border-radius: 2.5px;
          letter-spacing: 0.5px;
          box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.1);
        }

        .watch-complication-date {
          position: absolute;
          bottom: 16px;
          left: 50%;
          transform: translateX(-50%);
          font-family: var(--font-mono, monospace);
          font-size: 8px;
          font-weight: 700;
          line-height: 1;
          color: ${useDarkMarkers ? "#ffffff" : "#000000"};
          background: ${
            activeTheme === "light" || activeTheme === "streets"
              ? "rgba(0, 0, 0, 0.03)"
              : "rgba(255, 255, 255, 0.08)"
          };
          border: 0.5px solid ${
            activeTheme === "light" || activeTheme === "streets"
              ? "rgba(0, 0, 0, 0.12)"
              : "rgba(255, 255, 255, 0.2)"
          };
          padding: 2px 4px;
          border-radius: 3px;
          letter-spacing: 0.5px;
          box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.1);
        }

        /* Hands */
        .watch-hand {
          position: absolute;
          left: 50%;
          top: 50%;
          transform-origin: 50% 100%;
          border-radius: 2px;
        }

        .watch-hand-hour {
          width: 3px;
          height: 22px;
          margin-left: -1.5px;
          margin-top: -22px;
          z-index: 10;
        }

        .watch-hand-minute {
          width: 1.5px;
          height: 32px;
          margin-left: -0.75px;
          margin-top: -32px;
          z-index: 11;
        }

        /* Center Pin */
        .watch-pin {
          position: absolute;
          left: 50%;
          top: 50%;
          transform: translate(-50%, -50%);
          width: 6px;
          height: 6px;
          border-radius: 50%;
          z-index: 12;
          box-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
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
