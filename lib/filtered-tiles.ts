// Map tiles recoloured once, when each tile loads, instead of with a CSS filter on the tile layer. A CSS filter
// is redone by the browser on every frame of a zoom or pan; with many report dots on the map it sometimes
// skipped it, so tiles showed unfiltered or washed out. Here every tile is drawn into a canvas with its pixels
// already changed, so nothing depends on the browser keeping a filter up.

import L from "leaflet";

/** Same steps as the CSS filter functions: saturate first (0 = gray), then the per-channel steps in order. */
export interface TileFilter {
  saturate: number;
  steps: (["invert"] | ["brightness", number] | ["contrast", number])[];
}

export const TILE_FILTERS = {
  // was: grayscale(1) brightness(1.06) contrast(0.82)
  light: { saturate: 0, steps: [["brightness", 1.06], ["contrast", 0.82]] },
  // was: grayscale(1) invert(1) brightness(0.8) contrast(0.85)
  dark: { saturate: 0, steps: [["invert"], ["brightness", 0.8], ["contrast", 0.85]] },
  // was: saturate(0.5) contrast(0.92) brightness(1.04)
  streets: { saturate: 0.5, steps: [["contrast", 0.92], ["brightness", 1.04]] },
} satisfies Record<string, TileFilter>;

const clamp = (v: number) => Math.min(1, Math.max(0, v));

/** Lookup table for the per-channel steps (0-255 in, 0-255 out). */
function channelTable(filter: TileFilter): Uint8ClampedArray {
  const table = new Uint8ClampedArray(256);
  for (let i = 0; i < 256; i++) {
    let v = i / 255;
    for (const step of filter.steps) {
      if (step[0] === "invert") v = 1 - v;
      else if (step[0] === "brightness") v = clamp(v * step[1]);
      else v = clamp((v - 0.5) * step[1] + 0.5);
    }
    table[i] = Math.round(v * 255);
  }
  return table;
}

function applyFilter(data: Uint8ClampedArray, filter: TileFilter, table: Uint8ClampedArray) {
  // CSS saturate() matrix; s = 0 is grayscale.
  const s = filter.saturate;
  const m = [
    0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s,
    0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s,
    0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s,
  ];
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    data[i] = table[Math.min(255, Math.max(0, Math.round(m[0] * r + m[1] * g + m[2] * b)))];
    data[i + 1] = table[Math.min(255, Math.max(0, Math.round(m[3] * r + m[4] * g + m[5] * b)))];
    data[i + 2] = table[Math.min(255, Math.max(0, Math.round(m[6] * r + m[7] * g + m[8] * b)))];
  }
}

interface FilteredTileOptions extends L.GridLayerOptions {
  url: string;
  filter: TileFilter;
}

/** A tile layer (url with {z}/{x}/{y}) whose tiles are recoloured with `filter` as they load. */
export function filteredTileLayer(options: FilteredTileOptions): L.GridLayer {
  const table = channelTable(options.filter);
  const Layer = L.GridLayer.extend({
    createTile(coords: L.Coords, done: L.DoneCallback) {
      const size = this.getTileSize();
      const canvas = document.createElement("canvas");
      canvas.width = size.x;
      canvas.height = size.y;
      const img = new Image();
      img.crossOrigin = "anonymous"; // the tile server allows it; without it the pixels can't be read
      img.onload = () => {
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) return done(undefined, canvas);
        ctx.drawImage(img, 0, 0, size.x, size.y);
        const pixels = ctx.getImageData(0, 0, size.x, size.y);
        applyFilter(pixels.data, options.filter, table);
        ctx.putImageData(pixels, 0, 0);
        done(undefined, canvas);
      };
      img.onerror = () => done(new Error("tile failed to load"), canvas);
      img.src = L.Util.template(options.url, { x: coords.x, y: coords.y, z: coords.z });
      (canvas as HTMLCanvasElement & { _img?: HTMLImageElement })._img = img;
      return canvas;
    },
  });
  const layer = new (Layer as unknown as new (o: FilteredTileOptions) => L.GridLayer)(options);
  // Stop downloading tiles that scrolled out of view or belong to a zoom level that's gone.
  layer.on("tileunload", (e: L.TileEvent) => {
    const img = (e.tile as unknown as { _img?: HTMLImageElement })._img;
    if (img && !img.complete) {
      img.onload = img.onerror = null;
      img.src = "";
    }
  });
  return layer;
}
