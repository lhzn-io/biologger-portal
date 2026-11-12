import { useState } from "react";
import { Link } from "react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Badge, Button, ErrorNote, Panel } from "../components/ui";
import ValidationRunView from "../components/ValidationRunView";
import { sendJson, uploadFile } from "../lib/api";
import { bytes } from "../lib/format";
import { useDeployments, useMe, useValidationRun } from "../lib/queries";

interface PreviewRow {
  deployment_id: string;
  new: boolean;
  changes: { field: string; old: string; new: string }[];
  files_on_disk: number;
}

export default function Register() {
  const me = useMe().data;
  if (me && !me.editor) {
    return (
      <Panel title="Register">
        <p className="text-sm text-muted">{me.email} can read the catalog but not register files. Ask a maintainer for edit access.</p>
      </Panel>
    );
  }
  return (
    <div className="space-y-4">
      <UploadPanel />
      <NewDeploymentPanel />
      <SheetPanel />
    </div>
  );
}

function useInvalidateCatalog() {
  const qc = useQueryClient();
  return () => ["deployments", "matrix", "deployment"].forEach((k) => void qc.invalidateQueries({ queryKey: [k] }));
}

function UploadPanel() {
  const deployments = useDeployments().data ?? [];
  const invalidate = useInvalidateCatalog();
  const [dep, setDep] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState(0);
  const upload = useMutation({
    mutationFn: () => uploadFile(dep, file!, setProgress),
    onSuccess: invalidate,
  });
  const run = useValidationRun(upload.data?.validation_run ?? null).data;
  return (
    <Panel title="Upload a file to a deployment">
      <div className="flex flex-wrap items-end gap-3 text-sm">
        <label className="flex flex-col gap-1">
          <span className="text-muted">Deployment</span>
          <select className="rounded border border-line bg-surface px-2 py-1" value={dep} onChange={(e) => setDep(e.target.value)}>
            <option value="">Choose...</option>
            {deployments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.id}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-muted">File</span>
          <input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </label>
        <Button disabled={!dep || !file || upload.isPending} onClick={() => upload.mutate()}>
          Upload
        </Button>
      </div>
      <p className="mt-2 text-xs text-muted">
        Files go up in 64 MB parts and land in the deployment's folder by kind (standard, derived, raw, media). Existing
        files are never overwritten. For files of several GB, copy them to the server with rsync and run a scan instead.
        {file && ` Selected: ${file.name}, ${bytes(file.size)}.`}
      </p>
      {upload.isPending && <p className="mt-2 font-mono text-xs">{Math.round(progress * 100)} % sent</p>}
      {upload.error && <ErrorNote error={upload.error} />}
      {upload.data && (
        <div className="mt-3 text-sm">
          Stored as <span className="font-mono">{upload.data.path}</span> (SHA-256 {upload.data.sha256.slice(0, 12)}...).{" "}
          <Link className="text-accent hover:underline" to={`/deployments/${encodeURIComponent(dep)}`}>
            Open the deployment
          </Link>
          {run && <ValidationRunView run={run} />}
        </div>
      )}
    </Panel>
  );
}

