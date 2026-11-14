/** The track page's state in its URL, beside the camera vantagekit writes (cv, cam, cf), so a view can be shared. */

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
}

/** The 3D view's track colors: the animal's depth, or its ODBA (body acceleration, an activity measure). */
export type TrackColor = "depth" | "odba";

/** A chart click moves the cursor and: leaves the camera (lock), turns it in place to face the animal (look), or moves it to center the animal (center). */
export type ChartPick = "lock" | "look" | "center";
export const CHART_PICKS: ChartPick[] = ["lock", "look", "center"];
export const DEFAULT_CHART_PICK: ChartPick = "center";

/**
 * The camera during playback: left where it is (free), behind the animal turning with it (chase), or on the animal
 * at an angle the viewer sets with the mouse (orbit).
 */
export type PlayCamera = "free" | "chase" | "orbit";
export const PLAY_CAMERAS: PlayCamera[] = ["free", "chase", "orbit"];
/** Playback chases the animal unless the viewer picks otherwise. */
export const DEFAULT_PLAY_CAMERA: PlayCamera = "chase";

export const EXAGGERATION_RANGE: [number, number] = [1, 20];

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
  if (p.get("color") === "odba") out.color = "odba";
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
  if (s.color === "odba") params.set("color", "odba");
  else params.delete("color");
}
