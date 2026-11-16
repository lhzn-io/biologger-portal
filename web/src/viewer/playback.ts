/**
 * Playback speed and the playback position between samples. Speeds are seconds of track per second of playback;
 * positions are fractional sample indices, so slow playback of a 1 Hz track moves the animal smoothly instead of
 * jumping once per sample.
 */

/** The speeds a viewer may type, from slow motion to a day per second. */
export const SPEED_RANGE: [number, number] = [0.1, 86400];
/** The steps the slower and faster buttons move through. */
export const SPEED_STEPS = [1, 2, 5, 10, 20, 30, 60, 120, 300, 600, 1200, 1800, 3600];
/** Playback runs at 60x unless the viewer or a shared link picks another speed. */
export const DEFAULT_SPEED = 60;

/** A typed speed ("10", "2.5x", " 600 X"), or null when it is not a number in SPEED_RANGE. */
export function parseSpeed(text: string): number | null {
  const m = /^\s*(\d+(?:\.\d*)?|\.\d+)\s*x?\s*$/i.exec(text);
  if (!m) return null;
  const v = Number(m[1]);
  return v >= SPEED_RANGE[0] && v <= SPEED_RANGE[1] ? v : null;
}

/** The next step above (dir 1) or below (dir -1) `speed`; a speed between steps goes to the nearer side's step. */
export function stepSpeed(speed: number, dir: 1 | -1): number {
  if (dir > 0) return SPEED_STEPS.find((s) => s > speed * 1.0001) ?? speed;
  return [...SPEED_STEPS].reverse().find((s) => s < speed / 1.0001) ?? speed;
}

/** How a speed reads in the controls: whole numbers plain, slow motion to two significant digits. */
export function speedLabel(speed: number): string {
  return Number.isInteger(speed) ? String(speed) : String(Number(speed.toPrecision(2)));
}

/** The position `dt` seconds of playback after `pos`, for a track sampled at `hz`. */
export function advance(pos: number, dt: number, speed: number, hz: number): number {
  return pos + Math.max(0, dt) * speed * hz;
}

/** The sample before a fractional position, and how far past it the position lies (0 to 1). */
export function splitPosition(at: number, count: number): [number, number, number] {
  const last = Math.max(0, count - 1);
  const c = Math.min(Math.max(at, 0), last);
  const i = Math.floor(c);
  return [i, Math.min(i + 1, last), c - i];
}

/** A column's value at a fractional position, linear between samples (the earlier sample when the next is missing). */
export function valueAt(values: ArrayLike<number>, at: number): number {
  const [i, j, f] = splitPosition(at, values.length);
  const a = values[i]!;
  const b = values[j]!;
  return f > 0 && Number.isFinite(b) ? a + (b - a) * f : a;
}

/** An angle column's value (degrees) at a fractional position, turning the short way between samples. */
export function angleAt(values: ArrayLike<number>, at: number): number {
  const [i, j, f] = splitPosition(at, values.length);
  const a = values[i]!;
  const b = values[j]!;
  if (!(f > 0) || !Number.isFinite(b)) return a;
  const d = ((((b - a) % 360) + 540) % 360) - 180;
  return a + d * f;
}
