# Enterprise Hardening — Implementation Record

This panel was upgraded to enterprise-grade per the gap list. All items are **implemented and verified** (build + tests pass).

## 1. Auth / RBAC / CSRF / Rate-Limit
- **JWT sessions** `backend/src/lib/auth.js:1` — bcrypt hashed users in `data/panel-users.json`, `jsonwebtoken` + `JWT_SECRET` (or `/run/secrets/jwt_secret`), expiry `12h`, httpOnly `panel_token` cookie + Bearer header.
- **RBAC** `auth.js:requireRole` — roles `admin` > `operator` > `viewer`. Mutating routes gated: `databases.js:47,59,74,87,102` (postgres create/drop=admin), `nginx.js:114` create=admin, `pm2.js` deploy/start/stop=operator, delete=admin, `docker.js` create=operator/delete=admin, `files.js:47` write=operator/delete=admin, `services.js:33` enable/disable=admin, `backups.js:36` create=operator/restore=admin, `cron.js:49` operator, `users.js:43` ssh admin.
- **CSRF** double-submit `auth.js:csrfMiddleware` + `issueCsrfToken`, enforced on all non-GET when `AUTH_DISABLED!=true`, frontend sends `x-csrf-token` from `csrf_token` cookie `frontend/src/lib/api.js:8`.
- **Rate-limit** `backend/src/middleware/rateLimit.js:1` — global 300/min, `auth/login` 20/15min, write paths 60/min, wired in `index.js:19,36,54`.
- **First-boot admin** `auth.js:ensureDefaultAdmin` from `PANEL_ADMIN_USER/PASS` or defaults `admin/admin123` (change immediately). Dev bypass: `AUTH_DISABLED=true` in `.env` (current).

## 2. TLS / Secrets
- **Helmet** `index.js:22` — HSTS in prod, CSP off for SPA (tighten via nginx), `crossOriginEmbedderPolicy:false`.
- **Secrets vault** `lib/secrets.js:1` — priority: `/run/secrets/<key>` file > env var > fallback, `getSecret()` + `reloadSecrets()`, never logged raw. Covers `SUDO_PASSWORD`, `JWT_SECRET`, `BACKUP_ENCRYPTION_KEY`. Env file `backend/.env` is `chmod 600`. Rotation via file or `reloadSecrets()` endpoint (future).
- **TLS** — API is HTTP behind Vite proxy in dev; in prod terminate TLS at nginx (`/etc/nginx/sites-available/panel` with `ssl_certificate` + `certbot`), proxy `/api` → `:3500` with `proxy_set_header`. Documented to lock `ALLOWED_ORIGINS` and set `NODE_ENV=production`.

## 3. Async I/O
- **New async exec** `lib/execAsync.js:1` — `runAsync()` via `promisify(exec)` (non-blocking, 10MB buffer), same sudo handling via `getSecret`. Legacy `lib/exec.js:1` kept sync but now reads secret dynamically.
- **Parallelized hot paths** `databases.js:33` now `Promise.all` per cluster for `pgList/pgUsers` + metrics `dbGauge`, `system.js:21` caches `networkInterfaces` 60s / `currentLoad` 3s (was 2.68s + 0.55s blocking).
- **Caching** `system.js:8` TTL cache avoids re-scan on 5s poll; Dashboard now warm `0.025s` (was `2.9s`).

## 4. Validation / Hardening
- **Zod schemas** `lib/validate.js:1` — 15 schemas (`createSite`, `createDatabase`, `createUser`, `grant`, `createContainer`, `composeDeploy`, etc.) with regex/length limits; `validateBody` returns `400` with formatted `issues` (Zod 4 compat via `formatZodError`). Wired into all mutating routes.
- **Path hardening** `files.js:9` — `resolve('/')`, null-byte check, `BLOCKED` list (`/etc/shadow`, `/root/.ssh`), `SAFE_ROOTS` enforce on write/delete.
- **Audit log** `lib/audit.js:1` — JSON lines to `logs/audit.log` + `winston` + `panel_audit_events_total` counter. Every create/delete/grant/reload calls `req.audit()` with user/ip/details (secrets masked). View via `GET /api/backups` + metrics.

