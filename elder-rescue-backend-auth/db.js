// db.js
// Sets up a local SQLite database with the two core tables.
//
// This uses Node's BUILT-IN sqlite module (node:sqlite) instead of a
// third-party package. That means zero native compilation — no build
// tools, no Python, no Visual Studio needed. It ships with Node itself
// (stable from Node 22.5+; you're on 24.19.0 so you're covered).
// It's still marked "experimental" by Node, which just means its API
// may change in future Node versions — it's safe to use for a project
// like this.

const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const db = new DatabaseSync(path.join(__dirname, 'elder_rescue.db'));
db.isPostgres = false;

// ---- organizations table ----
// NGOs / trusts / old age homes that can receive and act on reports
db.exec(`
  CREATE TABLE IF NOT EXISTS organizations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    latitude REAL NOT NULL,
    longitude REAL NOT NULL,
    coverage_radius_km REAL NOT NULL DEFAULT 5,
    contact_phone TEXT NOT NULL,
    verified INTEGER NOT NULL DEFAULT 0,  -- 0 = false, 1 = true
    password_hash TEXT,                   -- "salt:hash", set at registration
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

const organizationColumns = db.prepare('PRAGMA table_info(organizations)').all();
if (!organizationColumns.some((column) => column.name === 'password_hash')) {
  db.exec('ALTER TABLE organizations ADD COLUMN password_hash TEXT');
}

// ---- reports table ----
// Individual reports submitted by the public
db.exec(`
  CREATE TABLE IF NOT EXISTS reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reporter_phone TEXT NOT NULL,
    photo_url TEXT,
    description TEXT,
    latitude REAL NOT NULL,
    longitude REAL NOT NULL,
    status TEXT NOT NULL DEFAULT 'reported',
    assigned_org_id INTEGER,             -- nearest matched organization, if any
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

const reportColumns = db.prepare('PRAGMA table_info(reports)').all();
if (!reportColumns.some((column) => column.name === 'photo_expires_at')) {
  db.exec('ALTER TABLE reports ADD COLUMN photo_expires_at TEXT');
}

console.log('Database ready: organizations + reports tables exist.');

// ---- status_logs table ----
// Audit trail of every status change made to a report
db.exec(`
  CREATE TABLE IF NOT EXISTS status_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    report_id INTEGER NOT NULL,
    old_status TEXT,
    new_status TEXT NOT NULL,
    note TEXT,
    changed_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (report_id) REFERENCES reports(id)
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS organization_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    organization_id INTEGER NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL,
    FOREIGN KEY (organization_id) REFERENCES organizations(id)
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS fallback_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    report_id INTEGER NOT NULL UNIQUE,
    reason TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'open',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    resolved_at TEXT,
    resolution_note TEXT,
    FOREIGN KEY (report_id) REFERENCES reports(id)
  );
`);

db.exec(`
  INSERT OR IGNORE INTO fallback_queue (report_id, reason)
  SELECT id, 'No verified organization covers the reported location.'
  FROM reports
  WHERE assigned_org_id IS NULL;
`);

db.exec(`
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
    sent_at TEXT,
    FOREIGN KEY (report_id) REFERENCES reports(id)
  );
`);

db.exec(`
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
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS password_resets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    organization_id INTEGER NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    used_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (organization_id) REFERENCES organizations(id)
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS admin_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token_hash TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL
  );
`);

module.exports = db;
