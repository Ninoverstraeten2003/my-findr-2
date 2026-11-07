"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { DeviceReport } from "@/lib/types";
import { reportKey } from "@/lib/report-key";
import { buildTrail, type Stay } from "@/lib/trail";
import { QUALITY_LABEL, qualitySvg, type ReportQuality } from "@/lib/report-quality";
import { formatDuration } from "@/lib/format";
import { TILE_FILTERS, filteredTileLayer } from "@/lib/filtered-tiles";
import {
  AI_PATH_CASING,
  ARROW_HALO_FILTER,
  DOT_OUTLINE,
  DOT_OUTLINE_WEIGHT,
  TRAIL_CASING,
  spikeStubStyle,
  trailLineStyle,
} from "@/lib/trail-style";
import type { AiPath, TravelMode } from "@/lib/ai-tools";

// AI-drawn paths show the travel mode by line style (device color stays the only color).
const MODE_DASH: Record<TravelMode, string | undefined> = {
  car: undefined,
  bike: "10, 6",
  foot: "2, 7",
  train: "14, 6, 2, 6",
  unknown: "1, 9",
};

/** Every report dot is this size: the shape (see the legend), not the size, says how accurate it is. */
const DOT_RADIUS = 5;
const DOUBTFUL_SIZE = 14;
const LATEST_SIZE = 22;
/** A stay's duration label shows once its circle is at least this big on screen. */
const STAY_LABEL_MIN_RADIUS_PX = 10;
/** Stay labels closer than this on screen are combined into one. */
const STAY_LABEL_MERGE_PX = { x: 90, y: 22 };

const TRAIL_LANE_OFFSET_PX = 4;

/** Shifts a line a few screen pixels to the right of its direction of travel (recomputed per zoom). */
function offsetRight(map: L.Map, path: L.LatLngTuple[], px: number): L.LatLngTuple[] {
  const pts = path.map((ll) => map.latLngToLayerPoint(ll));
  const n = pts.length;
  if (n < 2) return path;
  return pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(n - 1, i + 1)];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len === 0) return path[i];
    // Screen y points down, so the right-hand normal of (dx, dy) is (-dy, dx).
    const ll = map.layerPointToLatLng(L.point(p.x + (-dy / len) * px, p.y + (dx / len) * px));
    return [ll.lat, ll.lng] as L.LatLngTuple;
  });
}

// Light, dark and streets all use the OpenStreetMap tiles (sharp up to zoom 19), recoloured as each tile loads
// (lib/filtered-tiles.ts): gray (light), gray and inverted (dark), or muted colours (streets).
const OSM_TILES = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const SATELLITE_TILES = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const MAX_ZOOM = 19;

const ATTRIBUTIONS = {
  esri: 'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community',
  osm: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
};

interface LeafletMapProps {
  /** The map zooms to fit the reports again when this changes (another device or period). */
  fitKey?: string;
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
  /** Accuracy level of each report in filteredReports (same order): sets the dot's shape, never hides it. */
  qualities?: ReportQuality[];
  /** Fly to a report and open its tooltip; nonce lets the same report be focused again. */
  focusRequest?: { key: string; nonce: number } | null;
  /** Collapse stays, route around spikes and curve the trail line (dots are unaffected). */
  simplifyTrail?: boolean;
  /** Dashes flow along the trail in the direction of travel. */
  animateTrail?: boolean;
  /** Reports are still loading: the initial zoom-to-fit waits until they're all in. */
  isLoading?: boolean;
  /** Path drawn by the AI chat (through real reports, optionally along roads). */
  aiPath?: AiPath | null;
}

