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
  it("opens the run renamed with its model for a link to an old name, and says so", () => {
    const renamed = [
      row("C", "20261125-010000_pin_cur_necofs", 1),
      row("C", "20261125-020000_pin_cur_doppio", 1),
      row("D", "20261125-030000_pin_cur_hycom"),
    ];
    expect(resolveRun(renamed, "C", "pin_cur")).toEqual({ row: renamed[0], replaced: true });
    expect(resolveRun(renamed, "C", "20261119-001434_pin_cur")?.row.run_id).toBe("20261125-010000_pin_cur_necofs");
    expect(resolveRun(renamed, "D", "pin_cur")?.row.run_id).toBe("20261125-030000_pin_cur_hycom");
    expect(resolveRun(renamed, "C", "dr_cur")).toBeNull();
    // While an old-named run is still there, the old name opens it.
    expect(resolveRun([...renamed, row("C", "20261119-001434_pin_cur", 1)], "C", "pin_cur")?.row.run_id).toBe("20261119-001434_pin_cur");
  });
  it("opens the reviewed track for a link to a retired post-facto run, and says so", () => {
    const after = [
      row("E", "20261119-000903_dr", 1),
      row("E", "20261119-000913_pin", 1, 1),
      row("F", "20261120-202256_pin_cur", 1, 1),
      row("G", "20261119-000903_dr", 1),
    ];
    const legacy = "20261113-094223_Swordfish-E-postfacto";
    expect(resolveRun(after, "E", legacy)).toEqual({ row: after[1], replaced: true });
    expect(resolveRun(after, "E", "Swordfish-E-postfacto")).toEqual({ row: after[1], replaced: true });
    expect(resolveRun(after, "F", "20261113-160825_WhaleShark-F-postfacto")?.row.run_id).toBe("20261120-202256_pin_cur");
    // No reviewed track: nothing to open. Other unknown names are not redirected.
    expect(resolveRun(after, "G", "Swordfish-G-postfacto")).toBeNull();
    expect(resolveRun(after, "E", "nonsense")).toBeNull();
    // While the post-facto run is still there, its link opens it.
    expect(resolveRun(tracks, "A", "Swordfish-A-postfacto")).toEqual({ row: tracks[0], replaced: false });
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
