/** ODBA as the 3D view's track color: a mean per drawn stretch, a scale, and a color ramp. */
import { strideIndices, type Track } from "./track";

/** Samples the 3D view draws the track with (an even stride through the record). */
export const LINE_POINTS = 6000;

/**
 * Mean of `values` over each drawn stretch, from one drawn sample up to the next, ignoring NaN. The line is drawn
 * through every Nth sample (about every 36 s for a 2.5-day record at 1 Hz); a mean counts every sample between, so
 * the color neither misses bursts nor turns on whichever second happens to be drawn.
 */
export function segmentMeans(values: Float32Array, idx: number[]): Float32Array {
  const out = new Float32Array(idx.length);
  for (let k = 0; k < idx.length; k++) {
    const a = idx[k]!;
    const b = k + 1 < idx.length ? idx[k + 1]! : a + 1;
    let sum = 0;
    let n = 0;
    for (let i = a; i < b; i++) {
      const v = values[i]!;
      if (Number.isFinite(v)) {
        sum += v;
        n++;
      }
    }
    out[k] = n ? sum / n : NaN;
  }
  return out;
}

export interface ActivityScale {
  max: number;
  ticks: number[];
  unit: string;
  /** About how many seconds each drawn stretch averages. */
  stretch_s: number;
}

const STEPS = [1, 2, 2.5, 5];

function niceStep(x: number): number {
  const e = 10 ** Math.floor(Math.log10(x));
  return (STEPS.find((s) => s * e >= x * (1 - 1e-9)) ?? 10) * e;
}

/**
 * A scale for the track's ODBA colors: 0 to the 98th percentile of the stretch means, rounded up to a round step
 * (colors saturate past it, so a few bursts do not wash out the rest). Null when the bundle has no ODBA.
 */
export function odbaScale(track: Track): ActivityScale | null {
  if (!track.odba) return null;
  const idx = strideIndices(track.count, LINE_POINTS);
  const means = Array.from(segmentMeans(track.odba, idx))
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  if (!means.length) return null;
  const p98 = means[Math.floor(0.98 * (means.length - 1))]!;
  const step = niceStep(p98 > 0 ? p98 / 4 : 0.25);
  const max = Math.max(step, Math.ceil(p98 / step - 1e-9) * step);
  const ticks = Array.from({ length: Math.round(max / step) + 1 }, (_, k) => Number((k * step).toPrecision(6)));
  const stretch_s = idx.length > 1 ? (idx[1]! - idx[0]!) / track.manifest.rate_hz : 1 / track.manifest.rate_hz;
  return { max: Number(max.toPrecision(6)), ticks, unit: track.units.odba || track.units.vedba || "m/s^2", stretch_s };
}

// Light to dark, like the depth ramp: the bursts, the part worth seeing, stand out dark against the light seafloor.
const RAMP: [number, [number, number, number]][] = [
  [0, [0.99, 0.93, 0.55]],
  [0.5, [0.87, 0.3, 0.25]],
  [1, [0.23, 0.07, 0.43]],
];

/** Color of a body-acceleration value: pale yellow at 0, through red-orange, to dark violet at `max` and above. */
export function activityColor(v: number, max: number): [number, number, number] {
  if (!Number.isFinite(v)) return [0.6, 0.6, 0.6];
  const t = Math.min(1, Math.max(0, v / max));
  const k = t <= RAMP[1]![0] ? 0 : 1;
  const [t0, c0] = RAMP[k]!;
  const [t1, c1] = RAMP[k + 1]!;
  const f = (t - t0) / (t1 - t0);
  return [c0[0] + (c1[0] - c0[0]) * f, c0[1] + (c1[1] - c0[1]) * f, c0[2] + (c1[2] - c0[2]) * f];
}
