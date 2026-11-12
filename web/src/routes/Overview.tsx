import { Link } from "react-router";
import { ErrorNote, Loading, Panel } from "../components/ui";
import { bytes } from "../lib/format";
import { useDeployments, useTracks } from "../lib/queries";

/** Landing page: catalog totals and the tracks; the all-deployments map arrives with the viewer (D3). */
export default function Overview() {
  const deps = useDeployments();
  const tracks = useTracks();
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
          ["Files on the server", String(files)],
          ["Data on the server", bytes(size)],
        ].map(([label, value]) => (
          <Panel key={label}>
            <p className="text-xs text-muted">{label}</p>
            <p className="font-mono text-2xl">{value}</p>
          </Panel>
        ))}
      </div>
      <Panel title="Reconstructed tracks">
        {(tracks.data ?? []).length === 0 ? (
          <p className="text-sm text-muted">No track bundles yet.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {tracks.data!.map((t) => (
              <li key={t.id}>
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
