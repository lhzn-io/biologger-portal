import { describe, expect, it, vi } from "vitest";
import { inspectorSample } from "./inspector";
import { InspectorView } from "./inspectorView";
import { parseTrack, type TrackManifest } from "./track";

const BASE = ["t", "north_m", "east_m", "depth_m", "heading_deg", "pitch_deg", "roll_deg", "vedba", "speed_m_s"];

/** A two-sample bundle at 1 m/s, with any extra columns (each value repeated). */
function track(extra: Record<string, number> = {}) {
  const n = 2;
  const names = [...BASE, ...Object.keys(extra)];
  const data = new Float32Array(names.length * n);
  data.set([0, 1], 0);
  data.set([1, 1], 8 * n);
  Object.values(extra).forEach((v, k) => data.set([v, v], (BASE.length + k) * n));
  const manifest = {
    schema: "track-bundle-v1", deployment_id: "D", run_id: "R", track_model_used: "dead_reckoning",
    origin: { lat: 35.5, lon: -45.7 }, fixes: [], t0: 0, rate_hz: 1, count: n,
    columns: names.map((name, k) => ({ name, unit: "m/s^2", offset_bytes: k * n * 4 })),
    bounds: { lat: [35.5, 35.6], lon: [-45.7, -45.6], depth_m: [0, 0] },
    provenance: { sim_git_commit: "x", sim_git_dirty: false },
  } as TrackManifest;
  return parseTrack(manifest, data.buffer);
}

const ACCEL = Object.fromEntries(
  ["static_x", "static_y", "static_z", "dynamic_x", "dynamic_y", "dynamic_z"].map((s, k) => [`accel_${s}`, k === 2 ? 9.81 : 0.5]),
);

describe("inspector inset without acceleration columns", () => {
  it("shows no acceleration rows, labels or notes, and logs nothing", () => {
    const warn = vi.spyOn(console, "warn");
    const error = vi.spyOn(console, "error");
    const host = document.createElement("div");
    const view = new InspectorView(host);
    const tr = track();
    view.describe(tr, { frame: "heading", scale: 1, gravity: true });
    view.update(inspectorSample(tr, 0, "heading"));
    const rows = [...host.querySelectorAll<HTMLElement>("div")].filter((d) => (d.textContent ?? "").startsWith("■ "));
    const visible = rows.filter((d) => d.style.display !== "none").map((d) => d.textContent ?? "");
    expect(visible.some((t) => t.includes("through water"))).toBe(true);
    expect(visible.filter((t) => /accel|gravity/.test(t))).toEqual([]); // no empty acceleration entries
    const notes = [...host.querySelectorAll<HTMLElement>("div")].map((d) => d.textContent ?? "").filter((t) => /acceleration/.test(t));
    expect(notes).toEqual([]); // and no note about their absence
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    view.dispose();
  });

  it("shows them when all six columns are there", () => {
    const host = document.createElement("div");
    const view = new InspectorView(host);
    const tr = track(ACCEL);
    view.describe(tr, { frame: "heading", scale: 1, gravity: true });
    view.update(inspectorSample(tr, 0, "heading"));
    const rows = [...host.querySelectorAll<HTMLElement>("div")].filter((d) => /^■ (dynamic accel\.|gravity)/.test(d.textContent ?? ""));
    expect(rows).toHaveLength(2);
    expect(rows.every((d) => d.style.display === "")).toBe(true);
    view.dispose();
  });
});
