import { towardDeg } from "./current";
import { elevationAt, type Dem } from "./dem";
import { timeOf, type Track } from "./track";

export interface Readout {
  index: number;
  time_utc: string;
  lat: number;
  lon: number;
  north_m: number;
  east_m: number;
  depth_m: number;
  seafloor_depth_m: number | null;
  above_seafloor_m: number | null;
  heading_deg: number;
  pitch_deg: number;
  roll_deg: number;
  vedba: number;
  odba: number | null;
  /** The applied current: speed (m/s) and the direction it flows toward (deg); null without a correction, and
   * NaN speed where the model had no value. `up_m_s` is the model's upward current (shown, not applied): null when
   * the track has none, NaN where the model had no value. */
  current: { speed_m_s: number; toward_deg: number; up_m_s: number | null } | null;
}

/** The values at one sample: what the page shows beside the cursor and what the prompt carries. */
export function readoutAt(track: Track, dem: Dem | null, i: number): Readout {
  const lat = track.lat[i]!;
  const lon = track.lon[i]!;
  const elev = dem ? elevationAt(dem, lat, lon) : NaN;
  const floor = Number.isNaN(elev) ? null : -elev;
  const depth = track.depth[i]!;
  return {
    index: i,
    time_utc: new Date(timeOf(track, i) * 1000).toISOString().replace(".000Z", "Z"),
    lat,
    lon,
    north_m: track.north[i]!,
    east_m: track.east[i]!,
    depth_m: depth,
    seafloor_depth_m: floor,
    above_seafloor_m: floor == null ? null : floor - depth,
    heading_deg: track.heading[i]!,
    pitch_deg: track.pitch[i]!,
    roll_deg: track.roll[i]!,
    vedba: track.vedba[i]!,
    odba: track.odba ? track.odba[i]! : null,
    current: track.current
      ? {
          speed_m_s: track.current.speed[i]!,
          toward_deg: Number.isFinite(track.current.speed[i]!) ? towardDeg(track.current.east[i]!, track.current.north[i]!) : NaN,
          up_m_s: track.current.up ? track.current.up[i]! : null,
        }
      : null,
  };
}

export const fmt = (v: number | null | undefined, digits = 1): string =>
  v == null || !Number.isFinite(v) ? "--" : v.toFixed(digits);

/** An activity unit as shown: the run's own (g or m/s^2), with a superscript square. */
export const accelUnit = (u: string | undefined) => (u || "m/s^2").replace("^2", "²");
/** Decimals for an activity value: 0.1 m/s^2, or 0.01 g (about the same step). */
export const accelDigits = (u: string | undefined) => (u === "g" ? 2 : 1);
