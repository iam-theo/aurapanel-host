/**
 * Secrets vault abstraction.
 * Priority: env var > file > vault provider (future) > fallback.
 * Supports rotation via reload() and never logs raw values.
 */
import { readFileSync, existsSync } from 'fs';
import { logger } from './logger.js';

const SECRET_FILES = {
  SUDO_PASSWORD: '/run/secrets/sudo_password',
  JWT_SECRET: '/run/secrets/jwt_secret',
};

let cache = new Map();

function readSecretFile(key) {
  const path = SECRET_FILES[key];
  if (path && existsSync(path)) {
    try { return readFileSync(path, 'utf-8').trim(); } catch { return null; }
  }
  return null;
}

export function getSecret(key, fallback = '') {
  if (cache.has(key)) return cache.get(key);
  // 1. File-based secret (Docker Swarm / systemd-creds style)
  const fileVal = readSecretFile(key);
  if (fileVal) { cache.set(key, fileVal); return fileVal; }
  // 2. Env var
  const envVal = process.env[key];
  if (envVal) { cache.set(key, envVal); return envVal; }
  // 3. Fallback
  if (fallback) { cache.set(key, fallback); return fallback; }
  return '';
}

export function reloadSecrets() {
  cache.clear();
  logger.info('secrets reloaded');
}

export function requireSecret(key) {
  const v = getSecret(key);
  if (!v) throw new Error(`Missing required secret: ${key}`);
  return v;
}

import { randomBytes as _rb } from 'crypto';
export function getOrCreateJwtSecret() {
  let s = getSecret('JWT_SECRET');
  if (!s) {
    s = _rb(32).toString('hex');
    cache.set('JWT_SECRET', s);
    if (process.env.NODE_ENV === 'production') {
      logger.warn('JWT_SECRET not set — using ephemeral secret. Set JWT_SECRET or /run/secrets/jwt_secret');
    }
  }
  return s;
}
