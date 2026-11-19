import { describe, expect, it } from "vitest";
import { resolveRun, runName, runParam, trackHref } from "./runLinks";
import type { TrackRow } from "./types";

const row = (deployment_id: string, run_id: string, shared = 0, published = 0) =>
  ({ deployment_id, run_id, shared, published }) as TrackRow;

const tracks = [
  row("A", "20261113-094236_Swordfish-A-postfacto", 0, 1),
  row("A", "20261119-013430_pin_cur"),
  row("A", "20261119-135911_pin_cur", 1),
  row("A", "20261119-140000_pin_cur"), // a newer re-export, not yet shared
  row("A", "20261119-013212_dr"),
  row("B", "20261119-145021_pin_cur", 1),
];

describe("runName", () => {
  it("drops the start time", () => {
    expect(runName("20261119-135911_pin_cur")).toBe("pin_cur");
    expect(runName("20261113-094236_Swordfish-A-postfacto")).toBe("Swordfish-A-postfacto");
  });
  it("leaves a name as it is", () => {
    expect(runName("pin_cur")).toBe("pin_cur");
  });
});

describe("resolveRun", () => {
  it("opens an exact id that exists", () => {
    expect(resolveRun(tracks, "A", "20261119-013430_pin_cur")).toEqual({ row: tracks[1], replaced: false });
  });
  it("opens the shared run of a name before a newer unshared one", () => {
    expect(resolveRun(tracks, "A", "pin_cur")?.row.run_id).toBe("20261119-135911_pin_cur");
  });
  it("opens the most recent run of a name when none is shared", () => {
    expect(resolveRun(tracks, "A", "dr")?.row.run_id).toBe("20261119-013212_dr");
  });
  it("follows a retired id to its successor and says so", () => {
    expect(resolveRun(tracks, "A", "20261118-162227_pin_cur")).toEqual({ row: tracks[2], replaced: true });
  });
  it("keeps deployments apart", () => {
    expect(resolveRun(tracks, "B", "pin_cur")?.row.deployment_id).toBe("B");
    expect(resolveRun(tracks, "B", "dr")).toBeNull();
  });
});

describe("runParam and trackHref", () => {
  it("links by name when the name leads to the run", () => {
    expect(runParam(tracks, tracks[2]!)).toBe("pin_cur");
    expect(trackHref(tracks, tracks[0]!)).toBe("/deployments/A/track/Swordfish-A-postfacto");
  });
  it("links by exact id when the name leads elsewhere", () => {
    expect(runParam(tracks, tracks[1]!)).toBe("20261119-013430_pin_cur");
    expect(runParam(tracks, tracks[3]!)).toBe("20261119-140000_pin_cur");
  });
});
