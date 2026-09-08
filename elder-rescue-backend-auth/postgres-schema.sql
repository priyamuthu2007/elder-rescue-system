CREATE TABLE IF NOT EXISTS organizations (
  id SERIAL PRIMARY KEY,
  name VARCHAR NOT NULL,
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  coverage_radius_km DOUBLE PRECISION NOT NULL DEFAULT 5,
  contact_phone VARCHAR NOT NULL,
  verified BOOLEAN NOT NULL DEFAULT FALSE,
  password_hash VARCHAR,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS reports (
  id SERIAL PRIMARY KEY,
  reporter_phone VARCHAR NOT NULL,
  photo_url VARCHAR,
  description VARCHAR,
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  status VARCHAR NOT NULL DEFAULT 'reported',
  assigned_org_id INTEGER,
  photo_expires_at VARCHAR,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS status_logs (
  id SERIAL PRIMARY KEY,
  report_id INTEGER NOT NULL,
  old_status VARCHAR,
  new_status VARCHAR NOT NULL,
  note VARCHAR,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS organization_sessions (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at VARCHAR NOT NULL
);

CREATE TABLE IF NOT EXISTS fallback_queue (
  id SERIAL PRIMARY KEY,
  report_id INTEGER NOT NULL UNIQUE,
  reason VARCHAR NOT NULL,
  state VARCHAR NOT NULL DEFAULT 'open',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at VARCHAR,
  resolution_note VARCHAR
);

CREATE TABLE IF NOT EXISTS notifications (
  id SERIAL PRIMARY KEY,
  report_id INTEGER NOT NULL,
  recipient_type VARCHAR NOT NULL,
  recipient_id INTEGER,
  destination VARCHAR NOT NULL,
  event_type VARCHAR NOT NULL,
  payload_json VARCHAR NOT NULL,
  status VARCHAR NOT NULL DEFAULT 'pending',
  attempts BOOLEAN NOT NULL DEFAULT FALSE,
  last_error VARCHAR,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at VARCHAR
);

CREATE TABLE IF NOT EXISTS reporter_verifications (
  id SERIAL PRIMARY KEY,
  phone VARCHAR NOT NULL,
  code_hash VARCHAR NOT NULL,
  verification_token_hash VARCHAR UNIQUE,
  attempts BOOLEAN NOT NULL DEFAULT FALSE,
  expires_at VARCHAR NOT NULL,
  verified_at VARCHAR,
  used_at VARCHAR,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS password_resets (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at VARCHAR NOT NULL,
  used_at VARCHAR,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS admin_sessions (
  id SERIAL PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at VARCHAR NOT NULL
);
