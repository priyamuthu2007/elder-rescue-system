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

module.exports = db;
