/** The simulation run queue (server routes/sim.py): job rows, polling, and how a job is described. */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getJson, sendJson } from "./api";

export const BACKENDS = ["any", "cpu", "mlx", "warp"] as const;
export type JobStatus = "queued" | "claimed" | "running" | "done" | "error" | "canceled";

export interface SimJob {
  id: number;
  batch_id: number | null;
  deployment_id: string;
  profile: string;
  input_path: string;
  input_size: number;
  rate_hz: number;
  backend_pref: string;
  status: JobStatus;
  runner: string;
  backend_used: string;
  sim_git_commit: string;
  sim_git_dirty: number;
  run_id: string;
  error: string;
  attempts: number;
  retry_of: number | null;
  created_by: string;
  created_utc: string;
  claimed_utc: string | null;
  heartbeat_utc: string | null;
  finished_utc: string | null;
}

export interface SimJobDetail extends SimJob {
  config_yaml: string;
  meta_csv: string;
  log_tail: string;
}

export interface BatchPlan {
  batch_id: number | null;
  jobs: SimJob[];
  planned: { deployment_id: string; profile: string; input_path: string }[];
  skipped: { deployment_id: string; blockers: string[] }[];
}

export const isActive = (s: JobStatus) => s === "queued" || s === "claimed" || s === "running";

export const STATUS_TONE: Record<JobStatus, string> = {
  queued: "queued",
  claimed: "running",
  running: "running",
  done: "passed",
  error: "error",
  canceled: "missing",
};

/** How long a job ran (or has been running, given now), as "3m 05s" or "1h 02m"; "--" before it is claimed. */
export function jobDuration(job: Pick<SimJob, "claimed_utc" | "finished_utc" | "status">, now = Date.now()): string {
  if (!job.claimed_utc) return "--";
  const start = Date.parse(job.claimed_utc);
  const end = job.finished_utc ? Date.parse(job.finished_utc) : isActive(job.status) ? now : NaN;
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return "--";
  const s = Math.round((end - start) / 1000);
  if (s < 3600) return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
  return `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}m`;
}

/** The queue, newest first; polled every 5 s while any job is waiting or running. */
export const useSimJobs = () =>
  useQuery({
    queryKey: ["sim-jobs"],
    queryFn: () => getJson<SimJob[]>("/api/sim/jobs?limit=200"),
    refetchInterval: (q) => (q.state.data?.some((j) => isActive(j.status)) ? 5000 : 30000),
  });

export const useSimJob = (id: number | null) =>
  useQuery({
    queryKey: ["sim-job", id],
    queryFn: () => getJson<SimJobDetail>(`/api/sim/jobs/${id}`),
    enabled: id != null,
    refetchInterval: (q) => (q.state.data && isActive(q.state.data.status) ? 5000 : false),
  });

/** Queues one run; the server refuses (422, with the reasons) a deployment that cannot run yet. */
export function useQueueRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { deployment_id: string; profile?: string | null; input_path?: string | null; overrides?: string; rate_hz?: number; backend?: string }) =>
      sendJson<SimJob>("/api/sim/jobs", "POST", body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["sim-jobs"] }),
  });
}
