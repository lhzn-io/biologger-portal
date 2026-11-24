import { useEffect, useRef, type RefObject } from "react";
import * as THREE from "three";
import CameraControls from "camera-controls";
import { Line2 } from "three/examples/jsm/lines/Line2.js";
import { LineGeometry } from "three/examples/jsm/lines/LineGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { createVantage, type Vantage } from "../vendor/vantagekit/vantagekit-three.js";
import { activityColor, LINE_POINTS, segmentMeans } from "./activity";
import { CurrentArrowLayer } from "./arrowLayer";
import { loadAnimalModel } from "./animal";
import { currentColor } from "./current";
import { inspectorSample, type InspectorOptions } from "./inspector";
import { InspectorView } from "./inspectorView";
import { angleAt, valueAt } from "./playback";
import { elevationAt, elevationColor, trackDepthColor, type Dem } from "./dem";
import type { TrackColor } from "./link";
import { EARTH_RADIUS_M, indexAt, strideIndices, type Track } from "./track";
import { arrowLines, hoverSample, projector, sampleLines } from "./hover";
import { nearestSample } from "./pick";
import { holdViewForWheel } from "./wheel";

/** Scene units are 100 m (vantagekit metersPerUnit), as in topobathykit's DEM viewer. */
const S = 0.01;
const D2R = Math.PI / 180;
const MAX_MESH_SIDE = 512; // terrain vertices per side; the full grid is kept for depth lookups

interface SceneState {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  nav: Vantage;
  terrain: THREE.Mesh | null;
  terrainZ: Float32Array | null; // elevation (m) per terrain vertex, for rescaling
  line: Line2;
  lineIdx: number[];
  marker: THREE.Group;
  drop: THREE.Line;
  exag: number;
  frame: number;
  trueLen: number; // the animal's true length in scene units
  cursor: number; // where the marker is placed: a sample index, fractional between samples
  others: OtherState[];
  inspector: InspectorView;
  /** The current arrows along the track, when the track has a current correction. */
  arrows: CurrentArrowLayer | null;
}

/** Another reconstruction of the same deployment, drawn in one color with a dot where it is at the cursor time. */
export interface OtherTrack {
  key: string;
  track: Track;
  color: string;
}

interface OtherState {
  track: Track;
  line: Line2;
  idx: number[];
  dot: THREE.Group;
}

/** The dot marking another track's position at the cursor time (pixels across, without its outline). */
const DOT_PX = 12;

/** Length (m) assumed for the stand-in marker when no species model is loaded. */
const DEFAULT_LENGTH_M = 2.5;
/** The smallest the animal is drawn on screen (pixels along its body). */
const MARKER_PX = 40;
/** How large "Zoom to animal" makes the animal on screen (pixels, at true size). */
const FOCUS_PX = 160;

/** Camera actions the page's controls call. */
export interface SceneView {
  /** Glide the orbit point to the animal at the cursor and come in close, keeping the viewing angle. */
  focusAnimal(): void;
  /**
   * Bring the camera to the animal for playback. Chase: behind it, a little above its line of travel, at the chase
   * distance. Orbit: keeping the viewing angle, far enough out to show the track `halfWindow` samples either side
   * of the cursor. Skipped when the viewer has zoomed or dragged during playback since the last forced approach.
   */
  approach(mode: "chase" | "orbit", halfWindow: number, force: boolean): void;
  /** Return to the view the scene opened with. */
  home(): void;
  /** Glide the orbit point to the animal at sample `i`, keeping the current viewing distance and angle. */
  centerOn(i: number): void;
  /** Turn the camera in place to face the animal at sample `i`; the camera does not move. */
  lookAt(i: number): void;
  /** Write the camera and the page's parameters to the URL now (the camera's own moves write it as they settle). */
  writeLink(): void;
}

/** A wheel event this long after the previous one starts a new zoom gesture. */
const WHEEL_GESTURE_MS = 250;
/**
 * Chase keeps the camera's attitude within this tolerance of the animal's heading and pitch, so tail beats and small
 * course wobbles do not shake the view; beyond it, the camera catches up with this time constant (s, on screen).
 */
const CHASE_TOLERANCE_DEG = 10;
const CHASE_CATCHUP_S = 0.6;
/** Chase starts this far above the animal's line of travel (deg), at the distance where the animal spans CHASE_PX. */
const CHASE_ELEVATION_DEG = 15;
const CHASE_PX = 80;
/** Orbit's starting distance leaves this much room around the track it frames. */
const ORBIT_FRAME_MARGIN = 1.15;

