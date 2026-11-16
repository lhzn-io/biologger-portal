-- The live viewer's visit log, mirrored from its Worker (visits.py); kept 180 days, never published.
CREATE TABLE site_visit (
  id INTEGER PRIMARY KEY,        -- the Worker's row id
  at_utc TEXT NOT NULL,
  email TEXT NOT NULL,
  country TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL,            -- page | action
  path TEXT NOT NULL,
  action TEXT NOT NULL DEFAULT '',
  detail TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX site_visit_at ON site_visit (at_utc);
CREATE INDEX site_visit_email ON site_visit (email);

-- Each pull, with the newest Worker id seen: the next pull resumes after it even when that row was purged.
CREATE TABLE site_visit_pull (
  at_utc TEXT NOT NULL,
  fetched INTEGER NOT NULL,
  latest_id INTEGER NOT NULL
);
