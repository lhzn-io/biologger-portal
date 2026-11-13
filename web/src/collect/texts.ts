/** Prompt text for each collectable view, built from the same values the view renders. */
import { duration, utc } from "../lib/format";
import type { DeploymentDetail, Matrix, ValidationRun } from "../lib/types";
import type { ChartSeries } from "../viewer/Charts";
import type { DepthScale, Dem } from "../viewer/dem";
import { fmt, readoutAt } from "../viewer/readout";
import type { Track } from "../viewer/track";
import { lines, stats } from "./prompt";
import { promptSettings } from "./registry";

const PERSON_FIELDS = new Set(["deployment_team", "recovery_team"]);

export function deploymentText(d: DeploymentDetail): string {
  const fields = Object.entries(d.fields)
    .filter(([k, v]) => v && !k.startsWith("_") && (promptSettings.includePeople || !PERSON_FIELDS.has(k)))
    .map(([k, v]) => [k, v] as [string, unknown]);
  return lines([
    ["deployment_id", d.id],
    ["release_utc", utc(d.time_start_utc)],
    ["recovery_utc", utc(d.time_end_utc)],
    ["duration", duration(d.time_start_utc, d.time_end_utc)],
    ["dem_dataset", d.dem_dataset],
    ["files_on_server", d.files.filter((f) => !f.missing).length],
    ["track_runs", d.tracks.length],
    ...fields,
  ]);
}

export function filesText(d: DeploymentDetail): string {
  return d.files
    .filter((f) => !f.missing)
    .map((f) => `${f.path} (${f.kind}, ${f.size} bytes${f.info.first_time ? `, ${f.info.first_time} to ${f.info.last_time}` : ""})`)
    .join("\n");
}

export function validationText(run: ValidationRun): string {
  const facts = run.results.facts ?? {};
  const channels = (facts.channels ?? {}) as Record<string, { fill_fraction: number; rate_hz: number | null; violations: number }>;
  const head = lines([
    ["file", run.file_path],
    ["mode", run.mode],
    ["status", run.status],
    ["tool_version", run.tool_version],
    ["finished_utc", run.finished_utc],
    ["note", run.unverified ? "imported from the prototype portal; its values are not trustworthy" : ""],
    ["summary", run.summary],
  ]);
  const checks = (run.results.checks ?? []).map((c) => `- ${c.status} ${c.name}: ${c.detail}`).join("\n");
  const factLines = lines(
    ["rows", "rate_hz", "median_dt_s", "accel_unit", "time_format", "first_time", "last_time", "gaps", "max_gap_s", "duplicates", "non_monotonic"].map(
      (k) => [k, facts[k] as unknown] as [string, unknown],
    ),
  );
  const chan = Object.entries(channels)
    .map(([k, c]) => `- ${k}: ${(c.fill_fraction * 100).toFixed(2)} % filled, ${c.rate_hz ?? "--"} Hz, ${c.violations} outside limits`)
    .join("\n");
  const thresholds = run.results.thresholds ? `thresholds: ${JSON.stringify(run.results.thresholds)}` : "";
  return [head, checks && `checks:\n${checks}`, factLines, chan && `channels:\n${chan}`, thresholds].filter(Boolean).join("\n");
}

export function matrixText(m: Matrix): string {
  return m.rows
    .map((r) => {
      const cells = m.kinds.map((k) => {
        const c = r.cells[k];
        return `${k}=${c?.state === "present" ? `${c.count} file(s)` : (c?.state ?? "missing")}`;
      });
      return `${r.deployment_id} (${r.species}): ${cells.join(", ")}`;
    })
    .join("\n");
}

function trackHead(track: Track): [string, unknown][] {
  const m = track.manifest;
  return [
    ["deployment_id", m.deployment_id],
    ["run_id", m.run_id],
    ["track_model", m.track_model_used],
    ["heading_correction_deg", m.heading_correction_deg != null ? fmt(m.heading_correction_deg) : ""],
    ["samples", `${m.count} at ${m.rate_hz} Hz`],
    ["sim_commit", `${m.provenance.sim_git_commit.slice(0, 7)}${m.provenance.sim_git_dirty ? " (uncommitted changes in the checkout)" : ""}`],
  ];
}

