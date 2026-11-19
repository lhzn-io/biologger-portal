/**
 * The physics inspector inset: the animal at its attitude with the velocities and accelerations acting on it, drawn
 * by the 3D view's own renderer into scissored viewports in the bottom-right corner (one WebGL context, at the
 * scene's pixel ratio, so the inset is never a small buffer stretched up). One pane, or two side by side, the
 * second looking from 90 degrees to the right of the first, sharing one scene and one camera the viewer can turn.
 * Labels are HTML over the inset, moved each frame; the header with the toggles and the (i) explainer is
 * InspectorChrome.
 *
 * Built once per scene; each frame only sets the body's quaternion, the arrows' lengths and directions, and the
 * cameras.
 */
import CameraControls from "camera-controls";
import * as THREE from "three";
import { createVantage, type Vantage } from "../vendor/vantagekit/vantagekit-three.js";
import type { AnimalModel } from "./animal";
import { mPerS, mPerS2, placementOf, type InspectorCamera, type InspectorOptions, type InspectorSample } from "./inspector";
import type { Track } from "./track";

/** One pane's size and the inset's offsets from the view's right and bottom edges (CSS px; bottom clears the credits). */
export const INSET = { size: 220, right: 8, bottom: 32 };

/** The inset's pane size, and its overall width and height, for a camera choice and size (CSS px). */
export function insetBox(o: { pair: boolean; large: boolean }): { pane: number; width: number; height: number } {
  const pane = INSET.size * (o.large ? 2 : 1);
  return { pane, width: pane * (o.pair ? 2 : 1), height: pane };
}

/**
 * Arrow colors: swimming through the water (blue), the current (green, as the current track colors), over the
 * ground (amber), the vertical speed from the depth record (violet), the dynamic acceleration (pink), gravity
 * (light gray), and the slip vectors: the body's long axis (red) and the direction of travel (lime), as the
 * Omniverse viewer's debug vectors draw them.
 */
export const ARROW_COLORS = {
  water: "#60a5fa",
  current: "#34d399",
  ground: "#fbbf24",
  vertical: "#a78bfa",
  dynamic: "#f472b6",
  gravity: "#cbd5e1",
  axis: "#f87171",
  path: "#a3e635",
} as const;

/** Body lengths per 1 m/s^2 for the accelerations, whatever the velocity scale (gravity is about 2 body lengths). */
export const ACCEL_SCALE = 0.2;

/** The slip vectors' length in body lengths: they show directions, not speeds. */
export const AXIS_LEN = 1.1;

type ArrowKey = keyof typeof ARROW_COLORS;
const VELOCITIES: ArrowKey[] = ["water", "current", "ground", "vertical"];
const ACCELS: ArrowKey[] = ["dynamic", "gravity"];
const SLIP: ArrowKey[] = ["axis", "path"];
/** The arrows that carry a number at their tip (the slip vectors are directions only). */
const TIPPED: ArrowKey[] = [...VELOCITIES, ...ACCELS];
/** Legend names, short; the (i) explainer says what each is. */
const LABELS: Record<ArrowKey, string> = {
  water: "swim",
  current: "current",
  ground: "ground",
  vertical: "vert",
  dynamic: "dynamic",
  gravity: "gravity",
  axis: "axis",
  path: "path",
};
/** Each pane's caption: the first pane's, then the second's (90 degrees to the right of the first). */
const CAPTIONS: Record<InspectorCamera, [string, string]> = {
  behind: ["from behind (roll)", "from the right (pitch)"],
  side: ["from the right (pitch)", "from the front"],
  free: ["", "90° to the right"],
};
const HEAD_R = 0.012;
const HEAD_LEN = 0.05;
const UP = new THREE.Vector3(0, 1, 0);
/**
 * Vertical field of view (deg). Narrow, from farther out, close to a flat projection: up close, the end of the body
 * nearer the camera is drawn much larger than the far end, and a swordfish's raised tail lobe, seen from behind,
 * passes for its bill pointing at the viewer.
 */
