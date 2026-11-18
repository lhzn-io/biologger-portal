/**
 * The physics inspector inset: the animal at its attitude with the velocities acting on it, drawn by the 3D view's
 * own renderer into a small scissored viewport in the bottom-right corner (one WebGL context, at the scene's pixel
 * ratio, so the inset is never a small buffer stretched up). Labels are HTML over the inset, moved each frame.
 *
 * Built once per scene; each frame only sets the body's quaternion and the arrows' lengths and directions.
 */
import * as THREE from "three";
import type { AnimalModel } from "./animal";
import { cmPerS, placementOf, type InspectorSample } from "./inspector";
import type { Track } from "./track";

/** The inset's size and its offsets from the view's right and bottom edges (CSS px; bottom clears the credits). */
export const INSET = { size: 220, right: 8, bottom: 32 };

/** Arrow colors: through the water (blue), the current (green, as the current track colors), over the ground. */
export const ARROW_COLORS = { water: "#60a5fa", current: "#34d399", ground: "#fbbf24" } as const;

type ArrowKey = keyof typeof ARROW_COLORS;
const LABELS: Record<ArrowKey, string> = { water: "through water", current: "current", ground: "over ground" };
const SHAFT_R = 0.014;
const HEAD_LEN = 0.09;
const UP = new THREE.Vector3(0, 1, 0);
const MUTED = new THREE.Color("#6b7280");

/** An arrow from the origin: a cylinder and a cone (WebGL lines are always one pixel wide). */
class Arrow {
  readonly group = new THREE.Group();
  private readonly shaft: THREE.Mesh;
  private readonly head: THREE.Mesh;
  private readonly dir = new THREE.Vector3();
  private readonly mat: THREE.MeshLambertMaterial;
  private readonly color: THREE.Color;

  constructor(color: string) {
    this.color = new THREE.Color(color);
    this.mat = new THREE.MeshLambertMaterial({ color, emissive: color, emissiveIntensity: 0.35, transparent: true });
    this.shaft = new THREE.Mesh(new THREE.CylinderGeometry(SHAFT_R, SHAFT_R, 1, 10).translate(0, 0.5, 0), this.mat);
    this.head = new THREE.Mesh(new THREE.ConeGeometry(SHAFT_R * 2.8, 1, 14).translate(0, 0.5, 0), this.mat);
    this.group.add(this.shaft, this.head);
  }

  /** Gray and faint where the arrow depends on a heading that is undefined here. */
  setMuted(muted: boolean): void {
    const c = muted ? MUTED : this.color;
    this.mat.color.copy(c);
    this.mat.emissive.copy(c);
    this.mat.opacity = muted ? 0.45 : 1;
  }

  /** Points the arrow along `v` (scene units), hidden when absent or too short to draw. */
  set(v: THREE.Vector3 | null): void {
    const len = v ? v.length() : 0;
    this.group.visible = len > 1e-3;
    if (!this.group.visible || !v) return;
    const head = Math.min(HEAD_LEN, len * 0.45);
    this.group.quaternion.setFromUnitVectors(UP, this.dir.copy(v).divideScalar(len));
    this.shaft.scale.set(1, len - head, 1);
    this.head.scale.set(1, head, 1);
    this.head.position.y = len - head;
  }

  dispose(): void {
    this.shaft.geometry.dispose();
    this.head.geometry.dispose();
    (this.shaft.material as THREE.Material).dispose();
  }
}

/** Edges of a species model, built once per model (the geometry is shared through the model cache). */
const edgeCache = new WeakMap<THREE.BufferGeometry, THREE.EdgesGeometry>();

export class InspectorView {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(32, 1, 0.01, 50);
  private readonly body = new THREE.Group();
  private readonly arrows: Record<ArrowKey, Arrow>;
  private readonly ring: THREE.LineLoop;
  private readonly overlay: HTMLDivElement;
  private readonly tips: Record<ArrowKey | "north", HTMLSpanElement>;
  private readonly values: Record<ArrowKey, HTMLSpanElement>;
  private readonly note: HTMLDivElement;
  private readonly undefinedNote: HTMLSpanElement;
  private frame: "heading" | "north" = "heading";
  private readonly owned: (THREE.BufferGeometry | THREE.Material)[] = [];
  private standIn: THREE.BufferGeometry[] = [];
  private reach = 1.2; // the radius the camera frames, eased toward the longest arrow
  private readonly v = new THREE.Vector3();