export default function Scene3D({
  track,
  dem,
  cursor,
  exaggeration,
  colorBy = "depth",
  colorMax,
  follow = false,
  chase = false,
  species,
  viewRef,
  linkWrite,
  others,
  solidColor,
  inspector,
  onSeek,
  currentArrows = false,
  hover = true,
}: {
  track: Track;
  dem: Dem | null;
  cursor: number;
  exaggeration: number;
  /** Depth (m) the track's color ramp reaches at its deep end. */
  /** What the track is colored by: the animal's depth, its ODBA, or the applied current's speed (means per drawn
   * stretch for the last two). */
  colorBy?: TrackColor;
  /** The value (m, ODBA's unit, or m/s) the track's color ramp reaches at its far end. */
  colorMax: number;
  /** Hold the orbit point on the animal as the cursor moves (orbit and zoom only; no pan). */
  follow?: boolean;
  /**
   * Turn the view with the animal (with `follow`): the camera's angle to the animal's heading and pitch is held, to
   * within CHASE_TOLERANCE_DEG, so a camera set behind it stays behind it as it turns, climbs and dives.
   */
  chase?: boolean;
  /** Scientific name, to draw the animal with its species model where one is packed. */
  species?: string;
  viewRef?: RefObject<SceneView | null>;
  /** Adds the page's parameters whenever the camera is written to the URL; with it, the URL keeps the view. */
  linkWrite?: RefObject<((params: URLSearchParams) => void) | null>;
  /** Other reconstructions of the same deployment (same start fix, so the same north/east frame), for comparing. */
  others?: OtherTrack[];
  /** Draw this track in one color (CSS) instead of the `colorBy` ramp. */
  solidColor?: string;
  /** Show the physics inspector inset: its frame, body lengths per 1 m/s, and whether gravity is drawn. */
  inspector?: InspectorOptions | null;
  /** Called with the sample index when the viewer double-clicks on the track. */
  onSeek?: (at: number) => void;
  /** Draw arrows along the track where the water flows (tracks with a current correction only). */
  currentArrows?: boolean;
  /** Show a readout of the current arrow or track sample under the pointer. */
  hover?: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  const state = useRef<SceneState | null>(null);
  // The scene is rebuilt when the set of other tracks changes, not when the array is recreated.
  const othersRef = useRef(others);
  // Declared before the scene's build effect, so the build reads the latest list.
  useEffect(() => {
    othersRef.current = others;
  }, [others]);
  const othersKey = (others ?? []).map((o) => `${o.key}:${o.color}`).join("|");
  const chaseOn = useRef(chase);
  const followOn = useRef(follow);
  useEffect(() => {
    chaseOn.current = chase;
    followOn.current = follow;
  }, [chase, follow]);
  const inspectorOn = useRef(inspector);
  useEffect(() => {
    inspectorOn.current = inspector;
  }, [inspector]);
  const arrowsOn = useRef(currentArrows);
  useEffect(() => {
    arrowsOn.current = currentArrows;
  }, [currentArrows]);
  const onSeekRef = useRef(onSeek);
  useEffect(() => {
    onSeekRef.current = onSeek;
  }, [onSeek]);
  const hoverOn = useRef(hover);
  useEffect(() => {
    hoverOn.current = hover;
  }, [hover]);

  // Build the scene once per track and DEM.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const origin = track.manifest.origin;
    const cos0 = Math.cos(origin.lat * D2R);
    const xOf = (lon: number) => (lon - origin.lon) * D2R * EARTH_RADIUS_M * cos0 * S;
    const zOf = (lat: number) => -(lat - origin.lat) * D2R * EARTH_RADIUS_M * S;
    const exag = exaggeration;

    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#0b1220");
    const camera = new THREE.PerspectiveCamera(45, 1, 0.05, 20000);
    scene.add(new THREE.HemisphereLight(0xdfefff, 0x203040, 1.1));
    const sun = new THREE.DirectionalLight(0xffffff, 1.4);
    sun.position.set(-1, 2, 1);
    scene.add(sun);

    let terrain: THREE.Mesh | null = null;
    let terrainZ: Float32Array | null = null;
    if (dem) {
      const { width, height, bounds } = dem.meta;
      const [w, s, e, n] = bounds;
      const step = Math.max(1, Math.ceil(Math.max(width, height) / MAX_MESH_SIDE));
      const cols = Math.floor((width - 1) / step) + 1;
      const rows = Math.floor((height - 1) / step) + 1;
      const pos = new Float32Array(cols * rows * 3);
      const col = new Float32Array(cols * rows * 3);
      terrainZ = new Float32Array(cols * rows);
      // Each vertex is the mean of a step x step block of cells (NaN ignored), placed at the block's center: taking
      // every step-th cell instead aliases fine relief and survey texture into ribs on steep slopes.
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const gx = c * step;
          const gy = r * step;
          const bx = Math.min(step, width - gx);
          const by = Math.min(step, height - gy);
          let sum = 0;
          let count = 0;
          for (let y = gy; y < gy + by; y++) {
            for (let x = gx; x < gx + bx; x++) {
              const v = dem.grid[y * width + x]!;
              if (!Number.isNaN(v)) {
                sum += v;
                count++;
              }
            }
          }
          const z = count ? sum / count : NaN;
          const k = r * cols + c;
          terrainZ[k] = z;
          pos[k * 3] = xOf(w + ((gx + bx / 2) * (e - w)) / width);
          pos[k * 3 + 1] = Number.isNaN(z) ? 0 : z * exag * S;
          pos[k * 3 + 2] = zOf(n - ((gy + by / 2) * (n - s)) / height);
          const rgb = elevationColor(z);
          col.set(rgb, k * 3);
        }
      }
      const index: number[] = [];
      for (let r = 0; r < rows - 1; r++) {
        for (let c = 0; c < cols - 1; c++) {
          const a = r * cols + c;
          const b = a + 1;
          const d = a + cols;
          const f = d + 1;
          if ([a, b, d, f].some((v) => Number.isNaN(terrainZ![v]!))) continue; // no faces over missing cells
          index.push(a, d, b, b, d, f);
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
      geo.setIndex(index);
      geo.computeVertexNormals();
      terrain = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
      scene.add(terrain);
    }

    // Sea surface: a faint plane at 0 m over the track's area.
    const spanM = Math.max(
      ...(["north_m", "east_m"] as const).map((k) => {
        const arr = k === "north_m" ? track.north : track.east;
        let lo = Infinity;
        let hi = -Infinity;
        for (const v of arr) {
          if (v < lo) lo = v;
          if (v > hi) hi = v;
        }
        return hi - lo;
      }),
      1000,
    );
    const sea = new THREE.Mesh(
      new THREE.PlaneGeometry(spanM * 2 * S, spanM * 2 * S),
      new THREE.MeshBasicMaterial({ color: 0x3b9cff, transparent: true, opacity: 0.06, side: THREE.DoubleSide, depthWrite: false }),
    );
    sea.rotation.x = -Math.PI / 2;
    sea.position.set(((track.east[0]! + track.east[track.count - 1]!) / 2) * S, 0, (-(track.north[0]! + track.north[track.count - 1]!) / 2) * S);
    scene.add(sea);

    const lineIdx = strideIndices(track.count, LINE_POINTS);
    const lineGeo = new LineGeometry();
    lineGeo.setPositions(linePositions(track, lineIdx, exag));
    lineGeo.setColors(lineColors(track, lineIdx, colorBy, colorMax, solidColor));
    const lineMat = new LineMaterial({ vertexColors: true, linewidth: 2.5, worldUnits: false });
    const line = new Line2(lineGeo, lineMat);
    scene.add(line);

    // Where the water flows along the track: fine vectors, shown when zoomed in close enough (rebuilt each frame).
    const arrows = track.current ? new CurrentArrowLayer(track, S, dem, lineIdx) : null;
    if (arrows) scene.add(arrows.group);

    // Other reconstructions: thinner, one color each, and a dot at the cursor time.
    const otherMats: LineMaterial[] = [];
    const otherStates: OtherState[] = (othersRef.current ?? []).map((o) => {
      const idx = strideIndices(o.track.count, LINE_POINTS);
      const geo = new LineGeometry();
      geo.setPositions(linePositions(o.track, idx, exag));
      const mat = new LineMaterial({ color: new THREE.Color(o.color).getHex(), linewidth: 1.6, worldUnits: false });
      otherMats.push(mat);
      const l = new Line2(geo, mat);
      scene.add(l);
      // Drawn over the terrain and lines, with a dark outline, so it shows wherever the track runs.
      const dot = new THREE.Group();
      const ring = new THREE.Mesh(new THREE.SphereGeometry(1.35, 16, 12), new THREE.MeshBasicMaterial({ color: 0x0b1220, depthTest: false }));
      const fill = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), new THREE.MeshBasicMaterial({ color: o.color, depthTest: false }));
      ring.renderOrder = 10;
      fill.renderOrder = 11;
      dot.add(ring, fill);
      scene.add(dot);
      return { track: o.track, line: l, idx, dot };
    });

    // The animal, built at unit length with the head along -z (north at heading 0) and the back along +y, and
    // scaled every frame (see the loop). Until the species model loads, or without one, an elongated cone with a
    // dorsal fin stands in.
    const len = (spanM * S) / 40; // dash length for the drop line
    const marker = new THREE.Group();
    const body = new THREE.Mesh(new THREE.ConeGeometry(0.18, 1, 12), new THREE.MeshLambertMaterial({ color: 0x3b9cff }));
    body.rotation.x = -Math.PI / 2;
    marker.add(body);
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.25, 0.3), new THREE.MeshLambertMaterial({ color: 0xffffff }));
    fin.position.set(0, 0.15, 0.1);
    marker.add(fin);
    marker.rotation.order = "YXZ";
    scene.add(marker);
    const drop = new THREE.Line(
      new THREE.BufferGeometry().setAttribute("position", new THREE.BufferAttribute(new Float32Array(6), 3)),
      new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: len * 0.2, gapSize: len * 0.15 }),
    );
    scene.add(drop);

    const nav = createVantage({
      THREE,
      CameraControls,
      camera,
      dom: renderer.domElement,
      modes: ["orbit", "fly"],
      origin,
      axes: "x-east,y-up,-z-north",
      metersPerUnit: 1 / S,
      exaggeration: () => state.current?.exag ?? exag,
      mouse: "pan-left",
      minDistance: 0.05, // 5 m, close enough to see the animal at true size
      maxPolarAngle: Math.PI * 0.85,
      keys: "focus",
      link: linkWrite ? { app: { write: (p: URLSearchParams) => linkWrite.current?.(p) } } : false,
    });
    const bounds = new THREE.Box3().setFromObject(line);
    for (const o of otherStates) bounds.union(new THREE.Box3().setFromObject(o.line));
    nav.fitBox(bounds, { bearingDeg: 20, elevationDeg: 35, factor: 1.1 });
    nav.saveHome();
    // A shared link opens on its camera; Home still returns to the fitted view. The scene is rebuilt when the
    // terrain arrives, and the URL then holds the camera as the viewer left it, so the view carries over.
    if (linkWrite) {
      nav.readLink();
      nav.applyLink();
    }

    const resize = () => {
      const w = el.clientWidth || 600;
      const h = el.clientHeight || 400;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      lineMat.resolution.set(w, h);
      for (const m of otherMats) m.resolution.set(w, h);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(el);

    // Wheel zoom runs toward the orbit point, slowing as it nears it and creeping once it is closer than
    // minDistance. With the orbit point left at the middle of the track's box, zooming toward terrain or a
    // stretch of track elsewhere slowed to a crawl far from anything. So when a zoom gesture starts, the orbit
    // point slides along the line of sight to the depth of whatever is under the cursor; the view does not
    // move, and the zoom then slows only as the camera nears what it is heading for. This listener captures
    // on the container, so it runs before camera-controls handles the same event on the canvas. The slide is
    // made at once, from the camera's present pose, never eased: see holdViewForWheel for how an eased one
    // threw the view sideways.
    const ray = new THREE.Raycaster();
    let lastWheel = -Infinity;
    const onWheel = (e: WheelEvent) => {
      if (e.target !== renderer.domElement) return; // a wheel over the inspector inset zooms the inset only
      const fresh = e.timeStamp - lastWheel > WHEEL_GESTURE_MS;
      lastWheel = e.timeStamp;
      if (!fresh || nav.mode !== "orbit" || nav.pivot !== "free") return;
      const c = nav.controls;
      let along: number | null = null;
      const r = renderer.domElement.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
        const hit = ray.intersectObjects(terrain ? [marker, line, terrain] : [marker, line], true)[0];
        if (hit) {
          const eye = c.getPosition(new THREE.Vector3(), false);
          const dir = c.getTarget(new THREE.Vector3(), false).sub(eye).normalize();
          const d = hit.point.clone().sub(eye).dot(dir);
          if (d > c.minDistance) along = d;
        }
      }
      holdViewForWheel(c, along);
    };
    el.addEventListener("wheel", onWheel, { capture: true, passive: true });

    // A zoom or drag while following the animal keeps the viewer's distance and angle for later plays (approach).
    let adjusted = false;
    const onAdjust = () => {
      if (followOn.current) adjusted = true;
    };
    el.addEventListener("wheel", onAdjust, { passive: true });
    el.addEventListener("pointerdown", onAdjust);

    // A double-click on the track moves the time cursor, and the animal, to the sample under the pointer.
    const onDblClick = (e: MouseEvent) => {
      const seek = onSeekRef.current;
      if (!seek || e.target !== renderer.domElement) return;
      const r = renderer.domElement.getBoundingClientRect();
      const ex = st.exag;
      const at = (i: number, out: THREE.Vector3) => {
        const x = track.east[i]!;
        const y = track.depth[i]!;
        const z = track.north[i]!;
        return Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z) ? out.set(x * S, -y * ex * S, -z * S) : null;
      };
      const i = nearestSample(track.count, at, camera, e.clientX - r.left, e.clientY - r.top, r.width, r.height);
      if (i != null) seek(i);
    };
    el.addEventListener("dblclick", onDblClick);

    // Hover: a small readout of the current arrow, else the track sample, under a resting pointer. Hidden while a
    // button is down (dragging the view) and after a wheel turn, until the pointer moves again.
    const tip = document.createElement("div");
    tip.className =
      "pointer-events-none absolute z-10 hidden rounded border border-line bg-panel/90 px-1.5 py-1 font-mono text-[10px] leading-snug whitespace-pre text-ink";
    el.appendChild(tip);
    let pointer: [number, number] | null = null;
    let tipText = "";
    const hideTip = () => {
      pointer = null;
      tip.classList.add("hidden");
    };
    const onPointerMove = (e: PointerEvent) => {
      if (e.buttons || e.target !== renderer.domElement) return hideTip();
      const r = renderer.domElement.getBoundingClientRect();
      pointer = [e.clientX - r.left, e.clientY - r.top];
    };
    el.addEventListener("pointermove", onPointerMove);
    el.addEventListener("pointerleave", hideTip);
    el.addEventListener("pointerdown", hideTip);
    el.addEventListener("wheel", hideTip, { passive: true });

    const clock = new THREE.Clock();
    const lookAt = new THREE.Vector3(); // the point the camera looks at, for sizing the current arrows
    let chaseAtt: { yaw: number; pitch: number } | null = null; // the attitude the chase camera last turned to
    const st: SceneState = {
      renderer, scene, camera, nav, terrain, terrainZ, line, lineIdx, marker, drop, exag, frame: 0,
      trueLen: DEFAULT_LENGTH_M * S, cursor, others: otherStates, inspector: new InspectorView(el), arrows,
    }; // prettier-ignore
    let described = ""; // the inspector settings its corner note was last written for
    // Scene units per screen pixel at distance d from the camera.
    const perPixel = (d: number) => (2 * d * Math.tan((camera.fov * D2R) / 2)) / (el.clientHeight || 400);
    state.current = st;
    placeMarker(st, track, dem, cursor);
    if (viewRef) {
      viewRef.current = {
        focusAnimal: () => {
          const c = nav.controls;
          const p = st.marker.position;
          void c.setFocalOffset(0, 0, 0, true);
          void c.moveTo(p.x, p.y, p.z, true);
          // close enough that the animal, at true size, spans FOCUS_PX on screen
          void c.dollyTo(Math.max(c.minDistance, st.trueLen / perPixel(1) / FOCUS_PX), true);
        },
        approach: (mode, halfWindow, force) => {
          if (force) adjusted = false;
          if (adjusted) return;
          const c = nav.controls;
          const p = st.marker.position;
          void c.setFocalOffset(0, 0, 0, true);
          void c.moveTo(p.x, p.y, p.z, true);
          if (mode === "chase") {
            const polar = Math.PI / 2 - CHASE_ELEVATION_DEG * D2R + st.marker.rotation.x;
            const azimuth = c.azimuthAngle + wrapAngle(st.marker.rotation.y - c.azimuthAngle); // the short way round
            void c.rotateTo(azimuth, Math.min(Math.max(polar, c.minPolarAngle), c.maxPolarAngle), true);
            void c.dollyTo(Math.max(c.minDistance, st.trueLen / perPixel(1) / CHASE_PX), true);
            chaseAtt = { yaw: st.marker.rotation.y, pitch: st.marker.rotation.x };
          } else {
            // the farthest track point within the window, seen whole in the narrower of the two fields of view
            const i = Math.round(st.cursor);
            const lo = Math.max(0, i - Math.round(halfWindow));
            const hi = Math.min(track.count - 1, i + Math.round(halfWindow));
            const step = Math.max(1, Math.floor((hi - lo) / 500));
            let r = 0;
            for (let k = lo; k <= hi; k += step) {
              const d = Math.hypot(track.east[k]! * S - p.x, -track.depth[k]! * st.exag * S - p.y, -track.north[k]! * S - p.z);
              if (Number.isFinite(d) && d > r) r = d;
            }
            const half = Math.min(camera.fov * D2R, 2 * Math.atan(Math.tan((camera.fov * D2R) / 2) * camera.aspect)) / 2;
            const fit = (r / Math.sin(half)) * ORBIT_FRAME_MARGIN;
            void c.dollyTo(Math.max(c.minDistance, fit, st.trueLen / perPixel(1) / CHASE_PX), true);
          }
        },
        home: () => nav.home(true),
        writeLink: () => {
          nav.writeLink();
        },
        centerOn: (i: number) => {
          const c = nav.controls;
          const x = track.east[i]! * S;
          const y = -track.depth[i]! * st.exag * S;
          const z = -track.north[i]! * S;
          if (!Number.isFinite(x + y + z)) return;
          void c.setFocalOffset(0, 0, 0, true);
          void c.moveTo(x, y, z, true); // the camera keeps its offset from the orbit point: same distance and angle
        },
        lookAt: (i: number) => {
          const c = nav.controls;
          const x = track.east[i]! * S;
          const y = -track.depth[i]! * st.exag * S;
          const z = -track.north[i]! * S;
          if (!Number.isFinite(x + y + z)) return;
          const eye = c.getPosition(new THREE.Vector3(), false);
          if (eye.distanceTo(new THREE.Vector3(x, y, z)) < c.minDistance) return;
          void c.setFocalOffset(0, 0, 0, true);
          void c.setLookAt(eye.x, eye.y, eye.z, x, y, z, true); // the orbit point becomes the animal there
        },
      };
    }
    const loop = () => {
      st.frame = requestAnimationFrame(loop);
      const dt = clock.getDelta();
      // Chase: once the animal's heading or pitch is more than CHASE_TOLERANCE_DEG from the attitude the camera last
      // turned to, the camera turns about it to close the excess. Only the change is applied, so an angle the viewer
      // drags to (behind, beside) is the one kept relative to the animal.
      if (chaseOn.current) {
        const yaw = st.marker.rotation.y;
        const pitch = st.marker.rotation.x;
        if (!chaseAtt) chaseAtt = { yaw, pitch };
        const k = 1 - Math.exp(-Math.min(dt, 0.1) / CHASE_CATCHUP_S);
        const tol = CHASE_TOLERANCE_DEG * D2R;
        const dYaw = beyond(wrapAngle(yaw - chaseAtt.yaw), tol) * k;
        const dPitch = beyond(pitch - chaseAtt.pitch, tol) * k;
        chaseAtt.yaw += dYaw;
        chaseAtt.pitch += dPitch;
        // nose up puts the camera, behind, lower: a larger polar angle
        if (dYaw || dPitch) void nav.controls.rotate(dYaw, dPitch, false);
      } else chaseAtt = null;
      nav.update(dt);
      // The animal is drawn at its true length when that is at least MARKER_PX on screen, and at MARKER_PX when
      // it would be smaller, so it stays visible from kilometers away.
      st.marker.scale.setScalar(Math.max(st.trueLen, MARKER_PX * perPixel(camera.position.distanceTo(st.marker.position))));
      for (const o of st.others) o.dot.scale.setScalar((DOT_PX / 2) * perPixel(camera.position.distanceTo(o.dot.position)));
      if (st.arrows) {
        st.arrows.visible = !!arrowsOn.current;
        if (arrowsOn.current) st.arrows.update(st.exag, perPixel(camera.position.distanceTo(nav.controls.getTarget(lookAt))));
      }
      renderer.render(scene, camera);
      if (pointer && hoverOn.current) showHover(pointer[0], pointer[1]);
      else tip.classList.add("hidden");
      // The physics inspector, into its corner of the same canvas, at the same fractional playback position.
      const io = inspectorOn.current;
      st.inspector.setVisible(!!io);
      if (io) {
        const key = `${io.frame}:${io.scale}:${io.gravity}:${io.camera}:${io.pair}:${io.large}:${io.slip}`;
        if (key !== described) st.inspector.describe(track, io);
        described = key;
        st.inspector.update(inspectorSample(track, st.cursor, io.frame));
        st.inspector.render(renderer, el.clientWidth || 600, el.clientHeight || 400);
      }
    };
    // Fills and places the hover readout for the pointer at (x, y), CSS px from the canvas's top left.
    function showHover(x: number, y: number) {
      const cw = renderer.domElement.clientWidth;
      const ch = renderer.domElement.clientHeight;
      const project = projector(camera, cw, ch);
      let lines: string[] | null = null;
      const arrow = arrowsOn.current && st.arrows ? st.arrows.hit(project, x, y) : null;
      if (arrow) lines = arrowLines(track, arrow.arrow, arrow.step);
      else {
        const ex = st.exag;
        const at = (i: number, out: THREE.Vector3) => {
          const e = track.east[i]!;
          const d = track.depth[i]!;
          const n = track.north[i]!;
          return Number.isFinite(e) && Number.isFinite(d) && Number.isFinite(n) ? out.set(e * S, -d * ex * S, -n * S) : null;
        };
        const i = hoverSample(st.lineIdx, at, project, x, y);
        if (i != null) lines = [...sampleLines(track, dem, i), ...(onSeekRef.current ? ["double-click: move the cursor here"] : [])];
      }
      if (!lines) {
        tip.classList.add("hidden");
        return;
      }
      const text = lines.join("\n");
      if (text !== tipText) tip.textContent = tipText = text;
      tip.classList.remove("hidden");
      const gap = 14;
      const left = x + gap + tip.offsetWidth > cw ? x - gap - tip.offsetWidth : x + gap;
      const top = y + gap + tip.offsetHeight > ch ? y - gap - tip.offsetHeight : y + gap;
      tip.style.left = `${Math.max(0, left)}px`;
      tip.style.top = `${Math.max(0, top)}px`;
    }
    loop();
    return () => {
      cancelAnimationFrame(st.frame);
      ro.disconnect();
      el.removeEventListener("wheel", onWheel, { capture: true });
      el.removeEventListener("wheel", onAdjust);
      el.removeEventListener("pointerdown", onAdjust);
      el.removeEventListener("dblclick", onDblClick);
      el.removeEventListener("pointermove", onPointerMove);
      el.removeEventListener("pointerleave", hideTip);
      el.removeEventListener("pointerdown", hideTip);
      el.removeEventListener("wheel", hideTip);
      tip.remove();
      if (viewRef) viewRef.current = null;
      st.inspector.dispose();
      nav.dispose();
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose();
        const mat = m.material as THREE.Material | THREE.Material[] | undefined;
        (Array.isArray(mat) ? mat : mat ? [mat] : []).forEach((x) => x.dispose());
      });
      renderer.dispose();
      renderer.domElement.remove();
      state.current = null;
    };
    // Exaggeration and cursor have their own effects below; rebuilding for them would reset the camera.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track, dem, othersKey]);

  // Vertical exaggeration: rescale terrain, track and marker in place, keeping the view anchored.
  useEffect(() => {
    const st = state.current;
    if (!st || st.exag === exaggeration) return;
    const prev = st.exag;
    st.exag = exaggeration;
    if (st.terrain && st.terrainZ) {
      const pos = st.terrain.geometry.getAttribute("position") as THREE.BufferAttribute;
      for (let k = 0; k < st.terrainZ.length; k++) {
        const z = st.terrainZ[k]!;
        pos.setY(k, Number.isNaN(z) ? 0 : z * exaggeration * S);
      }
      pos.needsUpdate = true;
      st.terrain.geometry.computeVertexNormals();
      st.terrain.geometry.computeBoundingSphere(); // ray casts (the wheel's zoom target) test against it
      st.terrain.geometry.computeBoundingBox();
    }
    (st.line.geometry as LineGeometry).setPositions(linePositions(track, st.lineIdx, exaggeration));
    for (const o of st.others) (o.line.geometry as LineGeometry).setPositions(linePositions(o.track, o.idx, exaggeration));
    st.nav.rescaleVertical(prev, exaggeration, -median(track.depth) * prev * S);
    placeMarker(st, track, dem, cursor);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exaggeration]);

  useEffect(() => {
    const st = state.current;
    if (!st) return;
    placeMarker(st, track, dem, cursor);
    // Following, the pivot is vantagekit's "fixed" one, held on the animal: drags orbit it and the wheel runs
    // straight in and out, with no pan to pull the view away. Otherwise it is "free", for exploring.
    const pivot = follow ? "fixed" : "free";
    if (st.nav.pivot !== pivot) st.nav.setPivot(pivot);
    if (follow) {
      const p = st.marker.position;
      void st.nav.controls.moveTo(p.x, p.y, p.z, true);
    }
  }, [track, dem, cursor, follow]);

  // The species model replaces the stand-in marker once it loads (the species arrives with the tracks list,
  // after the scene is built, and a new scene starts again from the stand-in).
  useEffect(() => {
    const st = state.current;
    if (!st) return;
    let alive = true;
    void loadAnimalModel(species).then((model) => {
      if (!alive || !model || state.current !== st) return;
      const old = [...st.marker.children] as THREE.Mesh[];
      st.marker.clear();
      old.forEach((m) => {
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
      });
      // The geometry and texture are shared through the loader's cache, so the material is the only new object.
      const mat = new THREE.MeshLambertMaterial(model.texture ? { map: model.texture } : { color: 0x8aa0b8 });
      st.marker.add(new THREE.Mesh(model.geometry, mat));
      st.trueLen = model.length_m * S;
      st.inspector.setModel(model);
    });
    return () => {
      alive = false;
    };
  }, [track, dem, species]);

  // A new color scale recolors the track in place (the camera stays).
  useEffect(() => {
    const st = state.current;
    if (st) (st.line.geometry as LineGeometry).setColors(lineColors(track, st.lineIdx, colorBy, colorMax, solidColor));
  }, [track, colorBy, colorMax, solidColor]);

  return (
    <div
      ref={box}
      className="relative h-full min-h-80 w-full overflow-hidden rounded"
      title="Drag to pan, right-drag or two fingers to orbit, wheel to zoom; click, then WASD to move"
    />
  );
}

