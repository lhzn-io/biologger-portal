import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { attitude, attitudeAt, climbRate, inspectorSample, mPerS, mPerS2, placementOf, tagToBody, toScene } from "./inspector";
import { parseTrack, type PipelineStep, type TrackManifest } from "./track";

const BASE = ["t", "north_m", "east_m", "depth_m", "heading_deg", "pitch_deg", "roll_deg", "vedba"];
const FORWARD = new THREE.Vector3(0, 0, -1); // the body's head
const BACK = new THREE.Vector3(0, 1, 0); // its dorsal side

/** A bundle of `n` samples: heading, pitch and roll per sample, plus optional extra columns. */
function track(
  att: { heading: number[]; pitch?: number[]; roll?: number[] },
  extra: Record<string, number[]> = {},
  more: Partial<TrackManifest> = {},
  units: Record<string, string> = {},
) {
  const n = att.heading.length;
  const names = [...BASE, ...Object.keys(extra)];
  const data = new Float32Array(names.length * n);
  for (let i = 0; i < n; i++) data[i] = i;
  data.set(att.heading, 4 * n);
  data.set(att.pitch ?? new Array<number>(n).fill(0), 5 * n);
  data.set(att.roll ?? new Array<number>(n).fill(0), 6 * n);
  Object.values(extra).forEach((vals, k) => data.set(vals, (BASE.length + k) * n));
  const manifest = {
    schema: "track-bundle-v1", deployment_id: "D", run_id: "R", track_model_used: "dead_reckoning",
    origin: { lat: 35.5, lon: -45.7 }, fixes: [], t0: 0, rate_hz: 1, count: n,
    columns: names.map((name, k) => ({ name, unit: units[name], offset_bytes: k * n * 4 })),
    bounds: { lat: [35.5, 35.6], lon: [-45.7, -45.6], depth_m: [0, 0] },
    provenance: { sim_git_commit: "x", sim_git_dirty: false },
    ...more,
  } as TrackManifest;
  return parseTrack(manifest, data.buffer);
}

const near = (v: THREE.Vector3, x: number, y: number, z: number) => {
  expect(v.x).toBeCloseTo(x, 6);
  expect(v.y).toBeCloseTo(y, 6);
  expect(v.z).toBeCloseTo(z, 6);
};

describe("inspector axes and attitude", () => {
  it("maps north, east and down onto the scene's axes", () => {
    near(toScene(0, 1, 0), 0, 0, -1); // north is -z
    near(toScene(1, 0, 0), 1, 0, 0); // east is +x
    near(toScene(0, 0, -1), 0, -1, 0); // down is -y
  });

  it("points the head along the heading and up with the pitch", () => {
    near(FORWARD.clone().applyQuaternion(attitude(0, 0, 0)), 0, 0, -1); // north
    near(FORWARD.clone().applyQuaternion(attitude(90, 0, 0)), 1, 0, 0); // east
    near(FORWARD.clone().applyQuaternion(attitude(180, 0, 0)), 0, 0, 1); // south
    const up30 = FORWARD.clone().applyQuaternion(attitude(0, 30, 0));
    near(up30, 0, Math.sin(Math.PI / 6), -Math.cos(Math.PI / 6)); // nose up 30 deg, still facing north
  });

  it("rolls the back toward the right side for a positive roll", () => {
    near(BACK.clone().applyQuaternion(attitude(0, 0, 90)), 1, 0, 0); // facing north, right is east
    near(BACK.clone().applyQuaternion(attitude(90, 0, 90)), 0, 0, 1); // facing east, right is south
    near(FORWARD.clone().applyQuaternion(attitude(90, 0, 90)), 1, 0, 0); // roll leaves the head where it was
  });

  it("slerps between samples, turning the short way across north", () => {
    const tr = track({ heading: [350, 10] });
    near(FORWARD.clone().applyQuaternion(attitudeAt(tr, 0.5)), 0, 0, -1);
    const quarter = FORWARD.clone().applyQuaternion(attitudeAt(tr, 0.25));
    expect((Math.atan2(quarter.x, -quarter.z) * 180) / Math.PI).toBeCloseTo(-5, 4);
  });

  it("passes smoothly through vertical instead of tumbling", () => {
    // Euler interpolation from (heading 0, pitch 80) to (heading 180, pitch 80) would swing through level;
    // the slerp goes over the top, pointing straight up halfway.
    const tr = track({ heading: [0, 180], pitch: [80, 80], roll: [0, 180] });
    const mid = FORWARD.clone().applyQuaternion(attitudeAt(tr, 0.5));
    expect(mid.y).toBeCloseTo(1, 4);
  });

  it("holds the last heading for the body where the tag has none, and flags it", () => {
    const tr = track({ heading: [90, NaN, NaN], pitch: [0, 0, 0] });
    near(FORWARD.clone().applyQuaternion(attitudeAt(tr, 2)), 1, 0, 0);
    expect(inspectorSample(tr, 0, "north").headingDefined).toBe(true);
    expect(inspectorSample(tr, 0.5, "north").headingDefined).toBe(false);
    expect(inspectorSample(tr, 2, "north").headingDefined).toBe(false);
  });

  it("treats the heading as undefined near vertical", () => {
    const tr = track({ heading: [90, 90, 90], pitch: [79, 81, -85] });
    expect(inspectorSample(tr, 0, "north").headingDefined).toBe(true);
    expect(inspectorSample(tr, 1, "north").headingDefined).toBe(false);
    expect(inspectorSample(tr, 2, "north").headingDefined).toBe(false);
  });
});

