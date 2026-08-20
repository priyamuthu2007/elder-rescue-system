# Elder Rescue App — Backend (Step 1)

This is the first piece of the project: the database + a working API to
submit reports and register organizations.

## What's here
- `db.js` — creates the tables: `reports`, `organizations`, `status_logs`
- `matching.js` — finds the nearest verified organization to a report's location (Haversine distance formula)
- `status.js` — enforces valid status transitions and logs every status change
- `server.js` — Express API tying it all together
- Uses Node's **built-in** `node:sqlite` module — no third-party database
  package, so **no compilation, no build tools (Visual Studio/Python)
  needed**. Requires Node 22.5+ (you're on 24.19.0, so you're covered).
  You'll see an "ExperimentalWarning: SQLite is an experimental feature"
  message when the server starts — that's expected and harmless, it just
  means Node hasn't marked the API 100% final yet.
  When you're ready for production, swap `db.js` for a PostgreSQL
  connection — the table structure and SQL queries carry over almost as-is.

## Setup
```bash
npm install
node server.js
```
Server starts at `http://localhost:3000`. The database file
(`elder_rescue.db`) and its tables are created automatically the first
time you run it.

## How matching works
When a report is submitted:
1. All **verified** organizations are checked against the report's location.
2. An org only counts as a match if the report falls within *that org's own* `coverage_radius_km`.
3. Among matches, the **nearest** one is auto-assigned to the report (`assigned_org_id`).
4. If no organization currently covers that location, the report is still saved, but `assigned_org_id` is `null` and the response tells you it needs fallback routing (e.g. a helpline) — this is the hook point for that feature later.

## Status pipeline
A report moves through: `reported → acknowledged → en_route → rescued → closed`
- `closed` can be reached from any state (covers false alarms/duplicates).
- Any other jump (e.g. `reported` straight to `rescued`, or moving backwards) is rejected with a clear error explaining the allowed next steps.
- Every status change is logged to `status_logs` with an optional note and timestamp — view a report's full history via `GET /reports/:id/history`.

## Endpoints

### Submit a report
```
POST /reports
Content-Type: multipart/form-data

Fields: reporter_phone, description, latitude, longitude, photo (optional file)
```

Example (using curl):
```bash
curl -X POST http://localhost:3000/reports \
  -F "reporter_phone=+919999999999" \
  -F "description=Elderly man alone near bus stand, seems disoriented" \
  -F "latitude=13.0604" \
  -F "longitude=80.2496" \
  -F "photo=@/path/to/photo.jpg"
```
The response includes a `matched_organization` field showing which org (if any) was auto-assigned, and how far away it is.

### Check nearby organizations for a point (debug helper — doesn't create a report)
```
GET /nearby-organizations?latitude=13.06&longitude=80.25
```
Returns all verified orgs whose coverage radius includes that point, nearest first.

### List all reports (for testing)
```
GET /reports
```

### Update a report's status
```
PATCH /reports/:id/status
Content-Type: application/json

{ "status": "acknowledged", "note": "Team notified, heading out" }
```
Valid statuses: `reported`, `acknowledged`, `en_route`, `rescued`, `closed`.
Only allowed pipeline moves succeed — invalid jumps return a 400 with the allowed next steps listed.

### View a report's full status history
```
GET /reports/:id/history
```

### Add an organization (for testing — real NGO onboarding flow comes later)
```
POST /organizations
Content-Type: application/json

{
  "name": "Chennai Elder Care Trust",
  "latitude": 13.0827,
  "longitude": 80.2707,
  "coverage_radius_km": 8,
  "contact_phone": "+919999999999",
  "verified": true
}
```

### List all organizations
```
GET /organizations
```

## Verified working
All endpoints, the matching logic, and the full status pipeline were
tested end-to-end before delivery, including: nearest-org selection,
exclusion of unverified/out-of-range orgs, the no-coverage fallback
case, valid status transitions through the full pipeline, rejection
of invalid/backwards status jumps, 404 on updating a nonexistent
report, and the status history log recording every change correctly.

## Next steps (not built yet)
1. OTP phone verification before a report can be submitted
2. NGO dashboard (simple web UI reading from GET /reports)
3. Push/SMS notifications to organizations when a new report lands near them
4. Auto-escalation if an assigned org doesn't acknowledge in time
5. Fallback routing (e.g. helpline number) when assigned_org_id is null