  constructor(host: HTMLElement) {
    this.scene.background = new THREE.Color("#111a2e");
    this.scene.add(new THREE.HemisphereLight(0xdfefff, 0x203040, 1.2));
    const sun = new THREE.DirectionalLight(0xffffff, 1.2);
    sun.position.set(-1, 2, 1.5);
    this.scene.add(sun);
    this.scene.add(this.body);
    this.setModel(null);

    // A level ring one scale unit across (1 m/s at the default scale), so speeds and the horizontal read at a glance.
    const ringGeo = new THREE.BufferGeometry().setFromPoints(
      Array.from({ length: 64 }, (_, k) => new THREE.Vector3(Math.cos((k / 64) * 2 * Math.PI), 0, Math.sin((k / 64) * 2 * Math.PI))),
    );
    const ringMat = new THREE.LineBasicMaterial({ color: 0x5b6b86, transparent: true, opacity: 0.6 });
    this.ring = new THREE.LineLoop(ringGeo, ringMat);
    this.owned.push(ringGeo, ringMat);
    this.scene.add(this.ring);

    this.arrows = { water: new Arrow(ARROW_COLORS.water), current: new Arrow(ARROW_COLORS.current), ground: new Arrow(ARROW_COLORS.ground) };
    for (const a of Object.values(this.arrows)) this.scene.add(a.group);

    const el = document.createElement("div");
    el.className = "absolute cursor-help overflow-hidden rounded border border-line font-mono text-[10px] leading-tight";
    Object.assign(el.style, { right: `${INSET.right}px`, bottom: `${INSET.bottom}px`, width: `${INSET.size}px`, height: `${INSET.size}px` });
    el.setAttribute("aria-label", "Physics inspector: the animal's attitude and the velocities dead reckoning combined");
    const title = document.createElement("div");
    title.className = "absolute top-1 left-1.5 text-muted";
    title.textContent = "Physics";
    const legend = document.createElement("div");
    legend.className = "absolute bottom-1 left-1.5 space-y-px";
    const span = (cls: string, color?: string) => {
      const s = document.createElement("span");
      s.className = cls;
      if (color) s.style.color = color;
      return s;
    };
    const keys = Object.keys(ARROW_COLORS) as ArrowKey[];
    this.values = {} as Record<ArrowKey, HTMLSpanElement>;
    for (const k of keys) {
      const row = document.createElement("div");      row.append(span("", ARROW_COLORS[k]), span("text-muted"));
      (row.firstChild as HTMLSpanElement).textContent = "■ ";
      (row.lastChild as HTMLSpanElement).textContent = `${LABELS[k]} `;
      this.values[k] = span("text-ink");
      row.append(this.values[k]);
      legend.append(row);
    }
    this.undefinedNote = span("hidden text-muted italic");
    this.undefinedNote.textContent = "heading undefined near vertical";
    legend.prepend(this.undefinedNote);
    this.note = document.createElement("div");
    this.note.className = "absolute top-1 right-1.5 text-right text-[9px] whitespace-nowrap text-muted";
    this.tips = {
      water: span("absolute -translate-x-1/2 -translate-y-full", ARROW_COLORS.water),
      current: span("absolute -translate-x-1/2 -translate-y-full", ARROW_COLORS.current),
      ground: span("absolute -translate-x-1/2 -translate-y-full", ARROW_COLORS.ground),
      north: span("absolute -translate-x-1/2 -translate-y-1/2 text-muted"),
    };
    this.tips.north.textContent = "N";
    el.append(title, this.note, legend, ...Object.values(this.tips));
    host.appendChild(el);
    this.overlay = el;
    this.setVisible(false);
  }

  /** The note in the inset's corner: the frame, and what the speeds are (constant, before fix pinning). */
  describe(track: Track, frame: "heading" | "north", scale: number): void {
    this.frame = frame;
    const lines = [`${frame === "heading" ? "heading up" : "north up"}, ring 1 m/s`];
    const tips = [scale === 1 ? "One body length per 1 m/s." : `${scale} body lengths per 1 m/s.`];
    const sp = track.speed;
    if (sp) {
      let lo = Infinity;
      let hi = -Infinity;
      for (const x of sp) if (Number.isFinite(x)) [lo, hi] = [Math.min(lo, x), Math.max(hi, x)];
      if (hi - lo < 1e-6 && Number.isFinite(lo)) {
        lines.push(`water speed fixed ${lo.toFixed(2)}`);
        tips.push(`Dead reckoning assumed a constant ${lo.toFixed(2)} m/s through the water.`);
      }
    } else lines.push("no water speed");
    const { turnDeg, scale: k } = placementOf(track);
    if (Math.abs(k - 1) > 1e-6 || Math.abs(turnDeg) > 1e-6) {
      lines.push(`before pinning (x${k.toFixed(2)}, ${turnDeg.toFixed(0)} deg)`);
      tips.push(
        `Drawn as dead reckoning combined them, before fix pinning scaled the track ${k.toFixed(2)}x and turned it ${turnDeg.toFixed(0)} deg (the turn absorbs the magnetic declination and any heading bias).`,
      );
    } else if (track.headingSource === "tag") {
      // biologger-sim's heading is the tilt-compensated magnetometer's, with no declination applied.
      lines.push("magnetic heading");
      tips.push("The heading is magnetic, with no declination applied, as dead reckoning used it.");
    }
    this.note.replaceChildren(...lines.map((l) => Object.assign(document.createElement("div"), { textContent: l })));
    this.overlay.title = tips.join(" ");
  }

