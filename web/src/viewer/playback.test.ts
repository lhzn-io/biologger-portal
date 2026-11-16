import { describe, expect, it } from "vitest";
import { advance, angleAt, parseSpeed, speedLabel, splitPosition, stepSpeed, valueAt } from "./playback";

describe("playback speed", () => {
  it("reads typed speeds within the range", () => {
    expect(parseSpeed("1")).toBe(1);
    expect(parseSpeed(" 2.5x ")).toBe(2.5);
    expect(parseSpeed("600 X")).toBe(600);
    expect(parseSpeed(".5")).toBe(0.5);
    expect(parseSpeed("0")).toBeNull();
    expect(parseSpeed("0.05")).toBeNull();
    expect(parseSpeed("100000")).toBeNull();
    expect(parseSpeed("fast")).toBeNull();
    expect(parseSpeed("")).toBeNull();
  });

  it("steps through the ladder, from a step or from between steps", () => {
    expect(stepSpeed(1, 1)).toBe(2);
    expect(stepSpeed(60, 1)).toBe(120);
    expect(stepSpeed(60, -1)).toBe(30);
    expect(stepSpeed(45, 1)).toBe(60);
    expect(stepSpeed(45, -1)).toBe(30);
    expect(stepSpeed(1, -1)).toBe(1); // the slowest step stays; slower speeds are typed
    expect(stepSpeed(0.5, 1)).toBe(1);
    expect(stepSpeed(3600, 1)).toBe(3600);
  });

  it("labels speeds", () => {
    expect(speedLabel(60)).toBe("60");
    expect(speedLabel(0.25)).toBe("0.25");
    expect(speedLabel(2.5)).toBe("2.5");
  });
});

describe("playback position", () => {
  it("advances by real time times speed, without a one-sample minimum", () => {
    // 1x on a 1 Hz track: one frame at 60 frames per second moves a sixtieth of a sample
    expect(advance(10, 1 / 60, 1, 1)).toBeCloseTo(10 + 1 / 60, 9);
    expect(advance(10, 1, 60, 1)).toBe(70);
    expect(advance(10, -1, 60, 1)).toBe(10);
  });

  it("interpolates columns and angles between samples", () => {
    expect(splitPosition(2.25, 5)).toEqual([2, 3, 0.25]);
    expect(splitPosition(9, 5)).toEqual([4, 4, 0]);
    const depth = new Float32Array([100, 110, NaN, 130]);
    expect(valueAt(depth, 0.5)).toBe(105);
    expect(valueAt(depth, 1.5)).toBe(110); // the next sample is missing: hold the earlier one
    expect(valueAt(depth, 3)).toBe(130);
    expect(angleAt(new Float32Array([350, 10]), 0.5)).toBeCloseTo(360, 9); // the short way across north
    expect(angleAt(new Float32Array([10, 350]), 0.25)).toBeCloseTo(5, 9);
    expect(angleAt(new Float32Array([-170, 170]), 0.5)).toBeCloseTo(-180, 9);
  });
});
