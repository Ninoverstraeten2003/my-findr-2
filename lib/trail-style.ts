// One look for the trail on every map theme: the device colour on a white halo. The halo keeps the overlay
// readable on busy (Streets), dark and satellite maps alike, so nothing here depends on the map theme.

import type L from "leaflet";

export const TRAIL_HALO = "#ffffff";

/** Dash pattern of the trail line; its period (18 px) is what the "trail-flow" animation moves by. */
export const TRAIL_DASH = "6, 12";

/** The trail line itself (drawn on top of the casing). */
export function trailLineStyle(color: string): L.PolylineOptions {
  return { color, weight: 2.5, opacity: 0.9, dashArray: TRAIL_DASH, interactive: false, pane: "trail" };
}

/** The halo under the trail line. */
export const TRAIL_CASING: L.PolylineOptions = {
  color: TRAIL_HALO,
  weight: 6,
  opacity: 0.75,
  interactive: false,
  pane: "trail",
};

/** Faint stub where a glitch spike was routed around. */
export function spikeStubStyle(color: string): L.PolylineOptions {
  return { color, dashArray: "1, 6", weight: 1.5, opacity: 0.6, interactive: false, pane: "trail" };
}

/** Outline of report dots and accuracy shapes. */
export const DOT_OUTLINE = "rgba(255,255,255,0.95)";
export const DOT_OUTLINE_WEIGHT = 1.5;

/** CSS filter giving the direction chevrons the same halo as the line. */
export const ARROW_HALO_FILTER = `drop-shadow(0 0 1px ${TRAIL_HALO}) drop-shadow(0 0 1px ${TRAIL_HALO})`;

/** Halo under the AI chat's drawn path. */
export const AI_PATH_CASING: L.PolylineOptions = { color: TRAIL_HALO, weight: 8, opacity: 0.85, interactive: false };