const FOV = 14;
/** How far a tip label sits past its arrow's tip, and how far from the middle at least (clear of the body), in px. */
const TIP_GAP = 8;
const TIP_CLEAR = 0.17; // of the pane's size
const MUTED = new THREE.Color("#6b7280");

/**
 * An arrow from the origin: a hairline shaft (a WebGL line, one device pixel wide at any zoom) and a small, slender
 * cone, so several vectors can overlap and still be told apart.
 */
class Arrow {
  readonly group = new THREE.Group();
  private readonly shaft: THREE.Line;
  private readonly head: THREE.Mesh;
  private readonly dir = new THREE.Vector3();
  private readonly lineMat: THREE.LineBasicMaterial;
  private readonly headMat: THREE.MeshBasicMaterial;
  private readonly color: THREE.Color;

  constructor(color: string) {
    this.color = new THREE.Color(color);
    this.lineMat = new THREE.LineBasicMaterial({ color, transparent: true });
    this.headMat = new THREE.MeshBasicMaterial({ color, transparent: true });
    this.shaft = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), UP]), this.lineMat);
    this.head = new THREE.Mesh(new THREE.ConeGeometry(HEAD_R, 1, 12).translate(0, 0.5, 0), this.headMat);
    this.group.add(this.shaft, this.head);
  }

  /** Gray and faint where the arrow depends on a heading that is undefined here. */
  setMuted(muted: boolean): void {
    const c = muted ? MUTED : this.color;
    for (const m of [this.lineMat, this.headMat]) {
      m.color.copy(c);
      m.opacity = muted ? 0.45 : 1;
    }
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
    this.lineMat.dispose();
    this.headMat.dispose();
  }
}

/** One viewport onto the inset's scene: its camera, where it sits in the inset, its caption and its labels. */
class Pane {
  readonly camera = new THREE.PerspectiveCamera(FOV, 1, 0.01, 200);
  readonly el = document.createElement("div");
  readonly tips: Record<ArrowKey | "north" | "ring", HTMLSpanElement>;
  readonly caption = document.createElement("div");
  left = 0;
  size = INSET.size;
  private readonly ndc = new THREE.Vector3();

  constructor(span: (cls: string, color?: string) => HTMLSpanElement) {
    this.el.className = "pointer-events-none absolute top-0 overflow-hidden";
    const centered = "absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap";
    const tip = (k: ArrowKey) => span(centered, ARROW_COLORS[k]);
    this.tips = Object.fromEntries((Object.keys(ARROW_COLORS) as ArrowKey[]).map((k) => [k, tip(k)])) as Pane["tips"];
    this.tips.north = span(`${centered} text-muted`);
    this.tips.north.textContent = "N";
    this.tips.ring = span("absolute -translate-y-1/2 pl-1 whitespace-nowrap text-muted"); // the ring's own label
    this.tips.ring.textContent = "1 m/s";
    this.caption.className = "absolute inset-x-0 text-center text-muted";
    this.el.append(this.caption, ...Object.values(this.tips));
  }

  layout(left: number, size: number, caption: string, top: number): void {
    this.left = left;
    this.size = size;
    Object.assign(this.el.style, { left: `${left}px`, width: `${size}px`, height: `${size}px` });
    this.caption.textContent = caption;
    this.caption.style.top = `${top}px`;
  }

  /** Where a scene point falls in this pane, in px from its top left. */
  private screen(p: THREE.Vector3): [number, number] {
    const v = this.ndc.copy(p).project(this.camera);
    return [((v.x + 1) / 2) * this.size, ((1 - v.y) / 2) * this.size];
  }

  /** Moves a label to a point in the inset scene, as this pane's camera sees it. */
  place(el: HTMLElement, p: THREE.Vector3): void {
    const [x, y] = this.screen(p);
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
  }

