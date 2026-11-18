/** The applied ocean current as the 3D view's track color and in the readout: scale, color ramp, direction. */
import { LINE_POINTS, segmentMeans } from "./activity";
import { strideIndices, type Track } from "./track";

export interface CurrentScale {
  max: number;
  ticks: number[];
  /** About how many seconds each drawn stretch averages. */
  stretch_s: number;
  /** The ocean model the current came from, when the bundle names it. */
  donor: string | null;
}

/** Display names for forcingkit's ocean donors. */
const DONOR_NAMES: Record<string, string> = { necofs: "NECOFS", hycom: "HYCOM", doppio: "DOPPIO" };

export function donorName(donor: string | null): string {
  return donor ? (DONOR_NAMES[donor] ?? donor) : "an ocean model";
}

/**
 * A scale for the track's current colors: 0 to the 98th percentile of the stretch means, rounded up to a step of
 * 0.05, 0.1 or 0.25 m/s chosen so the legend has at most 5 ticks (colors saturate past it). Null when the bundle has
 * no current.
 */
export function currentScale(track: Track): CurrentScale | null {
  const c = track.current;
  if (!c) return null;
  const idx = strideIndices(track.count, LINE_POINTS);
  const means = Array.from(segmentMeans(c.speed, idx))
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  if (!means.length) return null;
  const p98 = means[Math.floor(0.98 * (means.length - 1))]!;
  const step = [0.05, 0.1, 0.25, 0.5, 1].find((s) => Math.ceil(p98 / s - 1e-9) <= 4) ?? 1;
  const max = Math.max(step, Math.ceil(p98 / step - 1e-9) * step);
  const ticks = Array.from({ length: Math.round(max / step) + 1 }, (_, k) => Number((k * step).toFixed(2)));
  const stretch_s = idx.length > 1 ? (idx[1]! - idx[0]!) / track.manifest.rate_hz : 1 / track.manifest.rate_hz;
  return { max: Number(max.toFixed(2)), ticks, stretch_s, donor: c.donor };
}

// Light to dark in greens, apart from the blue terrain, the yellow-magenta depth ramp and the yellow-violet ODBA ramp.
const RAMP: [number, [number, number, number]][] = [
  [0, [0.9, 0.97, 0.82]],
  [0.5, [0.3, 0.72, 0.42]],
  [1, [0.02, 0.3, 0.2]],
];

/** Color of a current speed: pale green at 0 to dark green at `max` and above; gray where the model had none. */
export function currentColor(v: number, max: number): [number, number, number] {
  if (!Number.isFinite(v)) return [0.6, 0.6, 0.6];
  const t = Math.min(1, Math.max(0, v / max));
  const k = t <= RAMP[1]![0] ? 0 : 1;
  const [t0, c0] = RAMP[k]!;
  const [t1, c1] = RAMP[k + 1]!;
  const f = (t - t0) / (t1 - t0);
  return [c0[0] + (c1[0] - c0[0]) * f, c0[1] + (c1[1] - c0[1]) * f, c0[2] + (c1[2] - c0[2]) * f];
}

/** The direction a current flows toward, degrees clockwise from north (oceanographic convention). */
export function towardDeg(east: number, north: number): number {
  return ((Math.atan2(east, north) * 180) / Math.PI + 360) % 360;
}