function NewDeploymentPanel() {
  const invalidate = useInvalidateCatalog();
  const [fields, setFields] = useState({ deployment_id: "", species: "", common_name: "", location_name: "", time_start_utc: "", start_lat: "", start_lon: "" });
  const create = useMutation({
    mutationFn: () => sendJson<{ id: string }>("/api/deployments", "POST", { fields }),
    onSuccess: invalidate,
  });
  return (
    <Panel title="New deployment">
      <div className="grid gap-2 text-sm md:grid-cols-4">
        {Object.keys(fields).map((k) => (
          <label key={k} className="flex flex-col gap-1">
            <span className="font-mono text-xs text-muted">{k}</span>
            <input
              className="rounded border border-line bg-surface px-2 py-1"
              value={fields[k as keyof typeof fields]}
              placeholder={k === "time_start_utc" ? "8/27/25 23:33 or ISO 8601" : ""}
              onChange={(e) => setFields({ ...fields, [k]: e.target.value })}
            />
          </label>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-3">
        <Button disabled={!fields.deployment_id || create.isPending} onClick={() => create.mutate()}>
          Create
        </Button>
        {create.data && (
          <Link className="text-sm text-accent hover:underline" to={`/deployments/${encodeURIComponent(create.data.id)}`}>
            Created {create.data.id}
          </Link>
        )}
      </div>
      {create.error && <ErrorNote error={create.error} />}
    </Panel>
  );
}

function SheetPanel() {
  const invalidate = useInvalidateCatalog();
  const [text, setText] = useState<string | null>(null);
  const [take, setTake] = useState<Set<string>>(new Set());
  const preview = useMutation({
    mutationFn: (t: string) => sendJson<PreviewRow[]>("/api/sheets/preview", "POST", { text: t }),
    // Like the prototype's "register all verified": rows with files on the server start selected.
    onSuccess: (rows) => setTake(new Set(rows.filter((r) => r.files_on_disk > 0 && (r.new || r.changes.length)).map((r) => r.deployment_id))),
  });
  const apply = useMutation({
    mutationFn: () => sendJson<{ applied: string[] }>("/api/sheets/apply", "POST", { text, take: [...take] }),
    onSuccess: () => {
      invalidate();
      if (text) preview.mutate(text);
    },
  });
  const onFile = async (f: File | undefined) => {
    if (!f) return;
    const t = await f.text();
    setText(t);
    preview.mutate(t);
  };
  return (
    <Panel
      title="Import a metadata sheet"
      actions={
        <a className="text-sm text-accent hover:underline" href="/api/sheets/export.csv">
          Export the catalog as a sheet
        </a>
      }
    >
      <p className="mb-2 text-xs text-muted">
        Either of the lab's sheets (keyed by deployment_id or tag_id). The preview shows what would change and whether each
        deployment has files on the server; nothing is written until you apply the selected rows.
      </p>
      <input type="file" accept=".csv,text/csv" onChange={(e) => void onFile(e.target.files?.[0])} />
      {preview.error && <ErrorNote error={preview.error} />}
      {preview.data && (
        <>
          <table className="mt-3 w-full text-sm">
            <thead className="text-left text-muted">
              <tr>
                <th className="py-1 pr-2 font-normal" />
                <th className="pr-4 font-normal">Deployment</th>
                <th className="pr-4 font-normal">On server</th>
                <th className="font-normal">Changes</th>
              </tr>
            </thead>
            <tbody>
              {preview.data.map((r) => (
                <tr key={r.deployment_id} className="border-t border-line align-top">
                  <td className="py-1.5 pr-2">
                    <input
                      type="checkbox"
                      aria-label={`take ${r.deployment_id}`}
                      checked={take.has(r.deployment_id)}
                      disabled={!r.new && r.changes.length === 0}
                      onChange={(e) => {
                        const next = new Set(take);
                        if (e.target.checked) next.add(r.deployment_id);
                        else next.delete(r.deployment_id);
                        setTake(next);
                      }}
                    />
                  </td>
                  <td className="pr-4 font-mono">
                    {r.deployment_id} {r.new && <Badge tone="running">new</Badge>}
                  </td>
                  <td className="pr-4">
                    {r.files_on_disk > 0 ? <Badge tone="passed">{r.files_on_disk} files</Badge> : <Badge tone="missing">none</Badge>}
                  </td>
                  <td className="text-xs">
                    {r.changes.length === 0 && !r.new ? (
                      <span className="text-muted">no changes</span>
                    ) : (
                      r.changes.map((c) => (
                        <div key={c.field}>
                          <span className="font-mono">{c.field}</span>: <span className="text-muted">{c.old || "(empty)"}</span> to {c.new || "(empty)"}
                        </div>
                      ))
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-3 flex items-center gap-3">
            <Button disabled={take.size === 0 || apply.isPending} onClick={() => apply.mutate()}>
              Apply {take.size} deployment(s)
            </Button>
            {apply.data && <span className="text-sm text-muted">Applied {apply.data.applied.join(", ") || "nothing"}.</span>}
          </div>
          {apply.error && <ErrorNote error={apply.error} />}
        </>
      )}
    </Panel>
  );
}