describe("inspector vectors", () => {
  const extra = (n: number, speed: number, east: number, north: number) => ({
    current_east_m_s: new Array<number>(n).fill(east),
    current_north_m_s: new Array<number>(n).fill(north),
    current_missing: new Array<number>(n).fill(0),
    speed_m_s: new Array<number>(n).fill(speed),
  });

  it("closes the triangle: over the ground is through the water plus the current", () => {
    const tr = track({ heading: [90, 90] }, extra(2, 1, 0, 0.2)); // swimming east at 1 m/s, current north 0.2
    const north = inspectorSample(tr, 0, "north");
    near(north.water!, 1, 0, 0);
    near(north.current!, 0, 0, -0.2);
    near(north.ground!, 1, 0, -0.2);
    expect(mPerS(north.ground)).toBe("1.02 m/s");
  });

  it("shows the model's vertical current on the current arrow, but not in the ground velocity", () => {
    const tr = track({ heading: [90, 90] }, { ...extra(2, 1, 0, 0.2), current_up_m_s: [0.01, 0.01] });
    const s = inspectorSample(tr, 0, "north");
    near(s.current!, 0, 0.01, -0.2);
    near(s.ground!, 1, 0, -0.2);
  });

  it("draws heading up: through the water straight ahead, the current turned with the animal", () => {
    const tr = track({ heading: [90, 90] }, extra(2, 1, 0, 0.2));
    const s = inspectorSample(tr, 0, "heading");
    near(s.water!, 0, 0, -1); // ahead
    near(s.current!, -0.2, 0, 0); // north is on the left of an animal heading east
    near(FORWARD.clone().applyQuaternion(s.body), 0, 0, -1);
    expect(s.headingDeg).toBeCloseTo(90, 6);
    near(s.north, -1, 0, 0); // and north on its left
  });

  it("keeps pitch and roll on the body in the heading-up frame", () => {
    const tr = track({ heading: [90, 90], pitch: [20, 20], roll: [30, 30] }, extra(2, 1, 0, 0));
    const s = inspectorSample(tr, 0, "heading");
    near(FORWARD.clone().applyQuaternion(s.body), 0, Math.sin((20 * Math.PI) / 180), -Math.cos((20 * Math.PI) / 180));
    near(s.water!, 0, 0, -1); // dead reckoning's through-water velocity is horizontal
  });

  it("uses the heading before the fix-pinning turn, and reads the placement", () => {
    const pinned: PipelineStep = { step: "placement", method: "fix_pinned", version: 1, status: "applied", params: { scale: 1.5, rotation_deg: 40 } };
    const tr = track({ heading: [130, 130] }, extra(2, 1, 0, 0), { heading_correction_deg: 40, pipeline: [pinned] });
    expect(placementOf(tr)).toEqual({ turnDeg: 40, scale: 1.5 });
    const s = inspectorSample(tr, 0, "north");
    expect(s.headingDeg).toBeCloseTo(90, 4);
    expect(s.placedHeadingDeg).toBeCloseTo(130, 4); // the bundle's heading, after the turn
    near(s.water!, 1, 0, 0);
  });

  it("leaves out a missing current and a missing speed", () => {
    const tr = track({ heading: [0, 0] }, { ...extra(2, 1, 0.1, 0), current_missing: [1, 0] });
    const s = inspectorSample(tr, 0, "north");
    expect(s.current).toBeNull();
    near(s.ground!, 0, 0, -1);
    const bare = inspectorSample(track({ heading: [0, 0] }), 0, "north");
    expect(bare.water).toBeNull();
    expect(bare.ground).toBeNull();
    expect(mPerS(bare.ground)).toBe("--");
  });
});

