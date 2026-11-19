import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { inspectorSample, type InspectorOptions } from "./inspector";
import { INSET, InspectorView, insetBox } from "./inspectorView";

const OPTS: InspectorOptions = { frame: "heading", scale: 1, gravity: false, camera: "free", pair: false, large: false, slip: false };
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
    view.describe(tr, { ...OPTS, gravity: true });
    view.update(inspectorSample(tr, 0, "heading"));
    const rows = [...host.querySelectorAll<HTMLElement>("div")].filter((d) => (d.textContent ?? "").startsWith("■ "));
    const visible = rows.filter((d) => d.style.display !== "none").map((d) => d.textContent ?? "");
    expect(visible.some((t) => t.startsWith("■ swim"))).toBe(true);
    expect(visible.filter((t) => /^■ (dynamic|gravity)/.test(t))).toEqual([]); // no empty acceleration entries
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
    view.describe(tr, { ...OPTS, gravity: true });
    view.update(inspectorSample(tr, 0, "heading"));
    const rows = [...host.querySelectorAll<HTMLElement>("div")].filter((d) => /^■ (dynamic|gravity)/.test(d.textContent ?? ""));
    expect(rows).toHaveLength(2);
    expect(rows.every((d) => d.style.display === "")).toBe(true);
    view.dispose();
  });
});

describe("inspector inset layout and slip", () => {
  const overlay = (host: HTMLElement) => host.firstElementChild as HTMLElement;
  const legendRow = (host: HTMLElement, label: string) =>
    [...host.querySelectorAll<HTMLElement>("div")].find((d) => (d.textContent ?? "").startsWith(`■ ${label}`))!;
  type Internals = {
    panes: { camera: THREE.PerspectiveCamera }[];
    nav: { controls: THREE.EventDispatcher<{ controlstart: object }> };
    surface: HTMLElement;
  };
  const internals = (view: InspectorView) => view as unknown as Internals;

  it("sizes one pane, two side by side, and doubles them", () => {
    expect(insetBox({ pair: false, large: false })).toEqual({ pane: INSET.size, width: INSET.size, height: INSET.size });
    expect(insetBox({ pair: true, large: false }).width).toBe(2 * INSET.size);
    expect(insetBox({ pair: true, large: true })).toEqual({ pane: 2 * INSET.size, width: 4 * INSET.size, height: 2 * INSET.size });
    const host = document.createElement("div");
    const view = new InspectorView(host);
    view.describe(track(), { ...OPTS, camera: "behind", pair: true, large: true });
    expect(overlay(host).style.width).toBe(`${4 * INSET.size}px`);
    expect(host.textContent).toContain("from behind (roll)");
    expect(host.textContent).toContain("from the right (pitch)");
    view.describe(track(), { ...OPTS, camera: "behind" });
    expect(overlay(host).style.width).toBe(`${INSET.size}px`);
    view.describe(track(), OPTS);
    expect(host.textContent).not.toContain("from behind"); // a free view has no caption
    view.dispose();
  });

  it("shows the slip rows only when asked, with the angles", () => {
    const host = document.createElement("div");
    const view = new InspectorView(host);
    const tr = track();
    view.describe(tr, OPTS);
    view.update(inspectorSample(tr, 0, "heading"));
    expect(legendRow(host, "path").style.display).toBe("none");
    view.describe(tr, { ...OPTS, slip: true });
    view.update(inspectorSample(tr, 0, "heading"));
    expect(legendRow(host, "axis").style.display).toBe("");
    expect(legendRow(host, "path").textContent).toContain("attack +0° slip +0°");
    view.dispose();
  });

  it("snaps behind opposite the nose, with the second pane on the animal's right", () => {
    const host = document.createElement("div");
    const view = new InspectorView(host);
    const tr = track(); // heading north, level
    const { panes } = internals(view);
    for (const frame of ["heading", "north"] as const) {
      view.describe(tr, { ...OPTS, frame, camera: "behind", pair: true });
      const s = inspectorSample(tr, 0, frame);
      view.update(s);
      const right = s.axis.clone().cross(new THREE.Vector3(0, 1, 0));
      const [behind, side] = panes.map((p) => p.camera.position.clone().normalize());
      expect(behind!.dot(s.axis)).toBeLessThan(-0.9);
      expect(side!.dot(right)).toBeGreaterThan(0.9);
      view.describe(tr, { ...OPTS, frame, camera: "side" });
      view.update(s);
      expect(panes[0]!.camera.position.clone().normalize().dot(right)).toBeGreaterThan(0.9);
    }
    view.dispose();
  });

  it("opens from the side, frees a snapped camera on a drag, and returns to the side on a double-click", () => {
    const host = document.createElement("div");
    const view = new InspectorView(host);
    const tr = track(); // heading north, level: the right is +x, behind is +z
    const onCamera = vi.fn();
    const { nav, surface, panes } = internals(view);
    const dir = () => panes[0]!.camera.position.clone().normalize();
    view.describe(tr, { ...OPTS, camera: "side", onCamera });
    view.update(inspectorSample(tr, 0, "heading"));
    expect(dir().x).toBeGreaterThan(0.9);
    view.describe(tr, { ...OPTS, camera: "behind", onCamera });
    view.update(inspectorSample(tr, 0, "heading"));
    expect(host.textContent).toContain("from behind (roll)");
    nav.controls.dispatchEvent({ type: "controlstart" }); // what a drag on the inset fires
    expect(onCamera).toHaveBeenLastCalledWith("free");
    expect(host.textContent).not.toContain("from behind");
    nav.controls.dispatchEvent({ type: "controlstart" }); // already free: nothing more to say
    expect(onCamera).toHaveBeenCalledTimes(1);
    // The page then says "free": the view stays where it is (still behind the animal).
    view.describe(tr, { ...OPTS, camera: "free", onCamera });
    view.update(inspectorSample(tr, 0, "heading"));
    expect(dir().z).toBeGreaterThan(0.9);
    // A double-click snaps back to the side, and tells the page so the Side button lights.
    surface.dispatchEvent(new MouseEvent("dblclick"));
    expect(onCamera).toHaveBeenLastCalledWith("side");
    view.update(inspectorSample(tr, 0, "heading"));
    expect(dir().x).toBeGreaterThan(0.9);
    view.dispose();
  });

  it("labels each arrow past its tip, clear of the body, and the ring", () => {
    const host = document.createElement("div");
    const view = new InspectorView(host);
    const tr = track(ACCEL);
    view.describe(tr, { ...OPTS, camera: "side" });
    view.update(inspectorSample(tr, 0, "heading"));
    const spans = [...host.querySelectorAll<HTMLElement>("span")];
    const dyn = spans.find((s) => s.style.color && s.textContent === "0.9")!; // the dynamic acceleration, 0.87 m/s^2
    const r = Math.hypot(parseFloat(dyn.style.left) - INSET.size / 2, parseFloat(dyn.style.top) - INSET.size / 2);
    expect(r).toBeGreaterThanOrEqual(INSET.size * 0.17 - 0.5); // pushed out from the middle, past the body
    expect(spans.some((s) => s.textContent === "1 m/s" && s.style.left !== "")).toBe(true);
    view.dispose();
  });
});
