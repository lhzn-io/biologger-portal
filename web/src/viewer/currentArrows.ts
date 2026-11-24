/**
 * Where the water flows along a track: the applied ocean current averaged over stretches of the track, for the 3D
 * view's arrows (stretches of distance, so the arrows are evenly spread along the line) and the current chart's
 * direction row (stretches of time). Directions are "toward", clockwise from north.
 */
import { towardDeg } from "./current";
import type { Track } from "./track";

export interface CurrentArrow {
  /** The sample the arrow is drawn at: the one nearest the middle of its stretch. */
  i: number;
  /** The first and last sample of the stretch it averages. */
  from: number;
  to: number;
  /** Share of the stretch's samples where the model had no value. */
  missingShare: number;
  /** Mean eastward and northward current over the stretch (m/s); speed is their vector length. */
  east: number;
  north: number;
  speed: number;
  /** Direction the water flows toward, degrees clockwise from north. */
  toward: number;
}

/** Track distances (m) the 3D view's arrows may be spaced by. */
const DISTANCE_STEPS_M = [50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000, 20000];
/** At most this many arrows along a whole track. */
export const MAX_ARROWS = 80;
/** An arrow's length never drops below this share of its full length, so weak flow still shows its direction. */
export const LENGTH_FLOOR = 0.35;
/**
 * Speed (m/s) at which an arrow reaches full length, the same on every track so lengths compare: the currents
 * ramp's first knot (a typical daily peak tidal current in Long Island Sound).
 */
export const LENGTH_FULL_M_S = 0.5;

/** The shortest step from `steps` that gives at most `max` stretches over `span`. */
export function arrowStep(span: number, max = MAX_ARROWS, steps = DISTANCE_STEPS_M): number {
  return steps.find((s) => span / s <= max) ?? steps[steps.length - 1]!;
}

/** Horizontal distance (m) along the track from its first sample, per sample. */
export function alongTrack(track: Track): Float64Array {
  const n = track.count;
  const out = new Float64Array(n);
  for (let i = 1; i < n; i++) {
    const d = Math.hypot(track.north[i]! - track.north[i - 1]!, track.east[i]! - track.east[i - 1]!);
    out[i] = out[i - 1]! + (Number.isFinite(d) ? d : 0);
  }
  return out;
}

/**
 * The vector mean of the current over stretches of `step` along `key` (time or distance, increasing per sample).
 * A stretch where the model had no value for more than half its samples, or with no samples, gets no arrow.
 */
export function stretchArrows(track: Track, key: ArrayLike<number>, step: number): CurrentArrow[] {
  const c = track.current;
  const n = track.count;
  if (!c || n < 2 || !(step > 0)) return [];
  const out: CurrentArrow[] = [];
  const start = key[0]!;
  let a = 0;
  for (let k = 0; a < n; k++) {
    const end = start + (k + 1) * step;
    let b = a;
    while (b < n && key[b]! < end) b++;
    if (b === a) continue; // a gap longer than the step
    let east = 0;
    let north = 0;
    let used = 0;
    let missing = 0;
    for (let i = a; i < b; i++) {
      if (c.missing[i]) {
        missing++;
        continue;
      }
      const e = c.east[i]!;
      const no = c.north[i]!;
      if (Number.isFinite(e) && Number.isFinite(no)) {
        east += e;
        north += no;
        used++;
      }
    }
    // A last stretch shorter than half a step is a stub: no arrow, so the line does not end on one.
    const stub = b === n && out.length > 0 && key[b - 1]! - key[a]! < step / 2;
    if (!stub && used > 0 && missing <= (b - a) / 2) {
      east /= used;
      north /= used;
      const mid = start + (k + 0.5) * step;
      let i = a;
      while (i + 1 < b && Math.abs(key[i + 1]! - mid) <= Math.abs(key[i]! - mid)) i++;
      out.push({ i, from: a, to: b - 1, missingShare: missing / (b - a), east, north, speed: Math.hypot(east, north), toward: towardDeg(east, north) });
    }
    a = b;
  }
  return out;
}

/** The 3D view's arrows: evenly spread along the track, at most MAX_ARROWS. */
export function trackArrows(track: Track): CurrentArrow[] {
  if (!track.current || track.count < 2) return [];
  const dist = alongTrack(track);
  return stretchArrows(track, dist, arrowStep(dist[track.count - 1]!));
}

/** The current chart's direction row: one arrow per `stepS` of track time (hourly by default). */
export function timeArrows(track: Track, stepS = 3600): CurrentArrow[] {
  return stretchArrows(track, track.t, stepS);
}

/** An arrow's length as a share of its full length: LENGTH_FLOOR at zero, linear to 1 at `max` and above. */
export function arrowLength(speed: number, max = LENGTH_FULL_M_S): number {
  const f = max > 0 ? Math.min(1, Math.max(0, speed / max)) : 0;
  return LENGTH_FLOOR + (1 - LENGTH_FLOOR) * f;
}
