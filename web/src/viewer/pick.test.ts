import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { nearestSample } from "./pick";

// A camera 10 units up the z axis looking at the origin, onto a 200 x 200 px canvas.
const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
camera.position.set(0, 0, 10);
camera.lookAt(0, 0, 0);
camera.updateMatrixWorld();
const W = 200;

/** Screen position (px) of a scene point. */
function px(p: THREE.Vector3): [number, number] {
  const v = p.clone().project(camera);
  return [((v.x + 1) / 2) * W, ((1 - v.y) / 2) * W];
}

describe("nearestSample", () => {
  // A straight run along x, one sample per unit tenth.
  const run = Array.from({ length: 41 }, (_, i) => new THREE.Vector3(-2 + i / 10, 0, 0));
  const at = (pts: THREE.Vector3[]) => (i: number, out: THREE.Vector3) => out.copy(pts[i]!);

  it("picks the sample nearest the point, and nothing out of reach", () => {
    const [x, y] = px(new THREE.Vector3(0.52, 0, 0));
    expect(nearestSample(run.length, at(run), camera, x, y, W, W)).toBe(25); // x = 0.5
    expect(nearestSample(run.length, at(run), camera, x, y + 40, W, W)).toBeNull();
  });

  it("prefers the pass nearer the camera where the track crosses itself", () => {
    // A second pass along y through the same screen point, 3 units nearer the camera.
    const near = Array.from({ length: 21 }, (_, i) => new THREE.Vector3(0, -1 + i / 10, 3));
    const both = [...run, ...near];
    const [x, y] = px(new THREE.Vector3(0, 0, 0));
    const i = nearestSample(both.length, at(both), camera, x, y, W, W);
    expect(i).toBe(run.length + 10); // the near pass's sample at y = 0
  });

  it("skips samples without a position or behind the camera", () => {
    const pts = [new THREE.Vector3(0, 0, 20), new THREE.Vector3(0, 0, 0)];
    const [x, y] = px(new THREE.Vector3(0, 0, 0));
    expect(nearestSample(3, (i, out) => (i < 2 ? out.copy(pts[i]!) : null), camera, x, y, W, W)).toBe(1);
  });
});
