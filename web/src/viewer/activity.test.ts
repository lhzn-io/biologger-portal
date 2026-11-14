import { describe, expect, it } from "vitest";
import { activityColor, segmentMeans } from "./activity";

describe("track activity colors", () => {
  it("averages every sample in each drawn stretch, ignoring NaN", () => {
    const v = new Float32Array([1, 3, NaN, 5, 7, 9, 100]);
    expect(Array.from(segmentMeans(v, [0, 3, 6]))).toEqual([2, 7, 100]);
  });

  it("runs pale yellow to dark violet and saturates past the scale", () => {
    const near = (a: number[], b: number[]) => a.forEach((v, k) => expect(v).toBeCloseTo(b[k]!, 9));
    near(activityColor(0, 2), [0.99, 0.93, 0.55]);
    near(activityColor(2, 2), [0.23, 0.07, 0.43]);
    near(activityColor(9, 2), activityColor(2, 2));
    expect(activityColor(NaN, 2)).toEqual([0.6, 0.6, 0.6]);
  });
});
