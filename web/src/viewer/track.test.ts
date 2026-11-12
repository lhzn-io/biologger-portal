import { describe, expect, it } from "vitest";
import { elevationAt, type Dem } from "./dem";
import { indexAt, parseTrack, strideIndices, toLatLon, type TrackManifest } from "./track";

function bundle(n: number): [TrackManifest, ArrayBuffer] {
  const names = ["t", "north_m", "east_m", "depth_m", "heading_deg", "pitch_deg", "roll_deg", "vedba"];
  const data = new Float32Array(names.length * n);
  for (let i = 0; i < n; i++) {
    data[i] = i; // t
    data[n + i] = i * 10; // north
    data[2 * n + i] = -i * 5; // east
    data[3 * n + i] = 100 + i; // depth
  }
  const manifest = {
    schema: "track-bundle-v1", deployment_id: "D", run_id: "R", track_model_used: "fix_pinned",
    origin: { lat: 35.534425, lon: -45.694675 }, fixes: [], t0: 1660358220, rate_hz: 1, count: n,
    columns: names.map((name, k) => ({ name, offset_bytes: k * n * 4 })),
    bounds: { lat: [35.53, 35.54], lon: [-45.70, -45.69], depth_m: [100, 100 + n] },
    provenance: { sim_git_commit: "x", sim_git_dirty: false },
  } as TrackManifest;
  return [manifest, data.buffer];
}

describe("track bundles", () => {
  it("reads column blocks by offset", () => {
    const [m, buf] = bundle(5);
    const tr = parseTrack(m, buf);
    expect(Array.from(tr.north)).toEqual([0, 10, 20, 30, 40]);
    expect(Array.from(tr.depth)).toEqual([100, 101, 102, 103, 104]);
    expect(tr.lat[0]).toBeCloseTo(35.534425, 9);
  });

  it("matches biologger-sim's equirectangular georeference", () => {
    // RED001 end fix from its bundle: north -2215.5589 m, east -14072.9444 m from the start fix.
    const [lat, lon] = toLatLon({ lat: 35.534425, lon: -45.694675 }, -2215.558913392904, -14072.944438191462);
    expect(lat).toBeCloseTo(35.5145, 6);
    expect(lon).toBeCloseTo(-45.8502, 6);
  });

  it("finds the nearest sample and strides", () => {
    const [m, buf] = bundle(100);
    const tr = parseTrack(m, buf);
    expect(indexAt(tr, m.t0 + 41.4)).toBe(41);
    expect(indexAt(tr, m.t0 + 41.6)).toBe(42);
    expect(indexAt(tr, m.t0 - 10)).toBe(0);
    const s = strideIndices(100, 10);
    expect(s[0]).toBe(0);
    expect(s[s.length - 1]).toBe(99);
  });
});

describe("DEM lookups", () => {
  it("interpolates between cell centres and returns NaN outside", () => {
    const dem = {
      meta: { width: 2, height: 2, bounds: [0, 0, 2, 2], dx: 1, dy: 1 },
      grid: new Float32Array([-100, -200, -300, -400]), // north row first
    } as unknown as Dem;
    expect(elevationAt(dem, 1.5, 0.5)).toBeCloseTo(-100); // centre of the north-west cell
    expect(elevationAt(dem, 1, 1)).toBeCloseTo(-250); // middle of the four
    expect(Number.isNaN(elevationAt(dem, 5, 5))).toBe(true);
  });
});
