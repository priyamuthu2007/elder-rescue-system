const fs = require('fs');
const path = require('path');

const sqliteSchema = `
CREATE TABLE IF NOT EXISTS organizations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  latitude REAL NOT NULL,
  longitude REAL NOT NULL,
  coverage_radius_km REAL NOT NULL DEFAULT 5,
  contact_phone TEXT NOT NULL,
  verified INTEGER NOT NULL DEFAULT 0,
  password_hash TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reporter_phone TEXT NOT NULL,
  photo_url TEXT,
  description TEXT,
  latitude REAL NOT NULL,
  longitude REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'reported',
  assigned_org_id INTEGER,
  photo_expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS status_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id INTEGER NOT NULL,
  old_status TEXT,
  new_status TEXT NOT NULL,
  note TEXT,
  changed_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS organization_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id INTEGER NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS fallback_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id INTEGER NOT NULL UNIQUE,
  reason TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT,
  resolution_note TEXT
);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id INTEGER NOT NULL,
  recipient_type TEXT NOT NULL,
  recipient_id INTEGER,
  destination TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  sent_at TEXT
);

CREATE TABLE IF NOT EXISTS reporter_verifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  verification_token_hash TEXT UNIQUE,
  attempts INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT NOT NULL,
  verified_at TEXT,
  used_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS password_resets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id INTEGER NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS admin_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);
`;

const postgresSchema = sqliteSchema
  .replace(/INTEGER PRIMARY KEY AUTOINCREMENT/g, 'SERIAL PRIMARY KEY')
  .replace(/TEXT NOT NULL DEFAULT \(datetime\('now'\)\)/g, 'TIMESTAMPTZ NOT NULL DEFAULT NOW()')
  .replace(/TEXT NOT NULL DEFAULT \(datetime\('now', '\+2 hours'\)\)/g, 'TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL \'2 hours\'')
  .replace(/TEXT NOT NULL DEFAULT \(datetime\('now', '\+8 hours'\)\)/g, 'TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL \'8 hours\'')
  .replace(/TEXT NOT NULL DEFAULT \(datetime\('now', '\+10 minutes'\)\)/g, 'TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL \'10 minutes\'')
  .replace(/TEXT NOT NULL DEFAULT \(datetime\('now', '\+30 days'\)\)/g, 'TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL \'30 days\'')
  .replace(/TEXT NOT NULL DEFAULT \(datetime\('now', '\+30 minutes'\)\)/g, 'TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL \'30 minutes\'')
  .replace(/INTEGER NOT NULL DEFAULT 0/g, 'BOOLEAN NOT NULL DEFAULT FALSE')
  .replace(/INTEGER NOT NULL DEFAULT 5/g, 'DOUBLE PRECISION NOT NULL DEFAULT 5')
  .replace(/BOOLEAN NOT NULL DEFAULT FALSE/g, 'BOOLEAN NOT NULL DEFAULT FALSE')
  .replace(/REAL NOT NULL/g, 'DOUBLE PRECISION NOT NULL')
  .replace(/TEXT/g, 'VARCHAR')
  .replace(/VARCHAR PRIMARY KEY/g, 'TEXT PRIMARY KEY')
  .replace(/VARCHAR NOT NULL UNIQUE/g, 'TEXT NOT NULL UNIQUE');

const outPath = path.join(__dirname, 'postgres-schema.sql');
fs.writeFileSync(outPath, postgresSchema.trim() + '\n');
console.log(`PostgreSQL schema written to ${outPath}`);
