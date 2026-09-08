// server.js
// Minimal Express API to prove the two tables work end-to-end.
// Endpoints included:
//   POST   /reports        -> submit a new report
//   GET    /reports        -> list all reports (for testing/debugging)
//   POST   /organizations  -> add an org (for testing/debugging)
//   GET    /organizations  -> list all orgs (for testing/debugging)

const express = require('express');
const crypto = require('crypto');
const multer = require('multer');
const sharp = require('sharp');
const helmet = require('helmet');
const path = require('path');
const fs = require('fs');
const db = require('./db');
const { findNearbyOrganizations } = require('./matching');
const { updateReportStatus, getStatusHistory, ALL_STATUSES } = require('./status');
const { hashPassword, verifyPassword, createSessionToken, hashSessionToken } = require('./auth');
const { queueNotification, dispatchPendingNotifications } = require('./notifications');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(helmet());
app.use(express.json({ limit: '100kb' }));
app.use(express.static(path.join(__dirname, 'public')));

const PHONE_PATTERN = /^\+?[0-9][0-9 ()-]{6,19}$/;
const fallbackHelpline = process.env.FALLBACK_HELPLINE || null;
const requestWindows = new Map();

function parseCoordinate(value, minimum, maximum) {
  const number = Number(value);
  return Number.isFinite(number) && number >= minimum && number <= maximum ? number : null;
}

function rateLimit({ windowMs, max, name }) {
  return (req, res, next) => {
    const key = `${name}:${req.ip}`;
    const now = Date.now();
    const current = requestWindows.get(key);
    if (!current || now >= current.resetAt) {
      requestWindows.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }
    if (current.count >= max) {
      res.setHeader('Retry-After', Math.ceil((current.resetAt - now) / 1000));
      return res.status(429).json({ error: 'Too many requests. Please try again later.' });
    }
    current.count += 1;
    next();
  };
}

// --- photo upload setup ---
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
      const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
      cb(null, unique + path.extname(file.originalname));
    },
  }),
  fileFilter: (req, file, cb) => cb(null, true),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
});

function validateUploadedPhoto(req, res, next) {
  if (!req.file) return next();

  const header = fs.readFileSync(req.file.path).subarray(0, 12);
  const isJpeg = header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff;
  const isPng = header.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const isWebp = header.toString('ascii', 0, 4) === 'RIFF' && header.toString('ascii', 8, 12) === 'WEBP';

  if (isJpeg || isPng || isWebp) return next();
  fs.unlinkSync(req.file.path);
  return res.status(400).json({ error: 'Uploaded file is not a supported image.' });
}

async function processUploadedPhoto(req, res, next) {
  if (!req.file) return next();
  const processedPath = path.join(uploadDir, `${path.parse(req.file.filename).name}.processed.jpg`);
  try {
    await sharp(req.file.path)
      .rotate()
      .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 82, mozjpeg: true })
      .toFile(processedPath);
    if (processedPath !== req.file.path) fs.unlinkSync(req.file.path);
    req.file.path = processedPath;
    req.file.filename = path.basename(processedPath);
    req.file.mimetype = 'image/jpeg';
    next();
  } catch (error) {
    if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    return res.status(400).json({ error: 'The image could not be processed safely.' });
  }
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  return Object.fromEntries(header.split(';').filter(Boolean).map((part) => {
    const index = part.indexOf('=');
    return [part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim())];
  }));
}

function requireOrganization(req, res, next) {
  const token = parseCookies(req).ngo_session;
  if (!token) return res.status(401).json({ error: 'Organization sign-in required.' });

  const session = db.prepare(`
    SELECT o.id, o.name, o.verified
    FROM organization_sessions s
    JOIN organizations o ON o.id = s.organization_id
    WHERE s.token_hash = ? AND s.expires_at > datetime('now') AND o.verified = 1
  `).get(hashSessionToken(token));

  if (!session) return res.status(401).json({ error: 'Session expired or invalid.' });
  req.organization = session;
  next();
}

function requireAssignedOrganization(req, res, next) {
  const reportId = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(reportId)) return res.status(400).json({ error: 'Invalid report id.' });

  const report = db.prepare('SELECT assigned_org_id FROM reports WHERE id = ?').get(reportId);
  if (!report) return res.status(404).json({ error: 'Report not found.' });
  if (report.assigned_org_id !== req.organization.id) {
    return res.status(403).json({ error: 'This report is not assigned to your organization.' });
  }
  next();
}

