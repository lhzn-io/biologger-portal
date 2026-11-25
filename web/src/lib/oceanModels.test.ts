import { describe, expect, it } from "vitest";
import { oceanModelDepth, oceanModelsHref } from "./oceanModels";

describe("oceanModelDepth", () => {
  it("picks the nearest level", () => {
    expect(oceanModelDepth(1)).toBe(0);
    expect(oceanModelDepth(6)).toBe(10);
    expect(oceanModelDepth(37)).toBe(25);
    expect(oceanModelDepth(38)).toBe(50);
    expect(oceanModelDepth(160)).toBe(200);
    expect(oceanModelDepth(1200)).toBe(500);
    expect(oceanModelDepth(NaN)).toBe(0);
  });
});

describe("oceanModelsHref", () => {
  const t = Date.parse("2025-07-23T19:10:00Z") / 1000;

  it("rounds to the hour and centers a box on the position to 0.1 degree", () => {
    expect(oceanModelsHref(t, 10.04, -20.06, 47)).toBe(
      "https://longhorizon.blue/northeast-shelf/?from=2025-07-23&t=2025-07-23T19Z&bbox=-20.5,9.7,-19.7,10.3&depth=50",
    );
  });

  it("leaves the surface level out, as the page does", () => {
    expect(oceanModelsHref(t, 10, -20, 2)).not.toContain("depth=");
  });

  it("rolls over to the next day at midnight", () => {
    const late = Date.parse("2025-07-23T23:40:00Z") / 1000;
    expect(oceanModelsHref(late, 10, -20, 0)).toContain("from=2025-07-24&t=2025-07-24T00Z");
  });

  it("gives nothing without a position", () => {
    expect(oceanModelsHref(t, NaN, -20, 0)).toBeNull();
  });
});
