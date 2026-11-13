import { afterEach, describe, expect, it, vi } from "vitest";
import { resolve, snapshotPath } from "./mode";

afterEach(() => vi.unstubAllEnvs());

describe("snapshotPath", () => {
  it("maps every hub path the web app reads to its snapshot file", () => {
    expect(snapshotPath("/api/health")).toBe("/data/v1/snapshot.json");
    expect(snapshotPath("/api/deployments")).toBe("/data/v1/deployments.json");
    expect(snapshotPath("/api/deployments/WHOI.001_20250827")).toBe("/data/v1/deployments/WHOI.001_20250827.json");
    expect(snapshotPath("/api/matrix")).toBe("/data/v1/matrix.json");
    expect(snapshotPath("/api/tracks")).toBe("/data/v1/tracks.json");
    expect(snapshotPath("/api/tracks/WHOI.001_20250827/run-1/terrain")).toBe(
      "/data/v1/terrain/WHOI.001_20250827/run-1/terrain.json",
    );
    expect(snapshotPath("/api/terrain/overview")).toBe("/data/v1/terrain/overview/terrain.json");
    expect(snapshotPath("/tracks/WHOI.001_20250827/run-1/track.f32")).toBe("/data/v1/tracks/WHOI.001_20250827/run-1/track.f32");
    expect(snapshotPath("/data/v1/terrain/overview/elevation.bin")).toBe("/data/v1/terrain/overview/elevation.bin");
  });

  it("has nothing for hub-only paths", () => {
    expect(snapshotPath("/api/me")).toBeNull();
    expect(snapshotPath("/api/validation/3")).toBeNull();
    expect(snapshotPath("/topobathy/dem/x/meta?bbox=1,2,3,4")).toBeNull();
  });
});

describe("resolve", () => {
  it("leaves paths alone on the hub and maps them when published", () => {
    expect(resolve("/api/deployments")).toBe("/api/deployments");
    vi.stubEnv("VITE_PUBLISHED", "1");
    expect(resolve("/api/deployments")).toBe("/data/v1/deployments.json");
    expect(() => resolve("/api/files")).toThrow(/not part of the published snapshot/);
  });
});
