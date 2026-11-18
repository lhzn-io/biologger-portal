import type { TrackRow } from "./types";

/**
 * One track per deployment, for the overview: the one an editor published, else the most recent run (run ids start
 * with their UTC start time). Keeps the order deployments first appear in `tracks`.
 */
export function oneTrackPerDeployment(tracks: TrackRow[]): TrackRow[] {
  const pick = new Map<string, TrackRow>();
  for (const t of tracks) {
    const cur = pick.get(t.deployment_id);
    if (!cur || (!cur.published && (t.published || t.run_id > cur.run_id))) pick.set(t.deployment_id, t);
  }
  return [...pick.values()];
}
