/** The studio timeline strip's series and the per-pixel envelopes it draws them from. */
import { solarElevation } from "./posture";
import type { Track } from "./track";

export interface StripSeries {
  key: string;
  label: string;
  unit: string;
  color: string;
  /** Decimals shown: whole meters and degrees, m/s to 0.01, m/s^2 to 0.1 (as the inspector labels them). */
  digits: number;
  /** Drawn with larger values lower (depth), so the trace reads like a dive profile. */
  down?: boolean;
  values: (track: Track) => ArrayLike<number> | null;
}

const hypot = (a: ArrayLike<number>, b: ArrayLike<number>, c?: ArrayLike<number>) =>
  Float32Array.from({ length: a.length }, (_, i) => Math.hypot(a[i]!, b[i]!, c ? c[i]! : 0));

export const STRIP_SERIES: StripSeries[] = [
  { key: "depth", label: "depth", unit: "m", color: "#60a5fa", digits: 0, down: true, values: (t) => t.depth },
  { key: "pitch", label: "pitch", unit: "°", color: "#f472b6", digits: 0, values: (t) => t.pitch },
  { key: "roll", label: "roll", unit: "°", color: "#a78bfa", digits: 0, values: (t) => t.roll },
  { key: "vedba", label: "VeDBA", unit: "m/s²", color: "#fbbf24", digits: 1, values: (t) => t.vedba },
  { key: "odba", label: "ODBA", unit: "m/s²", color: "#facc15", digits: 1, values: (t) => t.odba },
  { key: "speed", label: "water speed", unit: "m/s", color: "#34d399", digits: 2, values: (t) => t.speed },
  { key: "current", label: "current", unit: "m/s", color: "#2dd4bf", digits: 2, values: (t) => t.current?.speed ?? null },
  {
    key: "dynamic",
    label: "dynamic accel.",
    unit: "m/s²",
    color: "#fb923c",
    digits: 1,
    values: (t) => (t.accel ? hypot(...t.accel.dynamic) : null),
  },
];

/** The series a track has data for. */
export function availableSeries(track: Track): StripSeries[] {
  return STRIP_SERIES.filter((s) => s.values(track) != null);
}

/**
 * Min and max of `values` in each of `width` equal time columns (NaN where a column has no finite value), with the
 * finite range over the whole series. Columns are by sample index, which is uniform in time at the bundle's rate.
 */
export function envelope(values: ArrayLike<number>, width: number): { lo: Float32Array; hi: Float32Array; min: number; max: number } {
  const n = values.length;
  const lo = new Float32Array(width).fill(NaN);
  const hi = new Float32Array(width).fill(NaN);
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < n; i++) {
    const v = values[i]!;
    if (!Number.isFinite(v)) continue;
    const c = Math.min(width - 1, Math.floor((i / n) * width));
    if (!(v >= lo[c]!)) lo[c] = v; // NaN compares false, so the first value lands
    if (!(v <= hi[c]!)) hi[c] = v;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return { lo, hi, min, max };
}

/** Night spans as [start, end) column ranges: the sun below the horizon at the track's position in that column. */
export function nightColumns(track: Track, width: number): [number, number][] {
  const out: [number, number][] = [];
  let start = -1;
  for (let c = 0; c <= width; c++) {
    let night = false;
    if (c < width) {
      const i = Math.min(track.count - 1, Math.floor(((c + 0.5) / width) * track.count));
      const lat = track.lat[i]!;
      const lon = track.lon[i]!;
      night = Number.isFinite(lat) && Number.isFinite(lon) && solarElevation(lat, lon, track.manifest.t0 + track.t[i]!) < 0;
    }
    if (night && start < 0) start = c;
    if (!night && start >= 0) {
      out.push([start, c]);
      start = -1;
    }
  }
  return out;
}

/** The sample index at a fraction of the strip's width. */
export function indexAtFraction(track: Track, f: number): number {
  return Math.max(0, Math.min(track.count - 1, Math.round(f * (track.count - 1))));
}
