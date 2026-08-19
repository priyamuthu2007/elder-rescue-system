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

const app = express();
app.use(express.json());

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

  const insert = db.prepare(`
    INSERT INTO reports (reporter_phone, photo_url, description, latitude, longitude, status)
    VALUES (?, ?, ?, ?, ?, 'reported')
  `);
  const result = insert.run(reporter_phone, photo_url, description || null, lat, lng);

  const getNew = db.prepare('SELECT * FROM reports WHERE id = ?');
  const newReport = getNew.get(result.lastInsertRowid);

  res.status(201).json({ message: 'Report submitted.', report: newReport });
});

// GET /reports — list all reports (debugging/testing helper)
app.get('/reports', (req, res) => {
  const all = db.prepare('SELECT * FROM reports ORDER BY created_at DESC');
  res.json(all.all());
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
