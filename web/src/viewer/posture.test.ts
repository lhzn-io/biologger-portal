import { describe, expect, it } from "vitest";
import { fromUpright, postureByDepth, quantile, solarElevation } from "./posture";
import type { Track } from "./track";

describe("fromUpright", () => {
  it("folds a wrapped roll into degrees from upright", () => {
    expect(fromUpright(0)).toBe(0);
    expect(fromUpright(-30)).toBe(30);
    expect(fromUpright(90)).toBe(90);
    expect(fromUpright(-179)).toBe(179);
    expect(fromUpright(190)).toBe(170);
  });
});

describe("quantile", () => {
  it("interpolates between sorted values", () => {
    expect(quantile([0, 10, 20, 30], 0.5)).toBe(15);
    expect(quantile([5], 0.9)).toBe(5);
    expect(quantile([], 0.5)).toBeNaN();
  });
});

describe("solarElevation", () => {
  it("puts the sun high at local noon and below the horizon at local midnight", () => {
    // 2022-08-12, at 40 N, 70 W: local solar noon is near 16:40 UTC
    const noon = Date.UTC(2022, 7, 12, 16, 40) / 1000;
    const midnight = Date.UTC(2022, 7, 13, 4, 40) / 1000;
    expect(solarElevation(40, -70, noon)).toBeGreaterThan(60);
    expect(solarElevation(40, -70, noon)).toBeLessThan(70); // 90 - 40 + 15 (declination) = 65
    expect(solarElevation(40, -70, midnight)).toBeLessThan(-20);
  });
});

describe("postureByDepth", () => {
  it("summarizes roll from upright per depth band and period", () => {
    const n = 200;
    const z = () => new Float32Array(n);
    const t0 = Date.UTC(2022, 7, 12, 16, 40) / 1000; // daytime throughout (200 s)
    const depth = Float32Array.from({ length: n }, (_, i) => (i < 100 ? 10 : 450));
    const roll = Float32Array.from({ length: n }, (_, i) => (i < 100 ? (i % 2 ? 5 : -5) : i % 2 ? 50 : -60));
    const track = {
      manifest: { t0, rate_hz: 1 } as Track["manifest"],
      count: n,
      t: Float32Array.from({ length: n }, (_, i) => i),
      depth,
      roll,
      pitch: z(),
      lat: new Float64Array(n).fill(40),
      lon: new Float64Array(n).fill(-70),
    } as unknown as Track;
    const bins = postureByDepth(track);
    expect(bins.map((b) => [b.top, b.bottom, b.period, b.n])).toEqual([
      [0, 25, "day", 100],
      [400, 500, "day", 100],
    ]);
    expect(bins[0]!.median).toBe(5);
    expect(bins[1]!.median).toBe(55);
    expect(bins[1]!.over45).toBe(1);
    // small wobbles near the surface count as upright, to neither side
    expect(bins[0]!.upright).toBe(1);
    expect(bins[0]!.right.share).toBe(0);
    expect(bins[0]!.left.share).toBe(0);
    // at depth, half the time on each side, with each side's own roll from upright
    expect(bins[1]!.upright).toBe(0);
    expect(bins[1]!.right).toMatchObject({ share: 0.5, median: 50 });
    expect(bins[1]!.left).toMatchObject({ share: 0.5, median: 60 });
  });
});