function lineColors(track: Track, idx: number[], colorBy: TrackColor, max: number, solid?: string): number[] {
  if (solid) {
    const c = new THREE.Color(solid);
    return idx.flatMap(() => [c.r, c.g, c.b]);
  }
  if (colorBy === "odba" && track.odba) return Array.from(segmentMeans(track.odba, idx)).flatMap((v) => activityColor(v, max));
  if (colorBy === "current" && track.current)
    return Array.from(segmentMeans(track.current.speed, idx)).flatMap((v) => currentColor(v, max));
  return idx.flatMap((i) => trackDepthColor(track.depth[i]!, max));
}

function linePositions(track: Track, idx: number[], exag: number): number[] {
  const out = new Array<number>(idx.length * 3);
  idx.forEach((i, k) => {
    out[k * 3] = track.east[i]! * S;
    out[k * 3 + 1] = -track.depth[i]! * exag * S;
    out[k * 3 + 2] = -track.north[i]! * S;
  });
  return out;
}

/** Places the animal at playback position `at`, interpolated between samples so slow playback moves smoothly. */
function placeMarker(st: SceneState, track: Track, dem: Dem | null, at: number) {
  st.cursor = at;
  const x = valueAt(track.east, at) * S;
  const y = -valueAt(track.depth, at) * st.exag * S;
  const z = -valueAt(track.north, at) * S;
  st.marker.position.set(x, y, z);
  st.marker.rotation.set(
    (valueAt(track.pitch, at) || 0) * D2R,
    -(angleAt(track.heading, at) || 0) * D2R,
    -(angleAt(track.roll, at) || 0) * D2R,
  );
  const floor = dem ? elevationAt(dem, valueAt(track.lat, at), valueAt(track.lon, at)) : NaN;
  const pos = st.drop.geometry.getAttribute("position") as THREE.BufferAttribute;
  pos.setXYZ(0, x, y, z);
  pos.setXYZ(1, x, Number.isNaN(floor) ? y : floor * st.exag * S, z);
  pos.needsUpdate = true;
  st.drop.computeLineDistances();
  st.drop.visible = !Number.isNaN(floor);
  // Other tracks' dots, at the same time (the same fractional sample when both share a clock).
  for (const o of st.others) {
    const sameClock = o.track.count === track.count && o.track.manifest.t0 === track.manifest.t0;
    const j = sameClock ? at : indexAt(o.track, track.manifest.t0 + valueAt(track.t, at));
    const p = [valueAt(o.track.east, j) * S, -valueAt(o.track.depth, j) * st.exag * S, -valueAt(o.track.north, j) * S];
    o.dot.visible = p.every(Number.isFinite);
    if (o.dot.visible) o.dot.position.set(p[0]!, p[1]!, p[2]!);
  }
}

/** The angle in -pi..pi. */
function wrapAngle(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

/** How far `x` lies outside -tol..tol (0 inside). */
function beyond(x: number, tol: number): number {
  return x > tol ? x - tol : x < -tol ? x + tol : 0;
}

function median(values: Float32Array): number {
  const sample = Array.from(strideIndices(values.length, 2000), (i) => values[i]!).filter(Number.isFinite).sort((a, b) => a - b);
  return sample.length ? sample[Math.floor(sample.length / 2)]! : 0;
}
