/**
 * Comparing reconstructions of one deployment: what each track is (placement and current correction, from its
 * pipeline record), its color, and the numbers the compare page's table shows.
 */
import { donorName } from "./current";
import { elevationAt, type Dem } from "./dem";
import { indexAt, timeOf, type PipelineStep, type Track } from "./track";

/** A dive counts as below the seafloor when it is more than this far under the DEM's seafloor (m). */
export const BELOW_FLOOR_MARGIN_M = 10;

type Placement = "dead_reckoning" | "fix_pinned" | "fix_interpolation" | string;

export interface VariantInfo {
  /** "Dead reckoning, NECOFS current", "Pinned to the end fix, no current", ... */
  label: string;
  placement: Placement;
  /** The ocean model the current came from; null without a current correction; undefined when the bundle has
   * no pipeline record, so whether one was applied is unknown. */
  current: string | null | undefined;
  /** Sort key: dead reckoning before pinned, without current before with, records before older exports. */
  order: number;
}

const PLACEMENT_LABELS: Record<string, string> = {
  dead_reckoning: "Dead reckoning",
  fix_pinned: "Pinned to the end fix",
  fix_interpolation: "Fix-to-fix line",
};

function placementLabel(p: Placement): string {
  return PLACEMENT_LABELS[p] ?? p;
}

function lastStep(pipeline: PipelineStep[] | undefined, step: string): PipelineStep | undefined {
  return pipeline?.filter((s) => s.step === step).at(-1);
}

export function describeVariant(track: Track): VariantInfo {
  const m = track.manifest;
  const placement: Placement = m.track_model_used;
  const base = { dead_reckoning: 0, fix_pinned: 2, fix_interpolation: 4 }[placement] ?? 6;
  if (!m.pipeline) {
    return { label: `${placementLabel(placement)} (earlier export, no pipeline record)`, placement, current: undefined, order: 10 + base };
  }
  const cc = lastStep(m.pipeline, "current_correction");
  const donor = cc && cc.status === "applied" ? (typeof cc.params.donor_used === "string" ? cc.params.donor_used : "") : null;
  const unsettled = currentConvergence(track)?.converged === false ? " (not converged)" : "";
  const label = `${placementLabel(placement)}, ${donor == null ? "no current" : `${donorName(donor || null)} current${unsettled}`}`;
  return { label, placement, current: donor, order: base + (donor == null ? 0 : 1) };
}

export interface CurrentConvergence {
  converged: boolean;
  passes: number;
  /** The largest move of any sample in the last pass (m). */
  lastShiftM: number | null;
  /** The move under which the exporter calls the passes converged (m). */
  limitM: number | null;
}

/**
 * Whether the current correction's sampling passes settled (biologger-sim export-track: each pass samples the
 * current along the previous pass's track). Null for exports that sampled once or kept no record of it.
 */
export function currentConvergence(track: Track): CurrentConvergence | null {
  const cc = lastStep(track.manifest.pipeline, "current_correction");
  if (!cc || cc.status !== "applied" || typeof cc.params.converged !== "boolean") return null;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const shifts = Array.isArray(cc.params.pass_shift_max_m) ? cc.params.pass_shift_max_m : [];
  return {
    converged: cc.params.converged,
    passes: num(cc.params.passes) ?? shifts.length,
    lastShiftM: num(shifts.at(-1)),
    limitM: num(cc.params.convergence_m),
  };
}

/** One sentence for a run whose passes did not settle, or "" (the track page header, the compare table's title). */
export function convergenceNote(c: CurrentConvergence | null): string {
  if (!c || c.converged) return "";
  const last = c.lastShiftM == null ? "" : `, last shift ${Math.round(c.lastShiftM).toLocaleString("en-US")} m`;
  const limit = c.limitM == null ? "" : ` (limit ${Math.round(c.limitM)} m)`;
  return `Current correction not converged: ${c.passes} passes${last}${limit}; provisional`;
}

/**
 * Colors by what a track is: pinks for dead reckoning, ambers for pinned, the lighter of each without the current
 * and the stronger with it; older exports in violet and gray. None is blue, so lines stand out on the terrain.
 */