  /**
   * Puts an arrow's label just past its tip, along the arrow as drawn, and never closer to the middle than the body
   * reaches, so a short arrow's number is not hidden behind the body. An arrow pointing at the camera (no direction
   * on screen) gets its label up and to the right.
   */
  placeTip(el: HTMLElement, tip: THREE.Vector3): void {
    const [cx, cy] = this.screen(this.ndc.set(0, 0, 0));
    const [tx, ty] = this.screen(tip);
    let dx = tx - cx;
    let dy = ty - cy;
    const len = Math.hypot(dx, dy);
    [dx, dy] = len > 1 ? [dx / len, dy / len] : [Math.SQRT1_2, -Math.SQRT1_2];
    const r = Math.max(len + TIP_GAP, this.size * TIP_CLEAR);
    el.style.left = `${cx + dx * r}px`;
    el.style.top = `${cy + dy * r}px`;
  }

  /** Labels the level ring at its edge on the right of this pane's view. */
  placeRing(el: HTMLElement, radius: number): void {
    const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0);
    right.y = 0;
    if (right.lengthSq() < 1e-9) right.set(1, 0, 0); // looking straight down: any edge will do
    this.place(el, right.setLength(radius));
  }
}

/** Edges of a species model, built once per model (the geometry is shared through the model cache). */
const edgeCache = new WeakMap<THREE.BufferGeometry, THREE.EdgesGeometry>();

const fmtDeg = (d: number) => (Number.isFinite(d) ? `${Math.round(d)}°` : "--");
const fmtSigned = (d: number) => (Number.isFinite(d) ? `${d >= 0 ? "+" : "-"}${Math.abs(Math.round(d))}°` : "--");
/** A vertical velocity as the legend gives it: m/s to 0.01, up positive. */
const signedMPerS = (v: THREE.Vector3 | null) => (v ? `${v.y >= 0 ? "+" : "-"}${Math.abs(v.y).toFixed(2)} m/s` : "--");

export class InspectorView {
  private readonly scene = new THREE.Scene();
  private readonly panes: [Pane, Pane];
  private readonly body = new THREE.Group();
  private readonly arrows: Record<ArrowKey, Arrow>;
  private readonly ring: THREE.LineLoop;
  private readonly overlay: HTMLDivElement;
  private readonly rows: Record<ArrowKey, HTMLDivElement>;
  private readonly values: Record<ArrowKey, HTMLSpanElement>;
  private readonly attitudeLine: HTMLDivElement;
  private readonly undefinedNote: HTMLSpanElement;
  /**
   * The one camera the viewer moves (the first pane's), with vantagekit's fixed pivot, as for a viewer of one object:
   * a drag anywhere on the inset turns it, the wheel zooms, no pan. The second pane follows it at 90 degrees.
   */
  private readonly nav: Vantage;
  private readonly surface: HTMLDivElement;
  private opts: InspectorOptions = { frame: "heading", scale: 1, gravity: false, camera: "side", pair: false, large: false, slip: false };
  private box = insetBox(this.opts);
  /** The snapped camera the view follows each frame, or null while it is free. */
  private snap: "behind" | "side" | null = "side";
  /** No view placed yet: a free camera before any snap starts from the side. */
  private unplaced = true;
  private turnDeg = 0;
  private pinScale = 1;
  private hasAccel = false;
  private readonly owned: (THREE.BufferGeometry | THREE.Material)[] = [];
  private standIn: THREE.BufferGeometry[] = [];
  private reach = 1.2; // the radius the cameras frame, eased toward the longest arrow
  private lastUpdate = performance.now(); // for vantagekit's time steps
  private dist = 0; // the camera's distance from the body
  private readonly v = new THREE.Vector3();
  private readonly eye = new THREE.Vector3();

