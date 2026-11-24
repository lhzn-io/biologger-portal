/**
 * The 3D view's current arrows, drawn as fine pen vectors: a one-pixel shaft and two barbs, horizontal, with the head
 * on the track and the shaft reaching back toward where the water comes from. Longer and more saturated is faster.
 *
 * They show at every zoom, spaced along the track so neighbors do not overlap on screen: a coarse spacing in
 * whole-scene views, finer stretches of track distance as the view comes closer. Their on-screen size
 * stays about the same at any zoom. Colors come from the standard currents ramp (`currentRampColor`): its dark twin
 * over shallow (pale) seafloor and its light table over deep (dark) seafloor, so the thin lines contrast with what
 * is behind them and each color means the same speed as in the other current displays.
 */
import * as THREE from "three";
import { currentRampColor } from "./current";
import { alongTrack, arrowLength, stretchArrows, type CurrentArrow } from "./currentArrows";
import { elevationAt, type Dem } from "./dem";
import { HOVER_PX, segmentDistance2, type Projector } from "./hover";
import type { Track } from "./track";

/** A full-length arrow on screen (pixels). */
export const ARROW_PX = 44;
/** Neighbors are at least this many arrow lengths apart on screen before the arrows show. */
const SPACING = 1.3;
/** Barb length (pixels) and angle off the shaft. */
const BARB_PX = 6;
const BARB_DEG = 24;
/** Track distances (m) the arrows can be spaced by, finest first. */
const STEPS_M = [25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000, 20000, 25000, 50000, 100000];
/** At most this many arrows at the finest spacing (the whole track; most are off screen when zoomed that close). */
const MAX_FINE = 3000;
/** Seafloor deeper than this (m) is drawn dark, so arrows over it take the ramp's light table. */
const DEEP_M = 1500;

const D2R = Math.PI / 180;

interface Level {
  step: number;
  arrows: CurrentArrow[];
  /** Length as a share of ARROW_PX, per arrow. */
  lengths: number[];
  /** Horizontal unit direction in the scene (x east, z south), per arrow. */
  dirs: THREE.Vector3[];
  /** Where the head sits, per arrow: east, north and depth (m) on the drawn track line. */
  heads: [number, number, number][];
  ink: THREE.Color[];
}

export class CurrentArrowLayer {
  readonly group = new THREE.Group();
  private readonly levels: Level[];
  private readonly lines: THREE.LineSegments;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  /** The spacing drawn last, for hit-testing. */
  private shown: Level | null = null;

