-- The live viewer's visit log (worker/index.ts). Rows older than 180 days are deleted by the daily cron.
CREATE TABLE visits (
  id INTEGER PRIMARY KEY,
  at_utc TEXT NOT NULL,          -- ISO UTC, seconds
  email TEXT NOT NULL,           -- the visitor's Cloudflare Access email, lower case
  country TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL,            -- page | action
  path TEXT NOT NULL,            -- path and query: reopens the view
  action TEXT NOT NULL DEFAULT '',
  detail TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX visits_at ON visits (at_utc);
CREATE INDEX visits_email ON visits (email);
