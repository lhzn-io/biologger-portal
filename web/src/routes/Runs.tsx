import { Fragment, useMemo, useState } from "react";
import { Link } from "react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Badge, Button, ErrorNote, Loading, Panel } from "../components/ui";
import { sendJson } from "../lib/api";
import { useDeployments, useMe } from "../lib/queries";
import { BACKENDS, isActive, jobDuration, STATUS_TONE, useSimJob, useSimJobs, type BatchPlan, type SimJob } from "../lib/sim";
import { useSimProfiles } from "./SimSetup";

/** Simulation runs: the queue the runners work through, and new batches. Editors only. */
export default function Runs() {
  const me = useMe().data;
  if (me && !me.editor) {
    return (
      <Panel title="Runs">
        <p className="text-sm text-muted">Simulation runs are started by the portal's editors.</p>
      </Panel>
    );
  }
  return (
    <div className="space-y-4">
      <Queue />
      <NewBatch />
    </div>
  );
}

function Queue() {
  const { data, error, isLoading } = useSimJobs();
  const [open, setOpen] = useState<number | null>(null);
  if (isLoading) return <Loading what="the run queue" />;
  if (error) return <ErrorNote error={error} />;
  const jobs = data ?? [];
  const waiting = jobs.filter((j) => j.status === "queued").length;
  const running = jobs.filter((j) => j.status === "claimed" || j.status === "running").length;
  return (
    <Panel title={`Run queue (${waiting} waiting, ${running} running)`}>
      {jobs.length === 0 ? (
        <p className="text-sm text-muted">No runs yet. Queue one below, or from a deployment's page.</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-left text-muted">
            <tr>
              <th className="py-1 pr-3 font-normal">Job</th>
              <th className="pr-3 font-normal">Deployment</th>
              <th className="pr-3 font-normal">Profile</th>
              <th className="pr-3 font-normal">Status</th>
              <th className="pr-3 font-normal">Runner</th>
              <th className="pr-3 font-normal">Took</th>
              <th className="pr-3 font-normal">Simulator</th>
              <th className="font-normal">Track</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((j) => (
              <Fragment key={j.id}>
                <tr className="cursor-pointer border-t border-line hover:bg-surface" onClick={() => setOpen(open === j.id ? null : j.id)}>
                  <td className="py-1.5 pr-3 font-mono text-xs">
                    {open === j.id ? "v" : ">"} {j.id}
                    {j.batch_id ? <span className="text-muted"> b{j.batch_id}</span> : null}
                  </td>
                  <td className="pr-3 font-mono text-xs">{j.deployment_id}</td>
                  <td className="pr-3 text-xs">
                    {j.profile} at {j.rate_hz} Hz
                  </td>
                  <td className="pr-3">
                    <Badge tone={STATUS_TONE[j.status]}>{j.status}</Badge>
                    {j.attempts > 1 && <span className="ml-1 text-xs text-muted">attempt {j.attempts}</span>}
                  </td>
                  <td className="pr-3 text-xs">
                    {j.runner || "--"}
                    <span className="text-muted"> ({j.backend_used || j.backend_pref})</span>
                  </td>
                  <td className="pr-3 font-mono text-xs">{jobDuration(j)}</td>
                  <td className="pr-3 font-mono text-xs">
                    {j.sim_git_commit.slice(0, 7) || "--"}
                    {j.sim_git_dirty ? " (uncommitted changes)" : ""}
                  </td>
                  <td className="font-mono text-xs">
                    {j.run_id ? (
                      <Link
                        className="text-accent hover:underline"
                        to={`/deployments/${encodeURIComponent(j.deployment_id)}/track/${encodeURIComponent(j.run_id)}`}
                        onClick={(e) => e.stopPropagation()}
                      >
                        {j.run_id}
                      </Link>
                    ) : (
                      "--"
                    )}
                  </td>
                </tr>
                {open === j.id && (
                  <tr>
                    <td colSpan={8} className="pb-3">
                      <JobDetail job={j} />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      )}
    </Panel>
  );
}

function JobDetail({ job }: { job: SimJob }) {
  const qc = useQueryClient();
  const { data } = useSimJob(job.id);
  const [showConfig, setShowConfig] = useState(false);
  const act = useMutation({
    mutationFn: (what: "cancel" | "retry") => sendJson<SimJob>(`/api/sim/jobs/${job.id}/${what}`, "POST", {}),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["sim-jobs"] });
      void qc.invalidateQueries({ queryKey: ["sim-job", job.id] });
    },
  });
  return (
    <div className="space-y-2 rounded border border-line bg-surface p-3 text-sm">
      <p className="text-xs text-muted">
        Input <span className="font-mono">{job.input_path}</span>, queued by {job.created_by} at {job.created_utc.replace("T", " ")}
        {job.retry_of ? `, a retry of job ${job.retry_of}` : ""}. Backend preference {job.backend_pref}.
      </p>
      {job.error && <p className={job.status === "error" ? "text-bad" : "text-muted"}>{job.error}</p>}
      <pre className="max-h-72 overflow-auto rounded border border-line bg-panel p-2 font-mono text-xs">
        {data?.log_tail || (isActive(job.status) ? "Waiting for the runner's log..." : "No log.")}
      </pre>
      <div className="flex items-center gap-3">
        {isActive(job.status) && (
          <Button kind="plain" disabled={act.isPending} onClick={() => act.mutate("cancel")}>
            Cancel
          </Button>
        )}
        {(job.status === "error" || job.status === "canceled") && (
          <Button kind="plain" disabled={act.isPending} onClick={() => act.mutate("retry")}>
            Retry with the same config
          </Button>
        )}
        {data && (
          <button type="button" className="text-xs text-accent hover:underline" onClick={() => setShowConfig(!showConfig)}>
            {showConfig ? "Hide" : "Show"} the config and metadata row
          </button>
        )}
      </div>
      {act.error && <ErrorNote error={act.error} />}
      {showConfig && data && (
        <pre className="max-h-96 overflow-auto rounded border border-line bg-panel p-2 font-mono text-xs">
          {data.config_yaml}
          {"\n# meta.csv\n"}
          {data.meta_csv}
        </pre>
      )}
    </div>
  );
}

export function NewBatch() {
  const qc = useQueryClient();
  const deployments = useDeployments().data;
  const profiles = useSimProfiles().data ?? [];
  const [filter, setFilter] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [profile, setProfile] = useState("");
  const [rate, setRate] = useState("1");
  const [backend, setBackend] = useState("any");
  const [label, setLabel] = useState("");
  const shown = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return (deployments ?? []).filter((d) => !f || [d.id, d.species, d.common_name].some((v) => v?.toLowerCase().includes(f)));
  }, [deployments, filter]);
  const body = (dry_run: boolean) => ({
    deployment_ids: [...picked],
    profile: profile || null,
    rate_hz: Number(rate),
    backend,
    label,
    dry_run,
  });
  const plan = useMutation({ mutationFn: () => sendJson<BatchPlan>("/api/sim/batches", "POST", body(true)) });
  const make = useMutation({
    mutationFn: () => sendJson<BatchPlan>("/api/sim/batches", "POST", body(false)),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["sim-jobs"] });
      plan.reset();
      setPicked(new Set());
    },
  });
  const changed = () => {
    plan.reset();
    make.reset();
  };
  const toggle = (id: string) => {
    const next = new Set(picked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setPicked(next);
    changed();
  };
  const rateOk = Number(rate) > 0 && Number(rate) <= 25;
  const field = "rounded border border-line bg-surface px-2 py-1";
  return (
    <Panel title="New batch">
      <div className="flex flex-wrap items-end gap-3 text-sm">
        <label className="flex flex-col gap-1">
          <span className="text-muted">Profile</span>
          <select
            className={field}
            value={profile}
            onChange={(e) => {
              setProfile(e.target.value);
              changed();
            }}
          >
            <option value="">Suggested for each tag</option>
            {profiles.map((p) => (
              <option key={p.name} value={p.name}>
                {p.title}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-muted">Track rate (Hz)</span>
          <input
            className={`${field} w-24`}
            type="number"
            min={0.1}
            max={25}
            step={0.1}
            value={rate}
            onChange={(e) => {
              setRate(e.target.value);
              changed();
            }}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-muted">Backend</span>
          <select
            className={field}
            value={backend}
            onChange={(e) => {
              setBackend(e.target.value);
              changed();
            }}
          >
            {BACKENDS.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-muted">Label (optional)</span>
          <input className={field} value={label} onChange={(e) => setLabel(e.target.value)} />
        </label>
      </div>
      <p className="mt-1 max-w-3xl text-xs text-muted">
        The backend picks which runners may take the jobs. biologger-sim computes lab runs on the CPU today, whatever the
        backend.
      </p>
      <div className="mt-3 flex items-center gap-3 text-sm">
        <input
          className={`${field} w-64`}
          placeholder="Filter by id or species"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          aria-label="Filter deployments"
        />
        <button
          type="button"
          className="text-xs text-accent hover:underline"
          onClick={() => {
            setPicked(new Set([...picked, ...shown.map((d) => d.id)]));
            changed();
          }}
        >
          Select the {shown.length} shown
        </button>
        <button
          type="button"
          className="text-xs text-accent hover:underline"
          onClick={() => {
            setPicked(new Set());
            changed();
          }}
        >
          Clear
        </button>
        <span className="text-xs text-muted">{picked.size} selected</span>
      </div>
      <div className="mt-2 max-h-64 overflow-auto rounded border border-line">
        {shown.map((d) => (
          <label key={d.id} className="flex items-center gap-2 border-b border-line px-2 py-1 text-sm last:border-b-0">
            <input type="checkbox" checked={picked.has(d.id)} onChange={() => toggle(d.id)} />
            <span className="font-mono text-xs">{d.id}</span>
            <span className="text-xs text-muted">
              {d.common_name || d.species} {d.track_count ? `| ${d.track_count} track${d.track_count > 1 ? "s" : ""}` : ""}
            </span>
          </label>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-3">
        <Button kind="plain" disabled={!picked.size || !rateOk || plan.isPending} onClick={() => plan.mutate()}>
          Check
        </Button>
        {plan.data && plan.data.planned.length > 0 && (
          <Button disabled={make.isPending} onClick={() => make.mutate()}>
            Queue {plan.data.planned.length} run{plan.data.planned.length > 1 ? "s" : ""}
          </Button>
        )}
        {!rateOk && <span className="text-xs text-bad">The rate is between 0 and 25 Hz.</span>}
      </div>
      {(plan.error || make.error) && <ErrorNote error={plan.error ?? make.error} />}
      {make.data && (
        <p className="mt-2 text-sm">
          <Badge tone="passed">queued</Badge> {make.data.jobs.length} run{make.data.jobs.length === 1 ? "" : "s"} as batch{" "}
          {make.data.batch_id}.
        </p>
      )}
      {plan.data && (
        <div className="mt-3 space-y-1 text-sm">
          <p>
            {plan.data.planned.length} of {picked.size} can run
            {plan.data.planned.length ? `: ${plan.data.planned.map((p) => `${p.deployment_id} (${p.profile})`).join(", ")}` : "."}
          </p>
          {plan.data.skipped.map((s) => (
            <p key={s.deployment_id}>
              <Badge tone="failed">skipped</Badge> <span className="font-mono text-xs">{s.deployment_id}</span>: {s.blockers.join("; ")}
            </p>
          ))}
        </div>
      )}
    </Panel>
  );
}