describe("inspector slip", () => {
  const moving = (n: number, speed: number, east: number, north: number, depth: number[]) => ({
    current_east_m_s: new Array<number>(n).fill(east),
    current_north_m_s: new Array<number>(n).fill(north),
    current_missing: new Array<number>(n).fill(0),
    speed_m_s: new Array<number>(n).fill(speed),
    depth,
  });
  /** A bundle whose depth column is set (the base fixture's is zero). */
  function diving(att: { heading: number[]; pitch?: number[]; roll?: number[] }, x: ReturnType<typeof moving>) {
    const { depth, ...rest } = x;
    const tr = track(att, rest);
    tr.depth.set(depth);
    return tr;
  }

  it("reads the vertical speed from the depth record, up positive", () => {
    const tr = diving({ heading: [0, 0, 0] }, moving(3, 1, 0, 0, [10, 11, 13]));
    expect(climbRate(tr, 0)).toBeCloseTo(-1, 6);
    expect(climbRate(tr, 1.5)).toBeCloseTo(-2, 6);
    expect(climbRate(tr, 2)).toBeCloseTo(-2, 6); // the last two samples at the end
    // The sample carries it as a vertical vector, the same in either frame (a turn about the vertical).
    for (const frame of ["heading", "north"] as const) {
      const v = inspectorSample(tr, 0, frame).vertical!;
      expect([v.x, v.y, v.z].map((c) => +c.toFixed(6))).toEqual([0, -1, 0]);
    }
  });

  it("has no attack or sideslip when the body points along the path", () => {
    // Diving at 45 degrees: 1 m/s ahead and 1 m/s down, nose down 45.
    const tr = diving({ heading: [90, 90], pitch: [-45, -45] }, moving(2, 1, 0, 0, [0, 1]));
    const s = inspectorSample(tr, 0, "heading");
    near(s.axis, 0, -Math.SQRT1_2, -Math.SQRT1_2);
    near(s.path!, 0, -1, -1);
    expect(s.attackDeg).toBeCloseTo(0, 4);
    expect(s.sideslipDeg).toBeCloseTo(0, 4);
  });

  it("gives a positive attack angle with the nose above the path", () => {
    const tr = diving({ heading: [0, 0], pitch: [10, 10] }, moving(2, 1, 0, 0, [0, 0])); // level path, nose up 10
    expect(inspectorSample(tr, 0, "north").attackDeg).toBeCloseTo(10, 4);
  });

  it("gives a positive sideslip with a current pushing the path to the right", () => {
    const tr = diving({ heading: [0, 0] }, moving(2, 1, 1, 0, [0, 0])); // heading north, current east 1 m/s
    const s = inspectorSample(tr, 0, "north");
    expect(s.sideslipDeg).toBeCloseTo(45, 4);
    expect(s.attackDeg).toBeCloseTo(0, 4);
    near(s.forward, 0, 0, -1);
  });

  it("has no path, attack or sideslip without a through-water speed", () => {
    const s = inspectorSample(track({ heading: [0, 0] }), 0, "north");
    expect(s.path).toBeNull();
    expect(s.attackDeg).toBeNaN();
    expect(s.sideslipDeg).toBeNaN();
  });

  it("points the level forward along the heading in the north frame, ahead in the heading frame", () => {
    const tr = track({ heading: [90, 90], pitch: [30, 30] });
    near(inspectorSample(tr, 0, "north").forward, 1, 0, 0);
    near(inspectorSample(tr, 0, "heading").forward, 0, 0, -1);
  });
});

