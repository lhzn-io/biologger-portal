import { useMemo, useState } from "react";
import { Link } from "react-router";
import { Badge, ErrorNote, Loading, Panel } from "../components/ui";
import { bytes, duration, utc } from "../lib/format";
import { useDeployments } from "../lib/queries";
import type { DeploymentSummary } from "../lib/types";

type SortKey = "id" | "time_start_utc" | "duration" | "file_count" | "total_bytes";

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: "id", label: "Deployment" },
  { key: "time_start_utc", label: "Release (UTC)" },
  { key: "duration", label: "Duration" },
  { key: "file_count", label: "Files" },
  { key: "total_bytes", label: "Size" },
];

function sortValue(d: DeploymentSummary, key: SortKey): number | string {
  if (key === "duration") return d.time_start_utc != null && d.time_end_utc != null ? d.time_end_utc - d.time_start_utc : -1;
  const v = d[key];
  return v ?? -1;
}

export default function Deployments() {
  const { data, error, isLoading } = useDeployments();
  const [sort, setSort] = useState<{ key: SortKey; asc: boolean }>({ key: "time_start_utc", asc: true });
  const rows = useMemo(() => {
    const list = [...(data ?? [])];
    list.sort((a, b) => {
      const x = sortValue(a, sort.key);
      const y = sortValue(b, sort.key);
      const c = x < y ? -1 : x > y ? 1 : 0;
      return sort.asc ? c : -c;
    });
    return list;
  }, [data, sort]);

  if (isLoading) return <Loading what="deployments" />;
  if (error) return <ErrorNote error={error} />;
  return (
    <Panel title={`Deployments (${rows.length})`}>
      <table className="w-full text-sm">
        <thead className="text-left text-muted">
          <tr>
            {COLUMNS.map((c) => (
              <th key={c.key} className="py-1 pr-4 font-normal">
                <button
                  type="button"
                  className="hover:text-ink"
                  onClick={() => setSort((s) => ({ key: c.key, asc: s.key === c.key ? !s.asc : true }))}
                >
                  {c.label}
                  {sort.key === c.key ? (sort.asc ? " (asc)" : " (desc)") : ""}
                </button>
              </th>
            ))}
            <th className="py-1 pr-4 font-normal">Species</th>
            <th className="py-1 pr-4 font-normal">Tracks</th>
            <th className="py-1 font-normal">Last validation</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((d) => (
            <tr key={d.id} className="border-t border-line">
              <td className="py-1.5 pr-4 font-mono">
                <Link to={`/deployments/${encodeURIComponent(d.id)}`} className="text-accent hover:underline">
                  {d.id}
                </Link>
              </td>
              <td className="pr-4">{utc(d.time_start_utc)}</td>
              <td className="pr-4">{duration(d.time_start_utc, d.time_end_utc)}</td>
              <td className="pr-4">{d.file_count}</td>
              <td className="pr-4">{bytes(d.total_bytes)}</td>
              <td className="pr-4">
                <span className="italic">{d.species}</span>
                {d.common_name && <span className="text-muted"> ({d.common_name})</span>}
              </td>
              <td className="pr-4">{d.track_count}</td>
              <td>{d.last_validation ? <Badge tone={d.last_validation}>{d.last_validation}</Badge> : "--"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}
