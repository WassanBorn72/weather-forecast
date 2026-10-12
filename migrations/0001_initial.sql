PRAGMA foreign_keys = ON;
CREATE TABLE locations (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, latitude REAL NOT NULL CHECK(latitude BETWEEN -90 AND 90),
  longitude REAL NOT NULL CHECK(longitude BETWEEN -180 AND 180), timezone TEXT NOT NULL DEFAULT 'Asia/Tokyo'
);
CREATE TABLE forecast_runs (
  id TEXT PRIMARY KEY, location_id TEXT NOT NULL REFERENCES locations(id), model TEXT NOT NULL,
  initialization_time TEXT, issue_time TEXT, available_at TEXT NOT NULL, retrieved_at TEXT NOT NULL,
  source TEXT NOT NULL, method TEXT NOT NULL CHECK(method IN ('snapshot','single-run','previous-runs')),
  metadata TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX run_lookup ON forecast_runs(location_id, method, retrieved_at, model);
CREATE TABLE forecasts (
  run_id TEXT NOT NULL REFERENCES forecast_runs(id), valid_time TEXT NOT NULL,
  lead_hours REAL NOT NULL, lead_basis TEXT NOT NULL, values_json TEXT NOT NULL,
  PRIMARY KEY(run_id, valid_time)
);
CREATE INDEX forecast_valid ON forecasts(valid_time, lead_hours);
CREATE TABLE observations (
  id TEXT PRIMARY KEY, location_id TEXT NOT NULL REFERENCES locations(id), observed_at TEXT NOT NULL,
  available_at TEXT NOT NULL, imported_at TEXT NOT NULL, source TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind = 'station'), values_json TEXT NOT NULL,
  UNIQUE(location_id, observed_at), CHECK(available_at >= observed_at)
);
CREATE INDEX observation_lookup ON observations(location_id, observed_at, available_at);
CREATE TABLE model_scores (
  id TEXT PRIMARY KEY, location_id TEXT NOT NULL REFERENCES locations(id), model TEXT NOT NULL,
  variable TEXT NOT NULL, lead_hours INTEGER NOT NULL, window_days INTEGER NOT NULL,
  season INTEGER, calculated_at TEXT NOT NULL, method TEXT NOT NULL, metrics_json TEXT NOT NULL,
  run_ids_json TEXT NOT NULL, observation_ids_json TEXT NOT NULL
);
CREATE INDEX score_lookup ON model_scores(location_id, variable, lead_hours, window_days, calculated_at);
CREATE TABLE ensemble_forecasts (
  id TEXT PRIMARY KEY, location_id TEXT NOT NULL REFERENCES locations(id), generated_at TEXT NOT NULL,
  valid_time TEXT NOT NULL, method TEXT NOT NULL, values_json TEXT NOT NULL,
  weights_json TEXT NOT NULL, uncertainty_json TEXT NOT NULL, run_ids_json TEXT NOT NULL
);
CREATE INDEX ensemble_lookup ON ensemble_forecasts(location_id, generated_at, valid_time);
INSERT INTO locations VALUES
('tokyo','東京',35.6762,139.6503,'Asia/Tokyo'),
('osaka','大阪',34.6937,135.5023,'Asia/Tokyo'),
('sapporo','札幌',43.0618,141.3545,'Asia/Tokyo'),
('fukuoka','福岡',33.5902,130.4017,'Asia/Tokyo');
