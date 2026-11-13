import { describe, expect, it } from "vitest";
import { analyseRoll } from "./roll";
import type { Track } from "./track";

/** A 1 Hz track with the given wrapped roll (degrees) and level pitch. */
function track(roll: number[], extra: Partial<Track> = {}): Track {
  const n = roll.length;
  const z = () => new Float32Array(n);
  return {
    manifest: { rate_hz: 1 } as Track["manifest"],
    count: n,
    t: Float32Array.from({ length: n }, (_, i) => i),
    north: z(),
    east: z(),
    depth: z(),
    heading: z(),
    pitch: z(),
    roll: Float32Array.from(roll),
    vedba: z(),
    odba: null,
    rollUnwrapped: null,
    rollQuality: null,
    lat: new Float64Array(n),
    lon: new Float64Array(n),
    units: {},
    headingSource: "tag",
    ...extra,
  };
}

const wrap = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180;

describe("analyseRoll", () => {
  it("counts a steady spin, one revolution per 360 degrees", () => {
    // 30 deg/s for 40 s: 1200 degrees, 3.33 turns
    const a = analyseRoll(track(Array.from({ length: 41 }, (_, i) => wrap(i * 30))));
    expect(a.source).toBe("viewer");
    expect(a.cum[40]).toBeCloseTo(1200);
    expect(a.revolutions.map((r) => r.sense)).toEqual([1, 1, 1]);
    expect(a.revolutions.every((r) => !r.doubtful)).toBe(true);
    expect(a.doubtfulSteps).toBe(0);
  });

  it("counts no revolutions for wide rocking, even across the +/-180 wrap", () => {
    // swings of +/-170 degrees about 180 (belly up), 20 s period
    const a = analyseRoll(track(Array.from({ length: 200 }, (_, i) => wrap(180 + 170 * Math.sin((2 * Math.PI * i) / 20)))));
    const span = Math.max(...a.cum) - Math.min(...a.cum);
    expect(span).toBeGreaterThan(300);
    expect(span).toBeLessThan(360);
    expect(a.revolutions).toEqual([]);
  });

  it("does not count a single roll that only just passes 360 before returning", () => {
    const out = Array.from({ length: 39 }, (_, i) => i * 10); // 0 to 380
    const back = Array.from({ length: 39 }, (_, i) => 380 - i * 10);
    const a = analyseRoll(track([...out, ...back].map(wrap)));
    expect(a.revolutions).toEqual([]);
  });

  it("counts turns the other way as negative", () => {
    const a = analyseRoll(track(Array.from({ length: 31 }, (_, i) => wrap(-i * 40))));
    expect(a.revolutions.length).toBe(3);
    expect(a.revolutions.every((r) => r.sense === -1)).toBe(true);
  });

  it("flags steps too large to unwrap, steep pitch and gaps, and marks the turns they fall in", () => {
    const roll = Array.from({ length: 30 }, (_, i) => wrap(i * 150)); // 150 deg per sample: ambiguous
    const a = analyseRoll(track(roll));
    expect(a.doubtfulSteps).toBe(29);
    expect(a.revolutions.every((r) => r.doubtful)).toBe(true);

    const pitch = new Float32Array(10).fill(80);
    expect(analyseRoll(track(Array(10).fill(5), { pitch })).doubtfulSteps).toBe(10);

    const t = Float32Array.from([0, 1, 2, 10, 11]);
    expect(Array.from(analyseRoll(track([0, 0, 0, 0, 0], { t })).doubt)).toEqual([0, 0, 0, 1, 0]);
  });

  it("uses the exporter's cumulative roll and quality when the bundle has them", () => {
    const rollUnwrapped = Float32Array.from([0, 400, 800]);
    const rollQuality = Float32Array.from([0, 1, 0]);
    const a = analyseRoll(track([0, 40, 80], { rollUnwrapped, rollQuality }));
    expect(a.source).toBe("export");
    expect(Array.from(a.cum)).toEqual([0, 400, 800]);
    expect(a.revolutions.length).toBe(2);
    expect(a.revolutions[0]!.doubtful).toBe(true);
  });
});
