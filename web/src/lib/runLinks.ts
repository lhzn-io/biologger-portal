import type { TrackRow } from "./types";

/**
 * Track page links that survive a re-export. A run id is its UTC start time and a name from the export config
 * (`20261119-135911_pin_cur`); a re-export of the same config makes a new id with the same name. A link can name
 * the run (`pin_cur_necofs`) and open the current run of that name, or give the exact id and open that run while it
 * exists.
 *
 * Current-corrected runs were named `pin_cur` and `dr_cur` until 2026-11-24, when each took its model's name
 * (`pin_cur_necofs`, `pin_cur_hycom`, `pin_cur_doppio`). A link to an old name, once no run
 * of that name is left, opens the run that took over: the model forcingkit picked for those runs, NECOFS on the
 * Northeast Shelf, else HYCOM.
 *
 * The first exports (2026-11-13) were named for the tag and ended in `-postfacto`
 * (`Swordfish-RED001_20220812_19A0564-postfacto`), and carried no pipeline record. Once such a run is retired, a link
 * to it opens the deployment's reviewed track, which took its place.
 */

const STAMP = /^\d{8}-\d{6}_/;

/** Old run names and, in order, the names that replaced them. */
const RENAMED: Record<string, string[]> = {
  pin_cur: ["pin_cur_necofs", "pin_cur_hycom"],
  dr_cur: ["dr_cur_necofs", "dr_cur_hycom"],
};

/** The first exports' names, which end in `-postfacto`. */
const LEGACY = /-postfacto$/;

/** The run's name: its id without the leading start time (the id itself when it has none). */
export function runName(runId: string): string {
  return STAMP.test(runId) ? runId.replace(STAMP, "") : runId;
}

export interface Resolved {
  row: TrackRow;
  /** The link gave an exact run id that no longer exists (a re-export replaced it); `row` is its successor. */
  replaced: boolean;
}

/**
 * The run a track link opens. An exact id that exists opens that run. Otherwise the link's name (or the name of the
 * id it gave) opens the deployment's run of that name an editor published, else one shared, else the most recent.
 */
export function resolveRun(tracks: TrackRow[], depId: string, param: string): Resolved | null {
  const exact = tracks.find((t) => t.deployment_id === depId && t.run_id === param);
  if (exact) return { row: exact, replaced: false };
  const name = runName(param);
  let best: TrackRow | null = null;
  const rank = (t: TrackRow) => (t.published ? 2 : t.shared ? 1 : 0);
  for (const t of tracks) {
    if (t.deployment_id !== depId || runName(t.run_id) !== name) continue;
    if (!best || rank(t) > rank(best) || (rank(t) === rank(best) && t.run_id > best.run_id)) best = t;
  }
  if (best) return { row: best, replaced: param !== name };
  for (const next of RENAMED[name] ?? []) {
    const found = resolveRun(tracks, depId, next);
    if (found) return { row: found.row, replaced: true };
  }
  if (LEGACY.test(name)) {
    const reviewed = tracks.find((t) => t.deployment_id === depId && t.published);
    if (reviewed) return { row: reviewed, replaced: true };
  }
  return null;
}

/** The path segment that opens `row`: its name when the name leads to it, else its exact id. */
export function runParam(tracks: TrackRow[], row: TrackRow): string {
  const name = runName(row.run_id);
  return resolveRun(tracks, row.deployment_id, name)?.row.run_id === row.run_id ? name : row.run_id;
}

/** The track page of `row`, by name when the name leads to it. */
export function trackHref(tracks: TrackRow[], row: TrackRow): string {
  return `/deployments/${encodeURIComponent(row.deployment_id)}/track/${encodeURIComponent(runParam(tracks, row))}`;
}