  constructor(host: HTMLElement) {
    this.scene.background = new THREE.Color("#111a2e");
    // Distance fog toward the background: the near side of the body is bright and the far side fades, so a view
    // from behind cannot be read as one from in front (the translucent edges otherwise show both sides at once).
    this.scene.fog = new THREE.Fog("#111a2e", 1, 2);
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

    const keys = Object.keys(ARROW_COLORS) as ArrowKey[];
    this.arrows = Object.fromEntries(keys.map((k) => [k, new Arrow(ARROW_COLORS[k])])) as Record<ArrowKey, Arrow>;
    for (const a of Object.values(this.arrows)) this.scene.add(a.group);

    const el = document.createElement("div");
    el.className = "absolute overflow-hidden rounded-b border border-line font-mono text-[10px] leading-tight";
    Object.assign(el.style, { right: `${INSET.right}px`, bottom: `${INSET.bottom}px` });
    el.setAttribute("aria-label", "Physics inspector: the animal's attitude and the vectors acting on it");
    const span = (cls: string, color?: string) => {
      const s = document.createElement("span");
      s.className = cls;
      if (color) s.style.color = color;
      return s;
    };
    this.panes = [new Pane(span), new Pane(span)];
    this.attitudeLine = document.createElement("div");
    this.attitudeLine.className = "absolute top-1 left-1.5 text-ink";
    this.attitudeLine.append(document.createElement("div"), document.createElement("div"));
    const legend = document.createElement("div");
    legend.className = "absolute bottom-1 left-1.5 space-y-px";
    this.undefinedNote = span("hidden text-muted italic");
    this.undefinedNote.textContent = "heading undefined near vertical";
    legend.append(this.undefinedNote);
    this.values = {} as Record<ArrowKey, HTMLSpanElement>;
    this.rows = {} as Record<ArrowKey, HTMLDivElement>;
    for (const k of keys) {
      const row = document.createElement("div");
      const swatch = span("", ARROW_COLORS[k]);
      swatch.textContent = "■ ";
      const label = span("text-muted");
      label.textContent = `${LABELS[k]} `;
      this.values[k] = span("text-ink");
      row.append(swatch, label, this.values[k]);
      this.rows[k] = row;
      legend.append(row);
    }
    // A surface over the whole inset takes the drags, the wheel and the double-click; the labels under it are
    // only drawn, never clicked.
    this.surface = document.createElement("div");
    this.surface.className = "absolute inset-0 cursor-grab active:cursor-grabbing";
    this.surface.title = "Drag to turn the view, wheel to zoom; double-click to return to the side view";
    el.append(...this.panes.map((p) => p.el), this.attitudeLine, legend, this.surface);
    host.appendChild(el);
    this.overlay = el;
    this.nav = createVantage({
      THREE, CameraControls, camera: this.panes[0].camera, dom: this.surface, modes: ["orbit"], keys: false,
      gamepad: false, link: false, pad: "object", minDistance: 0.6, maxDistance: 80, maxPolarAngle: Math.PI,
    }); // prettier-ignore
    this.nav.setPivot("fixed", { emit: false });
    this.nav.controls.addEventListener("controlstart", () => this.release());
    this.surface.addEventListener("wheel", () => this.release(), { passive: true });
    this.surface.addEventListener("dblclick", () => this.setSnap("side"));
    this.layout();
    this.setVisible(false);
  }

  /** The viewer moved the view: it is no longer snapped behind or to the side, and the page is told so. */
  private release(): void {
    if (this.snap) this.setSnap(null);
  }

  /** Snaps the camera (or frees it, with null) from the inset itself, and tells the page so its buttons agree. */
  private setSnap(snap: "behind" | "side" | null): void {
    if (this.snap === snap) return;
    this.snap = snap;
    this.layout();
    this.opts.onCamera?.(snap ?? "free");
  }

  /** Sizes the inset and its panes, and captions them, for the current options and camera. */
  private layout(): void {
    const { pair, large } = this.opts;
    this.box = insetBox(this.opts);
    const { pane, width, height } = this.box;
    Object.assign(this.overlay.style, { width: `${width}px`, height: `${height}px`, fontSize: large ? "13px" : "" });
    const [a, b] = this.panes;
    const [ca, cb] = CAPTIONS[this.snap ?? "free"];
    const top = large ? 44 : 34; // below the two lines of the attitude readout
    a.layout(0, pane, ca, top);
    b.layout(pane, pane, cb, top);
    b.el.style.display = pair ? "" : "none";
  }