function requireAdmin(req, res, next) {
  const configuredToken = process.env.ADMIN_TOKEN;
  const suppliedToken = req.get('x-admin-token');
  const sessionToken = parseCookies(req).admin_session;
  const validSession = sessionToken && db.prepare(
    "SELECT id FROM admin_sessions WHERE token_hash = ? AND expires_at > datetime('now')"
  ).get(hashSessionToken(sessionToken));
  if (!configuredToken || (!validSession && (!suppliedToken || suppliedToken !== configuredToken))) {
    return res.status(403).json({ error: 'Administrator access required.' });
  }
  next();
}

app.post('/admin/login', rateLimit({ windowMs: 15 * 60 * 1000, max: 5, name: 'admin-login' }), (req, res) => {
  if (!process.env.ADMIN_TOKEN || req.body.token !== process.env.ADMIN_TOKEN) {
    return res.status(401).json({ error: 'Incorrect administrator credentials.' });
  }
  const token = createSessionToken();
  db.prepare("DELETE FROM admin_sessions WHERE expires_at <= datetime('now')").run();
  db.prepare(`
    INSERT INTO admin_sessions (token_hash, expires_at)
    VALUES (?, datetime('now', '+2 hours'))
  `).run(hashSessionToken(token));
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `admin_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=7200${secure}`);
  res.json({ message: 'Administrator signed in.' });
});

app.post('/admin/logout', requireAdmin, (req, res) => {
  const token = parseCookies(req).admin_session;
  if (token) db.prepare('DELETE FROM admin_sessions WHERE token_hash = ?').run(hashSessionToken(token));
  res.setHeader('Set-Cookie', 'admin_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
  res.json({ message: 'Administrator signed out.' });
});

function hashOtp(phone, code) {
  return hashSessionToken(`${phone}:${code}:${process.env.OTP_SECRET || 'development-only'}`);
}

async function deliverOtp(phone, code) {
  const webhookUrl = process.env.OTP_WEBHOOK_URL;
  if (!webhookUrl) return;
  await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ phone, code, event_type: 'reporter_otp' }),
  });
}

async function deliverPasswordReset(organization, token) {
  const webhookUrl = process.env.PASSWORD_RESET_WEBHOOK_URL;
  if (!webhookUrl) return;
  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      organization_id: organization.id,
      organization_name: organization.name,
      contact_phone: organization.contact_phone,
      token,
      event_type: 'organization_password_reset',
    }),
  });
  if (!response.ok) throw new Error(`Password reset provider returned ${response.status}.`);
}

app.post('/report-verifications', rateLimit({ windowMs: 15 * 60 * 1000, max: 3, name: 'otp-request' }), async (req, res) => {
  const phone = String(req.body.phone || '').trim();
  if (!PHONE_PATTERN.test(phone)) return res.status(400).json({ error: 'A valid phone number is required.' });

  const code = String(crypto.randomInt(100000, 1000000));
  db.prepare(`
    INSERT INTO reporter_verifications (phone, code_hash, expires_at)
    VALUES (?, ?, datetime('now', '+10 minutes'))
  `).run(phone, hashOtp(phone, code));

  try {
    await deliverOtp(phone, code);
  } catch (error) {
    return res.status(502).json({ error: 'Could not deliver the verification code.' });
  }

  const response = { message: 'A verification code has been sent if delivery is configured.' };
  if (process.env.OTP_DEV_MODE === '1') response.development_code = code;
  res.json(response);
});

