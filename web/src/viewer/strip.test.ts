import { describe, expect, it } from "vitest";
import { availableSeries, envelope, indexAtFraction } from "./strip";
import type { Track } from "./track";

describe("studio strip", () => {
  it("takes each column's min and max, skipping missing values", () => {
    const { lo, hi, min, max } = envelope([1, 5, NaN, 3, 2, 8, NaN, NaN], 4);
    expect([...lo]).toEqual([1, 3, 2, NaN]);
    expect([...hi]).toEqual([5, 3, 8, NaN]);
    expect([min, max]).toEqual([1, 8]);
  });

  it("offers ODBA only for bundles that have it", () => {
    const base = { depth: [], pitch: [], roll: [], vedba: [], speed: null, current: null, accel: null } as unknown as Track;
    expect(availableSeries({ ...base, odba: null }).map((s) => s.key)).not.toContain("odba");
    expect(availableSeries({ ...base, odba: new Float32Array(1) }).map((s) => s.key)).toContain("odba");
  });

  it("maps the strip's ends to the first and last samples", () => {
    const track = { count: 101 } as Track;
    expect(indexAtFraction(track, 0)).toBe(0);
    expect(indexAtFraction(track, 0.5)).toBe(50);
    expect(indexAtFraction(track, 1.2)).toBe(100);
    expect(indexAtFraction(track, -1)).toBe(0);
  });
});
