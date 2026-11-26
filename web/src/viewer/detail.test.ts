import { describe, expect, it } from "vitest";
import { DETAIL_OFF_PX, DETAIL_ON_PX, detailWindow, keepWindow, refinedIndices, strideStep, wantDetail } from "./detail";
import { strideIndices } from "./track";

describe("wantDetail", () => {
  it("turns on at DETAIL_ON_PX and off below DETAIL_OFF_PX", () => {
    expect(wantDetail(false, DETAIL_ON_PX - 0.1)).toBe(false);
    expect(wantDetail(false, DETAIL_ON_PX)).toBe(true);
    expect(wantDetail(true, DETAIL_OFF_PX)).toBe(true);
    expect(wantDetail(true, DETAIL_OFF_PX - 0.1)).toBe(false);
  });

  it("keeps its state when the path has no size", () => {
    expect(wantDetail(true, NaN)).toBe(true);
    expect(wantDetail(false, NaN)).toBe(false);
  });
});

describe("detailWindow", () => {
  const stride = strideIndices(1000, 100); // every 10th sample, and 999

  it("widens out to the nearest drawn samples", () => {
    expect(detailWindow(stride, 500, 25)).toEqual({ lo: 470, hi: 530 });
    expect(detailWindow(stride, 503, 20)).toEqual({ lo: 480, hi: 530 });
  });

  it("stops at the ends of the track", () => {
    expect(detailWindow(stride, 5, 50)).toEqual({ lo: 0, hi: 60 });
    expect(detailWindow(stride, 990, 50)).toEqual({ lo: 940, hi: 999 });
  });
});

describe("keepWindow", () => {
  it("keeps the stretch while the cursor is within its middle half", () => {
    const win = { lo: 400, hi: 600 };
    expect(keepWindow(win, 550, 100)).toBe(true);
    expect(keepWindow(win, 551, 100)).toBe(false);
    expect(keepWindow(win, 450, 100)).toBe(true);
  });
});

describe("refinedIndices", () => {
  const stride = strideIndices(100, 10); // every 10th sample, and 99

  it("is the stride without a stretch", () => {
    expect(refinedIndices(stride, null)).toBe(stride);
  });

  it("puts every sample of the stretch in place of the stride's there", () => {
    const idx = refinedIndices(stride, { lo: 30, hi: 50 });
    expect(idx).toEqual([0, 10, 20, ...Array.from({ length: 21 }, (_, k) => 30 + k), 60, 70, 80, 90, 99]);
  });

  it("runs to the end of the track", () => {
    const idx = refinedIndices(stride, { lo: 90, hi: 99 });
    expect(idx.slice(-11)).toEqual([80, 90, 91, 92, 93, 94, 95, 96, 97, 98, 99]);
  });

  it("is strictly increasing", () => {
    const idx = refinedIndices(strideIndices(157860, 6000), { lo: 26 * 100, hi: 26 * 170 });
    for (let k = 1; k < idx.length; k++) expect(idx[k]!).toBeGreaterThan(idx[k - 1]!);
    // the 71 drawn samples from 2600 to 4420 give way to all 1821 samples between them
    expect(idx.length).toBe(strideIndices(157860, 6000).length - 71 + 1821);
  });
});

describe("strideStep", () => {
  it("is the samples between drawn samples", () => {
    expect(strideStep(strideIndices(157860, 6000))).toBe(26);
    expect(strideStep([0])).toBe(1);
  });
});
