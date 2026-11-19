import { useState } from "react";
import { Link, useParams } from "react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Badge, Button, ErrorNote, Loading, Panel } from "../components/ui";
import ValidationRunView from "../components/ValidationRunView";
import CollectPanel from "../collect/CollectPanel";
import { deploymentText, filesText } from "../collect/texts";
import { sendJson } from "../lib/api";
import { bytes, coord, duration, KIND_LABELS, utc } from "../lib/format";
import { lacksMagnetometer } from "../lib/magnetometer";
import { isPublished } from "../lib/mode";
import { useDeployment, useMe } from "../lib/queries";
import { trackHref } from "../lib/runLinks";
import type { DeploymentDetail } from "../lib/types";
import { QueueRunButton } from "./SimSetup";

// Canonical fields grouped for the form; the order follows the lab's Xgladius sheet.
const GROUPS: { title: string; fields: string[] }[] = [
  { title: "Animal", fields: ["species", "common_name", "sex", "length", "length_unit", "length_type"] },
  {
    title: "Deployment",
    fields: ["location_name", "time_start_utc", "start_lat", "start_lon", "time_end_utc", "time_location_utc", "end_lat", "end_lon"],
  },
  {
    title: "Instruments",
    fields: ["bodylogger1_type", "bodylogger1_id", "bodylogger2_type", "bodylogger2_id", "camera_type", "camera_id",
      "tdr_type", "tdr_id", "jawtag_type", "jawtag_id", "radio_type", "radio_freq", "spot_type", "spot_hex", "spot_sn"],
  },
  { title: "Package", fields: ["package_placement", "package_orientation", "attachment_method"] },
  { title: "People and notes", fields: ["deployment_team", "recovery_team", "resulting_paper(s)", "short_note", "notes", "current_link"] },
];

// People's names stay on the hub; the published snapshot leaves these out (server metadata.PERSON_FIELDS).
const PERSON_FIELDS = new Set(["deployment_team", "recovery_team"]);
const shownFields = (fields: string[]) => (isPublished() ? fields.filter((f) => !PERSON_FIELDS.has(f)) : fields);

export default function DeploymentPage() {
  const id = decodeURIComponent(useParams().id ?? "");
  const { data, error, isLoading } = useDeployment(id);
  const me = useMe().data;
  if (isLoading) return <Loading what={id} />;
  if (error || !data) return <ErrorNote error={error} />;
  const editor = me?.editor ?? false;
  return (
    <div className="space-y-4">
      <header>
        <h1 className="font-mono text-xl">{data.id}</h1>
        <p className="text-sm text-muted">
          <span className="italic">{data.species}</span> {data.common_name && `(${data.common_name})`} | {data.location || "--"} |{" "}
          {utc(data.time_start_utc)} to {utc(data.time_end_utc)} ({duration(data.time_start_utc, data.time_end_utc)})
        </p>
        <p className="text-sm text-muted">
          Release {coord(data.start_lat, data.start_lon)} | Recovery {coord(data.end_lat, data.end_lon)} | DEM{" "}
          {data.dem_dataset || "none"}
          {data.aliases.length > 1 && ` | Also known as ${data.aliases.filter((a) => a !== data.id.toLowerCase()).join(", ")}`}
        </p>
      </header>
      <Tracks data={data} editor={editor} />
      <Files data={data} editor={editor} />
      <Panel title={`Validation runs (${data.validation_runs.length})`}>
        {data.validation_runs.length === 0 ? (
          <p className="text-sm text-muted">No runs yet.</p>
        ) : (
          data.validation_runs.map((r) => <ValidationRunView key={r.id} run={r} />)
        )}
      </Panel>
      <Metadata data={data} editor={editor} />
      <Audit data={data} />
    </div>
  );
}

function useRefresh(id: string) {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ["deployment", id] });
    void qc.invalidateQueries({ queryKey: ["deployments"] });
    void qc.invalidateQueries({ queryKey: ["matrix"] });
  };
}

