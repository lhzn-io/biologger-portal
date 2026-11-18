/**
 * The physics inspector's numbers: the animal's attitude as a quaternion, and the velocities dead reckoning
 * combined at that instant (the through-water velocity along the heading, the applied ocean current, and their sum
 * over the ground), in the frame the inset draws.
 *
 * Axes follow the 3D view: x east, y up, -z north; the body is built head toward -z and back toward +y. The
 * attitude is the view's own (Euler YXZ: pitch about x, minus heading about y, minus roll about z), so the inset
 * and the scene always agree.
 *
 * The vectors are drawn as dead reckoning integrated them: horizontal, at the through-water speed it used, along
 * the heading before any fix-pinning turn, plus the current as applied. Pinning then turns and scales the whole
 * track rigidly (manifest heading_correction_deg and the placement step's scale), which the inset notes rather
 * than draws, since a scaled current would no longer be the model's current.
 */
import * as THREE from "three";
import { splitPosition, valueAt } from "./playback";
import type { Track } from "./track";

const D2R = Math.PI / 180;

/** The drawn frame: heading up and level (the default), or north up. */
export type InspectorFrame = "heading" | "north";

/** A world vector (east, north, up), in meters or m/s, in the scene's axes. */
export function toScene(east: number, north: number, up: number): THREE.Vector3 {
  return new THREE.Vector3(east, up, -north);
}

const euler = new THREE.Euler(0, 0, 0, "YXZ");

/** The body's attitude from heading (clockwise from north), pitch (nose up) and roll (right side down), degrees. */
export function attitude(headingDeg: number, pitchDeg: number, rollDeg: number, out = new THREE.Quaternion()): THREE.Quaternion {
  euler.set((pitchDeg || 0) * D2R, -(headingDeg || 0) * D2R, -(rollDeg || 0) * D2R, "YXZ");
  return out.setFromEuler(euler);
}

/** The last finite value of a column at or before sample i (NaN if there is none). */
function finiteAtOrBefore(values: ArrayLike<number>, i: number): number {
  for (let k = i; k >= 0; k--) if (Number.isFinite(values[k]!)) return values[k]!;
  return NaN;
}

/**
 * Heading, pitch and roll of sample i. A missing heading (missing sensor rows) holds the last one known so the body
 * can still be drawn; such samples are flagged headingDefined: false and their heading arrows are not shown as data.
 */
function sampleAttitude(track: Track, i: number, correctionDeg: number, out: THREE.Quaternion): THREE.Quaternion {
  const h = finiteAtOrBefore(track.heading, i);
  return attitude((Number.isFinite(h) ? h : 0) - correctionDeg, track.pitch[i]!, track.roll[i]!, out);
}

const qa = new THREE.Quaternion();
const qb = new THREE.Quaternion();

/**
 * The attitude at a fractional playback position: one quaternion per sample, slerped between samples (never
 * interpolated as Euler angles, which tumbles near vertical). `correctionDeg` is taken off the heading, to give the
 * heading dead reckoning used before a fix-pinning turn.
 */
export function attitudeAt(track: Track, at: number, correctionDeg = 0, out = new THREE.Quaternion()): THREE.Quaternion {
  const [i, j, f] = splitPosition(at, track.count);
  sampleAttitude(track, i, correctionDeg, qa);
  if (!(f > 0) || j === i) return out.copy(qa);
  sampleAttitude(track, j, correctionDeg, qb);
  return out.slerpQuaternions(qa, qb, f);
}

/** How a fix-pinned track was placed: the heading turn (deg, clockwise) and speed scale; identity otherwise. */
export function placementOf(track: Track): { turnDeg: number; scale: number } {
  const step = track.manifest.pipeline?.filter((s) => s.step === "placement").at(-1);
  const scale = Number(step?.params.scale);
  return { turnDeg: track.manifest.heading_correction_deg ?? 0, scale: Number.isFinite(scale) && scale > 0 ? scale : 1 };
}

export interface InspectorSample {
  /** The body's attitude in the drawn frame. */
  body: THREE.Quaternion;
  /** Through-water velocity (m/s, scene axes, drawn frame); null when the bundle has no through-water speed. */
  water: THREE.Vector3 | null;
  /** The applied current; null when the track had none, or the model had no value here (still water was used). */
  current: THREE.Vector3 | null;
  /** Over the ground: their sum; null without a through-water speed. */
  ground: THREE.Vector3 | null;
  /** The heading dead reckoning used here (deg clockwise from north, 0 to 360). */
  headingDeg: number;
  /** Unit north (level) in the drawn frame, for the inset's north mark. */
  north: THREE.Vector3;
  /**
   * False past VERTICAL_DEG of pitch, where roll turns to noise and the tilt-compensated heading jumps freely (a
   * gimbal singularity, not a flag), or where the tag has no heading: the arrows that depend on it are then shown
   * as undefined rather than as data.
   */
  headingDefined: boolean;
}

/** Past this pitch (deg, either way) the heading is treated as undefined. */
export const VERTICAL_DEG = 80;

/** The inset's state at a fractional playback position. */
export function inspectorSample(track: Track, at: number, frame: InspectorFrame): InspectorSample {
  const { turnDeg } = placementOf(track);
  const q = attitudeAt(track, at, turnDeg);
  // The heading the body points along, read back from the slerped attitude so the arrows and the body agree.
  // Roll turns about the body's long axis, so it leaves this direction alone. Straight up or down there is no
  // horizontal direction, and the sample's own heading stands in.
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
  const level =
    Math.hypot(fwd.x, fwd.z) > 1e-6
      ? Math.atan2(fwd.x, -fwd.z) / D2R
      : (finiteAtOrBefore(track.heading, Math.floor(Math.max(0, at))) || 0) - turnDeg;
  // Heading up removes only the yaw: pitch and roll stay on the body, so the current swings as the animal turns.
  const toFrame = frame === "heading" ? new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), level * D2R) : new THREE.Quaternion();
  const body = toFrame.clone().multiply(q);
  const speed = track.speed ? valueAt(track.speed, at) : NaN;
  const water = Number.isFinite(speed)
    ? toScene(speed * Math.sin(level * D2R), speed * Math.cos(level * D2R), 0).applyQuaternion(toFrame)
    : null;
  let current: THREE.Vector3 | null = null;
  const c = track.current;
  if (c) {
    const [i, j, f] = splitPosition(at, track.count);
    const missing = c.missing[i] || (f > 0 && c.missing[j]);
    const e = valueAt(c.east, at);
    const n = valueAt(c.north, at);
    if (!missing && Number.isFinite(e) && Number.isFinite(n)) current = toScene(e, n, 0).applyQuaternion(toFrame);
  }
  const ground = water ? water.clone().add(current ?? new THREE.Vector3()) : null;
  const north = toScene(0, 1, 0).applyQuaternion(toFrame);
  const [hi, hj, hf] = splitPosition(at, track.count);
  const headingDefined =
    Math.abs(valueAt(track.pitch, at) || 0) <= VERTICAL_DEG &&
    Number.isFinite(track.heading[hi]!) &&
    (!(hf > 0) || Number.isFinite(track.heading[hj]!));
  return { body, water, current, ground, headingDeg: ((level % 360) + 360) % 360, north, headingDefined };
}

/** A speed as the inset labels it: centimeters per second, whole numbers. */
export function cmPerS(v: THREE.Vector3 | null): string {
  return v ? `${Math.round(v.length() * 100)} cm/s` : "--";
}
