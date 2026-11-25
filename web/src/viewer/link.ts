/** The track page's state in its URL, beside the camera vantagekit writes (cv, cam, cf), so a view can be shared. */

import type { InspectorFrame } from "./inspector";
import { DEFAULT_SPEED, SPEED_RANGE } from "./playback";

/** What the page restores from a shared link. Unset fields keep the page defaults. */
export interface PageLink {
  /** Cursor time, Unix seconds. */
  time?: number;
  exaggeration?: number;
  basis?: "species" | "track";
  follow?: boolean;
  /** What the camera does while the track plays. */
  play?: PlayCamera;
  /** What a click on a chart does to the 3D camera. */
  pick?: ChartPick;
  /** What the 3D view's track is colored by. */
  color?: TrackColor;
  /** Playback speed: seconds of track per second of playback. */
  speed?: number;
  /** The physics inspector inset: shown in a frame, or off. */
  phys?: InspectorFrame | "off";
  /** Current arrows along the track: on, off, or null for the default (on wherever the track has a current). */
  arrows?: boolean | null;
  /** The 3D view's hover readout: on, off, or null for the default (on). */
  hover?: boolean | null;
  /** Current arrows tilted by the vertical current: on, off, or null for the default (on). */
  tilt?: boolean | null;
}

/** The 3D view's track colors: the animal's depth, its ODBA (body acceleration, an activity measure), or the speed
 * of the ocean current the track was corrected with. */
export type TrackColor = "depth" | "odba" | "current";
const TRACK_COLOR_MODES: TrackColor[] = ["depth", "odba", "current"];
/** Tracks are colored by ODBA unless the viewer picks depth (or the bundle has no ODBA). */
export const DEFAULT_TRACK_COLOR: TrackColor = "odba";

/** A chart click moves the cursor and: leaves the camera (lock), turns it in place to face the animal (look), or moves it to center the animal (center). */
export type ChartPick = "lock" | "look" | "center";
const CHART_PICKS: ChartPick[] = ["lock", "look", "center"];
export const DEFAULT_CHART_PICK: ChartPick = "lock";

/**
 * The camera during playback: left where it is (free), behind the animal turning with it (chase), or on the animal
 * at an angle the viewer sets with the mouse (orbit).
 */
export type PlayCamera = "free" | "chase" | "orbit";
export const PLAY_CAMERAS: PlayCamera[] = ["free", "chase", "orbit"];
/** Playback chases the animal unless the viewer picks otherwise. */
export const DEFAULT_PLAY_CAMERA: PlayCamera = "chase";

const EXAGGERATION_RANGE: [number, number] = [1, 20];

export function readPageLink(search: string): PageLink {
  const p = new URLSearchParams(search);
  const out: PageLink = {};
  const t = p.get("t");
  if (t) {
    const ms = Date.parse(t);
    if (Number.isFinite(ms)) out.time = ms / 1000;
  }
  const ve = Number(p.get("ve"));
  if (p.has("ve") && Number.isFinite(ve) && ve >= EXAGGERATION_RANGE[0] && ve <= EXAGGERATION_RANGE[1]) out.exaggeration = ve;
  const depth = p.get("depth");
  if (depth === "track" || depth === "species") out.basis = depth;
  if (p.get("follow") === "1") out.follow = true;
  const play = p.get("play");
  if (PLAY_CAMERAS.includes(play as PlayCamera)) out.play = play as PlayCamera;
  const pick = p.get("pick");
  if (CHART_PICKS.includes(pick as ChartPick)) out.pick = pick as ChartPick;
  const color = p.get("color");
  if (TRACK_COLOR_MODES.includes(color as TrackColor)) out.color = color as TrackColor;
  const speed = Number(p.get("speed"));
  if (p.has("speed") && speed >= SPEED_RANGE[0] && speed <= SPEED_RANGE[1]) out.speed = speed;
  const phys = p.get("phys");
  if (phys === "heading" || phys === "north") out.phys = phys;
  const arrows = p.get("arrows");
  if (arrows === "1" || arrows === "0") out.arrows = arrows === "1";
  const hover = p.get("hover");
  if (hover === "1" || hover === "0") out.hover = hover === "1";
  const tilt = p.get("tilt");
  if (tilt === "1" || tilt === "0") out.tilt = tilt === "1";
  return out;
}

/** Sets the page's parameters on `params`, leaving out the defaults so a plain link stays short. */
export function writePageLink(params: URLSearchParams, s: Required<PageLink>): void {
  params.set("t", new Date(Math.round(s.time) * 1000).toISOString().replace(".000Z", "Z"));
  params.set("ve", String(s.exaggeration));
  if (s.basis === "track") params.set("depth", "track");
  else params.delete("depth");
  if (s.follow) params.set("follow", "1");
  else params.delete("follow");
  if (s.play !== DEFAULT_PLAY_CAMERA) params.set("play", s.play);
  else params.delete("play");
  if (s.pick !== DEFAULT_CHART_PICK) params.set("pick", s.pick);
  else params.delete("pick");
  if (s.color !== DEFAULT_TRACK_COLOR) params.set("color", s.color);
  else params.delete("color");
  if (s.speed !== DEFAULT_SPEED) params.set("speed", String(s.speed));
  else params.delete("speed");
  if (s.phys !== "off") params.set("phys", s.phys);
  else params.delete("phys");
  if (s.arrows != null) params.set("arrows", s.arrows ? "1" : "0");
  else params.delete("arrows");
  if (s.hover != null) params.set("hover", s.hover ? "1" : "0");
  else params.delete("hover");
  if (s.tilt != null) params.set("tilt", s.tilt ? "1" : "0");
  else params.delete("tilt");
}
