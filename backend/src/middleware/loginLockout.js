/**
 * Per-account login lockout — complements the per-IP authLimiter.
 * After MAX_FAILS consecutive failures for one username, further attempts
 * (even with the right password) get 429 until the lock expires.
 * In-memory only; restart clears locks. Tunable via env:
 *   LOGIN_LOCK_MAX (default 5), LOGIN_LOCK_MS (default 15 min)
 */
import { logger } from '../lib/logger.js';

const MAX_FAILS = Number(process.env.LOGIN_LOCK_MAX || 5);
const LOCK_MS = Number(process.env.LOGIN_LOCK_MS || 15 * 60 * 1000);

const buckets = new Map(); // normalized username -> { fails, firstFailAt, lockedUntil }

function norm(name) {
  return String(name || '').trim().toLowerCase();
}

function getBucket(username) {
  const key = norm(username);
  let b = buckets.get(key);
  if (!b) {
    b = { fails: 0, firstFailAt: 0, lockedUntil: 0 };
    buckets.set(key, b);
  }
  return b;
}

export function isAccountLocked(username) {
  const b = buckets.get(norm(username));
  if (!b || !b.lockedUntil) return 0;
  const remaining = b.lockedUntil - Date.now();
  if (remaining <= 0) {
    buckets.delete(norm(username));
    return 0;
  }
  return Math.ceil(remaining / 1000);
}

export function checkLoginLockout(req, res, next) {
  const username = req.body?.username;
  if (!username) return next();
  const retryAfter = isAccountLocked(username);
  if (retryAfter > 0) {
    res.set('Retry-After', String(retryAfter));
    return res.status(429).json({
      error: 'Account temporarily locked due to too many failed attempts',
      retryAfter,
    });
  }
  return next();
}

export function recordLoginFailure(username) {
  const key = norm(username);
  if (!key) return;
  const now = Date.now();
  const b = getBucket(username);
  // Reset window if the first failure is older than the lock window
  if (!b.firstFailAt || now - b.firstFailAt > LOCK_MS) {
    b.fails = 0;
    b.firstFailAt = now;
  }
  b.fails += 1;
  if (b.fails >= MAX_FAILS && !b.lockedUntil) {
    b.lockedUntil = now + LOCK_MS;
    logger.warn('login lockout engaged', { username: key, fails: b.fails });
  }
}

export function recordLoginSuccess(username) {
  const key = norm(username);
  if (key) buckets.delete(key);
}

// Periodic cleanup so the map can't grow unbounded.
const CLEANUP_MS = 5 * 60 * 1000;
if (!globalThis.__loginLockoutCleanup) {
  globalThis.__loginLockoutCleanup = setInterval(() => {
    const now = Date.now();
    for (const [k, b] of buckets) {
      if (b.lockedUntil && b.lockedUntil <= now) buckets.delete(k);
      else if (b.firstFailAt && now - b.firstFailAt > LOCK_MS * 2) buckets.delete(k);
    }
    if (buckets.size > 10000) {
      // absolute cap: drop oldest entries
      const keys = [...buckets.keys()].slice(0, buckets.size - 10000);
      for (const k of keys) buckets.delete(k);
    }
  }, CLEANUP_MS);
  globalThis.__loginLockoutCleanup.unref?.();
}
