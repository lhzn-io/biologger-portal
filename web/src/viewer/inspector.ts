/**
 * The physics inspector's numbers: the animal's attitude as a quaternion, the velocities dead reckoning combined at
 * that instant (the through-water velocity along the heading, the applied ocean current, and their sum over the
 * ground), and, where the bundle has them, the tag's dynamic acceleration and gravity, in the frame the inset draws.
 *
 * Axes follow the 3D view: x east, y up, -z north; the body is built head toward -z and back toward +y. The
 * attitude is the view's own (Euler YXZ: pitch about x, minus heading about y, minus roll about z), so the inset
 * and the scene always agree.
 *
 * The velocities are drawn as dead reckoning integrated them: horizontal, at the through-water speed it used, along
 * the heading before any fix-pinning turn, plus the current as applied. Pinning then turns and scales the whole
 * track rigidly (manifest heading_correction_deg and the placement step's scale), which the inset notes rather
 * than draws, since a scaled current would no longer be the model's current.
 */
import * as THREE from "three";
import { angleAt, splitPosition, valueAt } from "./playback";
import type { Track } from "./track";

const D2R = Math.PI / 180;

/** What the drawn scene is locked to: the animal's heading (level, turning with it; the default), or north. */
export type InspectorFrame = "heading" | "north";

/**
 * Where the inset's camera is: snapped behind the animal (roll reads directly) or to its right (pitch reads
 * directly; the default), both following its heading; or free, where the viewer has turned it.
 */
export type InspectorCamera = "behind" | "side" | "free";

/**
 * What the inset shows: its lock, body lengths per 1 m/s, whether gravity is drawn, the camera, a second pane at
 * right angles, double size, and the slip vectors (the body's long axis and the direction of travel, with the
 * angles between them).
 */
export interface InspectorOptions {
  frame: InspectorFrame;
  scale: number;
  gravity: boolean;
  camera: InspectorCamera;
  /** A second pane, looking from 90 degrees to the right of the first (from behind, that is from the right). */
  pair: boolean;
  large: boolean;
  slip: boolean;
  /** Called when the viewer moves the camera from the inset itself: "free" on a drag, "side" on a double-click. */
  onCamera?: (camera: InspectorCamera) => void;
}

/** A world vector (east, north, up), in meters or m/s, in the scene's axes. */
export function toScene(east: number, north: number, up: number): THREE.Vector3 {
  return new THREE.Vector3(east, up, -north);
}

/**
 * A vector in the tag's body axes (x toward the head, y to the right, z down through the belly: biologger-sim's
 * axes after the attachment rotation) in the model's body axes (head toward -z, back toward +y, right toward +x).
 * The exported bundles bear this out: their static vector, which points along gravity, gives pitch_deg (nose up
 * positive) as atan2(-x, hypot(y, z)) and roll_deg (right side down positive) as atan2(y, z).
 */
export function tagToBody(x: number, y: number, z: number): THREE.Vector3 {
  return new THREE.Vector3(y, -z, -x);
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
  /** The tag's dynamic acceleration (m/s^2, drawn frame); null when the bundle has no acceleration columns. */
  dynamic: THREE.Vector3 | null;
  /** Gravity as the tag sees it: its static (low-passed) acceleration (m/s^2, drawn frame); null likewise. */
  gravity: THREE.Vector3 | null;
  /** The heading dead reckoning used here (deg clockwise from magnetic north, 0 to 360). */
  headingDeg: number;
  /** The bundle's heading here, after any fix-pinning turn (deg, 0 to 360; NaN where the tag has none). */
  placedHeadingDeg: number;
  /** Pitch (nose up) and roll (right side down), degrees, at the playback position. */
  pitchDeg: number;
  rollDeg: number;
  /** Unit north (level) in the drawn frame, for the inset's north mark. */
  north: THREE.Vector3;
  /** The level direction the body points along, unit, in the drawn frame: the behind and side cameras follow it. */
  forward: THREE.Vector3;
  /** The body's long axis (toward the head), unit, in the drawn frame. */
  axis: THREE.Vector3;
  /**
   * The vertical velocity from the depth record (m/s, straight up or down; up positive); null where the depth is
   * missing. Dead reckoning's set speed is horizontal only: this is the other, measured, component.
   */
  vertical: THREE.Vector3 | null;
  /**
   * The direction of travel: over the ground, plus the vertical speed from the depth record (m/s, drawn frame);
   * null without a through-water speed.
   */
  path: THREE.Vector3 | null;
  /** Angle of attack (deg): positive with the nose above the path, in the body's own axes; NaN without a path. */
  attackDeg: number;
  /** Sideslip (deg): positive with the path toward the animal's right, in the body's own axes; NaN without a path. */
  sideslipDeg: number;
  /**
   * False past VERTICAL_DEG of pitch, where roll turns to noise and the tilt-compensated heading jumps freely (a
   * gimbal singularity, not a flag), or where the tag has no heading: the arrows that depend on it are then shown
   * as undefined rather than as data.
   */
  headingDefined: boolean;
}