export function readoutText(track: Track, dem: Dem | null, cursor: number): string {
  const r = readoutAt(track, dem, cursor);
  return lines([
    ...trackHead(track),
    ["time_utc", r.time_utc],
    ["lat", fmt(r.lat, 5)],
    ["lon", fmt(r.lon, 5)],
    ["north_of_start_fix_m", fmt(r.north_m, 0)],
    ["east_of_start_fix_m", fmt(r.east_m, 0)],
    ["depth_m", fmt(r.depth_m)],
    ["seafloor_depth_m (DEM)", r.seafloor_depth_m == null ? "not covered by the DEM" : fmt(r.seafloor_depth_m)],
    ["above_seafloor_m", r.above_seafloor_m == null ? "" : fmt(r.above_seafloor_m)],
    [track.headingSource === "tag" ? "heading_deg" : "heading_deg (no magnetometer: bearing from start fix to end fix)", fmt(r.heading_deg)],
    ["pitch_deg", fmt(r.pitch_deg)],
    ["roll_deg", fmt(r.roll_deg)],
    [`vedba (${track.units.vedba || "m/s^2"})`, fmt(r.vedba, 3)],
    [`odba (${track.units.odba || track.units.vedba || "m/s^2"})`, r.odba == null ? "not in this track bundle" : fmt(r.odba, 3)],
  ]);
}

export function mapText(
  track: Track,
  dem: Dem | null,
  exaggeration?: number,
  depth: DepthScale = { max: 600, ticks: [], basis: "track" },
  species?: string,
): string {
  const span = depth.basis === "species" && species ? `the deepest of all ${species} tracks` : "this track's deepest point";
  const m = track.manifest;
  const fixes = m.fixes.map((f) => `${f.kind} fix ${f.time_utc} at ${fmt(f.lat, 5)}, ${fmt(f.lon, 5)}`).join("; ");
  const d = stats(track.depth);
  return lines([
    ...trackHead(track),
    ["fixes", fixes],
    ["lat_range", `${fmt(m.bounds.lat[0], 4)} to ${fmt(m.bounds.lat[1], 4)}`],
    ["lon_range", `${fmt(m.bounds.lon[0], 4)} to ${fmt(m.bounds.lon[1], 4)}`],
    ["depth_range_m", `${fmt(d.min)} to ${fmt(d.max)} (mean ${fmt(d.mean)})`],
    [
      "dem",
      dem
        ? `${dem.terrain.dataset} (${dem.terrain.policy}), ${dem.meta.width} x ${dem.meta.height} cells over ${dem.meta.bounds.map((b) => b.toFixed(3)).join(", ")} (W, S, E, N)`
        : "not loaded",
    ],
    ["vertical_exaggeration", exaggeration != null ? `${exaggeration}x` : ""],
    [
      "colours",
      `terrain by seafloor depth, light blue at 0 m to dark navy at 3000 m and deeper; track by the animal's depth, pale yellow at the surface to magenta at ${depth.max} m (a scale fitted to ${span}, rounded up)`,
    ],
  ]);
}

/** Index of the value in sorted `xs` nearest `t`. */
function nearest(xs: number[], t: number): number {
  let lo = 0;
  let hi = xs.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (xs[mid]! < t) lo = mid + 1;
    else hi = mid;
  }
  return lo > 0 && t - xs[lo - 1]! < xs[lo]! - t ? lo - 1 : lo;
}

export function chartText(series: ChartSeries, track: Track, cursor: number): string {
  const xs = series.xs;
  const cursorT = track.manifest.t0 + track.t[cursor]!;
  const at = xs.length ? nearest(xs, cursorT) : 0;
  const head = lines([
    ["chart", series.title],
    ["window_utc", xs.length ? `${new Date(xs[0]! * 1000).toISOString()} to ${new Date(xs[xs.length - 1]! * 1000).toISOString()}` : ""],
    ["points_drawn", `${xs.length} of ${track.count} samples`],
    ["cursor_utc", new Date(cursorT * 1000).toISOString()],
  ]);
  const body = series.lines
    .filter((l) => l.label) // unlabelled lines are drawing aids
    .map((l) => {
      const s = stats(l.ys);
      const sign = series.id === "depth" ? -1 : 1; // the depth chart draws depth as a negative height
      const v = (x: number) => fmt(sign * x, 2);
      const lo = sign < 0 ? s.max : s.min;
      const hi = sign < 0 ? s.min : s.max;
      return `- ${l.label}: min ${v(lo)}, max ${v(hi)}, mean ${v(s.mean)}, at cursor ${v(l.ys[at]!)}`;
    })
    .join("\n");
  return series.notes?.length ? `${head}\n${body}\n${lines(series.notes)}` : `${head}\n${body}`;
}
