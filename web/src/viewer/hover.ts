/**
 * The 3D view's hover readout: what is under the pointer (a current arrow, else the track) and the lines its tooltip
 * shows. Hit-testing is done in screen space, against the thinned track line the view draws, then refined to the
 * 1 Hz sample nearest the pointer along the segment it hit.
 */
import * as THREE from "three";
import { donorName, upText } from "./current";
import type { CurrentArrow } from "./currentArrows";
import type { Dem } from "./dem";
import { accelDigits, accelUnit, fmt, readoutAt } from "./readout";
import { timeOf, type Track } from "./track";

/** How close (CSS px) the pointer must be to the track or an arrow's shaft to show its readout. */
export const HOVER_PX = 8;

/**
 * Screen position (CSS px) and distance in front of the camera (scene units) of a scene point; null behind the
 * camera or past the far plane.
 */
export type Projector = (p: THREE.Vector3) => [number, number, number] | null;

export function projector(camera: THREE.Camera, w: number, h: number): Projector {
  const v = new THREE.Vector3();
  return (p) => {
    const depth = -v.copy(p).applyMatrix4(camera.matrixWorldInverse).z;
    v.copy(p).project(camera);
    if (!(v.z > -1 && v.z < 1)) return null;
    return [((v.x + 1) / 2) * w, ((1 - v.y) / 2) * h, depth];
  };
}

/** Segments this much farther from the camera than the nearest one hit (as a share of its distance) count as the same pass. */
const SAME_PASS = 0.02;

/** Squared distance from (px, py) to the segment a-b, and how far along it (0 to 1) the nearest point is. */
export function segmentDistance2(px: number, py: number, ax: number, ay: number, bx: number, by: number): [number, number] {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const f = len2 > 0 ? Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
  const ex = ax + dx * f - px;
  const ey = ay + dy * f - py;
  return [ex * ex + ey * ey, f];
}

/**
 * The track sample under (x, y): of the drawn segments (between samples `lineIdx[k]` and `lineIdx[k + 1]`) within
 * `tolPx` of the point, those of the pass nearest the camera where passes overlap, and of those the nearest on screen;
 * then, of the samples along that segment, the one nearest the point. Null when no segment is that close.
 *
 * `point(i, out)` writes sample i's scene position into `out` and returns it, or null for a sample with no position.
 */
export function hoverSample(
  lineIdx: number[],
  point: (i: number, out: THREE.Vector3) => THREE.Vector3 | null,
  project: Projector,
  x: number,
  y: number,
  tolPx = HOVER_PX,
): number | null {
  const tol2 = tolPx * tolPx;
  const p = new THREE.Vector3();
  const at = (i: number) => (point(i, p) ? project(p) : null);
  const hits: [number, number, number][] = []; // segment, squared screen distance, distance from the camera
  let prev = lineIdx.length ? at(lineIdx[0]!) : null;
  for (let k = 0; k + 1 < lineIdx.length; k++) {
    const next = at(lineIdx[k + 1]!);
    if (prev && next) {
      const [d2, f] = segmentDistance2(x, y, prev[0], prev[1], next[0], next[1]);
      if (d2 <= tol2) hits.push([k, d2, prev[2] + (next[2] - prev[2]) * f]);
    }
    prev = next;
  }
  if (!hits.length) return null;
  const front = Math.min(...hits.map((h) => h[2]));
  let best = -1;
  let bestD = Infinity;
  for (const [k, d2, z] of hits) if (z <= front + Math.abs(front) * SAME_PASS && d2 < bestD) [best, bestD] = [k, d2];
  let pick = lineIdx[best]!;
  let pickD = Infinity;
  for (let i = lineIdx[best]!; i <= lineIdx[best + 1]!; i++) {
    const s = at(i);
    if (!s) continue;
    const d = (s[0] - x) ** 2 + (s[1] - y) ** 2;
    if (d < pickD) [pick, pickD] = [i, d];
  }
  return pick;
}

const utc = (track: Track, i: number) => new Date(timeOf(track, i) * 1000).toISOString().slice(0, 19).replace("T", " ");

/** The tooltip for one track sample. */
export function sampleLines(track: Track, dem: Dem | null, i: number): string[] {
  const r = readoutAt(track, dem, i);
  const unit = track.units.odba || track.units.vedba;
  const out = [
    `${utc(track, i)} UTC`,
    `depth ${fmt(r.depth_m, 0)} m${r.above_seafloor_m != null ? `, ${fmt(r.above_seafloor_m, 0)} m above seafloor` : ""}`,
    `heading ${fmt((r.heading_deg % 360 + 360) % 360, 0)} deg, pitch ${fmt(r.pitch_deg, 0)} deg`,
  ];
  if (r.odba != null) out.push(`ODBA ${fmt(r.odba, accelDigits(unit))} ${accelUnit(unit)}`);
  if (track.speed) out.push(`through water ${fmt(track.speed[i], 2)} m/s`);
  if (r.current) {
    out.push(
      Number.isFinite(r.current.speed_m_s)
        ? `current ${fmt(r.current.speed_m_s, 2)} m/s toward ${fmt(r.current.toward_deg, 0)} deg (model)`
        : "current: no model value here",
    );
    if (r.current.up_m_s != null && Number.isFinite(r.current.up_m_s)) out.push(`vertical current ${upText(r.current.up_m_s)} (model)`);
  }
  return out;
}

/** A time span as seconds under 2 minutes, minutes under 2 hours, else hours. */
export function duration(s: number): string {
  if (s < 120) return `${Math.round(s)} s`;
  if (s < 7200) return `${Math.round(s / 60)} min`;
  return `${(s / 3600).toFixed(1)} h`;
}

/** The tooltip for one current arrow: the stretch of track it averages, from its start time. */
export function arrowLines(track: Track, a: CurrentArrow, stepM: number): string[] {
  const along = stepM >= 1000 ? `${stepM / 1000} km` : `${stepM} m`;
  const out = [
    `current, mean over ${along} of track`,
    `${utc(track, a.from)} UTC, over ${duration(timeOf(track, a.to) - timeOf(track, a.from))}`,
    `${fmt(a.speed, 2)} m/s toward ${fmt(a.toward, 0)} deg (${track.current?.donor ? `${donorName(track.current.donor)} model` : "model"})`,
  ];
  if (a.missingShare > 0) out.push(`no model value for ${Math.round(a.missingShare * 100)}% of it`);
  return out;
}
