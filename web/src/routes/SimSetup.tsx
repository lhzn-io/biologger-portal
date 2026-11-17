import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Badge, Button, ErrorNote, Panel } from "../components/ui";
import { getJson, sendJson } from "../lib/api";
import { bytes } from "../lib/format";
import { useDeployments } from "../lib/queries";

export interface SimProfile {
  name: string;
  title: string;
  description: string;
  tag_types: string[];
  accepts: string[];
}

export interface RunSetupPreview {
  profile: string | null;
  suggested: string | null;
  inputs: { path: string; kind: string; size: number; recognized: boolean }[];
  input_path: string | null;
  blockers: string[];
  config_yaml: string;
  meta_csv: string;
}

export const useSimProfiles = () =>
  useQuery({ queryKey: ["sim-profiles"], queryFn: () => getJson<SimProfile[]>("/api/sim/profiles") });

/** Pick a deployment's simulation profile and input, and see the biologger-sim config the run would use. */
export function SimSetupPanel({ dep, setDep }: { dep: string; setDep: (id: string) => void }) {
  const deployments = useDeployments().data ?? [];
  const profiles = useSimProfiles().data ?? [];
  const [profile, setProfile] = useState("");
  const [input, setInput] = useState("");
  const [overrides, setOverrides] = useState("");
  const [showConfig, setShowConfig] = useState(false);
  const preview = useMutation({
    mutationFn: () =>
      sendJson<RunSetupPreview>("/api/sim/preview", "POST", {
        deployment_id: dep,
        profile: profile || null,
        input_path: input || null,
        overrides,
      }),
  });
  const data = preview.data;
  const chosen = profiles.find((p) => p.name === (profile || data?.profile));
  const select = "rounded border border-line bg-surface px-2 py-1";
  return (
    <Panel title="Simulation setup">
      <div className="flex flex-wrap items-end gap-3 text-sm">
        <label className="flex flex-col gap-1">
          <span className="text-muted">Deployment</span>
          <select
            className={select}
            value={dep}
            onChange={(e) => {
              setDep(e.target.value);
              setInput("");
              preview.reset();
            }}
          >
            <option value="">Choose...</option>
            {deployments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.id}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-muted">Profile</span>
          <select
            className={select}
            value={profile}
            onChange={(e) => {
              setProfile(e.target.value);
              setInput("");
            }}
          >
            <option value="">{data?.suggested ? `Suggested (${data.suggested})` : "Suggest from the tag type"}</option>
            {profiles.map((p) => (
              <option key={p.name} value={p.name}>
                {p.title}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-muted">Input</span>
          <select className={select} value={input} onChange={(e) => setInput(e.target.value)} disabled={!data?.inputs.length}>
            <option value="">{data?.inputs.length ? "Best match" : "Check to list files"}</option>
            {data?.inputs.map((f) => (
              <option key={f.path} value={f.path}>
                {f.path} ({bytes(f.size)}){f.recognized ? "" : ", not this profile's format"}
              </option>
            ))}
          </select>
        </label>
        <Button disabled={!dep || preview.isPending} onClick={() => preview.mutate()}>
          Check
        </Button>
      </div>
      {chosen && <p className="mt-2 max-w-3xl text-xs text-muted">{chosen.description}</p>}
      <label className="mt-3 flex flex-col gap-1 text-sm">
        <span className="text-muted">
          Overrides (optional YAML merged into the run's entity, for example <span className="font-mono">calibration: {"{"}sensor_signs: negated{"}"}</span>)
        </span>
        <textarea
          className="h-20 max-w-3xl rounded border border-line bg-surface px-2 py-1 font-mono text-xs"
          value={overrides}
          onChange={(e) => setOverrides(e.target.value)}
          spellCheck={false}
        />
      </label>
      {preview.error && <ErrorNote error={preview.error} />}
      {data && (
        <div className="mt-3 space-y-2 text-sm">
          {data.blockers.length ? (
            <ul className="space-y-1">
              {data.blockers.map((b) => (
                <li key={b}>
                  <Badge tone="failed">blocked</Badge> {b}
                </li>
              ))}
            </ul>
          ) : (
            <p>
              <Badge tone="passed">ready</Badge> {data.profile} on <span className="font-mono">{data.input_path}</span>
            </p>
          )}
          {data.config_yaml && (
            <button type="button" className="text-xs text-accent hover:underline" onClick={() => setShowConfig(!showConfig)}>
              {showConfig ? "Hide" : "Show"} the biologger-sim config and metadata row
            </button>
          )}
          {showConfig && (
            <pre className="max-h-96 max-w-3xl overflow-auto rounded border border-line bg-surface p-2 font-mono text-xs">
              {data.config_yaml}
              {"\n# meta.csv\n"}
              {data.meta_csv}
            </pre>
          )}
        </div>
      )}
    </Panel>
  );
}