function Tracks({ data, editor }: { data: DeploymentDetail; editor: boolean }) {
  const refresh = useRefresh(data.id);
  const publish = useMutation({
    mutationFn: (run_id: string) => sendJson(`/api/deployments/${encodeURIComponent(data.id)}/published-track`, "PUT", { run_id }),
    onSuccess: refresh,
  });
  const share = useMutation({
    mutationFn: ({ run_id, shared }: { run_id: string; shared: boolean }) =>
      sendJson(`/api/deployments/${encodeURIComponent(data.id)}/tracks/${encodeURIComponent(run_id)}/shared`, "PUT", { shared }),
    onSuccess: refresh,
  });
  return (
    <Panel
      title={`Tracks (${data.tracks.length})`}
      actions={editor && !isPublished() ? <QueueRunButton body={{ deployment_id: data.id }} label="Run simulation" /> : undefined}
    >
      {lacksMagnetometer(data) && (
        <p className="mb-2 text-sm text-muted">
          No track comparison for this deployment: the tag recorded no magnetometer, so it has no heading.
          biologger-sim cannot dead-reckon it, with or without the ocean current, and places the track by
          interpolating between the start and end fixes.
        </p>
      )}
      {data.tracks.length === 0 ? (
        <p className="text-sm text-muted">No track bundles yet.{editor && !isPublished() ? " Run the simulation to make one." : ""}</p>
      ) : (
        <>
        {data.tracks.length > 1 && (
          <p className="mb-2 text-sm">
            <Link to={`/deployments/${encodeURIComponent(data.id)}/compare`} className="text-accent hover:underline">
              Compare the {data.tracks.length} tracks
            </Link>
            <span className="text-muted"> side by side: with and without the ocean current, dead-reckoned and pinned</span>
          </p>
        )}
        <table className="w-full text-sm">
          <thead className="text-left text-muted">
            <tr>
              <th className="py-1 pr-4 font-normal">Run</th>
              <th className="pr-4 font-normal">Track model</th>
              <th className="pr-4 font-normal">Samples</th>
              <th className="pr-4 font-normal">Simulator</th>
              <th className="font-normal" />
            </tr>
          </thead>
          <tbody>
            {data.tracks.map((t) => (
              <tr key={t.id} className="border-t border-line">
                <td className="py-1.5 pr-4 font-mono text-xs">
                  <Link to={trackHref(data.tracks, t)} className="text-accent hover:underline">
                    {t.run_id}
                  </Link>
                  {t.published ? <span className="ml-2"><Badge tone="passed">reviewed</Badge></span> : null}
                  {!t.published && t.shared && !isPublished() ? (
                    <span className="ml-2" title="Published on the viewer beside the reviewed run, for comparison">
                      <Badge tone="remote">on viewer</Badge>
                    </span>
                  ) : null}
                </td>
                <td className="pr-4">{t.track_model}</td>
                <td className="pr-4">
                  {t.count?.toLocaleString()} at {t.rate_hz} Hz
                </td>
                <td className="pr-4 font-mono text-xs">
                  {t.sim_git_commit.slice(0, 7)}
                  {t.sim_git_dirty ? " (uncommitted changes)" : ""}
                </td>
                <td className="text-right">
                  {editor && !t.published && (
                    <span className="flex justify-end gap-2">
                      <span title={t.shared ? "Stop publishing this run on the viewer" : "Publish this run on the viewer beside the reviewed one, for comparison"}>
                        <Button kind="plain" onClick={() => share.mutate({ run_id: t.run_id, shared: !t.shared })} disabled={share.isPending}>
                          {t.shared ? "Unshare" : "Share"}
                        </Button>
                      </span>
                      <Button kind="plain" onClick={() => publish.mutate(t.run_id)} disabled={publish.isPending}>
                        Mark reviewed
                      </Button>
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </>
      )}
      {publish.error && <ErrorNote error={publish.error} />}
      {share.error && <ErrorNote error={share.error} />}
    </Panel>
  );
}

function Files({ data, editor }: { data: DeploymentDetail; editor: boolean }) {
  const refresh = useRefresh(data.id);
  const validate = useMutation({
    mutationFn: (v: { file_id: number; mode: "light" | "deep" }) => sendJson("/api/validation", "POST", v),
    onSuccess: refresh,
  });
  const files = data.files.filter((f) => !f.missing);
  return (
    <CollectPanel id={`dep:${data.id}:files`} title={`Files, ${data.id}`} text={() => filesText(data)}>
      <table className="w-full text-sm">
        <thead className="text-left text-muted">
          <tr>
            <th className="py-1 pr-4 font-normal">Path</th>
            <th className="pr-4 font-normal">Kind</th>
            <th className="pr-4 font-normal">Size</th>
            <th className="pr-4 font-normal">Span</th>
            <th className="font-normal" />
          </tr>
        </thead>
        <tbody>
          {files.map((f) => (
            <tr key={f.id} className="border-t border-line">
              <td className="py-1.5 pr-4 font-mono text-xs">{f.path}</td>
              <td className="pr-4">{KIND_LABELS[f.kind] ?? f.kind}</td>
              <td className="pr-4">{bytes(f.size)}</td>
              <td className="pr-4 font-mono text-xs">
                {f.info.first_time ? `${f.info.first_time} to ${f.info.last_time ?? "?"}` : ""}
              </td>
              <td className="space-x-2 text-right whitespace-nowrap">
                {editor && f.kind === "standard" && (
                  <>
                    <Button kind="plain" disabled={validate.isPending} onClick={() => validate.mutate({ file_id: f.id, mode: "light" })}>
                      Light check
                    </Button>
                    <Button kind="plain" disabled={validate.isPending} onClick={() => validate.mutate({ file_id: f.id, mode: "deep" })}>
                      Deep check
                    </Button>
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {validate.error && <ErrorNote error={validate.error} />}
      {validate.isSuccess && <p className="mt-2 text-xs text-muted">Run queued; results appear under Validation runs.</p>}
    </CollectPanel>
  );
}

function Metadata({ data, editor }: { data: DeploymentDetail; editor: boolean }) {
  const refresh = useRefresh(data.id);
  const [draft, setDraft] = useState<Record<string, string> | null>(null);
  const save = useMutation({
    mutationFn: (fields: Record<string, string>) => sendJson(`/api/deployments/${encodeURIComponent(data.id)}`, "PATCH", { fields }),
    onSuccess: () => {
      setDraft(null);
      refresh();
    },
  });
  const changed = draft ? Object.fromEntries(Object.entries(draft).filter(([k, v]) => v !== (data.fields[k] ?? ""))) : {};
  return (
    <CollectPanel
      id={`dep:${data.id}:metadata`}
      title={`Metadata, ${data.id}`}
      text={() => deploymentText(data)}
      actions={
        editor &&
        (draft ? (
          <>
            <Button kind="plain" onClick={() => setDraft(null)}>
              Cancel
            </Button>
            <Button onClick={() => save.mutate(changed)} disabled={save.isPending || Object.keys(changed).length === 0}>
              Save {Object.keys(changed).length} change(s)
            </Button>
          </>
        ) : (
          <Button kind="plain" onClick={() => setDraft({ ...data.fields })}>
            Edit
          </Button>
        ))
      }
    >
      <div className="grid gap-6 md:grid-cols-2">
        {GROUPS.map((g) => (
          <fieldset key={g.title}>
            <legend className="mb-1 text-xs font-semibold text-muted uppercase">{g.title}</legend>
            <dl className="space-y-1 text-sm">
              {shownFields(g.fields).map((f) => (
                <div key={f} className="grid grid-cols-[11rem_1fr] items-center gap-2">
                  <dt className="font-mono text-xs text-muted">{f}</dt>
                  <dd>
                    {draft ? (
                      <input
                        aria-label={f}
                        className="w-full rounded border border-line bg-surface px-2 py-0.5"
                        value={draft[f] ?? ""}
                        onChange={(e) => setDraft({ ...draft, [f]: e.target.value })}
                      />
                    ) : (
                      data.fields[f] || <span className="text-muted">--</span>
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          </fieldset>
        ))}
      </div>
      <p className="mt-3 text-xs text-muted">Source: {data.source}. Updated {data.updated_utc}.</p>
      {save.error && <ErrorNote error={save.error} />}
    </CollectPanel>
  );
}

function Audit({ data }: { data: DeploymentDetail }) {
  if (data.audit.length === 0) return null;
  return (
    <Panel title="Change history">
      <table className="w-full font-mono text-xs">
        <tbody>
          {data.audit.map((a) => (
            <tr key={a.id} className="border-t border-line align-top">
              <td className="py-1 pr-4 whitespace-nowrap">{a.at_utc}</td>
              <td className="pr-4">{a.actor}</td>
              <td className="pr-4">{a.field}</td>
              <td className="text-muted">
                {a.old_value ?? ""} {a.old_value != null || a.new_value != null ? "->" : ""} {a.new_value ?? ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}
