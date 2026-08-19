# Elder Rescue App — Backend (Step 1)

This is the first piece of the project: the database + a working API to
submit reports and register organizations.

## What's here
- `db.js` — creates two SQLite tables: `reports` and `organizations`
- `server.js` — Express API with endpoints to create/list reports and organizations
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

### List all reports (for testing)
```
GET /reports
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
Both tables and all four endpoints were tested end-to-end before
delivery — a report and an organization were successfully created and
retrieved.

## Next steps (not built yet)
1. "Find nearest organization" matching logic (using lat/lng + coverage_radius_km)
2. OTP phone verification before a report can be submitted
3. Status pipeline: reported → acknowledged → en_route → rescued/closed
4. NGO dashboard (simple web UI reading from GET /reports)
5. Push/SMS notifications to organizations when a new report lands near them
