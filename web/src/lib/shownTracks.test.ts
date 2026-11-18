import { describe, expect, it } from "vitest";
import { oneTrackPerDeployment } from "./shownTracks";
import type { TrackRow } from "./types";

const row = (deployment_id: string, run_id: string, published = 0) => ({ deployment_id, run_id, published }) as TrackRow;
const ids = (rows: TrackRow[]) => rows.map((t) => `${t.deployment_id}/${t.run_id}`);

describe("oneTrackPerDeployment", () => {
  it("prefers the published track", () => {
    expect(ids(oneTrackPerDeployment([row("A", "20261118-1"), row("A", "20261113-1", 1), row("A", "20261117-1")]))).toEqual([
      "A/20261113-1",
    ]);
  });
  it("falls back to the most recent run, whatever the input order", () => {
    expect(ids(oneTrackPerDeployment([row("A", "20261113-1"), row("A", "20261118-1"), row("B", "20261110-1")]))).toEqual([
      "A/20261118-1",
      "B/20261110-1",
    ]);
  });
  it("returns nothing for no tracks", () => {
    expect(oneTrackPerDeployment([])).toEqual([]);
  });
});
