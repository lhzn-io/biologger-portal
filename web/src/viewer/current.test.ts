import { describe, expect, it } from "vitest";
import { CURRENTS_RAMP, CURRENTS_RAMP_DARK } from "@lhzn-io/timecharts/currents-ramp";
import { currentColor, currentRampColor, currentScale, donorName, towardDeg } from "./current";
import { readPageLink } from "./link";
import { readoutAt } from "./readout";
import { parseTrack, type TrackManifest } from "./track";

const BASE = ["t", "north_m", "east_m", "depth_m", "heading_deg", "pitch_deg", "roll_deg", "vedba"];

/** A bundle of `n` samples with the given extra columns appended after the fixed ones. */
function bundle(n: number, extra: Record<string, number[]>, donor?: string): [TrackManifest, ArrayBuffer] {
  const names = [...BASE, ...Object.keys(extra)];
  const data = new Float32Array(names.length * n);
  for (let i = 0; i < n; i++) data[i] = i;
  Object.values(extra).forEach((vals, k) => data.set(vals, (BASE.length + k) * n));
  const manifest = {
    schema: "track-bundle-v1", deployment_id: "D", run_id: "R", track_model_used: "fix_pinned",
    origin: { lat: 35.534425, lon: -45.694675 }, fixes: [], t0: 1660358220, rate_hz: 1, count: n,
    columns: names.map((name, k) => ({ name, offset_bytes: k * n * 4 })),
    bounds: { lat: [35.53, 35.54], lon: [-45.70, -45.69], depth_m: [0, 0] },
    provenance: { sim_git_commit: "x", sim_git_dirty: false },
    pipeline: donor
      ? [{ step: "current_correction", method: "forcingkit", version: 1, status: "applied", params: { donor_used: donor } }]
      : undefined,
  } as TrackManifest;
  return [manifest, data.buffer];
}

describe("applied ocean current", () => {
  it("is null in a bundle without current columns", () => {
    const tr = parseTrack(...bundle(3, {}));
    expect(tr.current).toBeNull();
    expect(tr.speed).toBeNull();
  });

  it("reads east, north and speed, with NaN speed where the model had no value", () => {
    const [m, buf] = bundle(
      3,
      { current_east_m_s: [0.3, 0, 0.3], current_north_m_s: [0.4, 0, -0.4], current_missing: [0, 1, 0], speed_m_s: [1, 1, 1] },
      "necofs",
    );
    const tr = parseTrack(m, buf);
    expect(Array.from(tr.current!.speed)).toEqual([expect.closeTo(0.5, 6), NaN, expect.closeTo(0.5, 6)]);
    expect(tr.current!.donor).toBe("necofs");
    expect(Array.from(tr.speed!)).toEqual([1, 1, 1]);
    const r = readoutAt(tr, null, 2);
    expect(r.current!.speed_m_s).toBeCloseTo(0.5, 6);
    expect(r.current!.toward_deg).toBeCloseTo(143.13, 2); // east and south: toward the south-east
    expect(Number.isNaN(readoutAt(tr, null, 1).current!.toward_deg)).toBe(true);
  });

  it("treats a bundle without the missing column as all modeled", () => {
    const tr = parseTrack(...bundle(2, { current_east_m_s: [0.1, 0.1], current_north_m_s: [0, 0] }));
    expect(Array.from(tr.current!.missing)).toEqual([0, 0]);
    expect(tr.current!.donor).toBeNull();
  });

  it("scales colors to a rounded 98th percentile of the stretch means", () => {
    const n = 200;
    const speed = Array.from({ length: n }, (_, i) => (i / (n - 1)) * 0.43);
    const tr = parseTrack(...bundle(n, { current_east_m_s: speed, current_north_m_s: new Array<number>(n).fill(0) }, "hycom"));
    const s = currentScale(tr)!;
    expect(s.max).toBe(0.5);
    expect(s.ticks).toEqual([0, 0.25, 0.5]); // at most 5 ticks, so the legend's labels stay apart
    expect(s.donor).toBe("hycom");
  });

  it("colors pale green to dark green, saturating, and gray without a value", () => {
    const near = (a: number[], b: number[]) => a.forEach((v, k) => expect(v).toBeCloseTo(b[k]!, 9));
    near(currentColor(0, 0.4), [0.9, 0.97, 0.82]);
    near(currentColor(0.4, 0.4), [0.02, 0.3, 0.2]);
    near(currentColor(2, 0.4), currentColor(0.4, 0.4));
    expect(currentColor(NaN, 0.4)).toEqual([0.6, 0.6, 0.6]);
  });

  it("gives flow direction toward, clockwise from north", () => {
    expect(towardDeg(0, 1)).toBeCloseTo(0, 9);
    expect(towardDeg(1, 0)).toBeCloseTo(90, 9);
    expect(towardDeg(0, -1)).toBeCloseTo(180, 9);
    expect(towardDeg(-1, 0)).toBeCloseTo(270, 9);
  });

  it("names the ocean model", () => {
    expect(donorName("necofs")).toBe("NECOFS");
    expect(donorName(null)).toBe("an ocean model");
  });

  it("keeps the current color in a shared link", () => {
    expect(readPageLink("color=current")).toEqual({ color: "current" });
    expect(readPageLink("color=wind")).toEqual({});
  });
});

describe("standard currents ramp", () => {
  const hex = (rgb: [number, number, number]) => `#${rgb.map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("")}`;
  it("matches the shared table at its rows and clamps outside it", () => {
    expect(hex(currentRampColor(0.494, "light"))).toBe("#9adbd5");
    expect(hex(currentRampColor(0.494, "dark"))).toBe("#03696c");
    expect(hex(currentRampColor(0.001, "light"))).toBe(CURRENTS_RAMP[0]![1]);
    expect(hex(currentRampColor(NaN, "dark"))).toBe(CURRENTS_RAMP_DARK[0]![1]);
    expect(hex(currentRampColor(9, "light"))).toBe(CURRENTS_RAMP[CURRENTS_RAMP.length - 1]![1]);
  });
  it("darkens with speed on the light table and lightens on the dark twin", () => {
    const lum = ([r, g, b]: [number, number, number]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const speeds = [0.03, 0.1, 0.3, 1, 3];
    const light = speeds.map((v) => lum(currentRampColor(v, "light")));
    const dark = speeds.map((v) => lum(currentRampColor(v, "dark")));
    light.slice(1).forEach((l, k) => expect(l).toBeLessThan(light[k]!));
    dark.slice(1).forEach((l, k) => expect(l).toBeGreaterThan(dark[k]!));
  });
});
