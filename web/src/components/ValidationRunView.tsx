import { useRef, useState } from "react";
import { CollectButton, useCollectItem } from "../collect/collect";
import { validationText } from "../collect/texts";
import { Badge } from "./ui";
import type { ValidationRun } from "../lib/types";

const FACT_LABELS: Record<string, string> = {
  rows: "Rows",
  rate_hz: "Base rate (Hz)",
  median_dt_s: "Median interval (s)",
  accel_unit: "Accelerometer unit",
  time_format: "Time format",
  first_time: "First sample",
  last_time: "Last sample",
  duration_s: "Duration (s)",
  gaps: "Gaps",
  max_gap_s: "Longest gap (s)",
  duplicates: "Repeated timestamps",
  non_monotonic: "Backward steps",
};

export default function ValidationRunView({ run }: { run: ValidationRun }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const id = `run:${run.id}`;
  const title = `${run.mode} validation of ${run.file_path || "a file"}`;
  useCollectItem(id, title, () => validationText(run), box);
  const facts = run.results.facts ?? {};
  const channels = (facts.channels ?? {}) as Record<string, { fill_fraction: number; rate_hz: number | null; violations: number }>;
  const window = facts.deployment_window as { pre_release_s: number; post_recovery_s: number } | undefined;
  return (
    <div ref={box} data-collect-item className="border-t border-line py-2 text-sm">
      <div className="flex items-center">
      <CollectButton id={id} title={title} kind="validation run" />
      <button type="button" className="flex w-full items-center gap-3 text-left" onClick={() => setOpen((o) => !o)}>
        <Badge tone={run.status}>{run.status}</Badge>
        <span className="font-mono text-xs text-muted">{run.mode}</span>
        <span className="truncate">{run.file_path || "(no file)"}</span>
        <span className="ml-auto shrink-0 font-mono text-xs text-muted">
          {run.finished_utc ?? run.created_utc}
          {run.unverified && " (prototype record, unverified)"}
        </span>
      </button>
      </div>
      {open && (
        <div className="mt-2 space-y-3 pl-2">
          <p className="text-muted">{run.summary}</p>
          {run.results.checks && (
            <ul className="space-y-1">
              {run.results.checks.map((c) => (
                <li key={c.name} className="flex gap-2">
                  <Badge tone={c.status}>{c.status}</Badge>
                  <span className="font-semibold">{c.name}:</span>
                  <span>{c.detail}</span>
                </li>
              ))}
            </ul>
          )}
          <dl className="grid grid-cols-2 gap-x-6 gap-y-1 font-mono text-xs md:grid-cols-4">
            {Object.entries(FACT_LABELS)
              .filter(([k]) => facts[k] != null)
              .map(([k, label]) => (
                <div key={k}>
                  <dt className="text-muted">{label}</dt>
                  <dd>{String(facts[k])}</dd>
                </div>
              ))}
            {window && (
              <div>
                <dt className="text-muted">Before release / after recovery (s)</dt>
                <dd>
                  {window.pre_release_s} / {window.post_recovery_s}
                </dd>
              </div>
            )}
          </dl>
          {Object.keys(channels).length > 0 && (
            <table className="font-mono text-xs">
              <thead className="text-left text-muted">
                <tr>
                  <th className="pr-4 font-normal">Channel</th>
                  <th className="pr-4 font-normal">Filled</th>
                  <th className="pr-4 font-normal">Rate (Hz)</th>
                  <th className="font-normal">Outside limits</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(channels).map(([name, c]) => (
                  <tr key={name}>
                    <td className="pr-4">{name}</td>
                    <td className="pr-4">{(c.fill_fraction * 100).toFixed(1)} %</td>
                    <td className="pr-4">{c.rate_hz ?? "--"}</td>
                    <td>{c.violations}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {run.results.thresholds && (
            <details className="text-xs text-muted">
              <summary>Thresholds ({run.tool_version})</summary>
              <pre className="mt-1 whitespace-pre-wrap">{JSON.stringify(run.results.thresholds, null, 2)}</pre>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
