# Elder Rescue App — Backend (Step 1)

This is the first piece of the project: the database + a working API to
submit reports and register organizations.

## What's here
- `db.js` — creates the tables: `reports`, `organizations`, `status_logs`
- `matching.js` — finds the nearest verified organization to a report's location (Haversine distance formula)
- `status.js` — enforces valid status transitions and logs every status change
- `server.js` — Express API tying it all together, also serves the two pages below
- `public/index.html` — the **Response Board** (NGO-facing dashboard)
- `public/report.html` — the **public reporting page** (mobile-first, camera capture, geolocation — this is what a member of the public would actually use)
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
- **http://localhost:3000** — the Response Board (NGO dashboard)
- **http://localhost:3000/report.html** — the public reporting page

The database file (`elder_rescue.db`) and its tables are created
automatically the first time you run it.

## The dashboard (`index.html`) — v3, colorful redesign
Open `http://localhost:3000` in a browser. What changed in this version:
- **New vibrant palette** — coral, amber, turquoise, emerald, and violet replace the muted teal/sage tones, each status now has its own bold color
- **Drifting gradient "aurora" blobs** in the background for a livelier feel, plus a small animated heartbeat/pulse line under the header
- **Fixed a real bug**: the file input for the photo dropzone was showing as a stray native "Choose File" box beneath the styled dropzone — the CSS rule hiding it didn't actually target the right element. That's corrected now.
- Stat cards now have soft tinted backgrounds + an icon per status, and lift with a bouncier animation on hover
- Buttons are now pill-shaped with a gradient fill and a soft glow on hover
- Progress tracker dots are bigger and bouncier when advancing
- Same underlying functionality as before: animated counters, card-update glow, toast notifications, drag-and-drop photo upload, status pipeline, org matching, history log, auto-refresh every 6s

## The public reporting page (`report.html`)
This is the screen an actual member of the public would use:
- **Camera capture** — tapping the photo box opens the device camera directly on mobile (falls back to gallery/file picker on desktop), via `capture="environment"`
- **Automatic geolocation** — requests the browser's location on load; shows a clear pending/success/error state, with a retry button if permission was denied
- **Phone + description fields**, large touch targets throughout
- On submit, shows a confirmation screen naming the matched organization (or a message that it's being followed up manually if nothing covers that area yet)
- A short privacy note is shown up front, explaining the report is only shared with verified organizations, not made public

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
All endpoints, the matching logic, the full status pipeline, and photo
upload were tested end-to-end before delivery — including submitting a
report with a real image file via multipart upload, confirming the file
saves correctly, is servable, and shows up in the report data exactly
as both pages expect. Both pages' embedded JavaScript were also
syntax-checked.

## Next steps (not built yet)
1. OTP phone verification before a report can be submitted
2. Push/SMS notifications to organizations when a new report lands near them
3. Auto-escalation if an assigned org doesn't acknowledge in time
4. Fallback routing (e.g. helpline number) when assigned_org_id is null
5. Login/auth so only a real NGO can act on their own assigned reports
6. Deploying this somewhere public (right now it only runs on your own machine at localhost)
