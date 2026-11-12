import { Link } from "react-router";
import { ErrorNote, Loading, Panel } from "../components/ui";
import { bytes, KIND_LABELS } from "../lib/format";
import { useMatrix } from "../lib/queries";
import type { MatrixCell } from "../lib/types";

function Cell({ cell }: { cell: MatrixCell }) {
  if (cell.state === "present")
    return (
      <span className="text-ok" title={`${cell.count} file(s), ${bytes(cell.bytes)}`}>
        {cell.count} / {bytes(cell.bytes)}
      </span>
    );
  if (cell.state === "remote")
    return (
      <a href={cell.link} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline" title="Not on the server; the deployment lists a Drive folder">
        Drive
      </a>
    );
  return <span className="text-muted">--</span>;
}

export default function Matrix() {
  const { data, error, isLoading } = useMatrix();
  if (isLoading) return <Loading what="the file grid" />;
  if (error || !data) return <ErrorNote error={error} />;
  return (
    <Panel title="Files by deployment">
      <p className="mb-3 text-xs text-muted">
        Count and size of files on the server per kind. "Drive" marks a product that is not on the server
        while the deployment lists a Google Drive folder, where it may be; the portal does not check Drive.
        {data.unattributed_files > 0 && ` ${data.unattributed_files} file(s) are not assigned to a deployment.`}
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-muted">
            <tr>
              <th className="py-1 pr-4 font-normal">Deployment</th>
              {data.kinds.map((k) => (
                <th key={k} className="py-1 pr-4 font-normal">
                  {KIND_LABELS[k] ?? k}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r) => (
              <tr key={r.deployment_id} className="border-t border-line">
                <td className="py-1.5 pr-4 font-mono">
                  <Link to={`/deployments/${encodeURIComponent(r.deployment_id)}`} className="text-accent hover:underline">
                    {r.deployment_id}
                  </Link>
                </td>
                {data.kinds.map((k) => (
                  <td key={k} className="pr-4 font-mono text-xs">
                    <Cell cell={r.cells[k] ?? { state: "missing" }} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
