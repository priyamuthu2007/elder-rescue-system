// status.js
// Defines the report status pipeline and enforces valid transitions,
// so a report can't jump illogically (e.g. straight from "reported"
// to "rescued" without anyone actually acknowledging or going there).

const db = require('./db');

// Each status maps to the set of statuses it's allowed to move to next.
// "closed" can be reached from anywhere (covers false alarms/duplicates).
const ALLOWED_TRANSITIONS = {
  reported: ['acknowledged', 'closed'],
  acknowledged: ['en_route', 'closed'],
  en_route: ['rescued', 'closed'],
  rescued: ['closed'],
  closed: [], // terminal state — no further transitions
};

const ALL_STATUSES = Object.keys(ALLOWED_TRANSITIONS);

function isValidTransition(currentStatus, newStatus) {
  if (!ALLOWED_TRANSITIONS[currentStatus]) return false;
  return ALLOWED_TRANSITIONS[currentStatus].includes(newStatus);
}

// Updates a report's status if the transition is valid, logs the change,
// and returns { ok: true, report } or { ok: false, error }.
function updateReportStatus(reportId, newStatus, note) {
  if (!ALL_STATUSES.includes(newStatus)) {
    return { ok: false, error: `Invalid status "${newStatus}". Must be one of: ${ALL_STATUSES.join(', ')}` };
  }

  const getReport = db.prepare('SELECT * FROM reports WHERE id = ?');
  const report = getReport.get(reportId);

  if (!report) {
    return { ok: false, error: 'Report not found.' };
  }

  if (!isValidTransition(report.status, newStatus)) {
    return {
      ok: false,
      error: `Cannot change status from "${report.status}" to "${newStatus}". Allowed next steps: ${
        ALLOWED_TRANSITIONS[report.status].join(', ') || 'none (terminal state)'
      }`,
    };
  }

  const update = db.prepare('UPDATE reports SET status = ? WHERE id = ?');
  update.run(newStatus, reportId);

  const log = db.prepare(`
    INSERT INTO status_logs (report_id, old_status, new_status, note)
    VALUES (?, ?, ?, ?)
  `);
  log.run(reportId, report.status, newStatus, note || null);

  const updatedReport = getReport.get(reportId);
  return { ok: true, report: updatedReport };
}

function getStatusHistory(reportId) {
  const getLogs = db.prepare('SELECT * FROM status_logs WHERE report_id = ? ORDER BY changed_at ASC');
  return getLogs.all(reportId);
}

module.exports = { ALLOWED_TRANSITIONS, ALL_STATUSES, isValidTransition, updateReportStatus, getStatusHistory };
