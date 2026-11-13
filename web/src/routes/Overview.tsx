import { lazy, Suspense } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { ErrorNote, Loading, Panel } from "../components/ui";
import { bytes, TRACK_COLORS } from "../lib/format";
import { isPublished } from "../lib/mode";
import { useDeployments, useTracks } from "../lib/queries";
import { loadDemFrom } from "../viewer/dem";

const OverviewMap = lazy(() => import("../viewer/OverviewMap"));

/** Landing page: catalog totals, every track on one map, and the list of tracks. */
export default function Overview() {
  const deps = useDeployments();
  const tracks = useTracks();
  const hasTracks = (tracks.data ?? []).length > 0;
  const dem = useQuery({
    queryKey: ["dem", "overview"],
    queryFn: () => loadDemFrom("/api/terrain/overview"),
    enabled: hasTracks,
    staleTime: Infinity,
    retry: 0,
  });
  if (deps.isLoading) return <Loading what="the catalog" />;
  if (deps.error) return <ErrorNote error={deps.error} />;
  const list = deps.data ?? [];
  const files = list.reduce((n, d) => n + d.file_count, 0);
  const size = list.reduce((n, d) => n + d.total_bytes, 0);
  const species = new Set(list.map((d) => d.species).filter(Boolean));
  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-4">
        {[
          ["Deployments", String(list.length)],
          ["Species", String(species.size)],
          ["Files catalogued", String(files)],
          ["Data catalogued", bytes(size)],
        ].map(([label, value]) => (
          <Panel key={label}>
            <p className="text-xs text-muted">{label}</p>
            <p className="font-mono text-2xl">{value}</p>
          </Panel>
        ))}
      </div>
      {hasTracks && (
        <Panel title="All tracks">
          {dem.isLoading ? (
            <p className="text-sm text-muted">
              {isPublished() ? "Loading topobathymetry..." : "Fetching topobathymetry (the first view can take up to a minute)..."}
            </p>
          ) : (
            <Suspense fallback={<p className="text-sm text-muted">Loading the map...</p>}>
              <OverviewMap tracks={tracks.data!} dem={dem.data ?? null} />
            </Suspense>
          )}
          {dem.error && <p className="mt-2 text-xs text-muted">Shown without relief: {dem.error.message}</p>}
        </Panel>
      )}
      <Panel title="Reconstructed tracks">
        {(tracks.data ?? []).length === 0 ? (
          <p className="text-sm text-muted">No track bundles yet.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {tracks.data!.map((t, k) => (
              <li key={t.id}>
                <i className="mr-2 inline-block h-1 w-4 align-middle" style={{ background: TRACK_COLORS[k % TRACK_COLORS.length] }} />
                <Link className="font-mono text-accent hover:underline" to={`/deployments/${encodeURIComponent(t.deployment_id)}/track/${encodeURIComponent(t.run_id)}`}>
                  {t.deployment_id}
                </Link>{" "}
                <span className="text-muted">
                  {t.track_model}, {t.count?.toLocaleString()} samples at {t.rate_hz} Hz, run {t.run_id}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
