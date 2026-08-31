import { appendFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { logger } from './logger.js';

const AUDIT_PATH = process.env.AUDIT_LOG_PATH || 'logs/audit.log';

function ensureDir(path) {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

export function audit({ action, resource, user, ip, details, status = 'success' }) {
  const entry = {
    ts: new Date().toISOString(),
    user: user || 'anonymous',
    ip: ip || '-',
    action,
    resource: resource || '-',
    status,
    details: details ? mask(details) : undefined,
  };
  const line = JSON.stringify(entry);
  // structured log
  logger.info(`AUDIT ${action} ${resource} by ${entry.user}`, entry);
  // append to audit file (best-effort)
  try {
    ensureDir(AUDIT_PATH);
    appendFileSync(AUDIT_PATH, line + '\n', 'utf-8');
  } catch (e) {
    logger.error('audit write failed', { error: e.message });
  }
}

function mask(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const out = { ...obj };
  for (const k of Object.keys(out)) {
    if (['password', 'passwd', 'secret', 'token'].some(s => k.toLowerCase().includes(s))) {
      out[k] = '***';
    }
  }
  return out;
}

export function auditMiddleware(req, _res, next) {
  // attach helper to req
  req.audit = (action, resource, details, status) => audit({
    action, resource, details, status,
    user: req.user?.username || req.user?.sub || 'anonymous',
    ip: req.ip,
  });
  next();
}
