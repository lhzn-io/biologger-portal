import { describe, expect, it } from "vitest";
import {
  alignedIndex,
  belowSeafloor,
  convergenceNote,
  currentConvergence,
  currentSummary,
  describeVariant,
  metricValue,
  placementSummary,
  separation,
  variantColor,
} from "./compare";
import type { Dem } from "./dem";
import { parseTrack, type PipelineStep, type TrackManifest } from "./track";

const NAMES = ["t", "north_m", "east_m", "depth_m", "heading_deg", "pitch_deg", "roll_deg", "vedba"];

/** A track of `n` samples heading east at `east_m_s`, at the given depth, with an optional pipeline record. */
function track(n: number, opts: { east_m_s?: number; depth?: number; model?: string; pipeline?: PipelineStep[]; metrics?: TrackManifest["metrics"] } = {}) {
  const data = new Float32Array(NAMES.length * n);
  for (let i = 0; i < n; i++) {
    data[i] = i;
    data[2 * n + i] = i * (opts.east_m_s ?? 1);
    data[3 * n + i] = opts.depth ?? 50;
  }
  const manifest = {
    schema: "track-bundle-v1", deployment_id: "D", run_id: "R", track_model_used: opts.model ?? "dead_reckoning",
    origin: { lat: 35.534425, lon: -45.694675 }, fixes: [], t0: 1660358220, rate_hz: 1, count: n,
    columns: NAMES.map((name, k) => ({ name, offset_bytes: k * n * 4 })),
    bounds: { lat: [35.53, 35.54], lon: [-45.70, -45.69], depth_m: [0, 0] },
    provenance: { sim_git_commit: "x", sim_git_dirty: false },
    pipeline: opts.pipeline,
    metrics: opts.metrics,
  } as TrackManifest;
  return parseTrack(manifest, data.buffer);
}

const step = (s: string, method: string, params: Record<string, unknown> = {}): PipelineStep => ({ step: s, method, version: 1, status: "applied", params });
const CURRENT = step("current_correction", "forcingkit", { donor_used: "necofs", samples: 100, missing: 5, drift_end_m: { north: -3000, east: -4000 } });

describe("track comparison", () => {
  it("labels and orders reconstructions by placement and current", () => {
    const dr = describeVariant(track(3, { pipeline: [step("dead_reckoning", "constant")] }));
    const drCur = describeVariant(track(3, { pipeline: [step("dead_reckoning", "constant"), CURRENT] }));
    const pin = describeVariant(track(3, { model: "fix_pinned", pipeline: [step("placement", "fix_pinned")] }));
    const pinCur = describeVariant(track(3, { model: "fix_pinned", pipeline: [CURRENT, step("placement", "fix_pinned")] }));
    const old = describeVariant(track(3, { model: "fix_pinned" }));
    expect(dr.label).toBe("Dead reckoning, no current");
    expect(drCur.label).toBe("Dead reckoning, NECOFS current");
    expect(pinCur.label).toBe("Pinned to the end fix, NECOFS current");
    expect(old.current).toBeUndefined();
    expect(old.label).toContain("earlier export");
    expect([old, pinCur, dr, pin, drCur].sort((a, b) => a.order - b.order).map((v) => v.label)).toEqual([
      dr.label, drCur.label, pin.label, pinCur.label, old.label,
    ]);
    expect(new Set([dr, drCur, pin, pinCur, old].map((v) => variantColor(v))).size).toBe(5);
  });

  it("reads the current, placement and metrics from the record", () => {
    const tr = track(3, {
      model: "fix_pinned",
      pipeline: [CURRENT, step("placement", "fix_pinned", { scale: 1.5, rotation_deg: 43 })],
      metrics: [{ name: "end_fix_miss_before_placement", value: 29078, unit: "m", by: "export-track" }],
    });
    const c = currentSummary(tr)!;
    expect(c.donor).toBe("NECOFS");
    expect(c.missingShare).toBeCloseTo(0.05, 9);
    expect(c.driftEnd).toEqual({ north: -3000, east: -4000 });
    expect(placementSummary(tr)).toEqual({ method: "fix_pinned", scale: 1.5, rotationDeg: 43 });
    expect(metricValue(tr, "end_fix_miss_before_placement")).toBe(29078);
    expect(metricValue(tr, "end_fix_miss")).toBeNull();
    expect(currentSummary(track(3))).toBeNull();
  });

  it("counts dives more than the margin below the DEM seafloor", () => {
    // A flat 100 m seafloor around the track's start (the origin lies between the four cell centers).
    const dem = {
      meta: { width: 2, height: 2, bounds: [-45.7, 35.53, -45.69, 35.54], dx: 0.005, dy: 0.005 },
      grid: new Float32Array([-100, -100, -100, -100]),
    } as unknown as Dem;
    const deep = belowSeafloor(track(4, { east_m_s: 0, depth: 150 }), dem);
    expect(deep.share).toBe(1);
    expect(deep.maxBelowM).toBeCloseTo(50, 3);
    expect(deep.covered).toBe(1);
    const shallow = belowSeafloor(track(4, { east_m_s: 0, depth: 105 }), dem); // within the 10 m margin
    expect(shallow.share).toBe(0);
  });

  it("measures how far two tracks run apart at the same time", () => {
    const a = track(5, { east_m_s: 1 });
    const b = track(5, { east_m_s: 2 });
    expect(separation(a, b, [0, 2, 4])).toEqual([0, 2, 4]);
    expect(alignedIndex(a, b, 3)).toBe(3);
  });
});

describe("current correction convergence", () => {
  const passes = (converged: boolean, shifts: number[]) =>
    step("current_correction", "forcingkit", { donor_used: "necofs", passes: shifts.length, pass_shift_max_m: shifts, convergence_m: 50, converged });

  it("reads the passes, the last shift and the limit", () => {
    const t = track(3, { model: "fix_pinned", pipeline: [passes(false, [59201.2, 391.3, 67.2])] });
    expect(currentConvergence(t)).toEqual({ converged: false, passes: 3, lastShiftM: 67.2, limitM: 50 });
    expect(convergenceNote(currentConvergence(t))).toBe(
      "Current correction not converged: 3 passes, last shift 67 m (limit 50 m); provisional",
    );
    expect(describeVariant(t).label).toBe("Pinned to the end fix, NECOFS current (not converged)");
  });

  it("says nothing for a converged run or one without a pass record", () => {
    const settled = track(3, { pipeline: [passes(true, [900, 12])] });
    expect(currentConvergence(settled)?.converged).toBe(true);
    expect(convergenceNote(currentConvergence(settled))).toBe("");
    expect(describeVariant(settled).label).toBe("Dead reckoning, NECOFS current");
    expect(currentConvergence(track(3, { pipeline: [CURRENT] }))).toBeNull();
    expect(currentConvergence(track(3))).toBeNull();
  });
});
