/** The track page's state in its URL, beside the camera vantagekit writes (cv, cam, cf), so a view can be shared. */

/** What the page restores from a shared link. Unset fields keep the page defaults. */
export interface PageLink {
  /** Cursor time, Unix seconds. */
  time?: number;
  exaggeration?: number;
  basis?: "species" | "track";
  follow?: boolean;
}

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
}