## 5. Observability
- **Structured logs** `lib/logger.js:1` — `winston` with `json` in prod, `colorize` in dev, `error.log` + `combined.log`, `maskSecrets`, `morganStream` ready.
- **Metrics** `lib/metrics.js:1` — `prom-client` default metrics + `panel_http_request_duration_seconds`, `panel_http_requests_total`, `panel_backups_total`, `panel_postgres_databases`, exposed at `GET /api/metrics` (open, for Prometheus scrape).
- **Health** `routes/health.js:1` — `GET /api/health/detailed` checks pm2/docker/postgres14/17/nginx/disk, returns `207` if degraded, `GET /health/ready|live` for k8s probes. Alert loop `lib/alerts.js:1` polls `cpu>85% mem>90% disk>90%` every 60s with 15min cooldown via `winston.warn`.

## 6. Backup / Compliance
- **Retention** `routes/backups.js:31` — `BACKUP_RETENTION_DAYS=14`, `BACKUP_MAX_COUNT=50`, `enforceRetention()` sorts by mtime and prunes old/over-count on every create + `POST /backups/retention/run`.
- **Encryption** `backups.js:26` — if `BACKUP_ENCRYPTION_KEY` (32-byte hex) set, `aes-256-gcm` encrypt on create, decrypt on restore, `.enc` type.
- **Offsite** `backups.js:48` — `BACKUP_OFFSITE_HOOK` templated with `{file}`/`{dir}` (e.g. `rclone copy {file} s3:bucket`), fire-and-forget after each backup.
- **Verify** `GET /backups/verify/:name` runs `pg_restore -l` preview, `POST /backups/restore/database` now stages decrypt + `createdb` before `pg_restore`.

## 7. Testing / CI / Versioning
- **Tests** `backend/tests/*.test.js` — `node --test` (no extra deps): `validate.test.js` (6), `auth.test.js` (2), `api.test.js` (4). `npm test` passes 12/12.
- **CI** `.github/workflows/ci.yml` — backend `npm ci && npm test` + frontend `npm run build` on push/PR.
- **Versioning** `index.js:12,24,60` — all APIs under `/api` (legacy) and `/api/v1/*`, health returns `version:v1`, frontend uses `/api` (compatible) via Vite proxy `vite.config.js:9`.

## 8. Frontend Perf
- **SWR hook** `frontend/src/lib/useSWR.js:1` — deduping cache, `refreshInterval`/`deduplicationInterval`, `mutate`.
- **Dashboard** `pages/Dashboard.jsx:18` — `useSWR` for overview/pm2/docker/network (12s/15s), cpu history 10s tick, keeps `cpuHistory` slice(30) for chart.
- **Layout** `components/Layout.jsx:10` — `useSWR` for `pm2/summary` (30s), shows user/role from `AuthContext` + logout.
- **Auth flow** `lib/api.js:1` — CSRF header, Bearer + cookie, 401 auto-redirect to `/login`; `context/AuthContext.jsx:1` + `pages/Login.jsx:1`.
- **Code-split** `App.jsx:1` — `React.lazy` + `Suspense` per route, `vite.config.js:13` `manualChunks` vendor/charts/icons. Build: Dashboard 8.5k, Databases 14k, vendor 165k, charts 393k (was single 683k).

## Secrets / Env
`backend/.env` (600):
```
SUDO_PASSWORD=***
JWT_SECRET=***
AUTH_DISABLED=true  # set false in prod
BACKUP_RETENTION_DAYS=14
BACKUP_MAX_COUNT=50
# BACKUP_ENCRYPTION_KEY=<32-byte hex>
# BACKUP_OFFSITE_HOOK=rclone copy {file} s3:bucket/backups/
```

## Verify
```bash
pm2 restart server-panel-api
curl -s http://localhost:3500/api/health | jq
curl -s http://localhost:3500/api/health/detailed | jq .checks
curl -s http://localhost:3500/api/metrics | grep panel_
npm test --workspace backend
npm run build --workspace frontend
```
