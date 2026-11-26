/**
 * Full-rate track near the animal when zoomed in. The 3D view draws each track through every Nth sample (LINE_POINTS
 * in all: one every 26 s for a 44-hour record at 1 Hz), which turns a minute of tight turning into a few straight
 * chords. Once the path over one stride spans a few pixels at the animal, the stretch around the cursor is
 * drawn through every sample instead; elsewhere the line keeps its stride. Each track decides for itself, from that
 * size where its own animal is, so a track far in the background keeps its stride while the one in front is refined.
 */

/** Seconds of track drawn at full rate either side of the cursor. */
export const DETAIL_HALF_S = 900;
/** The full-rate stretch is drawn once the path over one stride spans this many pixels at the animal... */
export const DETAIL_ON_PX = 6;
/** ...and dropped once it spans fewer than this (the gap keeps it from flickering at the threshold). */
export const DETAIL_OFF_PX = 4;

/** A stretch drawn at full rate: sample indices, both on the stride so the line joins without a kink. */
export interface DetailWindow {
  lo: number;
  hi: number;
}

/**
 * Whether to draw the full-rate stretch, given whether it is drawn now and the size on screen (px) of the path over
 * one stride.
 */
export function wantDetail(on: boolean, pathPx: number): boolean {
  if (!Number.isFinite(pathPx)) return on;
  return on ? pathPx >= DETAIL_OFF_PX : pathPx >= DETAIL_ON_PX;
}

/** The first position in sorted `a` whose value is at least `v` (a.length when none is). */
function lowerBound(a: number[], v: number): number {
  let lo = 0;
  let hi = a.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (a[mid]! < v) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** The stretch `half` samples either side of sample `center`, widened out to the nearest drawn samples. */
export function detailWindow(stride: number[], center: number, half: number): DetailWindow {
  const last = stride[stride.length - 1]!;
  const a = lowerBound(stride, center - half);
  const lo = a < stride.length && stride[a] === center - half ? stride[a]! : stride[Math.max(0, a - 1)]!;
  const b = lowerBound(stride, center + half);
  const hi = b < stride.length ? stride[b]! : last;
  return { lo: Math.min(lo, last), hi };
}

/** Whether `win` still serves sample `center`: the cursor is within the middle half of the stretch it was made for. */
export function keepWindow(win: DetailWindow, center: number, half: number): boolean {
  return Math.abs(center - (win.lo + win.hi) / 2) <= half / 2;
}

/** The samples to draw: the stride, with every sample from `win.lo` to `win.hi` in place of the stride's there. */
export function refinedIndices(stride: number[], win: DetailWindow | null): number[] {
  if (!win) return stride;
  const out: number[] = [];
  for (const i of stride) {
    if (i >= win.lo) break;
    out.push(i);
  }
  for (let i = win.lo; i <= win.hi; i++) out.push(i);
  for (let k = lowerBound(stride, win.hi + 1); k < stride.length; k++) out.push(stride[k]!);
  return out;
}

/** Samples between drawn samples on the stride (1 when every sample is drawn). */
export function strideStep(stride: number[]): number {
  return stride.length > 1 ? stride[1]! - stride[0]! : 1;
}
