import * as THREE from "three";

/** How close (CSS px) a double-click must land to the track to pick a sample on it. */
export const PICK_PX = 12;

/**
 * The track sample under a screen point, or null when none is within `tolPx`. Where the track crosses itself, the
 * pass nearest the camera wins (the one drawn on top); along that pass, the sample nearest the point.
 *
 * `point(i, out)` writes sample i's scene position into `out` and returns it, or null for a sample with no position.
 * `x` and `y` are CSS px from the canvas's top left, `w` and `h` its size.
 */
export function nearestSample(
  count: number,
  point: (i: number, out: THREE.Vector3) => THREE.Vector3 | null,
  camera: THREE.Camera,
  x: number,
  y: number,
  w: number,
  h: number,
  tolPx = PICK_PX,
): number | null {
  const v = new THREE.Vector3();
  const tol2 = tolPx * tolPx;
  // Squared screen distance of sample i to the point, with its depth in the view (NDC z); null off screen.
  const screen = (i: number): [number, number] | null => {
    if (!point(i, v)) return null;
    v.project(camera);
    if (!(v.z > -1 && v.z < 1)) return null; // behind the camera or past the far plane
    const dx = ((v.x + 1) / 2) * w - x;
    const dy = ((1 - v.y) / 2) * h - y;
    return [dx * dx + dy * dy, v.z];
  };
  let front = -1;
  let frontZ = Infinity;
  for (let i = 0; i < count; i++) {
    const s = screen(i);
    if (s && s[0] <= tol2 && s[1] < frontZ) [front, frontZ] = [i, s[1]];
  }
  if (front < 0) return null;
  // Walk along the front pass while it stays within reach of the point, keeping the closest sample.
  let best = front;
  let bestD = screen(front)![0];
  for (const step of [-1, 1]) {
    for (let i = front + step; i >= 0 && i < count; i += step) {
      const s = screen(i);
      if (!s || s[0] > tol2) break;
      if (s[0] < bestD) [best, bestD] = [i, s[0]];
    }
  }
  return best;
}
