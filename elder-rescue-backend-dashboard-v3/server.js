// server.js
// Minimal Express API to prove the two tables work end-to-end.
// Endpoints included:
//   POST   /reports        -> submit a new report
//   GET    /reports        -> list all reports (for testing/debugging)
//   POST   /organizations  -> add an org (for testing/debugging)
//   GET    /organizations  -> list all orgs (for testing/debugging)

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('./db');
const { findNearbyOrganizations } = require('./matching');
const { updateReportStatus, getStatusHistory, ALL_STATUSES } = require('./status');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- photo upload setup ---
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);
app.use('/uploads', express.static(uploadDir));

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
      const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
      cb(null, unique + path.extname(file.originalname));
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
});

// ---------------------------------------------------------------
// POST /reports  — submit a new report
// ---------------------------------------------------------------
app.post('/reports', upload.single('photo'), (req, res) => {
  const { reporter_phone, description, latitude, longitude } = req.body;

  if (!reporter_phone || !latitude || !longitude) {
    return res.status(400).json({
      error: 'reporter_phone, latitude, and longitude are required.',
    });
  }

  const lat = parseFloat(latitude);
  const lng = parseFloat(longitude);
  if (Number.isNaN(lat) || Number.isNaN(lng)) {
    return res.status(400).json({ error: 'latitude/longitude must be valid numbers.' });
  }

  const photo_url = req.file ? `/uploads/${req.file.filename}` : null;

  // Find the nearest verified organization that covers this location
  const nearby = findNearbyOrganizations(lat, lng);
  const matchedOrg = nearby.length > 0 ? nearby[0] : null;

  const insert = db.prepare(`
    INSERT INTO reports (reporter_phone, photo_url, description, latitude, longitude, status, assigned_org_id)
    VALUES (?, ?, ?, ?, ?, 'reported', ?)
  `);
  const result = insert.run(
    reporter_phone,
    photo_url,
    description || null,
    lat,
    lng,
    matchedOrg ? matchedOrg.id : null
  );

  const getNew = db.prepare('SELECT * FROM reports WHERE id = ?');
  const newReport = getNew.get(result.lastInsertRowid);

  res.status(201).json({
    message: matchedOrg
      ? `Report submitted and matched to ${matchedOrg.name}.`
      : 'Report submitted. No organization currently covers this location — needs manual/fallback routing.',
    report: newReport,
    matched_organization: matchedOrg
      ? {
          id: matchedOrg.id,
          name: matchedOrg.name,
          contact_phone: matchedOrg.contact_phone,
          distance_km: Math.round(matchedOrg.distance_km * 100) / 100,
        }
      : null,
  });
});

// GET /reports — list all reports (debugging/testing helper)
app.get('/reports', (req, res) => {
  const all = db.prepare('SELECT * FROM reports ORDER BY created_at DESC');
  res.json(all.all());
});

// ---------------------------------------------------------------
// PATCH /reports/:id/status — update a report's status
// Body: { "status": "acknowledged", "note": "optional note" }
// Enforces valid pipeline transitions: reported -> acknowledged ->
// en_route -> rescued -> closed (closed reachable from anywhere).
// ---------------------------------------------------------------
app.patch('/reports/:id/status', (req, res) => {
  const reportId = parseInt(req.params.id, 10);
  const { status, note } = req.body;

  if (Number.isNaN(reportId)) {
    return res.status(400).json({ error: 'Invalid report id.' });
  }
  if (!status) {
    return res.status(400).json({ error: `status is required. Must be one of: ${ALL_STATUSES.join(', ')}` });
  }

  const result = updateReportStatus(reportId, status, note);

  if (!result.ok) {
    // Not found -> 404, invalid transition/status -> 400
    const code = result.error === 'Report not found.' ? 404 : 400;
    return res.status(code).json({ error: result.error });
  }

  res.json({ message: `Report ${reportId} status updated to "${status}".`, report: result.report });
});

// GET /reports/:id/history — full status change log for a report
app.get('/reports/:id/history', (req, res) => {
  const reportId = parseInt(req.params.id, 10);
  if (Number.isNaN(reportId)) {
    return res.status(400).json({ error: 'Invalid report id.' });
  }
  res.json(getStatusHistory(reportId));
});

// GET /nearby-organizations?latitude=..&longitude=..
// Debug helper: see which verified orgs would match a given point,
// without creating a report.
app.get('/nearby-organizations', (req, res) => {
  const { latitude, longitude } = req.query;
  const lat = parseFloat(latitude);
  const lng = parseFloat(longitude);

  if (Number.isNaN(lat) || Number.isNaN(lng)) {
    return res.status(400).json({ error: 'latitude and longitude query params are required.' });
  }

  const nearby = findNearbyOrganizations(lat, lng);
  res.json(
    nearby.map((org) => ({
      id: org.id,
      name: org.name,
      contact_phone: org.contact_phone,
      distance_km: Math.round(org.distance_km * 100) / 100,
    }))
  );
});

// ---------------------------------------------------------------
// Organizations — just enough to test the table for now.
// ---------------------------------------------------------------
app.post('/organizations', (req, res) => {
  const { name, latitude, longitude, coverage_radius_km, contact_phone, verified } = req.body;

  if (!name || !latitude || !longitude || !contact_phone) {
    return res.status(400).json({
      error: 'name, latitude, longitude, and contact_phone are required.',
    });
  }

  const insert = db.prepare(`
    INSERT INTO organizations (name, latitude, longitude, coverage_radius_km, contact_phone, verified)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const result = insert.run(
    name,
    parseFloat(latitude),
    parseFloat(longitude),
    coverage_radius_km ? parseFloat(coverage_radius_km) : 5,
    contact_phone,
    verified ? 1 : 0
  );

  const getNew = db.prepare('SELECT * FROM organizations WHERE id = ?');
  const newOrg = getNew.get(result.lastInsertRowid);
  res.status(201).json({ message: 'Organization added.', organization: newOrg });
});

app.get('/organizations', (req, res) => {
  const all = db.prepare('SELECT * FROM organizations ORDER BY created_at DESC');
  res.json(all.all());
});

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'Elder Rescue API is running.' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
