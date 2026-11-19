/** The topobathykit DEM crop behind both the 2D basemap and the 3D terrain.
 *
 * elevation.bin is Float32 (little-endian), row-major, row 0 at the north edge, meters positive up;
 * NaN marks missing cells. meta gives the grid size and bounds [west, south, east, north] in degrees.
 */

import { resolve } from "../lib/mode";

interface DemMeta {
  width: number;
  height: number;
  bounds: [number, number, number, number];
  dx: number;
  dy: number;
  crs?: string;
  units?: string;
  policy_legend?: unknown;
}

interface Terrain {
  dataset: string;
  policy: string;
  bbox: [number, number, number, number];
  max_dim: number;
  meta_url: string;
  elevation_url: string;
}

export interface Dem {
  terrain: Terrain;
  meta: DemMeta;
  grid: Float32Array;
}

export function loadDem(depId: string, runId: string): Promise<Dem> {
  return loadDemFrom(`/api/tracks/${encodeURIComponent(depId)}/${encodeURIComponent(runId)}/terrain`);
}

/** Loads the crop a terrain endpoint names (a track's, or the overview's at /api/terrain/overview). */
export async function loadDemFrom(terrainUrl: string): Promise<Dem> {
  const tRes = await fetch(resolve(terrainUrl));
  if (!tRes.ok) throw new Error(((await tRes.json().catch(() => ({}))) as { detail?: string }).detail ?? `terrain ${tRes.status}`);
  const terrain = (await tRes.json()) as Terrain & { detail?: string };
  // A published track with no DEM carries only the reason, where the hub answers 404 with it.
  if (!terrain.meta_url) throw new Error(terrain.detail ?? "no terrain for this track");
  const [mRes, eRes] = await Promise.all([fetch(resolve(terrain.meta_url)), fetch(resolve(terrain.elevation_url))]);
  if (!mRes.ok || !eRes.ok) {
    const detail = !mRes.ok ? await mRes.text() : await eRes.text();
    throw new Error(`topobathymetry unavailable: ${detail.slice(0, 200)}`);
  }
  const meta = (await mRes.json()) as DemMeta;
  const grid = new Float32Array(await eRes.arrayBuffer());
  if (grid.length !== meta.width * meta.height) throw new Error("elevation.bin does not match its meta");
  return { terrain, meta, grid };
}

/** Elevation (m, positive up) at a point, bilinear between cell centers; NaN outside or over missing cells. */
export function elevationAt(dem: Dem, lat: number, lon: number): number {
  const { width, height, bounds } = dem.meta;
  const [w, s, e, n] = bounds;
  const fx = ((lon - w) / (e - w)) * width - 0.5;
  const fy = ((n - lat) / (n - s)) * height - 0.5;
  if (fx < 0 || fy < 0 || fx > width - 1 || fy > height - 1) return NaN;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = Math.min(x0 + 1, width - 1);
  const y1 = Math.min(y0 + 1, height - 1);
  const ax = fx - x0;
  const ay = fy - y0;
  const g = dem.grid;
  const v00 = g[y0 * width + x0]!;
  const v10 = g[y0 * width + x1]!;
  const v01 = g[y1 * width + x0]!;
  const v11 = g[y1 * width + x1]!;
  return (v00 * (1 - ax) + v10 * ax) * (1 - ay) + (v01 * (1 - ax) + v11 * ax) * ay;
}

/** The range the animal-depth colors span: 0 to `max` m, fitted to a species' tracks or to one track. */
export interface DepthScale {
  max: number;
  ticks: number[];
  basis: "species" | "track";
}

const NICE_MAX = [50, 100, 150, 200, 250, 300, 400, 500, 600, 750, 800, 1000, 1200, 1500, 2000, 2500, 3000, 4000, 5000, 6000];
const TICK_STEP = [25, 50, 100, 200, 250, 300, 400, 500, 1000, 2000];

/** A depth scale from 0 to the deepest value rounded up to a round number, with four tick intervals where a round step allows (five otherwise). */
export function depthScale(deepest: number, basis: DepthScale["basis"]): DepthScale {
  const d = Number.isFinite(deepest) && deepest > 0 ? deepest : 1;
  const max = NICE_MAX.find((n) => n >= d) ?? Math.ceil(d / 1000) * 1000;
  const fits = (n: number) => TICK_STEP.find((s) => max % s === 0 && max / s <= n);
  const step = fits(4) ?? fits(5) ?? max;
  return { max, ticks: Array.from({ length: Math.round(max / step) + 1 }, (_, k) => k * step), basis };
}

/** Color of the animal's depth (m, positive down) along a track: pale yellow at the surface to magenta at `max` m. */
export function trackDepthColor(depth: number, max = 600): [number, number, number] {
  const t = Math.min(1, Math.max(0, depth / max));
  return [0.99 * (1 - t) + 0.75 * t, 0.88 * (1 - t) + 0.15 * t, 0.28 * (1 - t) + 0.83 * t];
}

/** Color of an elevation (m): blues below sea level by depth, greens and browns above (topobathykit's ramp). */
export function elevationColor(z: number): [number, number, number] {
  if (Number.isNaN(z)) return [0.35, 0.35, 0.38];
  if (z < 0) {
    const t = Math.min(1, -z / 3000);
    return [0.55 * (1 - t) + 0.02 * t, 0.78 * (1 - t) + 0.12 * t, 0.92 * (1 - t) + 0.35 * t];
  }
  const t = Math.min(1, z / 400);
  return [0.35 + 0.4 * t, 0.55 + 0.1 * t, 0.3 + 0.1 * t];
}

/** A shaded relief image of the DEM (light from the north-west), for the 2D map. */
export function reliefCanvas(dem: Dem, exaggeration = 4): HTMLCanvasElement {
  const { width, height, bounds } = dem.meta;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(width, height);
  const latMid = (bounds[1] + bounds[3]) / 2;
  const cellX = (((bounds[2] - bounds[0]) / width) * Math.PI) / 180 * 6371000 * Math.cos((latMid * Math.PI) / 180);
  const cellY = (((bounds[3] - bounds[1]) / height) * Math.PI) / 180 * 6371000;
  const g = dem.grid;
  const L = [-0.5, 0.5, 0.707]; // light vector (west, north, up), normalized below
  const ln = Math.hypot(L[0]!, L[1]!, L[2]!);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const z = g[i]!;
      const zl = g[y * width + Math.max(0, x - 1)]!;
      const zr = g[y * width + Math.min(width - 1, x + 1)]!;
      const zu = g[Math.max(0, y - 1) * width + x]!;
      const zd = g[Math.min(height - 1, y + 1) * width + x]!;
      let shade = 1;
      if (![z, zl, zr, zu, zd].some(Number.isNaN)) {
        const dzdx = ((zr - zl) / (2 * cellX)) * exaggeration;
        const dzdy = ((zu - zd) / (2 * cellY)) * exaggeration; // north is up the image
        const nx = -dzdx;
        const ny = -dzdy;
        const nlen = Math.hypot(nx, ny, 1);
        shade = 0.35 + 0.65 * Math.max(0, (nx * L[0]! + ny * L[1]! + L[2]!) / (nlen * ln));
      }
      const [r, gg, b] = elevationColor(z);
      img.data[i * 4] = Math.round(r * shade * 255);
      img.data[i * 4 + 1] = Math.round(gg * shade * 255);
      img.data[i * 4 + 2] = Math.round(b * shade * 255);
      img.data[i * 4 + 3] = Number.isNaN(z) ? 0 : 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}