/** Past this pitch (deg, either way) the heading is treated as undefined. */
const VERTICAL_DEG = 80;

const wrap360 = (deg: number) => ((deg % 360) + 360) % 360;

/** A body-axes column triple at a playback position, in the drawn frame; null where any component is missing. */
function accelAt(cols: [Float32Array, Float32Array, Float32Array], at: number, body: THREE.Quaternion): THREE.Vector3 | null {
  const [x, y, z] = cols.map((c) => valueAt(c, at)) as [number, number, number];
  if (![x, y, z].every(Number.isFinite)) return null;
  return tagToBody(x, y, z).applyQuaternion(body);
}

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
  const a = track.accel;
  const dynamic = a ? accelAt(a.dynamic, at, body) : null;
  const gravity = a ? accelAt(a.static, at, body) : null;
  const north = toScene(0, 1, 0).applyQuaternion(toFrame);
  const [hi, hj, hf] = splitPosition(at, track.count);
  const pitchDeg = valueAt(track.pitch, at);
  const headingDefined =
    Math.abs(pitchDeg || 0) <= VERTICAL_DEG && Number.isFinite(track.heading[hi]!) && (!(hf > 0) || Number.isFinite(track.heading[hj]!));
  const placed = angleAt(track.heading, at);
  const climb = climbRate(track, at);
  const path = ground && Number.isFinite(climb) ? ground.clone().add(new THREE.Vector3(0, climb, 0)) : null;
  const axis = new THREE.Vector3(0, 0, -1).applyQuaternion(body);
  let attackDeg = NaN;
  let sideslipDeg = NaN;
  if (path && path.length() > 1e-6) {
    // The path in the body's own axes: x right, y back (dorsal), -z head.
    const p = path.clone().applyQuaternion(body.clone().invert());
    attackDeg = Math.atan2(-p.y, -p.z) / D2R;
    sideslipDeg = Math.atan2(p.x, -p.z) / D2R;
  }
  return {
    body,
    water,
    current,
    ground,
    dynamic,
    gravity,
    headingDeg: wrap360(level),
    placedHeadingDeg: Number.isFinite(placed) ? wrap360(placed) : NaN,
    pitchDeg,
    rollDeg: angleAt(track.roll, at),
    north,
    forward: toScene(0, 1, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), -level * D2R).applyQuaternion(toFrame),
    axis,
    vertical: Number.isFinite(climb) ? new THREE.Vector3(0, climb, 0) : null,
    path,
    attackDeg,
    sideslipDeg,
    headingDefined,
  };
}

/**
 * The vertical speed (m/s, up positive) at a playback position, from the depth record: the change between the two
 * samples around it (the last two at the end). NaN where either depth or time is missing.
 */
export function climbRate(track: Track, at: number): number {
  const [a, j] = splitPosition(at, track.count);
  const i = j === a ? Math.max(0, j - 1) : a;
  const dt = track.t[j]! - track.t[i]!;
  const dz = track.depth[j]! - track.depth[i]!;
  return dt > 0 && Number.isFinite(dz) ? -dz / dt : NaN;
}

/** A speed as the inset labels it: m/s to 0.01, the unit of the ring and of the accelerations' m/s^2. */
export function mPerS(v: THREE.Vector3 | null): string {
  return v ? `${v.length().toFixed(2)} m/s` : "--";
}

/** An acceleration as the inset labels it: m/s^2 to one decimal. */
export function mPerS2(v: THREE.Vector3 | null): string {
  return v ? `${v.length().toFixed(1)} m/s²` : "--";
}