describe("inspector accelerations", () => {
  const G = 9.81;
  const D2R = Math.PI / 180;
  /** The static vector the exported bundles carry at this pitch and roll: pitch = atan2(-x, hypot(y, z)), roll = atan2(y, z). */
  const staticAt = (p: number, r: number) => [-G * Math.sin(p * D2R), G * Math.cos(p * D2R) * Math.sin(r * D2R), G * Math.cos(p * D2R) * Math.cos(r * D2R)];
  const accel = (n: number, s: number[], d: number[]) => ({
    accel_static_x: new Array<number>(n).fill(s[0]!),
    accel_static_y: new Array<number>(n).fill(s[1]!),
    accel_static_z: new Array<number>(n).fill(s[2]!),
    accel_dynamic_x: new Array<number>(n).fill(d[0]!),
    accel_dynamic_y: new Array<number>(n).fill(d[1]!),
    accel_dynamic_z: new Array<number>(n).fill(d[2]!),
  });

  it("maps the tag's axes (x head, y right, z down) onto the model's", () => {
    near(tagToBody(1, 0, 0), 0, 0, -1); // head
    near(tagToBody(0, 1, 0), 1, 0, 0); // right
    near(tagToBody(0, 0, 1), 0, -1, 0); // belly
  });

  it("draws gravity straight down when the attitude came from the same static vector", () => {
    for (const [h, p, r] of [
      [0, 0, 0],
      [37, 25, -40],
      [250, -60, 120],
    ] as const) {
      const tr = track({ heading: [h, h], pitch: [p, p], roll: [r, r] }, accel(2, staticAt(p, r), [0, 0, 0]));
      for (const frame of ["north", "heading"] as const) near(inspectorSample(tr, 0, frame).gravity!, 0, -G, 0);
    }
  });

  it("turns the dynamic acceleration with the body, and labels it in m/s^2", () => {
    const tr = track({ heading: [90, 90] }, accel(2, staticAt(0, 0), [2, 0, 0])); // surging forward, heading east
    near(inspectorSample(tr, 0, "north").dynamic!, 2, 0, 0);
    near(inspectorSample(tr, 0, "heading").dynamic!, 0, 0, -2);
    expect(mPerS2(inspectorSample(tr, 0, "north").dynamic)).toBe("2.0 m/s²");
    const rolled = track({ heading: [0, 0], roll: [90, 90] }, accel(2, staticAt(0, 90), [0, 1, 0])); // right side down
    near(inspectorSample(rolled, 0, "north").dynamic!, 0, -1, 0); // toward the right side, now straight down
  });

  it("reads the attitude for the readout", () => {
    const tr = track({ heading: [10, 20], pitch: [4, 8], roll: [350, 10] });
    const s = inspectorSample(tr, 0.5, "north");
    expect(s.pitchDeg).toBeCloseTo(6, 5);
    expect(((s.rollDeg % 360) + 360) % 360).toBeCloseTo(0, 4); // the short way across 0
    expect(s.placedHeadingDeg).toBeCloseTo(15, 4);
  });

  it("has no accelerations unless all six columns are there", () => {
    const { accel_dynamic_z: _drop, ...five } = accel(2, staticAt(0, 0), [1, 1, 1]);
    void _drop;
    const tr = track({ heading: [0, 0] }, five);
    expect(tr.accel).toBeNull();
    const s = inspectorSample(tr, 0, "north");
    expect(s.dynamic).toBeNull();
    expect(s.gravity).toBeNull();
    expect(mPerS2(s.dynamic)).toBe("--");
  });
});

describe("inspector acceleration units", () => {
  it("converts a run's g to m/s^2, and leaves m/s^2 alone", () => {
    const names = ["static_x", "static_y", "static_z", "dynamic_x", "dynamic_y", "dynamic_z"].map((s) => `accel_${s}`);
    const cols = (vals: number[]) => Object.fromEntries(names.map((nm, k) => [nm, [vals[k]!, vals[k]!]]));
    const inG = track({ heading: [90, 90] }, cols([0, 0, 1, 0.2, 0, 0]), {}, Object.fromEntries(names.map((nm) => [nm, "g"])));
    const inSI = track({ heading: [90, 90] }, cols([0, 0, 9.80665, 0.2 * 9.80665, 0, 0]), {}, Object.fromEntries(names.map((nm) => [nm, "m/s^2"])));
    for (const tr of [inG, inSI]) {
      const s = inspectorSample(tr, 0, "north");
      near(s.gravity!, 0, -9.80665, 0);
      near(s.dynamic!, 0.2 * 9.80665, 0, 0); // forward, heading east
    }
  });
});
