/** Shapes returned by the portal API (server/src/biologger_portal/routes). */

export interface DeploymentSummary {
  id: string;
  species: string;
  common_name: string;
  location: string;
  time_start_utc: number | null;
  time_end_utc: number | null;
  start_lat: number | null;
  start_lon: number | null;
  end_lat: number | null;
  end_lon: number | null;
  dem_dataset: string;
  file_count: number;
  total_bytes: number;
  track_count: number;
  last_validation: string | null;
}

export interface CatalogFile {
  id: number;
  path: string;
  deployment_id: string | null;
  kind: string;
  size: number;
  mtime: number;
  sha256: string | null;
  info: { columns?: string[]; first_time?: string; last_time?: string };
  missing: number;
  seen_utc: string;
}

export interface Check {
  name: string;
  status: "passed" | "warning" | "failed";
  detail: string;
}

export interface ValidationRun {
  id: number;
  deployment_id: string | null;
  file_id: number | null;
  file_path: string;
  mode: "light" | "deep";
  status: "queued" | "running" | "passed" | "warning" | "failed" | "error";
  tool_version: string;
  unverified: boolean;
  summary: string;
  results: {
    checks?: Check[];
    facts?: Record<string, unknown>;
    thresholds?: Record<string, unknown>;
    error?: string;
  };
  requested_by: string;
  created_utc: string;
  started_utc: string | null;
  finished_utc: string | null;
}

export interface TrackRow {
  id: number;
  deployment_id: string;
  run_id: string;
  path: string;
  track_model: string;
  sim_git_commit: string;
  sim_git_dirty: number;
  rate_hz: number | null;
  count: number | null;
  t0: number | null;
  duration_s: number | null;
  bounds: { lat?: [number, number]; lon?: [number, number]; depth_m?: [number, number] };
  published: number;
  url?: string;
  species?: string;
  common_name?: string;
}

export interface AuditRow {
  id: number;
  at_utc: string;
  actor: string;
  field: string;
  old_value: string | null;
  new_value: string | null;
}

export interface DeploymentDetail extends DeploymentSummary {
  fields: Record<string, string>;
  dem_policy: string;
  drive_link: string;
  source: string;
  updated_utc: string;
  aliases: string[];
  files: CatalogFile[];
  validation_runs: ValidationRun[];
  tracks: TrackRow[];
  audit: AuditRow[];
}

export interface MatrixCell {
  state: "present" | "remote" | "missing";
  count?: number;
  bytes?: number;
  link?: string;
}

export interface Matrix {
  kinds: string[];
  rows: { deployment_id: string; species: string; common_name: string; cells: Record<string, MatrixCell> }[];
  unattributed_files: number;
}

export interface Me {
  email: string;
  editor: boolean;
}