  /** The species model at unit length (head toward -z), drawn translucent with its edges; null for the stand-in. */
  setModel(model: AnimalModel | null): void {
    this.clearBody();
    const faces = new THREE.MeshLambertMaterial({ color: 0x9fb4cc, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide });
    const lines = new THREE.LineBasicMaterial({ color: 0xcfe0f5, transparent: true, opacity: 0.55 });
    if (model) {
      let edges = edgeCache.get(model.geometry);
      if (!edges) edgeCache.set(model.geometry, (edges = new THREE.EdgesGeometry(model.geometry, 25)));
      this.body.add(new THREE.Mesh(model.geometry, faces), new THREE.LineSegments(edges, lines));
    } else {
      // The 3D view's stand-in: an elongated cone, head toward -z, with a dorsal fin toward +y.
      const cone = new THREE.ConeGeometry(0.18, 1, 12).rotateX(-Math.PI / 2);
      const fin = new THREE.BoxGeometry(0.02, 0.25, 0.3).translate(0, 0.15, 0.1);
      const edges = new THREE.EdgesGeometry(cone);
      this.standIn = [cone, fin, edges];
      this.body.add(new THREE.Mesh(cone, faces), new THREE.LineSegments(edges, lines), new THREE.Mesh(fin, faces.clone()));
    }
  }

  /** Removes the body, disposing its materials and the stand-in's geometry (a model's is shared and kept). */
  private clearBody(): void {
    for (const c of this.body.children) ((c as THREE.Mesh).material as THREE.Material).dispose();
    for (const g of this.standIn) g.dispose();
    this.standIn = [];
    this.body.clear();
  }

  setVisible(on: boolean): void {
    this.overlay.style.display = on ? "" : "none";
  }

  /** Sets the body and arrows for one frame; `scale` is body lengths per 1 m/s. */
  update(s: InspectorSample, scale: number): void {
    this.body.quaternion.copy(s.body);
    // Without a defined heading, the through-water and over-ground directions are not data, nor, heading up, is the
    // current's direction relative to the body. The body is still drawn from pitch and roll.
    const muted = (k: ArrowKey) => !s.headingDefined && (k !== "current" || this.frame === "heading");
    this.undefinedNote.style.display = s.headingDefined ? "none" : "block";
    let longest = 0.6;
    for (const k of Object.keys(this.arrows) as ArrowKey[]) {
      const v = s[k];
      const scaled = v ? this.v.copy(v).multiplyScalar(scale) : null;
      this.arrows[k].set(scaled);
      this.arrows[k].setMuted(muted(k));
      if (scaled) longest = Math.max(longest, scaled.length());
      this.values[k].textContent = cmPerS(v);
      this.values[k].style.opacity = muted(k) ? "0.45" : "";
    }
    this.ring.scale.setScalar(scale);
    // Ease the framing toward the longest arrow, so a gust of current does not jolt the view.
    this.reach += (Math.max(longest, scale * 0.5) - this.reach) * 0.08;
    // From the right, a little behind and above: arrows along the heading run across the inset, not into it.
    const d = (this.reach * 1.05) / Math.tan((this.camera.fov / 2) * (Math.PI / 180));
    this.camera.position.set(1, 0.6, 0.7).normalize().multiplyScalar(d);
    this.camera.lookAt(0, 0, 0);
    this.camera.updateMatrixWorld();
    this.place(this.tips.north, s.north.clone().multiplyScalar(scale * 1.12));
    for (const k of Object.keys(this.arrows) as ArrowKey[]) {
      const v = s[k];
      this.tips[k].style.display = v && !muted(k) && v.length() * scale > 0.05 ? "" : "none";
      if (v && this.tips[k].style.display === "") {
        this.tips[k].textContent = cmPerS(v).replace(" cm/s", "");
        this.place(this.tips[k], this.v.copy(v).multiplyScalar(scale));
      }
    }
  }

  /** Moves a label to a point in the inset scene. */
  private place(el: HTMLElement, p: THREE.Vector3): void {
    const ndc = p.clone().project(this.camera);
    el.style.left = `${((ndc.x + 1) / 2) * INSET.size}px`;
    el.style.top = `${((1 - ndc.y) / 2) * INSET.size}px`;
  }

  /** Draws the inset into its corner of a canvas `w` x `h` CSS px, after the main scene. */
  render(renderer: THREE.WebGLRenderer, w: number, h: number): void {
    const s = INSET.size;
    if (w < s + INSET.right * 2 || h < s + INSET.bottom + 8) return;
    const x = w - INSET.right - s;
    const y = INSET.bottom; // from the bottom edge, as WebGL counts
    renderer.setScissorTest(true);
    renderer.setViewport(x, y, s, s);
    renderer.setScissor(x, y, s, s);
    renderer.render(this.scene, this.camera);
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, w, h);
  }

  dispose(): void {
    this.clearBody();
    for (const a of Object.values(this.arrows)) a.dispose();
    for (const o of this.owned) o.dispose();
    this.overlay.remove();
  }
}
