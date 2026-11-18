import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { attitude, attitudeAt, cmPerS, inspectorSample, placementOf, toScene } from "./inspector";
import { parseTrack, type PipelineStep, type TrackManifest } from "./track";

const BASE = ["t", "north_m", "east_m", "depth_m", "heading_deg", "pitch_deg", "roll_deg", "vedba"];
const FORWARD = new THREE.Vector3(0, 0, -1); // the body's head
const BACK = new THREE.Vector3(0, 1, 0); // its dorsal side

/** A bundle of `n` samples: heading, pitch and roll per sample, plus optional extra columns. */
function track(
  att: { heading: number[]; pitch?: number[]; roll?: number[] },
  extra: Record<string, number[]> = {},
  more: Partial<TrackManifest> = {},
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
    columns: names.map((name, k) => ({ name, offset_bytes: k * n * 4 })),
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
    expect(cmPerS(north.ground)).toBe("102 cm/s");
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
    expect(cmPerS(bare.ground)).toBe("--");
  });
});
