/** Track bundles (track-bundle-v1, written by biologger-sim export-track): loading and lookups.
 *
 * track.f32 is little-endian Float32 in column blocks; track.json gives each column's byte offset.
 * Positions are metres north and east of the origin (the start fix); latitude and longitude come from
 * the same equirectangular conversion biologger-sim uses (core/georef.py, R = 6371000 m).
 */

import { resolve } from "../lib/mode";

export const EARTH_RADIUS_M = 6371000;
const D2R = Math.PI / 180;

export interface TrackManifest {
  schema: string;
  deployment_id: string;
  run_id: string;
  species?: string;
  track_model_used: string;
  heading_correction_deg?: number;
  origin: { lat: number; lon: number };
  fixes: { kind: string; t: number; time_utc: string; lat: number; lon: number }[];
  t0: number;
  rate_hz: number;
  count: number;
  columns: { name: string; unit?: string; offset_bytes: number }[];
  bounds: { lat: [number, number]; lon: [number, number]; depth_m: [number, number] };
  provenance: { sim_git_commit: string; sim_git_dirty: boolean };
}

export interface Track {
  manifest: TrackManifest;
  count: number;
  /** Seconds since manifest.t0. */
  t: Float32Array;
  north: Float32Array;
  east: Float32Array;
  depth: Float32Array;
  heading: Float32Array;
  pitch: Float32Array;
  roll: Float32Array;
  vedba: Float32Array;
  lat: Float64Array;
  lon: Float64Array;
  units: Record<string, string>;
  /** "tag" when heading comes from the magnetometer; "fix bearing" when the tag has none and every heading is NaN,
   * so the animal is pointed along the bearing from the start fix to the end fix (or north without an end fix). */
  headingSource: "tag" | "fix bearing";
}

/** Bearing in degrees clockwise from north from one point to another (equirectangular, short distances). */
export function bearingDeg(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dn = lat2 - lat1;
  const de = (lon2 - lon1) * Math.cos(((lat1 + lat2) / 2) * D2R);
  return ((Math.atan2(de, dn) / D2R) + 360) % 360;
}

export function toLatLon(origin: { lat: number; lon: number }, north: number, east: number): [number, number] {
  const lat = origin.lat + north / EARTH_RADIUS_M / D2R;
  const lon = origin.lon + east / (EARTH_RADIUS_M * Math.cos(origin.lat * D2R)) / D2R;
  return [lat, lon];
}

export function parseTrack(manifest: TrackManifest, buffer: ArrayBuffer): Track {
  const n = manifest.count;
  const col = (name: string): Float32Array => {
    const c = manifest.columns.find((x) => x.name === name);
    if (!c) return new Float32Array(n).fill(NaN);
    // Copy out of the shared buffer so each column is aligned and independent.
    return new Float32Array(buffer.slice(c.offset_bytes, c.offset_bytes + n * 4));
  };
  const north = col("north_m");
  const east = col("east_m");
  const lat = new Float64Array(n);
  const lon = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    [lat[i], lon[i]] = toLatLon(manifest.origin, north[i]!, east[i]!);
  }
  let heading = col("heading_deg");
  let headingSource: Track["headingSource"] = "tag";
  if (!heading.some(Number.isFinite)) {
    const start = manifest.fixes.find((f) => f.kind === "start");
    const end = manifest.fixes.find((f) => f.kind === "end");
    heading = new Float32Array(n).fill(start && end ? bearingDeg(start.lat, start.lon, end.lat, end.lon) : 0);
    headingSource = "fix bearing";
  }
  return {
    manifest,
    count: n,
    t: col("t"),
    north,
    east,
    depth: col("depth_m"),
    heading,
    headingSource,
    pitch: col("pitch_deg"),
    roll: col("roll_deg"),
    vedba: col("vedba"),
    lat,
    lon,
    units: Object.fromEntries(manifest.columns.map((c) => [c.name, c.unit ?? ""])),
  };
}

export async function loadTrack(depId: string, runId: string): Promise<Track> {
  const base = `/tracks/${encodeURIComponent(depId)}/${encodeURIComponent(runId)}`;
  const [mRes, dRes] = await Promise.all([fetch(resolve(`${base}/track.json`)), fetch(resolve(`${base}/track.f32`))]);
  if (!mRes.ok || !dRes.ok) throw new Error(`track bundle not available (${mRes.status}, ${dRes.status})`);
  const manifest = (await mRes.json()) as TrackManifest;
  const buffer = await dRes.arrayBuffer();
  if (buffer.byteLength < manifest.columns.length * manifest.count * 4) throw new Error("track.f32 is shorter than track.json says");
  return parseTrack(manifest, buffer);
}

/** Unix seconds of sample i. */
export const timeOf = (track: Track, i: number): number => track.manifest.t0 + track.t[i]!;

/** Index of the sample nearest Unix time `unix` (t is increasing). */
export function indexAt(track: Track, unix: number): number {
  const target = unix - track.manifest.t0;
  let lo = 0;
  let hi = track.count - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (track.t[mid]! < target) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0 && Math.abs(track.t[lo - 1]! - target) < Math.abs(track.t[lo]! - target)) return lo - 1;
  return lo;
}

/** Every k-th index so that about `target` samples remain (always keeps the last). */
export function strideIndices(count: number, target: number): number[] {
  const step = Math.max(1, Math.floor(count / target));
  const out: number[] = [];
  for (let i = 0; i < count; i += step) out.push(i);
  if (out[out.length - 1] !== count - 1) out.push(count - 1);
  return out;
}
