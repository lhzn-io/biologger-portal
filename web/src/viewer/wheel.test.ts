import { describe, expect, it } from "vitest";
import * as THREE from "three";
import CameraControls from "camera-controls";
import { holdViewForWheel } from "./wheel";

CameraControls.install({ THREE });

/** Controls 10 units from the orbit point at the origin, looking north (-z), zooming toward the cursor. */
function controls(): CameraControls {
  const camera = new THREE.PerspectiveCamera(50, 1.5, 0.01, 1e6);
  const c = new CameraControls(camera);
  c.dollyToCursor = true;
  c.infinityDolly = true;
  c.minDistance = 0.05;
  void c.setLookAt(0, 0, 10, 0, 0, 0, false);
  c.update(0);
  return c;
}

/** One wheel step toward the cursor at the right edge, as camera-controls handles a wheel event. */
function wheelIn(c: CameraControls): void {
  // camera-controls' wheel handler passes a negative delta to zoom in
  (c as unknown as { _dollyInternal(delta: number, x: number, y: number): void })._dollyInternal(-1, 0.8, 0);
}

function settle(c: CameraControls): THREE.Vector3 {
  for (let k = 0; k < 600; k++) c.update(1 / 60);
  return c.getTarget(new THREE.Vector3());
}

describe("wheel zoom after moving the orbit point", () => {
  it("an eased slide of the orbit point is taken for cursor zoom and throws the view sideways", () => {
    // What the page did: ease the orbit point 1000 units ahead, then the same wheel event zooms toward the cursor.
    const c = controls();
    void c.setLookAt(0, 0, 10, 0, 0, -990, true);
    wheelIn(c);
    const t = settle(c);
    expect(t.x).toBeLessThan(-100); // hundreds of units away from the cursor (+x): the "yaw"
  });

  it("holding the view first leaves only the zoom toward the cursor", () => {
    const c = controls();
    holdViewForWheel(c, 1000);
    expect(c.getTarget(new THREE.Vector3()).z).toBeCloseTo(-990, 6);
    expect(c.getPosition(new THREE.Vector3()).z).toBeCloseTo(10, 6); // the camera did not move
    wheelIn(c);
    const t = settle(c);
    expect(t.x).toBeGreaterThan(0); // toward the cursor
    expect(t.x).toBeLessThan(60); // by one wheel step's worth, not the slide's
  });

  it("stops an eased move under way, where it is, before the wheel zooms", () => {
    const c = controls();
    void c.dollyTo(1000, true); // a glide out, as Zoom to animal or playback starts one
    for (let k = 0; k < 3; k++) c.update(1 / 60);
    const mid = c.distance;
    holdViewForWheel(c, null);
    expect(c.distance).toBeCloseTo(mid, 6);
    wheelIn(c);
    const t = settle(c);
    expect(Math.abs(t.y)).toBeLessThan(1e-6);
    expect(t.x).toBeGreaterThan(0);
    expect(c.distance).toBeLessThan(mid);
  });
});
