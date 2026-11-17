-- Simulation runs: a queue of biologger-sim export-track jobs that runners (garnet, coriolis) claim over the VPN.
CREATE TABLE sim_batch (
  id INTEGER PRIMARY KEY,
  label TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL,
  created_utc TEXT NOT NULL
);

CREATE TABLE sim_job (
  id INTEGER PRIMARY KEY,
  batch_id INTEGER REFERENCES sim_batch(id) ON DELETE SET NULL,
  deployment_id TEXT NOT NULL REFERENCES deployment(id) ON DELETE CASCADE,
  profile TEXT NOT NULL,
  config_name TEXT NOT NULL,      -- the config's file name on the runner; biologger-sim names the run after it
  config_yaml TEXT NOT NULL,      -- run unchanged: the bundle's config_sha256 must be its hash
  meta_csv TEXT NOT NULL,         -- the metadata row as it was when the job was made
  input_path TEXT NOT NULL,       -- relative to the datasets root
  input_size INTEGER NOT NULL,
  rate_hz REAL NOT NULL DEFAULT 1.0,
  backend_pref TEXT NOT NULL DEFAULT 'any',  -- any | warp | mlx | cpu
  status TEXT NOT NULL DEFAULT 'queued',     -- queued | claimed | running | done | error | canceled
  runner TEXT NOT NULL DEFAULT '',
  backend_used TEXT NOT NULL DEFAULT '',
  sim_git_commit TEXT NOT NULL DEFAULT '',
  sim_git_dirty INTEGER NOT NULL DEFAULT 0,
  run_id TEXT NOT NULL DEFAULT '',
  log_tail TEXT NOT NULL DEFAULT '',
  error TEXT NOT NULL DEFAULT '',
  attempts INTEGER NOT NULL DEFAULT 0,
  retry_of INTEGER REFERENCES sim_job(id) ON DELETE SET NULL,
  created_by TEXT NOT NULL,
  created_utc TEXT NOT NULL,
  claimed_utc TEXT,
  heartbeat_utc TEXT,
  finished_utc TEXT
);
CREATE INDEX sim_job_status ON sim_job (status, id);
CREATE INDEX sim_job_deployment ON sim_job (deployment_id, id);