  /** Which rows the legend shows, the layout, and the camera the page chose. */
  describe(track: Track, opts: InspectorOptions): void {
    this.opts = opts;
    // A snapped camera from the page; "free" keeps the view where the viewer left it.
    this.snap = opts.camera === "free" ? null : opts.camera;
    this.layout();
    this.hasAccel = track.accel != null;
    const { turnDeg, scale: k } = placementOf(track);
    this.turnDeg = turnDeg;
    this.pinScale = k;
    this.rows.dynamic.style.display = this.hasAccel ? "" : "none";
    this.rows.gravity.style.display = this.hasAccel && opts.gravity ? "" : "none";
    for (const s of SLIP) this.rows[s].style.display = opts.slip ? "" : "none";
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

  /** The panes drawn with the current options. */
  private get active(): Pane[] {
    return this.opts.pair ? this.panes : [this.panes[0]];
  }

  /**
   * Moves the camera for this frame. Snapped behind or to the right, it follows the heading, a little above the level
   * ring, so roll and pitch read against the horizon. Free, it stays where the viewer turned it; with the scene
   * locked to the heading (as the page always draws it), the view keeps its angle to the animal as it turns. The
   * second pane looks from 90 degrees to the right of the first.
   */
  private aim(s: InspectorSample, dt: number): void {
    const d = (this.reach * 1.05) / Math.tan((FOV / 2) * (Math.PI / 180));
    const f = s.forward;
    const right = f.clone().cross(UP);
    let dir: THREE.Vector3 | null = null;
    if (this.snap === "behind") dir = f.clone().negate().addScaledVector(UP, 0.12);
    else if (this.snap === "side" || this.unplaced) dir = right.clone().addScaledVector(UP, 0.12);
    // Any placement settles the view: freed later, it stays where it was.
    if (dir) this.unplaced = false;
    // Through vantagekit, so that a drag starts from exactly this view.
    if (dir) void this.nav.setLookAt(this.eye.copy(dir.normalize().multiplyScalar(d)), [0, 0, 0]);
    this.nav.update(dt);
    const [a, b] = this.panes;
    a.camera.updateMatrixWorld();
    this.dist = a.camera.position.length();
    if (this.opts.pair) {
      b.camera.position.copy(a.camera.position).applyAxisAngle(UP, Math.PI / 2);
      b.camera.up.copy(UP);
      b.camera.lookAt(0, 0, 0);
      b.camera.updateMatrixWorld();
    }
  }

  /** Sets the body, arrows, cameras and labels for one frame. */
  update(s: InspectorSample): void {
    const { frame, scale, gravity, slip } = this.opts;
    this.body.quaternion.copy(s.body);
    // Without a defined heading, the through-water and over-ground directions are not data, nor is the path, nor,
    // locked to the heading, is the current's direction relative to the body, nor, locked to north, are the
    // accelerations' compass directions or the body axis's. The body is still drawn from pitch and roll.
    const muted = (k: ArrowKey) =>
      !s.headingDefined &&
      (k === "water" || k === "ground" || k === "path" || (k === "current" ? frame === "heading" : frame === "north"));
    const shown = (k: ArrowKey) => (k === "gravity" ? gravity : SLIP.includes(k) ? slip : true);
    const vec = (k: ArrowKey): THREE.Vector3 | null => (k === "axis" ? s.axis : s[k]);
    const scaled = (k: ArrowKey, v: THREE.Vector3) =>
      SLIP.includes(k) ? this.v.copy(v).setLength(AXIS_LEN) : this.v.copy(v).multiplyScalar(ACCELS.includes(k) ? ACCEL_SCALE : scale);
    this.undefinedNote.style.display = s.headingDefined ? "none" : "block";
    // Roll, pitch and yaw: the attitude the body is drawn at (yaw is the tag's heading). On a track pinned to its end
    // fix, a second line gives the heading it moves along on the map, after the pinning turn and scale.
    const [rpy, mapped] = this.attitudeLine.children as unknown as [HTMLElement, HTMLElement];
    rpy.textContent = `r ${fmtDeg(s.rollDeg)} p ${fmtDeg(s.pitchDeg)} y ${s.headingDefined ? fmtDeg(s.headingDeg) : "--"}`;
    const pinned = Math.abs(this.turnDeg) > 1e-6 || Math.abs(this.pinScale - 1) > 1e-6;
    mapped.textContent = pinned
      ? `hdg ${s.headingDefined ? fmtDeg(s.placedHeadingDeg) : "--"} (pin ${fmtSigned(this.turnDeg)} ×${this.pinScale.toFixed(2)})`
      : "";
    let longest = 0.6;
    for (const k of Object.keys(this.arrows) as ArrowKey[]) {
      const v = shown(k) ? vec(k) : null;
      const drawn = v && v.length() > 1e-6 ? scaled(k, v) : null;
      this.arrows[k].set(drawn);
      this.arrows[k].setMuted(muted(k));
      if (drawn) longest = Math.max(longest, drawn.length());
      // The vertical speed signed (up positive), the other velocities and accelerations as magnitudes.
      this.values[k].textContent =
        k === "vertical"
          ? signedMPerS(s.vertical)
          : VELOCITIES.includes(k)
            ? mPerS(s[k as "water"])
            : ACCELS.includes(k)
              ? mPerS2(s[k as "dynamic"])
              : k === "path" && !muted(k)
                ? `attack ${fmtSigned(s.attackDeg)} slip ${fmtSigned(s.sideslipDeg)}`
                : k === "path"
                  ? "--"
                  : "";
      this.values[k].style.opacity = muted(k) ? "0.45" : "";
    }
    this.ring.scale.setScalar(scale);
    // Ease the framing toward the longest arrow, so a gust of current does not jolt the view.
    this.reach += (Math.max(longest, scale * 0.5) - this.reach) * 0.08;
    const now = performance.now();
    const dt = Math.min(0.1, Math.max(0, (now - this.lastUpdate) / 1000));
    this.lastUpdate = now;
    this.aim(s, dt);
    for (const p of this.active) {
      p.place(p.tips.north, s.north.clone().multiplyScalar(scale * 1.12));
      p.placeRing(p.tips.ring, scale);
      for (const k of Object.keys(this.arrows) as ArrowKey[]) {
        const v = shown(k) && TIPPED.includes(k) ? vec(k) : null;
        const on = !!v && !muted(k) && v.length() > 1e-6;
        p.tips[k].style.display = on ? "" : "none";
        if (on && v) {
          // Bare numbers by the arrows, in the legend's units: m/s to 0.01, m/s^2 to 0.1.
          p.tips[k].textContent = v.length().toFixed(VELOCITIES.includes(k) ? 2 : 1);
          p.placeTip(p.tips[k], scaled(k, v));
        }
      }
    }
  }

  /** Draws the inset's panes into their corner of a canvas `w` x `h` CSS px, after the main scene. */
  render(renderer: THREE.WebGLRenderer, w: number, h: number): void {
    const { width, height } = this.box;
    if (w < width + INSET.right * 2 || h < height + INSET.bottom + 8) return;
    renderer.setScissorTest(true);
    const fog = this.scene.fog as THREE.Fog;
    // Clear up to the body's near end (it is one unit long), fading to the background 2.5 units behind its middle:
    // the far end of the body is a third faded, the far side of the 1 m/s ring half, and long arrows stay visible.
    // Both panes are the same distance out.
    fog.near = this.dist - 0.5;
    fog.far = this.dist + 2.5;
    for (const p of this.active) {
      const x = w - INSET.right - width + p.left;
      const y = INSET.bottom; // from the bottom edge, as WebGL counts
      renderer.setViewport(x, y, p.size, p.size);
      renderer.setScissor(x, y, p.size, p.size);
      renderer.render(this.scene, p.camera);
    }
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, w, h);
  }

  dispose(): void {
    this.clearBody();
    for (const a of Object.values(this.arrows)) a.dispose();
    for (const o of this.owned) o.dispose();
    this.nav.dispose();
    this.overlay.remove();
  }
}
