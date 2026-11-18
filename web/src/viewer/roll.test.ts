import { describe, expect, it } from "vitest";
import { analyzeRoll } from "./roll";
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
    current: null,
    speed: null,
    accel: null,
    lat: new Float64Array(n),
    lon: new Float64Array(n),
    units: {},
    headingSource: "tag",
    ...extra,
  };
}

const wrap = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180;

describe("analyzeRoll", () => {
  it("counts a steady spin, one revolution per 360 degrees", () => {
    // 30 deg/s for 40 s: 1200 degrees, 3.33 turns
    const a = analyzeRoll(track(Array.from({ length: 41 }, (_, i) => wrap(i * 30))));
    expect(a.source).toBe("viewer");
    expect(a.cum[40]).toBeCloseTo(1200);
    expect(a.revolutions.map((r) => r.sense)).toEqual([1, 1, 1]);
    expect(a.revolutions.every((r) => !r.doubtful)).toBe(true);
    expect(a.doubtfulSteps).toBe(0);
  });

  it("counts no revolutions for wide rocking, even across the +/-180 wrap", () => {
    // swings of +/-170 degrees about 180 (belly up), 20 s period
    const a = analyzeRoll(track(Array.from({ length: 200 }, (_, i) => wrap(180 + 170 * Math.sin((2 * Math.PI * i) / 20)))));
    const span = Math.max(...a.cum) - Math.min(...a.cum);
    expect(span).toBeGreaterThan(300);
    expect(span).toBeLessThan(360);
    expect(a.revolutions).toEqual([]);
  });

  it("does not count a single roll that only just passes 360 before returning", () => {
    const out = Array.from({ length: 39 }, (_, i) => i * 10); // 0 to 380
    const back = Array.from({ length: 39 }, (_, i) => 380 - i * 10);
    const a = analyzeRoll(track([...out, ...back].map(wrap)));
    expect(a.revolutions).toEqual([]);
  });

  it("counts turns the other way as negative", () => {
    const a = analyzeRoll(track(Array.from({ length: 31 }, (_, i) => wrap(-i * 40))));
    expect(a.revolutions.length).toBe(3);
    expect(a.revolutions.every((r) => r.sense === -1)).toBe(true);
  });

  it("flags steps too large to unwrap, steep pitch and gaps, and marks the turns they fall in", () => {
    const roll = Array.from({ length: 30 }, (_, i) => wrap(i * 150)); // 150 deg per sample: ambiguous
    const a = analyzeRoll(track(roll));
    expect(a.doubtfulSteps).toBe(29);
    // the whole record after the first sample is one doubtful stretch: held, and nothing counted from it
    expect(a.revolutions).toEqual([]);
    expect(a.bridgedDeg).toBeCloseTo(29 * 150);

    const pitch = new Float32Array(10).fill(80);
    expect(analyzeRoll(track(Array(10).fill(5), { pitch })).doubtfulSteps).toBe(10);

    const t = Float32Array.from([0, 1, 2, 10, 11]);
    expect(Array.from(analyzeRoll(track([0, 0, 0, 0, 0], { t })).doubt)).toEqual([0, 0, 0, 1, 0]);
  });

  it("uses the exporter's cumulative roll and quality when the bundle has them", () => {
    const rollUnwrapped = Float32Array.from([0, 400, 800]);
    const rollQuality = Float32Array.from([0, 1, 0]);
    const a = analyzeRoll(track([0, 40, 80], { rollUnwrapped, rollQuality }));
    expect(a.source).toBe("export");
    // across the doubtful sample only the shortest rotation is kept: 800 degrees becomes 80
    expect(Array.from(a.cum)).toEqual([0, 0, 80]);
    expect(a.bridgedDeg).toBe(720);
    expect(a.revolutions).toEqual([]);

    // good samples are carried as the exporter gave them
    const b = analyzeRoll(track([0, 40, 80], { rollUnwrapped: Float32Array.from([0, 400, 800]), rollQuality: new Float32Array(3) }));
    expect(Array.from(b.cum)).toEqual([0, 400, 800]);
    expect(b.revolutions.length).toBe(2);
  });

  it("does not drift when doubtful samples fall on the peaks of rocking", () => {
    // rocking +/-60 degrees, every peak flagged: dropping only the steps into them would climb by 120 per cycle
    const n = 200;
    const rollUnwrapped = Float32Array.from({ length: n }, (_, i) => 60 * Math.sin((2 * Math.PI * i) / 20));
    const rollQuality = Float32Array.from({ length: n }, (_, i) => (i % 20 === 5 ? 1 : 0));
    const a = analyzeRoll(track(Array.from(rollUnwrapped), { rollUnwrapped, rollQuality }));
    expect(Math.max(...a.cum)).toBeLessThan(61);
    expect(Math.min(...a.cum)).toBeGreaterThan(-61);
    expect(a.revolutions).toEqual([]);
  });

  it("keeps the roll flip of a near-vertical dive within half a turn", () => {
    // as on WHOI.003 at 576 m (exporter's columns): pitch to -88, roll 74 then -95; the exporter carried +191
    const rollUnwrapped = Float32Array.from([426, 424, 429, 434, 450, 625, 627, 628, 629, 630, 631]);
    const rollQuality = Float32Array.from([0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0]);
    const pitch = Float32Array.from([-2, 2, -15, -56, -88, -62, -37, -20, -15, -10, -5]);
    const a = analyzeRoll(track(Array.from(rollUnwrapped), { rollUnwrapped, rollQuality, pitch }));
    expect(a.cum[6]! - a.cum[3]!).toBeCloseTo(-167); // the shortest way between 74 and -93 (434 and 627)
    expect(a.revolutions).toEqual([]);
  });
});
