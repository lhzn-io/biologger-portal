/** Track bundles (track-bundle-v1, written by biologger-sim export-track): loading and lookups.
 *
 * track.f32 is little-endian Float32 in column blocks; track.json gives each column's byte offset.
 * Positions are meters north and east of the origin (the start fix); latitude and longitude come from
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
  /** The ordered steps that made the track (biologger-sim core/provenance.py); absent in older bundles. */
  pipeline?: PipelineStep[];
  /** Numbers the exporter measured on the track ({name, value, unit, by}); absent in older bundles. */
  metrics?: { name: string; value: number | null; unit: string; by: string }[];
  /** How to rebuild the track; absent in older bundles. */
  reproducibility?: {
    fingerprint: string;
    complete: boolean;
    sim_branch: string | null;
    sim_commit_on_remote: boolean | null;
    sim_dirty: boolean | null;
  } | null;
}

export interface PipelineStep {
  step: string;
  method: string;
  version: number;
  status: "applied" | "failed";
  params: Record<string, unknown>;
}

/** The ocean current the track was corrected with, as the exporter applied it (m/s, at the animal's depth). */
export interface TrackCurrent {
  east: Float32Array;
  north: Float32Array;
  /** Speed, NaN where `missing` is set (the exporter used still water there). */
  speed: Float32Array;
  /** 1 where a forcing sample was missing since the previous sample, else 0. */
  missing: Float32Array;
  /** The ocean model forcingkit used ("necofs", "hycom"), from the current_correction step. */
  donor: string | null;
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
  /** Overall dynamic body acceleration (sum of the absolute dynamic axes), same units as VeDBA; null in bundles
   * exported before biologger-sim wrote an "odba" column. */
  odba: Float32Array | null;
  /** Cumulative (unwrapped) roll in degrees, computed by the exporter at the tag's native rate; null when the
   * bundle has no such column and the viewer unwraps the bundle-rate roll itself. */
  rollUnwrapped: Float32Array | null;
  /** Exporter's roll quality per sample (0 fine, nonzero an uncertain unwrap step or ill-conditioned roll). */
  rollQuality: Float32Array | null;
  /** The applied ocean current; null when the track had no current correction. */
  current: TrackCurrent | null;
  /** Through-water speed dead reckoning used (m/s, before placement); null in bundles without it. */
  speed: Float32Array | null;
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
  /** A column the exporter may not write yet: the first of `names` present, or null. */
  const optional = (...names: string[]): Float32Array | null => {
    const name = names.find((x) => manifest.columns.some((c) => c.name === x));
    return name ? col(name) : null;
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
  const cEast = optional("current_east_m_s");
  const cNorth = optional("current_north_m_s");
  let current: TrackCurrent | null = null;
  if (cEast && cNorth) {
    const missing = optional("current_missing") ?? new Float32Array(n);
    const speed = new Float32Array(n);
    for (let i = 0; i < n; i++) speed[i] = missing[i] ? NaN : Math.hypot(cEast[i]!, cNorth[i]!);
    const cc = manifest.pipeline?.filter((s) => s.step === "current_correction").at(-1);
    const donor = cc?.params.donor_used;
    current = { east: cEast, north: cNorth, speed, missing, donor: typeof donor === "string" ? donor : null };
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
    odba: optional("odba"),
    rollUnwrapped: optional("roll_unwrapped_deg", "roll_cum_deg"),
    rollQuality: optional("roll_quality", "roll_qc"),
    current,
    speed: optional("speed_m_s"),
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
