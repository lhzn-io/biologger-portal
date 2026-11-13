import { useEffect, useRef } from "react";
import * as THREE from "three";
import CameraControls from "camera-controls";
import { Line2 } from "three/examples/jsm/lines/Line2.js";
import { LineGeometry } from "three/examples/jsm/lines/LineGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { createVantage, type Vantage } from "../vendor/vantagekit/vantagekit-three.js";
import { elevationAt, elevationColor, trackDepthColor, type Dem } from "./dem";
import { EARTH_RADIUS_M, strideIndices, type Track } from "./track";

/** Scene units are 100 m (vantagekit metersPerUnit), as in topobathykit's DEM viewer. */
const S = 0.01;
const D2R = Math.PI / 180;
const MAX_MESH_SIDE = 512; // terrain vertices per side; the full grid is kept for depth lookups
const LINE_POINTS = 6000;

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
}


export default function Scene3D({
  track,
  dem,
  cursor,
  exaggeration,
}: {
  track: Track;
  dem: Dem | null;
  cursor: number;
  exaggeration: number;
}) {
  const box = useRef<HTMLDivElement>(null);
  const state = useRef<SceneState | null>(null);

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
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const gx = c * step;
          const gy = r * step;
          const z = dem.grid[gy * width + gx]!;
          const k = r * cols + c;
          terrainZ[k] = z;
          pos[k * 3] = xOf(w + ((gx + 0.5) * (e - w)) / width);
          pos[k * 3 + 1] = Number.isNaN(z) ? 0 : z * exag * S;
          pos[k * 3 + 2] = zOf(n - ((gy + 0.5) * (n - s)) / height);
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
    lineGeo.setColors(lineIdx.flatMap((i) => trackDepthColor(track.depth[i]!)));
    const lineMat = new LineMaterial({ vertexColors: true, linewidth: 2.5, worldUnits: false });
    const line = new Line2(lineGeo, lineMat);
    scene.add(line);

    // The animal: an elongated cone pointing along -z (north at heading 0).
    const len = (spanM * S) / 40;
    const marker = new THREE.Group();
    const body = new THREE.Mesh(new THREE.ConeGeometry(len * 0.18, len, 12), new THREE.MeshLambertMaterial({ color: 0x3b9cff }));
    body.rotation.x = -Math.PI / 2;
    marker.add(body);
    const fin = new THREE.Mesh(new THREE.BoxGeometry(len * 0.02, len * 0.25, len * 0.3), new THREE.MeshLambertMaterial({ color: 0xffffff }));
    fin.position.set(0, len * 0.15, len * 0.1);
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
      minDistance: 0.5,
      maxPolarAngle: Math.PI * 0.85,
      keys: "focus",
    });
    const bounds = new THREE.Box3().setFromObject(line);
    nav.fitBox(bounds, { bearingDeg: 20, elevationDeg: 35, factor: 1.1 });
    nav.saveHome();

    const resize = () => {
      const w = el.clientWidth || 600;
      const h = el.clientHeight || 400;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      lineMat.resolution.set(w, h);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(el);

    const clock = new THREE.Clock();
    const st: SceneState = { renderer, scene, camera, nav, terrain, terrainZ, line, lineIdx, marker, drop, exag, frame: 0 };
    state.current = st;
    placeMarker(st, track, dem, cursor);
    const loop = () => {
      st.frame = requestAnimationFrame(loop);
      nav.update(clock.getDelta());
      renderer.render(scene, camera);
    };
    loop();
    return () => {
      cancelAnimationFrame(st.frame);
      ro.disconnect();
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
  }, [track, dem]);

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
    }
    (st.line.geometry as LineGeometry).setPositions(linePositions(track, st.lineIdx, exaggeration));
    st.nav.rescaleVertical(prev, exaggeration, -median(track.depth) * prev * S);
    placeMarker(st, track, dem, cursor);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exaggeration]);

  useEffect(() => {
    if (state.current) placeMarker(state.current, track, dem, cursor);
  }, [track, dem, cursor]);

  return (
    <div
      ref={box}
      className="h-full min-h-80 w-full overflow-hidden rounded"
      title="Drag to pan, right-drag or two fingers to orbit, wheel to zoom; click, then WASD to move"
    />
  );
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

function placeMarker(st: SceneState, track: Track, dem: Dem | null, i: number) {
  const x = track.east[i]! * S;
  const y = -track.depth[i]! * st.exag * S;
  const z = -track.north[i]! * S;
  st.marker.position.set(x, y, z);
  st.marker.rotation.set((track.pitch[i]! || 0) * D2R, -(track.heading[i]! || 0) * D2R, -(track.roll[i]! || 0) * D2R);
  const floor = dem ? elevationAt(dem, track.lat[i]!, track.lon[i]!) : NaN;
  const pos = st.drop.geometry.getAttribute("position") as THREE.BufferAttribute;
  pos.setXYZ(0, x, y, z);
  pos.setXYZ(1, x, Number.isNaN(floor) ? y : floor * st.exag * S, z);
  pos.needsUpdate = true;
  st.drop.computeLineDistances();
  st.drop.visible = !Number.isNaN(floor);
}

function median(values: Float32Array): number {
  const sample = Array.from(strideIndices(values.length, 2000), (i) => values[i]!).filter(Number.isFinite).sort((a, b) => a - b);
  return sample.length ? sample[Math.floor(sample.length / 2)]! : 0;
}