app.post('/report-verifications/confirm', rateLimit({ windowMs: 15 * 60 * 1000, max: 10, name: 'otp-confirm' }), (req, res) => {
  const phone = String(req.body.phone || '').trim();
  const code = String(req.body.code || '').trim();
  if (!PHONE_PATTERN.test(phone) || !/^\d{6}$/.test(code)) {
    return res.status(400).json({ error: 'A valid phone number and six-digit code are required.' });
  }

  const verification = db.prepare(`
    SELECT * FROM reporter_verifications
    WHERE phone = ? AND verified_at IS NULL AND used_at IS NULL AND expires_at > datetime('now')
    ORDER BY created_at DESC LIMIT 1
  `).get(phone);
  if (!verification || verification.attempts >= 5) return res.status(400).json({ error: 'The code is invalid or expired.' });

  db.prepare('UPDATE reporter_verifications SET attempts = attempts + 1 WHERE id = ?').run(verification.id);
  if (hashOtp(phone, code) !== verification.code_hash) return res.status(400).json({ error: 'The code is invalid or expired.' });

  const token = createSessionToken();
  db.prepare(`
    UPDATE reporter_verifications
    SET verified_at = datetime('now'), verification_token_hash = ?
    WHERE id = ?
  `).run(hashSessionToken(token), verification.id);
  res.json({ message: 'Phone number verified.', verification_token: token });
});

app.post('/organizations/password-reset/request', rateLimit({ windowMs: 15 * 60 * 1000, max: 3, name: 'password-reset' }), async (req, res) => {
  const organizationId = Number.parseInt(req.body.id, 10);
  const organization = Number.isInteger(organizationId)
    ? db.prepare('SELECT id, name, contact_phone FROM organizations WHERE id = ?').get(organizationId)
    : null;

  if (organization) {
    const token = createSessionToken();
    db.prepare(`
      INSERT INTO password_resets (organization_id, token_hash, expires_at)
      VALUES (?, ?, datetime('now', '+30 minutes'))
    `).run(organization.id, hashSessionToken(token));
    try {
      await deliverPasswordReset(organization, token);
    } catch (error) {
      console.error('Password reset delivery failed:', error.message);
    }
    if (process.env.PASSWORD_RESET_DEV_MODE === '1') {
      return res.json({ message: 'If the organization exists, reset instructions were sent.', development_token: token });
    }
  }
  res.json({ message: 'If the organization exists, reset instructions were sent.' });
});

app.post('/organizations/password-reset/confirm', rateLimit({ windowMs: 15 * 60 * 1000, max: 5, name: 'password-reset-confirm' }), (req, res) => {
  const token = String(req.body.token || '');
  const password = String(req.body.password || '');
  if (token.length < 40 || password.length < 12) {
    return res.status(400).json({ error: 'A valid reset token and password of at least 12 characters are required.' });
  }

  const reset = db.prepare(`
    SELECT * FROM password_resets
    WHERE token_hash = ? AND used_at IS NULL AND expires_at > datetime('now')
  `).get(hashSessionToken(token));
  if (!reset) return res.status(400).json({ error: 'The reset token is invalid or expired.' });

  db.prepare('UPDATE organizations SET password_hash = ? WHERE id = ?').run(hashPassword(password), reset.organization_id);
  db.prepare("UPDATE password_resets SET used_at = datetime('now') WHERE id = ?").run(reset.id);
  db.prepare('DELETE FROM organization_sessions WHERE organization_id = ?').run(reset.organization_id);
  res.json({ message: 'Password reset successfully.' });
});

app.get('/uploads/:filename', requireOrganization, (req, res) => {
  const filename = path.basename(req.params.filename);
  const photoPath = path.join(uploadDir, filename);
  const report = db.prepare('SELECT assigned_org_id, photo_expires_at FROM reports WHERE photo_url = ?').get(`/uploads/${filename}`);

  if (!report) return res.status(404).json({ error: 'Photo not found.' });
  if (report.photo_expires_at && report.photo_expires_at <= new Date().toISOString().replace('T', ' ').slice(0, 19)) {
    return res.status(410).json({ error: 'Photo retention period has ended.' });
  }
  if (report.assigned_org_id !== req.organization.id) {
    return res.status(403).json({ error: 'This photo is not assigned to your organization.' });
  }

  res.sendFile(photoPath, (error) => {
    if (error && !res.headersSent) res.status(error.statusCode === 404 ? 404 : 500).json({ error: 'Unable to read photo.' });
  });
});

