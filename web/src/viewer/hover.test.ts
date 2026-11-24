import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { stretchArrows } from "./currentArrows";
import { arrowLines, duration, hoverSample, sampleLines, segmentDistance2, type Projector } from "./hover";
import { parseTrack, type TrackManifest } from "./track";

/** Scene x and y are taken as screen px; z as distance from the camera. */
const flat: Projector = (p) => [p.x, p.y, p.z];

describe("hover hit-testing", () => {
  it("measures the distance to a segment, clamped at its ends", () => {
    expect(segmentDistance2(5, 3, 0, 0, 10, 0)).toEqual([9, 0.5]);
    expect(segmentDistance2(-4, 0, 0, 0, 10, 0)).toEqual([16, 0]);
  });

  it("finds the sample along the drawn segment nearest the pointer, not only the line's vertices", () => {
    // Samples 0..100 at x = i, swaying 3 px off the line on odd samples; the line is drawn through every 10th.
    const point = (i: number, out: THREE.Vector3) => out.set(i, i % 2 ? 3 : 0, 0);
    const idx = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    expect(hoverSample(idx, point, flat, 15, 3)).toBe(15);
    expect(hoverSample(idx, point, flat, 14.2, 0)).toBe(14);
    expect(hoverSample(idx, point, flat, 15, 40)).toBeNull();
  });

  it("takes the pass nearest the camera where the track crosses itself", () => {
    // Out along y = 0 (far, z 0.5) for samples 0..20, back along y = 1 (near, z 0.2) for 21..41.
    const point = (i: number, out: THREE.Vector3) => (i <= 20 ? out.set(i, 0, 0.5) : out.set(41 - i, 1, 0.2));
    expect(hoverSample([0, 10, 20, 21, 31, 41], point, flat, 5, 0.5)).toBe(36);
  });
});

const BASE = ["t", "north_m", "east_m", "depth_m", "heading_deg", "pitch_deg", "roll_deg", "vedba"];

function track(n: number) {
  const cols: Record<string, (i: number) => number> = {
    current_east_m_s: () => 0.1,
    current_north_m_s: () => 0,
    current_missing: (i) => (i < 30 ? 1 : 0),
  };
  const names = [...BASE, ...Object.keys(cols)];
  const data = new Float32Array(names.length * n);
  for (let i = 0; i < n; i++) {
    data[i] = i;
    data[n + i] = i;
    data[3 * n + i] = 42;
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

describe("hover text", () => {
  it("describes a sample", () => {
    const tr = track(120);
    const lines = sampleLines(tr, null, 60);
    expect(lines[0]).toBe("2022-08-13 02:38:00 UTC");
    expect(lines[1]).toBe("depth 42 m");
    expect(lines[2]).toBe("heading 0 deg, pitch 0 deg");
    expect(lines).toContain("current 0.10 m/s toward 90 deg (model)");
    expect(sampleLines(tr, null, 10)).toContain("current: no model value here");
  });

  it("describes an arrow's stretch: span, mean and missing share", () => {
    const tr = track(120);
    const [a] = stretchArrows(tr, tr.t, 60);
    expect(a!.from).toBe(0);
    expect(a!.to).toBe(59);
    expect(a!.missingShare).toBeCloseTo(0.5, 9);
    expect(arrowLines(tr, a!, 250)).toEqual([
      "current, mean over 250 m of track",
      "2022-08-13 02:37:00 UTC, over 59 s",
      "0.10 m/s toward 90 deg (model)",
      "no model value for 50% of it",
    ]);
    expect([duration(20), duration(900), duration(9000)]).toEqual(["20 s", "15 min", "2.5 h"]);
  });
});
