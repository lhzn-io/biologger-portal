import { lazy, Suspense, useMemo, useState } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Badge, ErrorNote, Loading } from "../components/ui";
import { bytes, duration, TRACK_COLORS } from "../lib/format";
import { isPublished } from "../lib/mode";
import { useDeployments, useTracks } from "../lib/queries";
import type { TrackRow } from "../lib/types";
import { loadDemFrom } from "../viewer/dem";

const OverviewMap = lazy(() => import("../viewer/OverviewMap"));

/** Width over height of a lon/lat box as drawn (equirectangular at its mid latitude). */
function aspectOf(west: number, south: number, east: number, north: number): number {
  const mid = ((south + north) / 2) * (Math.PI / 180);
  const a = ((east - west) * Math.cos(mid)) / Math.max(1e-6, north - south);
  return Math.min(2, Math.max(0.5, a));
}

const day = (s: number | null) => (s == null ? "--" : new Date(s * 1000).toISOString().slice(0, 10));
const trackHref = (t: TrackRow) => `/deployments/${encodeURIComponent(t.deployment_id)}/track/${encodeURIComponent(t.run_id)}`;

/** Landing page: every track on one map (left), and the deployments with their tracks (right). */
export default function Overview() {
  const deps = useDeployments();
  const tracks = useTracks();
  const [hover, setHover] = useState<string | null>(null);
  const list = useMemo(() => tracks.data ?? [], [tracks.data]);
  const colors = useMemo(() => list.map((_, k) => TRACK_COLORS[k % TRACK_COLORS.length]!), [list]);
  const dem = useQuery({
    queryKey: ["dem", "overview"],
    queryFn: () => loadDemFrom("/api/terrain/overview"),
    enabled: list.length > 0,
    staleTime: Infinity,
    retry: 0,
  });

  // The map's shape follows the area it shows: the DEM crop, or the tracks' extent until it loads.
  const aspect = useMemo(() => {
    if (dem.data) return aspectOf(...dem.data.meta.bounds);
    const lats = list.flatMap((t) => t.bounds.lat ?? []);
    const lons = list.flatMap((t) => t.bounds.lon ?? []);
    return lats.length ? aspectOf(Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)) : 1;
  }, [dem.data, list]);

  if (deps.isLoading) return <Loading what="the catalog" />;
  if (deps.error) return <ErrorNote error={deps.error} />;
  const rows = [...(deps.data ?? [])].sort((a, b) => (a.time_start_utc ?? 0) - (b.time_start_utc ?? 0));
  const files = rows.reduce((n, d) => n + d.file_count, 0);
  const size = rows.reduce((n, d) => n + d.total_bytes, 0);
  const species = new Set(rows.map((d) => d.species).filter(Boolean));
  const trackOf = (id: string) => {
    const k = list.findIndex((t) => t.deployment_id === id && t.published);
    const j = k >= 0 ? k : list.findIndex((t) => t.deployment_id === id);
    return j >= 0 ? { track: list[j]!, color: colors[j]! } : null;
  };

  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
      <div
        className="w-full overflow-hidden rounded-lg border border-line bg-panel lg:sticky lg:top-4 lg:h-[calc(100vh-6.5rem)] lg:w-auto lg:max-w-[45%] lg:flex-none"
        style={{ aspectRatio: String(aspect) }}
      >
        {list.length === 0 ? (
          <p className="p-4 text-sm text-muted">No track bundles yet.</p>
        ) : dem.isLoading ? (
          <p className="p-4 text-sm text-muted">
            {isPublished() ? "Loading topobathymetry..." : "Fetching topobathymetry (the first view can take up to a minute)..."}
          </p>
        ) : (
          <Suspense fallback={<p className="p-4 text-sm text-muted">Loading the map...</p>}>
            <OverviewMap tracks={list} colors={colors} dem={dem.data ?? null} highlight={hover} onHover={setHover} />
          </Suspense>
        )}
      </div>

      <div className="min-w-0 flex-1 space-y-3">
        <dl className="flex flex-wrap gap-x-6 gap-y-1 rounded-lg border border-line bg-panel px-4 py-2 text-sm">
          {[
            ["Deployments", String(rows.length)],
            ["Species", String(species.size)],
            ["Tracks", String(list.length)],
            ["Files cataloged", String(files)],
            ["Data cataloged", bytes(size)],
          ].map(([label, value]) => (
            <div key={label} className="flex items-baseline gap-2">
              <dt className="text-xs text-muted">{label}</dt>
              <dd className="font-mono">{value}</dd>
            </div>
          ))}
        </dl>
        {dem.error && <p className="text-xs text-muted">Map shown without relief: {dem.error.message}</p>}

        <section className="overflow-x-auto rounded-lg border border-line bg-panel">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted">
              <tr>
                <th className="w-6 py-2 pl-3" aria-label="Track color" />
                <th className="py-2 pr-4 font-normal">Deployment</th>
                <th className="py-2 pr-4 font-normal">Species</th>
                <th className="py-2 pr-4 font-normal">Release (UTC)</th>
                <th className="py-2 pr-4 font-normal">Duration</th>
                <th className="py-2 pr-4 font-normal">Track</th>
                <th className="py-2 pr-3 font-normal">Validation</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((d) => {
                const t = trackOf(d.id);
                const lit = hover === d.id;
                return (
                  <tr
                    key={d.id}
                    className={`border-t border-line ${lit ? "bg-surface" : ""}`}
                    onMouseEnter={() => t && setHover(d.id)}
                    onMouseLeave={() => t && setHover(null)}
                  >
                    <td className="py-1.5 pl-3">
                      {t && <i className="inline-block h-1 w-4 align-middle" style={{ background: t.color }} />}
                    </td>
                    <td className="pr-4 font-mono whitespace-nowrap">
                      <Link to={`/deployments/${encodeURIComponent(d.id)}`} className="text-accent hover:underline">
                        {d.id}
                      </Link>
                    </td>
                    <td className="pr-4 whitespace-nowrap italic" title={d.common_name || undefined}>
                      {d.species || "--"}
                    </td>
                    <td className="pr-4 font-mono whitespace-nowrap">{day(d.time_start_utc)}</td>
                    <td className="pr-4 whitespace-nowrap">{duration(d.time_start_utc, d.time_end_utc)}</td>
                    <td className="pr-4 whitespace-nowrap">
                      {t ? (
                        <Link
                          to={trackHref(t.track)}
                          className="text-accent hover:underline"
                          title={`${t.track.count?.toLocaleString()} samples at ${t.track.rate_hz} Hz, run ${t.track.run_id}`}
                        >
                          {t.track.track_model}
                        </Link>
                      ) : (
                        <span className="text-muted">--</span>
                      )}
                    </td>
                    <td className="pr-3">{d.last_validation ? <Badge tone={d.last_validation}>{d.last_validation}</Badge> : "--"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      </div>
    </div>
  );
}