export function variantColor(v: VariantInfo, k = 0): string {
  const withCurrent = v.current != null;
  if (v.current === undefined) return ["#a78bfa", "#cbd5e1", "#c4b5fd"][k % 3]!;
  if (v.placement === "dead_reckoning") return withCurrent ? "#ec4899" : "#f9a8d4";
  if (v.placement === "fix_pinned") return withCurrent ? "#f97316" : "#fde68a";
  return withCurrent ? "#22c55e" : "#bbf7d0";
}

/** A metric the exporter wrote (biologger-sim core/provenance.py), or null. */
export function metricValue(track: Track, name: string): number | null {
  const v = track.manifest.metrics?.find((x) => x.name === name)?.value;
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export interface CurrentSummary {
  donor: string;
  /** Share of the record where the model had no value (still water used). */
  missingShare: number;
  /** Where the current alone moved the track by its end (m). */
  driftEnd: { north: number; east: number } | null;
}

export function currentSummary(track: Track): CurrentSummary | null {
  const cc = lastStep(track.manifest.pipeline, "current_correction");
  if (!cc || cc.status !== "applied") return null;
  const d = cc.params.drift_end_m as { north?: number; east?: number } | undefined;
  const samples = Number(cc.params.samples);
  const missing = Number(cc.params.missing);
  return {
    donor: donorName(typeof cc.params.donor_used === "string" ? cc.params.donor_used : null),
    missingShare: samples > 0 && Number.isFinite(missing) ? missing / samples : NaN,
    driftEnd: d && typeof d.north === "number" && typeof d.east === "number" ? { north: d.north, east: d.east } : null,
  };
}

export interface PlacementSummary {
  method: string;
  /** Fix pinning's stretch and turn; null for other placements. */
  scale: number | null;
  rotationDeg: number | null;
}

export function placementSummary(track: Track): PlacementSummary {
  const p = lastStep(track.manifest.pipeline, "placement");
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  return {
    method: p?.method ?? track.manifest.track_model_used,
    scale: num(p?.params.scale),
    rotationDeg: num(p?.params.rotation_deg),
  };
}

export interface FloorSummary {
  /** Share of samples over the DEM that dive more than BELOW_FLOOR_MARGIN_M below its seafloor. */
  share: number;
  /** The deepest such sample's distance below the seafloor (m), or 0. */
  maxBelowM: number;
  /** Share of samples that lie over the DEM at all. */
  covered: number;
}

/** How much of a track passes under the seafloor of its DEM: the test that tells a placement that cannot be right. */
export function belowSeafloor(track: Track, dem: Dem): FloorSummary {
  let over = 0;
  let below = 0;
  let maxBelow = 0;
  for (let i = 0; i < track.count; i++) {
    const depth = track.depth[i]!;
    if (!Number.isFinite(depth)) continue;
    const elev = elevationAt(dem, track.lat[i]!, track.lon[i]!);
    if (!Number.isFinite(elev)) continue;
    over++;
    const under = depth + elev; // elevation is negative below sea level: depth past the seafloor depth
    if (under > BELOW_FLOOR_MARGIN_M) {
      below++;
      if (under > maxBelow) maxBelow = under;
    }
  }
  const finite = track.depth.reduce((n, d) => n + (Number.isFinite(d) ? 1 : 0), 0);
  return { share: over ? below / over : NaN, maxBelowM: maxBelow, covered: finite ? over / finite : 0 };
}

/** The sample of `other` at the time of `track`'s sample `i` (the same index when both share a clock). */
export function alignedIndex(track: Track, other: Track, i: number): number {
  if (other.count === track.count && other.manifest.t0 === track.manifest.t0) return i;
  return indexAt(other, timeOf(track, i));
}

/** Horizontal distance (m) between two tracks at the times of `track`'s samples `idx`. */
export function separation(track: Track, other: Track, idx: number[]): number[] {
  return idx.map((i) => {
    const j = alignedIndex(track, other, i);
    return Math.hypot(track.north[i]! - other.north[j]!, track.east[i]! - other.east[j]!);
  });
}

/** Seafloor depth (m, positive down) under a track at the times of `base`'s samples `idx`; NaN off the DEM. */
export function seafloorUnder(base: Track, track: Track, dem: Dem, idx: number[]): number[] {
  return idx.map((i) => {
    const j = alignedIndex(base, track, i);
    const elev = elevationAt(dem, track.lat[j]!, track.lon[j]!);
    return Number.isFinite(elev) ? -elev : NaN;
  });
}
