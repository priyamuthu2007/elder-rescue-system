# Production deployment boundary

The current application uses Node's synchronous `node:sqlite` API. It is suitable
for local development and security testing, but production must use PostgreSQL
before real public traffic is enabled.

## Required production steps

1. Start PostgreSQL with `docker compose up -d postgres` or use a managed PostgreSQL service.
2. Set every value in `.env.example` through the deployment secret manager. Do not commit `.env`.
3. Replace `db.js` with an asynchronous PostgreSQL data-access layer using `DATABASE_URL`.
4. Migrate the tables and existing data before switching traffic.
5. Put the Node process behind an HTTPS reverse proxy. Set `NODE_ENV=production` so session cookies include `Secure`.
6. Keep uploads on private object storage or a private volume and back them up separately from database data.
7. Configure `OTP_WEBHOOK_URL` and `NOTIFICATION_WEBHOOK_URL` to trusted providers, then test delivery and retry behavior.
8. Run `npm test` in CI and apply dependency security updates before deployment.

The compose file provides local PostgreSQL infrastructure only; it does not
silently switch the running prototype away from SQLite. A PostgreSQL adapter and
data migration are still required before production use.
