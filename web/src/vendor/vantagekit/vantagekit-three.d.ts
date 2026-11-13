// Types for the parts of vantagekit-three.js (v0.8.2) the portal calls.
import type * as THREE from "three";
import type CameraControls from "camera-controls";

export interface VantageOptions {
  THREE: typeof THREE;
  CameraControls: typeof CameraControls;
  camera: THREE.PerspectiveCamera;
  dom?: HTMLElement;
  modes?: ("orbit" | "fly")[];
  origin?: { lon: number; lat: number };
  axes?: string;
  metersPerUnit?: number;
  exaggeration?: number | (() => number);
  mouse?: "rotate-left" | "pan-left";
  pan?: "screen" | "ground";
  minDistance?: number;
  maxDistance?: number;
  maxPolarAngle?: number;
  keys?: boolean | "focus";
  gamepad?: boolean;
  link?: boolean;
}

export declare class Vantage extends EventTarget {
  controls: CameraControls;
  readonly mode: "orbit" | "fly";
  readonly pivot: "free" | "fixed";
  setPivot(mode: "free" | "fixed", options?: { emit?: boolean }): void;
  update(dt: number): boolean;
  fitBox(box: THREE.Box3, options?: { bearingDeg?: number; elevationDeg?: number; factor?: number; animate?: boolean }): unknown;
  saveHome(): void;
  home(animate?: boolean): void;
  rescaleVertical(prev: number, next: number, anchorY: number): number;
  dispose(): void;
}

export declare function createVantage(options: VantageOptions): Vantage;
