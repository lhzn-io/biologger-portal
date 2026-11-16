import * as THREE from "three";
import type CameraControls from "camera-controls";

/**
 * Moves the orbit point to `along` scene units ahead on the current line of sight (or leaves it, for null), at once
 * and from where the camera is now, so an eased move still under way stops there. The view does not change.
 *
 * camera-controls' zoom toward the cursor reads every change of camera distance as wheel zoom while a wheel
 * gesture's zoom is still being applied. A wheel gesture's first event reaches this page's listener before
 * camera-controls' own; an eased move of the orbit point started there lengthened the camera distance over the next
 * frames, and camera-controls took all of it for zoom toward the cursor and moved the view sideways, away from the
 * cursor, by up to the length of the slide. After "Zoom to animal" that was hundreds of meters, which looked like
 * the wheel turning the view. Settling the controls here (update(0)) records the new distance before the wheel
 * event adds its own zoom, and stops any eased move whose distance change would be read the same way.
 */
export function holdViewForWheel(c: CameraControls, along: number | null): void {
  const eye = c.getPosition(new THREE.Vector3(), false);
  const target = c.getTarget(new THREE.Vector3(), false);
  if (along != null) target.sub(eye).normalize().multiplyScalar(along).add(eye);
  void c.setLookAt(eye.x, eye.y, eye.z, target.x, target.y, target.z, false);
  c.update(0);
}
