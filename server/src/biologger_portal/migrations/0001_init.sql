-- Catalog schema, version 1.

CREATE TABLE deployment (
    id              TEXT PRIMARY KEY,           -- canonical deployment_id, e.g. WHOI.001_20250827
    species         TEXT NOT NULL DEFAULT '',
    common_name     TEXT NOT NULL DEFAULT '',
    location        TEXT NOT NULL DEFAULT '',
    time_start_utc  REAL,                       -- Unix seconds
    time_end_utc    REAL,
    start_lat       REAL,
    start_lon       REAL,
    end_lat         REAL,
    end_lon         REAL,
    drive_link      TEXT NOT NULL DEFAULT '',
    dem_dataset     TEXT NOT NULL DEFAULT '',   -- topobathykit DEM dataset id, e.g. 112bafb5_30m
    dem_policy      TEXT NOT NULL DEFAULT '',
    fields          TEXT NOT NULL DEFAULT '{}', -- every canonical sheet field as text (JSON object)
    source          TEXT NOT NULL DEFAULT '',   -- where the record came from (sheet file and row)
    updated_utc     TEXT NOT NULL
);

CREATE TABLE deployment_alias (
    alias           TEXT PRIMARY KEY,           -- compared case-insensitively (stored lower case)
    deployment_id   TEXT NOT NULL REFERENCES deployment(id) ON DELETE CASCADE
);

CREATE TABLE file (
    id              INTEGER PRIMARY KEY,
    path            TEXT NOT NULL UNIQUE,       -- relative to the datasets root, '/' separated
    deployment_id   TEXT REFERENCES deployment(id) ON DELETE SET NULL,
    kind            TEXT NOT NULL,
    size            INTEGER NOT NULL,
    mtime           REAL NOT NULL,
    sha256          TEXT,                       -- NULL until hashed
    info            TEXT NOT NULL DEFAULT '{}', -- kind-specific facts (header, first and last time)
    missing         INTEGER NOT NULL DEFAULT 0, -- 1 when a scan no longer finds it
    seen_utc        TEXT NOT NULL
);
CREATE INDEX file_deployment ON file(deployment_id);

CREATE TABLE validation_run (
    id              INTEGER PRIMARY KEY,
    deployment_id   TEXT REFERENCES deployment(id) ON DELETE SET NULL,
    file_id         INTEGER REFERENCES file(id) ON DELETE SET NULL,
    file_path       TEXT NOT NULL DEFAULT '',
    mode            TEXT NOT NULL,              -- light | deep
    status          TEXT NOT NULL,              -- queued | running | passed | warning | failed | error
    tool_version    TEXT NOT NULL,
    unverified      INTEGER NOT NULL DEFAULT 0, -- 1 for records imported from the prototype
    summary         TEXT NOT NULL DEFAULT '',
    results         TEXT NOT NULL DEFAULT '{}',
    requested_by    TEXT NOT NULL DEFAULT '',
    created_utc     TEXT NOT NULL,
    started_utc     TEXT,
    finished_utc    TEXT
);
CREATE INDEX validation_deployment ON validation_run(deployment_id);

CREATE TABLE track (
    id              INTEGER PRIMARY KEY,
    deployment_id   TEXT NOT NULL REFERENCES deployment(id) ON DELETE CASCADE,
    run_id          TEXT NOT NULL,
    path            TEXT NOT NULL,              -- bundle folder, relative to the datasets root
    track_model     TEXT NOT NULL DEFAULT '',
    sim_git_commit  TEXT NOT NULL DEFAULT '',
    sim_git_dirty   INTEGER NOT NULL DEFAULT 0,
    rate_hz         REAL,
    count           INTEGER,
    t0              REAL,
    duration_s      REAL,
    bounds          TEXT NOT NULL DEFAULT '{}',
    published       INTEGER NOT NULL DEFAULT 0,
    seen_utc        TEXT NOT NULL,
    UNIQUE (deployment_id, run_id)
);

CREATE TABLE audit (
    id              INTEGER PRIMARY KEY,
    at_utc          TEXT NOT NULL,
    actor           TEXT NOT NULL,
    entity          TEXT NOT NULL,
    entity_id       TEXT NOT NULL,
    field           TEXT NOT NULL,
    old_value       TEXT,
    new_value       TEXT
);
CREATE INDEX audit_entity ON audit(entity, entity_id);