export default function LeafletMap({
  fitKey,
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
  qualities,
  focusRequest,
  simplifyTrail = true,
  animateTrail = true,
  isLoading = false,
  aiPath = null,
}: LeafletMapProps) {
  const aiLayerRef = useRef<L.LayerGroup | null>(null);
  const aiRendererRef = useRef<L.Renderer | null>(null);
  const markersByKeyRef = useRef<Map<string, L.Layer>>(new Map());
  // Direction arrows live in their own layer: they're placed by screen distance, so they're redrawn on move/zoom.
  const arrowLayerRef = useRef<L.LayerGroup | null>(null);
  const arrowPathsRef = useRef<L.LatLngTuple[][]>([]);
  const drawArrowsRef = useRef<() => void>(() => {});
  // Stay duration labels: shown only where a stay's circle is big enough on screen, so redrawn on zoom.
  const stayLabelLayerRef = useRef<L.LayerGroup | null>(null);
  const staysRef = useRef<Stay[]>([]);
  const drawStayLabelsRef = useRef<() => void>(() => {});
  // Trail lines are also redrawn per zoom: in simplified mode each trip is offset a few pixels to the right of
  // travel ("keep right"), so a trip and its return along the same road show as two lanes.
  const trailLayerRef = useRef<L.LayerGroup | null>(null);
  const trailBaseRef = useRef<{
    paths: L.LatLngTuple[][];
    offset: boolean;
    style: L.PolylineOptions;
    /** Wider light line drawn under the trail on busy maps, for contrast. */
    casing?: L.PolylineOptions;
    animate?: boolean;
  }>({
    paths: [],
    offset: false,
    style: {},
  });
  const drawTrailRef = useRef<() => void>(() => {});
  // Trail lines are few, so they're SVG (dots stay on the canvas): SVG paths can be animated with CSS.
  const trailRendererRef = useRef<L.Renderer | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerGroupRef = useRef<L.LayerGroup | null>(null);
  const isProgrammaticMoveRef = useRef(false);
  const tileLayerRef = useRef<L.GridLayer | null>(null);
  /** fitKey the map last zoomed to fit; undefined until the first fit. */
  const fittedKeyRef = useRef<string | undefined>(undefined);

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
      // One canvas instead of an SVG element per dot/line: far faster with thousands of reports.
      preferCanvas: true,
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

    // Trail pane sits under the report dots (overlayPane is 400).
    // Custom panes don't catch the mouse themselves: a full-map canvas or SVG in a pane above the dots' canvas
    // (overlayPane) covered every dot, so only the latest marker (marker pane) still showed its tooltip. Only
    // interactive SVG paths in them (class leaflet-interactive) take pointer events again.
    const trailPane = map.createPane("trail");
    trailPane.style.zIndex = "390";
    trailPane.style.pointerEvents = "none";
    trailRendererRef.current = L.svg({ pane: "trail" });
    trailLayerRef.current = L.layerGroup().addTo(map);
    const layerGroup = L.layerGroup().addTo(map);
    arrowLayerRef.current = L.layerGroup().addTo(map);
    // AI path above the trail and dots' shapes, below markers and tooltips.
    const aiPane = map.createPane("aiPath");
    aiPane.style.zIndex = "450";
    aiPane.style.pointerEvents = "none";
    // SVG, not the default canvas: a canvas can't let hovers through to the dots under it.
    aiRendererRef.current = L.svg({ pane: "aiPath" });
    aiLayerRef.current = L.layerGroup().addTo(map);
    // Stay labels above the dots, below markers and tooltips; never in the way of the mouse.
    const stayLabelPane = map.createPane("stayLabels");
    stayLabelPane.style.zIndex = "420";
    stayLabelPane.style.pointerEvents = "none";
    stayLabelLayerRef.current = L.layerGroup().addTo(map);
    const redrawStayLabels = () => drawStayLabelsRef.current();
    map.on("zoomend", redrawStayLabels);
    const redrawTrail = () => drawTrailRef.current();
    const redrawArrows = () => drawArrowsRef.current();
    map.on("zoomend", redrawTrail);
    map.on("moveend", redrawArrows);

    mapRef.current = map;
    layerGroupRef.current = layerGroup;
    
    // Invalidate size on mount if visible
    if (isVisible) {
       map.invalidateSize();
    }

    // Leaflet only re-measures on window resize. When the container changes size any other way (phone rotation,
    // browser bars, a resize while the map was hidden), tiles and the canvas kept covering the old size and the
    // rest stayed blank. Re-measure whenever the container itself changes; skip while it's hidden (0 x 0).
    const resizeObserver = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) map.invalidateSize({ debounceMoveend: true });
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      map.off("movestart", handleMoveStart);
      map.off("moveend", handleMoveEnd);
      map.off("zoomend", redrawTrail);
      map.off("moveend", redrawArrows);
      map.off("zoomend", redrawStayLabels);
      map.remove();
      mapRef.current = null;
      layerGroupRef.current = null;
      arrowLayerRef.current = null;
      aiLayerRef.current = null;
      trailLayerRef.current = null;
      stayLabelLayerRef.current = null;
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

  // The delayed fit must use the reports as they are when it runs, not when it was scheduled.
  const fitRef = useRef(fitMapToState);
  fitRef.current = fitMapToState;

  // Only auto-fit on initial load / device or period switch, not on poll updates
  useEffect(() => {
    if (fittedKeyRef.current === (fitKey ?? "")) return; // Already fitted for this device and period
    if (filteredReports.length === 0) return; // No data yet
    if (isLoading) return; // Wait until every report is in, so the zoom covers all of them

    if (isVisible) {
      setTimeout(() => fitRef.current(), 100);
    } else {
      fitMapToState();
    }
    fittedKeyRef.current = fitKey ?? "";
  }, [fitMapToState, zoom, isVisible, filteredReports.length, isLoading, fitKey]);

  // Handle Map Theme
  useEffect(() => {
    if (!mapRef.current) return;

    if (tileLayerRef.current) {
      tileLayerRef.current.remove();
    }

    const layer =
      activeTheme === "satellite"
        ? L.tileLayer(SATELLITE_TILES, { attribution: ATTRIBUTIONS.esri, maxZoom: MAX_ZOOM })
        : filteredTileLayer({
            url: OSM_TILES,
            filter: TILE_FILTERS[activeTheme],
            attribution: ATTRIBUTIONS.osm,
            maxZoom: MAX_ZOOM,
          });
    layer.addTo(mapRef.current);
    tileLayerRef.current = layer;
  }, [activeTheme]);

  // Update markers/polylines when data changes
  useEffect(() => {
    const layerGroup = layerGroupRef.current;
    if (!layerGroup) return;

    layerGroup.clearLayers();
    markersByKeyRef.current.clear();

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

    // --- Latest cluster: reports near the latest one merge into the latest marker ---
    const absorbedIndices = new Set<number>();
    let bestIdx = -1;
    let latestReport: (typeof filteredReports)[number] | null = null;

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

    /** Clock face showing when the report was seen, plus a line with its accuracy level (see the legend). */
    const reportTooltip = (date: Date, quality: ReportQuality | undefined, extra = "") => {
      const hours = date.getHours();
      const minutes = date.getMinutes();
      const hourAngle = (hours % 12) * 30 + minutes * 0.5;
      const minuteAngle = minutes * 6;
      const day = date.getDate();
      const monthStr = date.toLocaleDateString(undefined, { month: "short" }).toUpperCase();
      const qualityLine = quality
        ? `<div class="map-tip map-tip-compact"><span class="map-tip-title">${QUALITY_LABEL[quality.level]}</span> · ${quality.why}${extra}</div>`
        : "";
      return `
        <div class="map-tooltip-card watch-face" style="border-color: ${deviceColor}; box-shadow: 0 0 15px ${deviceColor}40, inset 0 0 10px ${deviceColor}20;">
          ${ticksHtml}
          <div class="watch-complication-year">${date.getFullYear()}</div>
          <div class="watch-complication-ampm">${hours >= 12 ? "PM" : "AM"}</div>
          <div class="watch-complication-date">${day} ${monthStr}</div>
          <div class="watch-hand watch-hand-hour" style="transform: rotate(${hourAngle}deg); background-color: ${deviceColor};"></div>
          <div class="watch-hand watch-hand-minute" style="transform: rotate(${minuteAngle}deg); background-color: ${useDarkMarkers ? "#ffffff" : "#000000"};"></div>
          <div class="watch-pin" style="background-color: ${deviceColor};"></div>
        </div>
        ${qualityLine}
      `;
    };

    if (showHistory && filteredReports.length > 0) {
      latestReport = filteredReports[filteredReports.length - 1];
      const latestLoc = latestReport.decrypedPayload.location;
      const searchRadius = Math.max(latestLoc.accuracy, 30); // at least 30m radius

      filteredReports.forEach((report, idx) => {
        const loc = report.decrypedPayload.location;
        if (haversineM(latestLoc.latitude, latestLoc.longitude, loc.latitude, loc.longitude) <= searchRadius) {
          absorbedIndices.add(idx);
        }
      });

      // The marker sits on the best of them: highest confidence first, then the smallest accuracy radius.
      let bestScore = -Infinity;
      for (const idx of absorbedIndices) {
        const p = filteredReports[idx].decrypedPayload;
        const score = p.confidence * 1000 + (255 - p.location.accuracy);
        if (score > bestScore) {
          bestScore = score;
          bestIdx = idx;
        }
      }
    }
    const best = bestIdx >= 0 ? filteredReports[bestIdx].decrypedPayload.location : null;

    // Trail line. Order is always true seen-time order; "simplify" only changes how the line is routed
    // (stays collapsed, spikes routed around, curves). Every dot is still drawn below.
    // Same style on every map theme (lib/trail-style.ts).
    const trailPaths: L.LatLngTuple[][] = [];
    const stays: Stay[] = [];

    if (showHistory && filteredReports.length > 1 && simplifyTrail) {
      const valid = filteredReports
        .map((r, i) => ({ p: r.decrypedPayload, doubtful: qualities?.[i]?.level === "doubtful" }))
        .filter(({ p }) => !isNaN(p.location.latitude) && !isNaN(p.location.longitude));
      // The line skips doubtful reports (their marks stay) and doesn't end at a doubtful latest location.
      const skip = new Set(valid.flatMap((v, k) => (v.doubtful ? [k] : [])));
      const bestDoubtful = bestIdx >= 0 && qualities?.[bestIdx]?.level === "doubtful";
      const trail = buildTrail(
        valid.map(({ p }) => ({
          lat: p.location.latitude,
          lon: p.location.longitude,
          acc: p.location.accuracy,
          t: new Date(p.date).getTime(),
        })),
        best && !bestDoubtful ? [best.latitude, best.longitude] : undefined,
        skip,
      );

      // Stay areas: where the tag sat still, drawn in real metres under the dots; their duration is labelled
      // on the map (drawStayLabels) and the tooltip gives the times.
      const fmtTime = (ms: number) => new Date(ms).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
      for (const stay of trail.stays) {
        stays.push(stay);
        L.circle(stay.center, {
          radius: stay.radiusM,
          color: deviceColor,
          weight: 1.5,
          opacity: 0.6,
          dashArray: "2, 5",
          fillColor: deviceColor,
          fillOpacity: 0.06,
          // Same pane (canvas) as the dots and added before them: hovering an empty part of the stay reaches it,
          // a dot on top still wins. In a lower pane the dots' full-map canvas swallowed every hover.
        })
          .bindTooltip(
            `<div class="map-tip"><div class="map-tip-title">Stayed ${formatDuration(stay.end - stay.start)}</div>` +
              `<div class="map-tip-detail">${fmtTime(stay.start)} – ${fmtTime(stay.end)}<br/>${stay.indices.length} reports, most within ~${Math.round(stay.radiusM)} m</div></div>`,
            { direction: "top", opacity: 1, className: "custom-leaflet-tooltip", sticky: true },
          )
          .addTo(layerGroup);
      }

      trailPaths.push(...trail.paths);
      // Spikes keep a faint stub so they're still connected, without dragging the line out and back.
      for (const stub of trail.spikeStubs) {
        L.polyline(stub, spikeStubStyle(deviceColor)).addTo(layerGroup);
      }
    } else if (showHistory && filteredReports.length > 1) {
      // Raw trail: every report in order; absorbed dots snap to the cluster location.
      const latlngs: L.LatLngTuple[] = filteredReports
        .map((r, idx) => {
          if (absorbedIndices.has(idx) && best) return [best.latitude, best.longitude] as L.LatLngTuple;
          return [r.decrypedPayload.location.latitude, r.decrypedPayload.location.longitude] as L.LatLngTuple;
        })
        .filter((ll) => !isNaN(ll[0]) && !isNaN(ll[1]));

      // Deduplicate consecutive identical points to keep the line clean
      const deduped: L.LatLngTuple[] = latlngs.length ? [latlngs[0]] : [];
      for (let i = 1; i < latlngs.length; i++) {
        if (latlngs[i][0] !== latlngs[i - 1][0] || latlngs[i][1] !== latlngs[i - 1][1]) {
          deduped.push(latlngs[i]);
        }
      }
      if (deduped.length > 1) trailPaths.push(deduped);
    }
    trailBaseRef.current = {
      paths: trailPaths,
      offset: simplifyTrail,
      style: trailLineStyle(deviceColor),
      casing: TRAIL_CASING,
      animate: animateTrail,
    };
    drawTrailRef.current();
    staysRef.current = stays;
    drawStayLabelsRef.current();

    // Report dots: all the same size and opacity in the device colour; only the shape says how accurate the
    // report is (see the legend). Reports merged into the latest marker aren't drawn separately.
    if (showHistory && filteredReports.length > 0) {
      filteredReports.forEach((report, idx) => {
        if (absorbedIndices.has(idx)) return;

        const { decrypedPayload: payload } = report;
        const { location } = payload;
        if (isNaN(location.latitude) || isNaN(location.longitude)) return;

        const key = reportKey(report);
        const quality = qualities?.[idx];
        const level = quality?.level ?? "reliable";
        const at: L.LatLngTuple = [location.latitude, location.longitude];

        // Dots and rings are on the canvas (fast with thousands); the few doubtful ones are crosses (DOM).
        let marker: L.CircleMarker | L.Marker;
        if (level === "doubtful") {
          marker = L.marker(at, {
            icon: L.divIcon({
              className: "quality-mark",
              html: qualitySvg("doubtful", deviceColor, DOUBTFUL_SIZE, DOT_OUTLINE),
              iconSize: [DOUBTFUL_SIZE, DOUBTFUL_SIZE],
              iconAnchor: [DOUBTFUL_SIZE / 2, DOUBTFUL_SIZE / 2],
            }),
            keyboard: false,
          });
        } else if (level === "approximate") {
          marker = L.circleMarker(at, {
            radius: DOT_RADIUS,
            color: deviceColor,
            weight: 2.5,
            fillColor: DOT_OUTLINE,
            fillOpacity: 0.85,
          });
        } else {
          marker = L.circleMarker(at, {
            radius: DOT_RADIUS,
            color: DOT_OUTLINE,
            weight: DOT_OUTLINE_WEIGHT,
            fillColor: deviceColor,
            fillOpacity: 0.9,
          });
        }
        markersByKeyRef.current.set(key, marker);

        // Built only when the tooltip opens, not upfront for every dot.
        marker.bindTooltip(() => reportTooltip(payload.date, quality), {
          direction: "top",
          opacity: 1,
          className: "custom-leaflet-tooltip",
          offset: [0, -10],
        });

        // While hovered, the report's accuracy radius in real metres.
        let hoverCircle: L.Circle | null = null;
        marker.on("tooltipopen", () => {
          if (location.accuracy > 0) {
            hoverCircle = L.circle(at, {
              radius: location.accuracy,
              color: deviceColor,
              weight: 1.5,
              opacity: 0.3,
              fillColor: deviceColor,
              fillOpacity: 0.06,
              dashArray: location.accuracy > 65 ? "6, 8" : undefined,
              interactive: false,
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

    // Latest location marker — at the best report of the latest cluster, in that report's shape.
    let mainLocation: [number, number] | undefined;
    let displayAccuracy = 100;

    if (showHistory && best) {
      mainLocation = [best.latitude, best.longitude];
      displayAccuracy = best.accuracy;
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
          interactive: false, // only a visual range; hovers pass through to the stay underneath
        }).addTo(layerGroup);
      }

      const bestQuality = bestIdx >= 0 ? qualities?.[bestIdx] : undefined;
      const latestLevel = bestQuality?.level ?? "reliable";
      const centre =
        latestLevel === "reliable"
          ? `<div style="position: relative; width: 100%; height: 100%; background-color: ${deviceColor}; border: 2px solid white; border-radius: 50%; box-shadow: 0 0 12px ${deviceColor}; z-index: 2;"></div>`
          : `<div style="position: relative; z-index: 2; width: 100%; height: 100%; filter: drop-shadow(0 0 6px ${deviceColor});">${qualitySvg(latestLevel, deviceColor, LATEST_SIZE)}</div>`;
      const icon = L.divIcon({
        className: "custom-location-marker",
        html: `<div style="position: relative; width: 100%; height: 100%;">
          <div style="position: absolute; inset: 0; border-radius: 50%; background-color: ${deviceColor}; opacity: 0.6; animation: map-pulse 2s infinite;"></div>
          ${centre}
        </div>`,
        iconSize: [LATEST_SIZE, LATEST_SIZE],
        iconAnchor: [LATEST_SIZE / 2, LATEST_SIZE / 2],
      });

      const marker = L.marker(mainLocation, { icon });

      // Tooltip — the latest report's time, the best report's accuracy level.
      if (latestReport && bestIdx >= 0) {
        const merged = absorbedIndices.size > 1 ? `<br/>Combined from ${absorbedIndices.size} nearby reports` : "";
        marker.bindTooltip(reportTooltip(latestReport.decrypedPayload.date, bestQuality, merged), {
          direction: "top",
          opacity: 1,
          className: "custom-leaflet-tooltip",
          offset: [0, -10],
        });
      }

      marker.addTo(layerGroup);
      // Reports merged into the latest marker focus that marker.
      for (const idx of absorbedIndices) {
        markersByKeyRef.current.set(reportKey(filteredReports[idx]), marker);
      }
    }

    drawArrowsRef.current();
  }, [
    filteredReports,
    guessedLocation,
    deviceColor,
    showHistory,
    showDirectionArrows,
    useDarkMarkers,
    onCopyLocation,
    qualities,
    simplifyTrail,
    activeTheme,
    animateTrail,
  ]);

  // Each stay gets a label with how long it lasted, above its circle, once the circle is big enough on screen to
  // tell which stay it belongs to (redrawn on zoom). Stays whose labels would overlap (the same place visited
  // again, or places close together at this zoom) share one label.
  drawStayLabelsRef.current = () => {
    const map = mapRef.current;
    const layer = stayLabelLayerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    if (!showHistory) return;
    const groups: { top: L.LatLng; px: L.Point; stays: Stay[] }[] = [];
    for (const stay of staysRef.current) {
      const top = L.latLng(stay.center[0] + stay.radiusM / 111_320, stay.center[1]);
      const px = map.latLngToLayerPoint(top);
      if (px.distanceTo(map.latLngToLayerPoint(L.latLng(stay.center))) < STAY_LABEL_MIN_RADIUS_PX) continue;
      const near = groups.find((g) => Math.abs(g.px.x - px.x) < STAY_LABEL_MERGE_PX.x && Math.abs(g.px.y - px.y) < STAY_LABEL_MERGE_PX.y);
      if (near) near.stays.push(stay);
      else groups.push({ top, px, stays: [stay] });
    }
    for (const g of groups) {
      const durations = g.stays.map((st) => st.end - st.start);
      const text =
        durations.length <= 2
          ? durations.map(formatDuration).join(" · ")
          : `${durations.length} stays · ${formatDuration(durations.reduce((a, b) => a + b, 0))}`;
      L.marker(g.top, {
        interactive: false,
        keyboard: false,
        pane: "stayLabels",
        icon: L.divIcon({
          className: "stay-label-marker",
          html: `<span class="stay-label" style="border-color: ${deviceColor};">${text}</span>`,
          iconSize: [0, 0],
        }),
      }).addTo(layer);
    }
  };

  drawTrailRef.current = () => {
    const map = mapRef.current;
    const layer = trailLayerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    const { paths, offset, style, casing, animate } = trailBaseRef.current;
    const drawn = offset ? paths.map((p) => offsetRight(map, p, TRAIL_LANE_OFFSET_PX)) : paths;
    const renderer = trailRendererRef.current ?? undefined;
    if (casing) for (const p of drawn) L.polyline(p, { ...casing, renderer }).addTo(layer);
    // "trail-flow" moves the dashes forward along the line (CSS below), i.e. in the direction of travel.
    for (const p of drawn) L.polyline(p, { ...style, renderer, className: animate ? "trail-flow" : undefined }).addTo(layer);
    arrowPathsRef.current = drawn;
  };

  // Direction arrows spaced by screen distance (~every 80 px along the line), only where the map is visible.
  drawArrowsRef.current = () => {
    const map = mapRef.current;
    const layer = arrowLayerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    if (!showDirectionArrows || !showHistory) return;

    const SPACING_PX = 80;
    const MIN_PATH_PX = 40;
    const MAX_ARROWS = 300;
    const view = map.getBounds().pad(0.1);
    let placed = 0;

    for (const path of arrowPathsRef.current) {
      const px = path.map((ll) => map.latLngToLayerPoint(ll));
      const segLen: number[] = [];
      let total = 0;
      for (let i = 1; i < px.length; i++) {
        const d = px[i].distanceTo(px[i - 1]);
        segLen.push(d);
        total += d;
      }
      if (total < MIN_PATH_PX) continue;

      // Short paths get one arrow in the middle; longer ones one every SPACING_PX, centred.
      const count = Math.max(1, Math.floor(total / SPACING_PX));
      const offset = (total - (count - 1) * SPACING_PX) / 2;
      let seg = 0;
      let segStart = 0;
      for (let k = 0; k < count && placed < MAX_ARROWS; k++) {
        const target = count === 1 ? total / 2 : offset + k * SPACING_PX;
        while (seg < segLen.length - 1 && segStart + segLen[seg] < target) {
          segStart += segLen[seg];
          seg++;
        }
        const a = px[seg];
        const b = px[seg + 1];
        const f = segLen[seg] > 0 ? (target - segStart) / segLen[seg] : 0;
        const at = L.point(a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f);
        const latlng = map.layerPointToLatLng(at);
        if (!view.contains(latlng)) continue;
        // Chevron points up; rotate to the screen direction of travel.
        const angle = (Math.atan2(b.x - a.x, -(b.y - a.y)) * 180) / Math.PI;
        L.marker(latlng, {
          interactive: false,
          keyboard: false,
          icon: L.divIcon({
            className: "trail-arrow-marker",
            html: `<div style="transform: rotate(${angle}deg); width: 12px; height: 12px; display: flex; align-items: center; justify-content: center; color: ${deviceColor}; filter: ${ARROW_HALO_FILTER};">
              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="18 15 12 9 6 15"></polyline>
              </svg>
            </div>`,
            iconSize: [12, 12],
            iconAnchor: [6, 6],
          }),
        }).addTo(layer);
        placed++;
      }
    }
  };

  // Draw the AI chat's path and zoom to it.
  useEffect(() => {
    const map = mapRef.current;
    const layer = aiLayerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    if (!aiPath || aiPath.legs.length === 0) return;
    const renderer = aiRendererRef.current ?? undefined;
    const all: L.LatLngTuple[] = [];
    for (const leg of aiPath.legs) {
      L.polyline(leg.coords, { ...AI_PATH_CASING, pane: "aiPath", renderer }).addTo(layer);
      L.polyline(leg.coords, {
        pane: "aiPath",
        renderer,
        color: deviceColor,
        weight: 4,
        opacity: 0.95,
        dashArray: MODE_DASH[leg.mode],
        lineCap: "round",
      })
        .bindTooltip(`<div class="map-tip"><div class="map-tip-title">${aiPath.title.replace(/</g, "&lt;")}</div><div class="map-tip-detail">${leg.label.replace(/</g, "&lt;")}</div></div>`, {
          sticky: true,
          opacity: 1,
          className: "custom-leaflet-tooltip",
        })
        .addTo(layer);
      all.push(...leg.coords);
    }
    if (all.length > 1) map.flyToBounds(L.latLngBounds(all), { padding: [60, 60], duration: 0.6, maxZoom: 17 });
  }, [aiPath, deviceColor]);

  // Fly to a report picked in the location list and open its tooltip.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !focusRequest) return;
    const layer = markersByKeyRef.current.get(focusRequest.key) as (L.Marker | L.CircleMarker) | undefined;
    if (!layer) return;
    const target = layer.getLatLng();
    map.flyTo(target, Math.max(map.getZoom(), 16), { duration: 0.6 });
    map.once("moveend", () => {
      layer.openTooltip();
      // Opened without a hover, so no mouse-out will close it: the next click or move on the map does.
      const close = () => {
        layer.closeTooltip();
        map.off("click movestart", close);
      };
      map.on("click movestart", close);
    });
  }, [focusRequest]);


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
          /* Shown while tiles load: roughly the colour of each theme's water/background. */
          background-color: ${
            activeTheme === "streets" ? "#aad3df" : activeTheme === "light" ? "#d6d6d6" : "#191a1a"
          } !important;
        }
        /* Direction of travel: the trail's dashes (6 on, 12 off = 18 px) flow toward the line's end. */
        .trail-flow {
          animation: trail-flow 1.1s linear infinite;
        }
        @keyframes trail-flow {
          from { stroke-dashoffset: 0; }
          to { stroke-dashoffset: -18; }
        }
        @media (prefers-reduced-motion: reduce) {
          .trail-flow { animation: none; }
        }
        @keyframes map-pulse {
          0% { transform: scale(1); opacity: 0.6; }
          70% { transform: scale(3); opacity: 0; }
          100% { transform: scale(3); opacity: 0; }
        }
        /* Zoom buttons: the same opaque surface as the other map controls (.map-surface). */
        .leaflet-bar {
          border: 1px solid hsl(var(--border)) !important;
          box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1) !important;
        }
        .leaflet-bar a {
          background-color: hsl(var(--card)) !important;
          color: hsl(var(--card-foreground)) !important;
          border-color: hsl(var(--border)) !important;
        }
        .leaflet-bar a:hover {
          background-color: hsl(var(--accent)) !important;
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

        /* Accuracy shapes drawn as markers (doubtful crosses) */
        .leaflet-div-icon.quality-mark {
          background: transparent;
          border: none;
        }
        .quality-mark svg { display: block; }
        /* Stay duration labels, centred just above each stay's circle */
        .leaflet-div-icon.stay-label-marker {
          background: transparent;
          border: none;
        }
        .stay-label {
          position: absolute;
          left: 0;
          bottom: 2px;
          transform: translateX(-50%);
          white-space: nowrap;
          padding: 1px 6px;
          border-radius: 9999px;
          border: 1.5px solid;
          font-size: 11px;
          font-weight: 600;
          line-height: 16px;
          color: hsl(var(--card-foreground));
          background-color: hsl(var(--card));
          box-shadow: 0 1px 3px rgb(0 0 0 / 0.25);
        }
        /* Small text tooltips (stays, the AI path, the accuracy line under a report's clock face) */
        .map-tip {
          margin: 6px auto 0;
          width: 190px;
          max-width: 70vw;
          padding: 6px 8px;
          border-radius: 8px;
          font-size: 11px;
          line-height: 1.3;
          white-space: normal;
          color: hsl(var(--card-foreground));
          background-color: hsl(var(--card));
          border: 1px solid hsl(var(--border));
        }
        .map-tip-compact { width: auto; max-width: 220px; text-align: center; }
        .map-tip-title { font-weight: 600; }
        .map-tip-detail { opacity: 0.7; font-size: 10px; }

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
             className="absolute bottom-24 right-4 z-[999] p-2 rounded-lg shadow-lg transition-all duration-200 hover:scale-105 active:scale-95 map-surface"
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
