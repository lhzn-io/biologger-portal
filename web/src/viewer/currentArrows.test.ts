import { describe, expect, it } from "vitest";
import { alongTrack, arrowLength, arrowStep, LENGTH_FLOOR, LENGTH_FULL_M_S, MAX_ARROWS, timeArrows, trackArrows } from "./currentArrows";
import { onLine } from "./arrowLayer";
import { parseTrack, type TrackManifest } from "./track";

const BASE = ["t", "north_m", "east_m", "depth_m", "heading_deg", "pitch_deg", "roll_deg", "vedba"];

interface Cols {
  east: (i: number) => number;
  north: (i: number) => number;
  missing?: (i: number) => number;
  t?: (i: number) => number;
  /** The animal's own position (m from the start fix); 1 m/s north by default. */
  posNorth?: (i: number) => number;
}

/** A 1 Hz track of `n` samples with the given current columns. */
function track(n: number, c: Cols) {
  const cols: Record<string, (i: number) => number> = {
    current_east_m_s: c.east,
    current_north_m_s: c.north,
    ...(c.missing ? { current_missing: c.missing } : {}),
  };
  const names = [...BASE, ...Object.keys(cols)];
  const data = new Float32Array(names.length * n);
  for (let i = 0; i < n; i++) {
    data[i] = c.t ? c.t(i) : i;
    data[n + i] = c.posNorth ? c.posNorth(i) : i;
  }
  Object.values(cols).forEach((f, k) => {
    for (let i = 0; i < n; i++) data[(BASE.length + k) * n + i] = f(i);
  });
  const manifest = {
    schema: "track-bundle-v1", deployment_id: "D", run_id: "R", track_model_used: "dead_reckoning",
    origin: { lat: 35.534425, lon: -45.694675 }, fixes: [], t0: 1660358220, rate_hz: 1, count: n,
    columns: names.map((name, k) => ({ name, offset_bytes: k * n * 4 })),
    bounds: { lat: [35.53, 35.54], lon: [-45.7, -45.69], depth_m: [0, 0] },
    provenance: { sim_git_commit: "x", sim_git_dirty: false },
  } as TrackManifest;
  return parseTrack(manifest, data.buffer);
}

describe("current arrows", () => {
  it("spreads the 3D arrows evenly along the track, at most MAX_ARROWS", () => {
    expect(arrowStep(40_000)).toBe(500);
    expect(40_000 / arrowStep(40_000)).toBeLessThanOrEqual(MAX_ARROWS);
    // 3600 m of track at 1 m/s: one arrow per 50 m, 72 of them.
    const tr = track(3601, { east: () => 0.1, north: () => 0 });
    expect(alongTrack(tr)[3600]).toBeCloseTo(3600, 3);
    expect(trackArrows(tr)).toHaveLength(72);
    // Where the animal lingers (here it stops for half the record), the arrows do not pile up.
    const lingering = track(3601, { east: () => 0.1, north: () => 0, posNorth: (i) => Math.min(i, 1800) });
    expect(trackArrows(lingering).length).toBeLessThanOrEqual(37);
  });

  it("averages the current over each stretch, as a vector, pointing where the water flows", () => {
    // East at 0.3 m/s for the first 10 minutes, then north at 0.4 m/s.
    const tr = track(1200, { east: (i) => (i < 600 ? 0.3 : 0), north: (i) => (i < 600 ? 0 : 0.4) });
    const arrows = timeArrows(tr, 600);
    expect(arrows).toHaveLength(2);
    expect(arrows[0]!.toward).toBeCloseTo(90, 6);
    expect(arrows[0]!.speed).toBeCloseTo(0.3, 6);
    expect(arrows[1]!.toward).toBeCloseTo(0, 6);
    expect(arrows[1]!.speed).toBeCloseTo(0.4, 6);
    expect(arrows.map((a) => a.i)).toEqual([300, 900]); // at the middle of their stretch
    // Opposing samples cancel: a vector mean, not a mean of speeds.
    const rocking = timeArrows(track(600, { east: (i) => (i % 2 ? 0.2 : -0.2), north: () => 0 }), 600);
    expect(rocking[0]!.speed).toBeCloseTo(0, 6);
  });

  it("leaves out stretches where the model mostly had no value, and gaps in the record", () => {
    const tr = track(1800, { east: () => 0.1, north: () => 0, missing: (i) => (i >= 600 && i < 1200 && i % 10 ? 1 : 0) });
    expect(timeArrows(tr, 600).map((a) => a.i)).toEqual([300, 1500]);
    const gap = track(1200, { east: () => 0.1, north: () => 0, t: (i) => (i < 600 ? i : i + 3600) });
    expect(timeArrows(gap, 600)).toHaveLength(2);
  });

  it("is empty without a current", () => {
    const n = 4;
    const manifest = {
      schema: "track-bundle-v1", deployment_id: "D", run_id: "R", track_model_used: "dead_reckoning",
      origin: { lat: 0, lon: 0 }, fixes: [], t0: 0, rate_hz: 1, count: n,
      columns: BASE.map((name, k) => ({ name, offset_bytes: k * n * 4 })),
      bounds: { lat: [0, 0], lon: [0, 0], depth_m: [0, 0] },
      provenance: { sim_git_commit: "x", sim_git_dirty: false },
    } as TrackManifest;
    const tr = parseTrack(manifest, new Float32Array(BASE.length * n).buffer);
    expect(trackArrows(tr)).toEqual([]);
    expect(timeArrows(tr)).toEqual([]);
  });

  it("keeps a floor on length so weak flow still shows its direction", () => {
    expect(arrowLength(0, 0.5)).toBe(LENGTH_FLOOR);
    expect(arrowLength(0.25, 0.5)).toBeCloseTo(LENGTH_FLOOR + (1 - LENGTH_FLOOR) / 2, 9);
    expect(arrowLength(2, 0.5)).toBe(1);
    // By default, a fixed scale shared by every track.
    expect(arrowLength(LENGTH_FULL_M_S)).toBe(1);
    expect(arrowLength(0.1)).toBeCloseTo(LENGTH_FLOOR + (1 - LENGTH_FLOOR) * 0.2, 9);
  });

  it("puts a head on the drawn (thinned) track line, not off it between vertices", () => {
    // The animal sways 2 m east and back every other sample; the line is drawn through every 10th sample.
    const tr = track(101, { east: () => 0.1, north: () => 0 });
    for (let i = 0; i < tr.count; i++) tr.east[i] = i % 2 ? 2 : 0;
    const idx = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    const [east, north] = onLine(tr, idx, 15);
    expect(east).toBe(0);
    expect(north).toBeCloseTo(15, 6);
    expect(onLine(tr, idx, 100)).toEqual([tr.east[100], tr.north[100], tr.depth[100]]);
  });
});
