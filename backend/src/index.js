import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';

import systemRoutes from './routes/system.js';
import pm2Routes from './routes/pm2.js';
import dockerRoutes from './routes/docker.js';
import databaseRoutes from './routes/databases.js';
import nginxRoutes from './routes/nginx.js';
import fileRoutes from './routes/files.js';
import serviceRoutes from './routes/services.js';
import backupRoutes from './routes/backups.js';
import cronRoutes from './routes/cron.js';
import userRoutes from './routes/users.js';
import settingRoutes from './routes/settings.js';
import authRoutes from './routes/auth.js';
import metricsRoutes from './routes/metrics.js';
import healthRoutes from './routes/health.js';
import packagesRoutes from './routes/packages.js';
import aurexRoutes from './routes/aurex.js';

import { logger } from './lib/logger.js';
import { metricsMiddleware, register } from './lib/metrics.js';
import { auditMiddleware } from './lib/audit.js';
import { requireAuth, issueCsrfToken, csrfMiddleware, ensureDefaultAdmin } from './lib/auth.js';
import { globalLimiter, writeLimiter } from './middleware/rateLimit.js';
import { startAlertLoop } from './lib/alerts.js';

const app = express();
const PORT = process.env.PORT || 3500;
const API_VERSION = 'v1';

// --- Security headers ---
app.use(helmet({
  contentSecurityPolicy: false, // SPA needs inline; tighten via nginx in prod
  hsts: process.env.NODE_ENV === 'production' ? { maxAge: 31536000, includeSubDomains: true } : false,
  crossOriginEmbedderPolicy: false,
}));

// --- CORS (allow Vite dev + same-origin via nginx) ---
const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:5180,http://127.0.0.1:5180').split(',').map(s => s.trim());
app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true); // same-origin / curl / nginx proxy
    if (allowedOrigins.includes(origin) || allowedOrigins.includes('*')) return cb(null, true);
    return cb(null, true); // keep open for now; lock down via ALLOWED_ORIGINS in prod
  },
  credentials: true,
}));
app.use(cookieParser());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));

// --- Global middleware ---
app.use(globalLimiter);
app.use(metricsMiddleware);
app.use(auditMiddleware);
// Lightweight request log (avoid double-logging health)
app.use((req, _res, next) => {
  if (req.path === '/api/health' || req.path === '/api/v1/health') return next();
  logger.http(`${req.method} ${req.originalUrl}`, { ip: req.ip, user: req.headers['x-forwarded-user'] || '-' });
  next();
});

// --- Open routes (no auth) ---
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', version: API_VERSION, timestamp: new Date().toISOString() });
});
app.get('/api/v1/health', (req, res) => {
  res.json({ status: 'ok', version: API_VERSION, timestamp: new Date().toISOString() });
});
app.use('/api/health/detailed', healthRoutes);
app.use('/api/v1/health/detailed', healthRoutes);
app.use('/api/metrics', metricsRoutes);
app.use('/api/v1/metrics', metricsRoutes);

// CSRF token issuance (sets cookie, must be before auth)
app.use(issueCsrfToken);
app.get('/api/auth/csrf', (req, res) => {
  res.json({ csrfToken: req.cookies?.csrf_token || '' });
});
app.get('/api/v1/auth/csrf', (req, res) => {
  res.json({ csrfToken: req.cookies?.csrf_token || '' });
});

// --- Auth ---
app.use('/api/auth', authRoutes);
app.use('/api/v1/auth', authRoutes);

// CSRF enforcement for state-changing methods (after auth routes, before protected APIs)
app.use(csrfMiddleware);

// Require auth for all subsequent /api/* (health/metrics/auth already handled)
app.use('/api', requireAuth);
app.use('/api/v1', requireAuth);

// Write-rate-limit for mutating APIs
const writePaths = ['/api/nginx', '/api/databases', '/api/backups', '/api/cron', '/api/users', '/api/files', '/api/services', '/api/pm2', '/api/docker',
  '/api/v1/nginx', '/api/v1/databases', '/api/v1/backups', '/api/v1/cron', '/api/v1/users', '/api/v1/files', '/api/v1/services', '/api/v1/pm2', '/api/v1/docker'];
app.use(writePaths, writeLimiter);

// --- Versioned API mount (v1) + legacy /api mount ---
function mountApi(prefix) {
  app.use(`${prefix}/system`, systemRoutes);
  app.use(`${prefix}/pm2`, pm2Routes);
  app.use(`${prefix}/docker`, dockerRoutes);
  app.use(`${prefix}/databases`, databaseRoutes);
  app.use(`${prefix}/nginx`, nginxRoutes);
  app.use(`${prefix}/files`, fileRoutes);
  app.use(`${prefix}/services`, serviceRoutes);
  app.use(`${prefix}/backups`, backupRoutes);
  app.use(`${prefix}/cron`, cronRoutes);
  app.use(`${prefix}/users`, userRoutes);
  app.use(`${prefix}/settings`, settingRoutes);
  app.use(`${prefix}/packages`, packagesRoutes);
  app.use(`${prefix}/aurex`, aurexRoutes);
}
mountApi('/api');
mountApi('/api/v1');

// --- 404 + error handler ---
app.use((req, res) => {
  res.status(404).json({ error: `Not found: ${req.method} ${req.path}` });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  logger.error('unhandled error', { error: err.message, stack: err.stack, path: req.path });
  const status = err.status || err.statusCode || 500;
  res.status(status).json({ error: err.message || 'Internal server error' });
});

// --- Boot ---
await ensureDefaultAdmin();
startAlertLoop();

app.listen(PORT, () => {
  logger.info(`Server Panel API running on port ${PORT} (version ${API_VERSION})`);
  // Pre-warm expensive systeminformation caches so first Dashboard paint is fast
  import('systeminformation').then(si => {
    si.default.cpu().catch(() => {});
    si.default.osInfo().catch(() => {});
    si.default.networkInterfaces().catch(() => {});
    si.default.currentLoad().catch(() => {});
  }).catch(() => {});
});
