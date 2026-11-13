import { describe, expect, it } from "vitest";
import { depthScale, trackDepthColor } from "./dem";

describe("depthScale", () => {
  it("rounds the deepest value up to a round number, with four tick intervals where a round step allows", () => {
    expect(depthScale(843.2, "species")).toEqual({ max: 1000, ticks: [0, 250, 500, 750, 1000], basis: "species" });
    expect(depthScale(2400, "track")).toMatchObject({ max: 2500, ticks: [0, 500, 1000, 1500, 2000, 2500] });
    expect(depthScale(155.9, "track")).toEqual({ max: 200, ticks: [0, 50, 100, 150, 200], basis: "track" });
    expect(depthScale(610.1, "track").max).toBe(750);
    expect(depthScale(1100, "track")).toMatchObject({ max: 1200, ticks: [0, 300, 600, 900, 1200] });
  });

  it("keeps the deepest value at an exact round number, and copes with no depths", () => {
    expect(depthScale(600, "track").max).toBe(600);
    expect(depthScale(0, "track").max).toBe(50);
    expect(depthScale(NaN, "track").max).toBe(50);
    expect(depthScale(7300, "track").max).toBe(8000);
  });
});

describe("trackDepthColor", () => {
  it("reaches the deep end of the ramp at the scale's maximum", () => {
    expect(trackDepthColor(1000, 1000)).toEqual(trackDepthColor(600, 600));
    expect(trackDepthColor(500, 1000)).toEqual(trackDepthColor(300, 600));
  });
});
