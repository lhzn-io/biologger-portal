/** The applied ocean current as the 3D view's track color and in the readout: scale, color ramp, direction. */
import { CURRENTS_FLOOR, CURRENTS_RAMP, CURRENTS_RAMP_DARK, CURRENTS_TOP } from "@lhzn-io/timecharts/currents-ramp";
import { LINE_POINTS, segmentMeans } from "./activity";
import { modelFromParams, strideIndices, type OceanModel, type Track } from "./track";

export interface CurrentScale {
  max: number;
  ticks: number[];
  /** About how many seconds each drawn stretch averages. */
  stretch_s: number;
  /** The ocean model the current came from, when the bundle names it. */
  donor: string | null;
  model: OceanModel;
}

/** Display names for forcingkit's ocean donors. */
const DONOR_NAMES: Record<string, string> = { necofs: "NECOFS", hycom: "HYCOM", doppio: "DOPPIO" };

/** Credits for forcingkit's ocean donors, as the (i) panels show them. */
const DONOR_CREDITS: Record<string, string> = {
  necofs: "Ocean current: NECOFS (FVCOM), NECOFS/UMASSD",
  hycom: "Ocean current: HYCOM, HYCOM Consortium",
  doppio: "Ocean current: DOPPIO, Rutgers",
};

/** The order of the known models on the compare page, after the tracks without a current. */
const MODEL_RANK: Record<string, number> = { necofs: 0, doppio: 1, hycom: 2 };

export const modelRank = (m: OceanModel | string | null | undefined): number => MODEL_RANK[idOf(m) ?? ""] ?? 3;

type ModelRef = OceanModel | string | null | undefined;
const idOf = (m: ModelRef) => (typeof m === "string" ? m || null : (m?.id ?? null));

export { modelFromParams };

/** The credit line for an ocean model, or null when the bundle does not name one: the model's own credit when it
 * carries one, else forcingkit's donors by id. */
export function donorCredit(model: ModelRef): string | null {
  const id = idOf(model);
  if (typeof model === "object" && model?.credit) return `Ocean current: ${model.label ?? id ?? "a model"}, ${model.credit}`;
  return id ? (DONOR_CREDITS[id] ?? `Ocean current: ${id} model`) : null;
}

/** A model's name: its own label, else forcingkit's name for the donor, else "an ocean model". */
export function donorName(model: ModelRef): string {
  if (typeof model === "object" && model?.label) return model.label;
  const id = idOf(model);
  return id ? (DONOR_NAMES[id] ?? id) : "an ocean model";
}

/** The model as a noun phrase ending in "model": "NECOFS model", "Example regional model", or
 * "ocean model" when the bundle names none. */
export function modelPhrase(model: ModelRef): string {
  const id = idOf(model);
  if (!id && !(typeof model === "object" && model?.label)) return "ocean model";
  const name = donorName(model);
  return /\bmodel$/i.test(name) ? name : `${name} model`;
}

/**
 * A scale for the track's current colors: 0 to the 98th percentile of the stretch means, rounded up to a step of
 * 0.05, 0.1 or 0.25 m/s chosen so the legend has at most 5 ticks (colors saturate past it). Null when the bundle has
 * no current.
 */
export function currentScale(track: Track): CurrentScale | null {
  const c = track.current;
  if (!c) return null;
  const idx = strideIndices(track.count, LINE_POINTS);
  const means = Array.from(segmentMeans(c.speed, idx))
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  if (!means.length) return null;
  const p98 = means[Math.floor(0.98 * (means.length - 1))]!;
  const step = [0.05, 0.1, 0.25, 0.5, 1].find((s) => Math.ceil(p98 / s - 1e-9) <= 4) ?? 1;
  const max = Math.max(step, Math.ceil(p98 / step - 1e-9) * step);
  const ticks = Array.from({ length: Math.round(max / step) + 1 }, (_, k) => Number((k * step).toFixed(2)));
  const stretch_s = idx.length > 1 ? (idx[1]! - idx[0]!) / track.manifest.rate_hz : 1 / track.manifest.rate_hz;
  return { max: Number(max.toFixed(2)), ticks, stretch_s, donor: c.donor, model: c.model };
}

// Light to dark in greens, apart from the blue terrain, the yellow-magenta depth ramp and the yellow-violet ODBA ramp.
const RAMP: [number, [number, number, number]][] = [
  [0, [0.9, 0.97, 0.82]],
  [0.5, [0.3, 0.72, 0.42]],
  [1, [0.02, 0.3, 0.2]],
];

/** Color of a current speed: pale green at 0 to dark green at `max` and above; gray where the model had none. */
export function currentColor(v: number, max: number): [number, number, number] {
  if (!Number.isFinite(v)) return [0.6, 0.6, 0.6];
  const t = Math.min(1, Math.max(0, v / max));
  const k = t <= RAMP[1]![0] ? 0 : 1;
  const [t0, c0] = RAMP[k]!;
  const [t1, c1] = RAMP[k + 1]!;
  const f = (t - t0) / (t1 - t0);
  return [c0[0] + (c1[0] - c0[0]) * f, c0[1] + (c1[1] - c0[1]) * f, c0[2] + (c1[2] - c0[2]) * f];
}

type Rgb = [number, number, number];

const rgbOf = (hex: string): Rgb => [1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16) / 255) as Rgb;
const RAMPS = {
  light: CURRENTS_RAMP.map(([v, c]) => [Math.log(v), rgbOf(c)] as const),
  dark: CURRENTS_RAMP_DARK.map(([v, c]) => [Math.log(v), rgbOf(c)] as const),
};

/**
 * The standard currents color (lhzn-io/timecharts' currents ramp, which forcingkit's displays also use): fixed in
 * speed, interpolated in log(speed), from CURRENTS_FLOOR to CURRENTS_TOP m/s. `light` is the light-basemap table
 * (pale aqua to deep teal as speed rises), `dark` its dark-basemap twin on the same speeds (lightness rising).
 */
/** A vertical current as read: cm/s and its sense, "0.12 cm/s up"; "--" when there is no value. */
export function upText(upMS: number): string {
  if (!Number.isFinite(upMS)) return "--";
  const cm = Math.abs(upMS) * 100;
  return `${cm.toFixed(2)} cm/s ${cm < 0.005 ? "" : upMS > 0 ? "up" : "down"}`.trimEnd();
}

export function currentRampColor(v: number, table: "light" | "dark"): Rgb {
  const rows = RAMPS[table];
  const x = Math.log(Math.min(CURRENTS_TOP, Math.max(CURRENTS_FLOOR, Number.isFinite(v) ? v : 0)));
  let k = 0;
  while (k + 2 < rows.length && rows[k + 1]![0] < x) k++;
  const [x0, c0] = rows[k]!;
  const [x1, c1] = rows[k + 1]!;
  const f = x1 > x0 ? Math.min(1, Math.max(0, (x - x0) / (x1 - x0))) : 0;
  return [c0[0] + (c1[0] - c0[0]) * f, c0[1] + (c1[1] - c0[1]) * f, c0[2] + (c1[2] - c0[2]) * f];
}

/** The direction a current flows toward, degrees clockwise from north (oceanographic convention). */
export function towardDeg(east: number, north: number): number {
  return ((Math.atan2(east, north) * 180) / Math.PI + 360) % 360;
}