// ---------------------------------------------------------------
// POST /reports  — submit a new report
// ---------------------------------------------------------------
app.post('/reports', rateLimit({ windowMs: 15 * 60 * 1000, max: 20, name: 'reports' }), upload.single('photo'), validateUploadedPhoto, processUploadedPhoto, (req, res) => {
  const { reporter_phone, description, latitude, longitude, reporter_verification_token } = req.body;

  if (!reporter_phone || latitude === undefined || longitude === undefined) {
    return res.status(400).json({
      error: 'reporter_phone, latitude, and longitude are required.',
    });
  }
  if (!PHONE_PATTERN.test(String(reporter_phone))) {
    return res.status(400).json({ error: 'reporter_phone must be a valid phone number.' });
  }
  const verification = db.prepare(`
    SELECT id FROM reporter_verifications
    WHERE phone = ? AND verification_token_hash = ?
      AND verified_at IS NOT NULL AND used_at IS NULL AND expires_at > datetime('now')
  `).get(String(reporter_phone), reporter_verification_token ? hashSessionToken(reporter_verification_token) : '');
  if (!verification) {
    return res.status(403).json({ error: 'Verify the reporter phone number before submitting a report.' });
  }
  if (description && String(description).length > 2000) {
    return res.status(400).json({ error: 'description must be 2000 characters or fewer.' });
  }

  const lat = parseCoordinate(latitude, -90, 90);
  const lng = parseCoordinate(longitude, -180, 180);
  if (lat === null || lng === null) {
    return res.status(400).json({ error: 'latitude/longitude must be valid coordinates.' });
  }

  const photo_url = req.file ? `/uploads/${req.file.filename}` : null;

  // Find the nearest verified organization that covers this location
  const nearby = findNearbyOrganizations(lat, lng);
  const matchedOrg = nearby.length > 0 ? nearby[0] : null;

  const insert = db.prepare(`
    INSERT INTO reports (reporter_phone, photo_url, photo_expires_at, description, latitude, longitude, status, assigned_org_id)
    VALUES (?, ?, CASE WHEN ? IS NULL THEN NULL ELSE datetime('now', '+30 days') END, ?, ?, ?, 'reported', ?)
  `);
  const result = insert.run(
    reporter_phone,
    photo_url,
    photo_url,
    description || null,
    lat,
    lng,
    matchedOrg ? matchedOrg.id : null
  );

  if (!matchedOrg) {
    db.prepare(`
      INSERT INTO fallback_queue (report_id, reason)
      VALUES (?, ?)
    `).run(result.lastInsertRowid, 'No verified organization covers the reported location.');
  } else {
    queueNotification({
      reportId: result.lastInsertRowid,
      recipientType: 'organization',
      recipientId: matchedOrg.id,
      destination: matchedOrg.contact_phone,
      eventType: 'report_assigned',
      payload: { report_id: result.lastInsertRowid, organization: matchedOrg.name },
    });
  }
  db.prepare("UPDATE reporter_verifications SET used_at = datetime('now') WHERE id = ?").run(verification.id);

  const getNew = db.prepare('SELECT * FROM reports WHERE id = ?');
  const newReport = getNew.get(result.lastInsertRowid);

  res.status(201).json({
    message: matchedOrg
      ? `Report submitted and matched to ${matchedOrg.name}.`
      : 'Report submitted. It has been sent for manual follow-up because no organization currently covers this location.',
    report: newReport,
    fallback: matchedOrg ? null : {
      status: 'queued_for_manual_follow_up',
      helpline: fallbackHelpline,
    },
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
app.get('/reports', requireOrganization, (req, res) => {
  const all = db.prepare('SELECT * FROM reports WHERE assigned_org_id = ? ORDER BY created_at DESC');
  res.json(all.all(req.organization.id));
});

// ---------------------------------------------------------------
// PATCH /reports/:id/status — update a report's status
// Body: { "status": "acknowledged", "note": "optional note" }
// Enforces valid pipeline transitions: reported -> acknowledged ->
// en_route -> rescued -> closed (closed reachable from anywhere).
// ---------------------------------------------------------------
app.patch('/reports/:id/status', requireOrganization, requireAssignedOrganization, (req, res) => {
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

  const report = result.report;
  queueNotification({
    reportId,
    recipientType: 'reporter',
    destination: report.reporter_phone,
    eventType: 'report_status_changed',
    payload: { report_id: reportId, status: report.status },
  });

  res.json({ message: `Report ${reportId} status updated to "${status}".`, report: result.report });
});

// GET /reports/:id/history — full status change log for a report
app.get('/reports/:id/history', requireOrganization, requireAssignedOrganization, (req, res) => {
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
  const lat = parseCoordinate(latitude, -90, 90);
  const lng = parseCoordinate(longitude, -180, 180);

  if (lat === null || lng === null) {
    return res.status(400).json({ error: 'latitude and longitude must be valid coordinates.' });
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
// Organizations
// ---------------------------------------------------------------
app.post('/organizations', (req, res) => {
  const { name, latitude, longitude, coverage_radius_km, contact_phone, verified, password } = req.body;

  if (!name || latitude === undefined || longitude === undefined || !contact_phone) {
    return res.status(400).json({
      error: 'name, latitude, longitude, and contact_phone are required.',
    });
  }
  if (String(name).length > 200 || !PHONE_PATTERN.test(String(contact_phone))) {
    return res.status(400).json({ error: 'Organization name or contact phone is invalid.' });
  }
  if (!password || password.length < 6) {
    return res.status(400).json({ error: 'A password of at least 6 characters is required.' });
  }

  const lat = parseCoordinate(latitude, -90, 90);
  const lng = parseCoordinate(longitude, -180, 180);
  const radius = coverage_radius_km === undefined ? 5 : Number(coverage_radius_km);
  if (lat === null || lng === null || !Number.isFinite(radius) || radius <= 0 || radius > 500) {
    return res.status(400).json({ error: 'Organization coordinates or coverage radius are invalid.' });
  }

  const password_hash = hashPassword(password);

  const insert = db.prepare(`
    INSERT INTO organizations (name, latitude, longitude, coverage_radius_km, contact_phone, verified, password_hash)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const result = insert.run(
    name,
    lat,
    lng,
    radius,
    contact_phone,
    0,
    password_hash
  );

  const getNew = db.prepare('SELECT id, name, latitude, longitude, coverage_radius_km, contact_phone, verified, created_at FROM organizations WHERE id = ?');
  const newOrg = getNew.get(result.lastInsertRowid);
  res.status(201).json({ message: 'Organization added.', organization: newOrg });
});

// GET /organizations — never includes password_hash
app.get('/organizations', (req, res) => {
  const all = db.prepare('SELECT id, name, latitude, longitude, coverage_radius_km, contact_phone, verified, created_at FROM organizations ORDER BY created_at DESC');
  res.json(all.all());
});

app.post('/admin/organizations/:id/verify', requireAdmin, (req, res) => {
  const organizationId = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(organizationId)) {
    return res.status(400).json({ error: 'Invalid organization id.' });
  }

  const result = db.prepare('UPDATE organizations SET verified = 1 WHERE id = ?').run(organizationId);
  if (result.changes === 0) return res.status(404).json({ error: 'Organization not found.' });
  res.json({ message: 'Organization verified.' });
});

app.get('/admin/fallback-reports', requireAdmin, (req, res) => {
  const reports = db.prepare(`
    SELECT r.*, f.id AS fallback_id, f.reason AS fallback_reason,
      f.state AS fallback_state, f.created_at AS fallback_created_at
    FROM fallback_queue f
    JOIN reports r ON r.id = f.report_id
    WHERE f.state = 'open'
    ORDER BY f.created_at ASC
  `).all();
  res.json(reports);
});

app.post('/admin/reports/:id/assign', requireAdmin, (req, res) => {
  const reportId = Number.parseInt(req.params.id, 10);
  const organizationId = Number.parseInt(req.body.organization_id, 10);
  if (!Number.isInteger(reportId) || !Number.isInteger(organizationId)) {
    return res.status(400).json({ error: 'Valid report id and organization_id are required.' });
  }

  const organization = db.prepare(
    'SELECT id, name FROM organizations WHERE id = ? AND verified = 1'
  ).get(organizationId);
  if (!organization) return res.status(400).json({ error: 'A verified organization is required.' });

  const report = db.prepare('SELECT id FROM reports WHERE id = ?').get(reportId);
  if (!report) return res.status(404).json({ error: 'Report not found.' });

  const queueItem = db.prepare(
    "SELECT id FROM fallback_queue WHERE report_id = ? AND state = 'open'"
  ).get(reportId);
  if (!queueItem) return res.status(409).json({ error: 'Report is not open in the fallback queue.' });

  db.prepare('UPDATE reports SET assigned_org_id = ? WHERE id = ?').run(organizationId, reportId);
  db.prepare(`
    UPDATE fallback_queue
    SET state = 'resolved', resolved_at = datetime('now'), resolution_note = ?
    WHERE report_id = ?
  `).run(`Manually assigned to ${organization.name}.`, reportId);

  res.json({ message: 'Fallback report assigned.', report_id: reportId, organization });
});

function escalateUnacknowledgedReports() {
  const timeoutMinutes = Number(process.env.ACK_TIMEOUT_MINUTES || 30);
  const reports = db.prepare(`
    SELECT r.id, r.assigned_org_id, o.contact_phone, o.name
    FROM reports r
    JOIN organizations o ON o.id = r.assigned_org_id
    WHERE r.status = 'reported'
      AND r.created_at <= datetime('now', ?)
      AND NOT EXISTS (
        SELECT 1 FROM fallback_queue f WHERE f.report_id = r.id AND f.state = 'open'
      )
  `).all(`-${timeoutMinutes} minutes`);

  for (const report of reports) {
    const result = db.prepare(`
      INSERT OR IGNORE INTO fallback_queue (report_id, reason)
      VALUES (?, ?)
    `).run(report.id, `No acknowledgement within ${timeoutMinutes} minutes.`);
    if (result.changes > 0) {
      queueNotification({
        reportId: report.id,
        recipientType: 'organization',
        recipientId: report.assigned_org_id,
        destination: report.contact_phone,
        eventType: 'report_escalated',
        payload: { report_id: report.id, organization: report.name },
      });
    }
  }
}

function removeExpiredPhotos() {
  const expired = db.prepare(`
    SELECT id, photo_url FROM reports
    WHERE photo_url IS NOT NULL AND photo_expires_at <= datetime('now')
  `).all();
  for (const report of expired) {
    const photoPath = path.join(uploadDir, path.basename(report.photo_url));
    if (fs.existsSync(photoPath)) fs.unlinkSync(photoPath);
    db.prepare('UPDATE reports SET photo_url = NULL, photo_expires_at = NULL WHERE id = ?').run(report.id);
  }
}

setInterval(() => {
  escalateUnacknowledgedReports();
  removeExpiredPhotos();
  dispatchPendingNotifications().catch((error) => console.error('Notification dispatch failed:', error.message));
}, 60 * 1000).unref();

// ---------------------------------------------------------------
// POST /organizations/login — { id, password }
// Verifies the password for an organization and returns its public
// info on success. This is the real check behind the NGO sign-in page.
// ---------------------------------------------------------------
app.post('/organizations/login', rateLimit({ windowMs: 15 * 60 * 1000, max: 5, name: 'login' }), (req, res) => {
  const { id, password } = req.body;
  if (!id || !password) {
    return res.status(400).json({ error: 'id and password are required.' });
  }

  const getOrg = db.prepare('SELECT * FROM organizations WHERE id = ?');
  const org = getOrg.get(id);

  if (!org || !verifyPassword(password, org.password_hash)) {
    return res.status(401).json({ error: 'Incorrect password.' });
  }

  if (!org.verified) {
    return res.status(403).json({ error: 'Organization verification is still pending.' });
  }

  const sessionToken = createSessionToken();
  db.prepare('DELETE FROM organization_sessions WHERE expires_at <= datetime(\'now\')').run();
  db.prepare(`
    INSERT INTO organization_sessions (organization_id, token_hash, expires_at)
    VALUES (?, ?, datetime('now', '+8 hours'))
  `).run(org.id, hashSessionToken(sessionToken));

  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `ngo_session=${encodeURIComponent(sessionToken)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=28800${secure}`);

  res.json({
    message: 'Signed in.',
    organization: { id: org.id, name: org.name, contact_phone: org.contact_phone },
  });
});

app.post('/organizations/logout', requireOrganization, (req, res) => {
  const token = parseCookies(req).ngo_session;
  db.prepare('DELETE FROM organization_sessions WHERE token_hash = ?').run(hashSessionToken(token));
  res.setHeader('Set-Cookie', 'ngo_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
  res.json({ message: 'Signed out.' });
});

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'Elder Rescue API is running.' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
