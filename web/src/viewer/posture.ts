/**
 * Roll posture: how far the animal is rolled from upright (0 upright, 90 on its side, 180 belly up), and how that
 * varies with depth and with day and night. This is the question behind the lab's working idea that swordfish roll
 * at depth to look upward at prey silhouetted against the dim light above; these views let the tag data confirm
 * or contradict it.
 *
 * The bundle's roll is the static (gravity) roll from the accelerometer, smoothed over a few seconds, which suits
 * posture (it changes over seconds to minutes) even though it cannot resolve fast spins (see roll.ts).
 */
import type { Track } from "./track";

const D2R = Math.PI / 180;

/** A roll angle wrapped to -180..180 (positive: right side down). */
export const wrap180 = (rollDeg: number) => ((((rollDeg + 180) % 360) + 360) % 360) - 180;

/** Degrees from upright, 0 to 180, from a wrapped roll angle (the side dropped). */
export const fromUpright = (rollDeg: number) => Math.abs(wrap180(rollDeg));

/** The q-th quantile (0 to 1) of an ascending sorted array, by linear interpolation. */
export function quantile(sorted: ArrayLike<number>, q: number): number {
  const n = sorted.length;
  if (!n) return NaN;
  const p = (n - 1) * q;
  const i = Math.floor(p);
  const f = p - i;
  return i + 1 < n ? sorted[i]! * (1 - f) + sorted[i + 1]! * f : sorted[i]!;
}

/**
 * Solar elevation (degrees) at a place and time, from the NOAA low-precision formulas (declination and the
 * equation of time); good to about a degree, which is ample for telling day from night.
 */
export function solarElevation(lat: number, lon: number, unixS: number): number {
  const days = unixS / 86400 - 10957.5; // days since 2000-01-01 12:00 UTC
  const g = (357.529 + 0.98560028 * days) * D2R; // mean anomaly
  const q = 280.459 + 0.98564736 * days; // mean longitude
  const l = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * D2R; // ecliptic longitude
  const e = (23.439 - 0.00000036 * days) * D2R; // obliquity
  const dec = Math.asin(Math.sin(e) * Math.sin(l));
  const ra = Math.atan2(Math.cos(e) * Math.sin(l), Math.cos(l)) / D2R;
  const eqTimeDeg = q - ra - 360 * Math.round((q - ra) / 360); // equation of time, in degrees of rotation
  const utcHours = ((unixS / 3600) % 24 + 24) % 24;
  const hourAngle = (utcHours * 15 + lon + eqTimeDeg - 180) * D2R;
  const sinEl = Math.sin(lat * D2R) * Math.sin(dec) + Math.cos(lat * D2R) * Math.cos(dec) * Math.cos(hourAngle);
  return Math.asin(Math.max(-1, Math.min(1, sinEl))) / D2R;
}

/** Depth bands (m) for the roll-by-depth summary: finer near the surface, where behavior changes fastest. */
const DEPTH_EDGES = [0, 25, 50, 100, 200, 300, 400, 500, 600, 700, 800, 1000, 1500, 2000];

/** Within this many degrees of upright a sample counts to neither side (small wobbles flip sign constantly). */
export const UPRIGHT_DEG = 20;

/** Roll from upright on one side (degrees), for the samples rolled past UPRIGHT_DEG to that side. */
export interface SideStats {
  /** Fraction of the bin's samples rolled past UPRIGHT_DEG to this side (right side down: positive roll). */
  share: number;
  p25: number;
  median: number;
  p75: number;
}

export interface PostureBin {
  top: number;
  bottom: number;
  period: "day" | "night";
  /** Samples in the bin (at the bundle rate). */
  n: number;
  minutes: number;
  p25: number;
  median: number;
  p75: number;
  /** Fraction of the bin's samples rolled more than 45 degrees from upright. */
  over45: number;
  /** Fraction of the bin within UPRIGHT_DEG of upright (counted to neither side). */
  upright: number;
  right: SideStats;
  left: SideStats;
}

function sideStats(signed: number[], sign: 1 | -1, total: number): SideStats {
  const v = signed
    .filter((r) => (sign > 0 ? r >= UPRIGHT_DEG : r <= -UPRIGHT_DEG))
    .map(fromUpright)
    .sort((a, b) => a - b);
  return { share: v.length / Math.max(1, total), p25: quantile(v, 0.25), median: quantile(v, 0.5), p75: quantile(v, 0.75) };
}

/** Roll from upright per depth band, split by day (sun above the horizon) and night. Empty bins are left out. */
export function postureByDepth(track: Track): PostureBin[] {
  const groups = new Map<string, number[]>(); // signed roll, wrapped to -180..180
  const t0 = track.manifest.t0;
  for (let i = 0; i < track.count; i++) {
    const d = track.depth[i]!;
    const r = track.roll[i]!;
    if (!Number.isFinite(d) || !Number.isFinite(r)) continue;
    let b = DEPTH_EDGES.findIndex((edge, k) => k > 0 && d < edge) - 1;
    if (b < 0) b = d < 0 ? 0 : DEPTH_EDGES.length - 2;
    const day = solarElevation(track.lat[i]!, track.lon[i]!, t0 + track.t[i]!) > 0;
    const key = `${b}:${day ? "day" : "night"}`;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = []));
    g.push(wrap180(r));
  }
  const out: PostureBin[] = [];
  for (const [key, signed] of groups) {
    const [b, period] = key.split(":") as [string, "day" | "night"];
    const values = signed.map(fromUpright).sort((x, y) => x - y);
    const k = Number(b);
    out.push({
      top: DEPTH_EDGES[k]!,
      bottom: DEPTH_EDGES[k + 1]!,
      period,
      n: values.length,
      minutes: values.length / Math.max(1e-6, track.manifest.rate_hz) / 60,
      p25: quantile(values, 0.25),
      median: quantile(values, 0.5),
      p75: quantile(values, 0.75),
      over45: values.filter((v) => v > 45).length / values.length,
      upright: values.filter((v) => v < UPRIGHT_DEG).length / values.length,
      right: sideStats(signed, 1, signed.length),
      left: sideStats(signed, -1, signed.length),
    });
  }
  return out.sort((a, b) => a.top - b.top || (a.period === "day" ? -1 : 1));
}