  constructor(
    track: Track,
    /** Scene units per meter. */
    private readonly unit: number,
    dem: Dem | null,
    /** The samples the track line is drawn through, increasing: heads go on that line, not between its vertices. */
    lineIdx: number[],
  ) {
    const dist = alongTrack(track);
    const total = dist[track.count - 1] ?? 0;
    this.levels = STEPS_M.filter((s) => total / s <= MAX_FINE).map((step) => {
      const arrows = stretchArrows(track, dist, step);
      return {
        step,
        arrows,
        lengths: arrows.map((a) => arrowLength(a.speed)),
        dirs: arrows.map((a) => new THREE.Vector3(Math.sin(a.toward * D2R), 0, -Math.cos(a.toward * D2R))),
        heads: arrows.map((a) => onLine(track, lineIdx, a.i)),
        ink: arrows.map((a) => {
          const floor = dem ? elevationAt(dem, track.lat[a.i]!, track.lon[a.i]!) : NaN;
          return new THREE.Color(...currentRampColor(a.speed, Number.isFinite(floor) && -floor > DEEP_M ? "light" : "dark"));
        }),
      };
    });
    const most = Math.max(0, ...this.levels.map((l) => l.arrows.length));
    this.positions = new Float32Array(most * 6 * 3);
    this.colors = new Float32Array(most * 6 * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(this.positions, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(this.colors, 3));
    geo.setDrawRange(0, 0);
    this.lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9, depthWrite: false }));
    this.lines.renderOrder = 5;
    this.lines.frustumCulled = false; // rebuilt every frame; geometry bounds would go stale
    this.group.add(this.lines);
  }

  /**
   * Draws the finest spacing whose neighbors are at least SPACING arrow lengths apart at `unitsPerPixel` (scene
   * units per screen pixel where the camera looks), or the coarsest when none is wide enough.
   */
  update(exaggeration: number, unitsPerPixel: number): void {
    // The finest spacing that keeps neighbors apart, else the coarsest there is (far out, a few arrows still show).
    const level =
      this.levels.find((l) => (l.step * this.unit) / unitsPerPixel >= SPACING * ARROW_PX) ?? this.levels[this.levels.length - 1];
    this.shown = level ?? null;
    const geo = this.lines.geometry;
    if (!level) {
      geo.setDrawRange(0, 0);
      return;
    }
    const pos = this.positions;
    const col = this.colors;
    const barb = BARB_PX * unitsPerPixel;
    const c = Math.cos(BARB_DEG * D2R);
    const s = Math.sin(BARB_DEG * D2R);
    let v = 0;
    const put = (x: number, y: number, z: number, ink: THREE.Color) => {
      pos[v * 3] = x;
      pos[v * 3 + 1] = y;
      pos[v * 3 + 2] = z;
      col[v * 3] = ink.r;
      col[v * 3 + 1] = ink.g;
      col[v * 3 + 2] = ink.b;
      v++;
    };
    level.heads.forEach(([east, north, depth], k) => {
      const d = level.dirs[k]!;
      const ink = level.ink[k]!;
      // The head is on the track; the tail reaches upstream.
      const hx = east * this.unit;
      const hy = -depth * exaggeration * this.unit;
      const hz = -north * this.unit;
      const len = ARROW_PX * level.lengths[k]! * unitsPerPixel;
      put(hx - d.x * len, hy, hz - d.z * len, ink);
      put(hx, hy, hz, ink);
      // Barbs: back from the head, turned either way about the vertical.
      put(hx, hy, hz, ink);
      put(hx - (d.x * c - d.z * s) * barb, hy, hz - (d.z * c + d.x * s) * barb, ink);
      put(hx, hy, hz, ink);
      put(hx - (d.x * c + d.z * s) * barb, hy, hz - (d.z * c - d.x * s) * barb, ink);
    });
    geo.setDrawRange(0, v);
    (geo.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
    (geo.getAttribute("color") as THREE.BufferAttribute).needsUpdate = true;
  }

  set visible(on: boolean) {
    this.group.visible = on;
  }

  /** The drawn arrow whose shaft passes within `tolPx` of (x, y), nearest first, with its spacing; null if none. */
  hit(project: Projector, x: number, y: number, tolPx = HOVER_PX): { arrow: CurrentArrow; step: number } | null {
    const level = this.shown;
    if (!level || !this.group.visible) return null;
    const pos = this.positions;
    const a = new THREE.Vector3();
    let best = -1;
    let bestD = tolPx * tolPx;
    for (let k = 0; k < level.arrows.length; k++) {
      const o = k * 18; // six vertices per arrow; the first two are the shaft, tail then head
      const pa = project(a.set(pos[o]!, pos[o + 1]!, pos[o + 2]!));
      const pb = project(a.set(pos[o + 3]!, pos[o + 4]!, pos[o + 5]!));
      if (!pa || !pb) continue;
      const [d2] = segmentDistance2(x, y, pa[0], pa[1], pb[0], pb[1]);
      if (d2 <= bestD) [best, bestD] = [k, d2];
    }
    return best < 0 ? null : { arrow: level.arrows[best]!, step: level.step };
  }
}

/**
 * The point on the drawn track line (straight between the samples in `lineIdx`) at sample `i`, as east, north and
 * depth (m): the line is thinned, so at close zoom a sample can sit a meter or two off it.
 */
export function onLine(track: Track, lineIdx: number[], i: number): [number, number, number] {
  let lo = 0;
  let hi = lineIdx.length - 1;
  if (hi < 1 || i <= lineIdx[0]! || i >= lineIdx[hi]!) return [track.east[i]!, track.north[i]!, track.depth[i]!];
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (lineIdx[mid]! <= i) lo = mid;
    else hi = mid;
  }
  const a = lineIdx[lo]!;
  const b = lineIdx[hi]!;
  const f = (i - a) / (b - a);
  const at = (v: Float32Array) => v[a]! + (v[b]! - v[a]!) * f;
  return [at(track.east), at(track.north), at(track.depth)];
}
