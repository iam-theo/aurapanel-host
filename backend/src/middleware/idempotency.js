/**
 * Idempotency for mutating APIs (Stripe-style).
 *
 * Client sends `Idempotency-Key: <unique-per-operation>` on POST/PUT/PATCH/DELETE.
 * - First request executes normally; a successful (2xx) response is cached.
 * - Retries with the SAME key + same method/URL/user return the cached
 *   response with `X-Idempotent-Replayed: true` instead of re-executing.
 * - A retry arriving while the first is still in-flight gets 409.
 * - Error responses (4xx/5xx) are never cached, so clients can fix + retry.
 *
 * Auth login/logout are excluded: replaying a login would return a stale
 * token and would interfere with lockout/audit accounting.
 */
const KEY_RE = /^[A-Za-z0-9_-]{8,128}$/;
const TTL_MS = Number(process.env.IDEMPOTENCY_TTL_MS || 24 * 60 * 60 * 1000);
const MAX_ENTRIES = Number(process.env.IDEMPOTENCY_MAX || 5000);

const store = new Map(); // cacheKey -> { status, body, expiresAt } | { inFlight: true, startedAt }

const IDEMPOTENT_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// Paths that must never be deduplicated (token issuance, session teardown, csrf).
function isExcluded(req) {
  const p = req.path || '';
  if (p === '/api/auth/login' || p === '/auth/login') return true;
  if (p === '/api/auth/logout' || p === '/auth/logout') return true;
  if (p === '/api/auth/csrf' || p === '/auth/csrf') return true;
  if (p.endsWith('/auth/login') || p.endsWith('/auth/logout') || p.endsWith('/auth/csrf')) return true;
  return false;
}

function scopeId(req) {
  // Bind the key to the acting principal so one user can't replay another's key.
  return req.user?.sub || req.user?.username || req.ip || 'anon';
}

export function idempotencyMiddleware(req, res, next) {
  if (!IDEMPOTENT_METHODS.has(req.method) || isExcluded(req)) return next();

  const key = req.headers['idempotency-key'];
  if (!key) return next(); // opt-in; requests without a key execute normally
  if (typeof key !== 'string' || !KEY_RE.test(key)) {
    return res.status(400).json({
      error: 'Invalid Idempotency-Key. Use 8-128 chars: letters, numbers, - _',
    });
  }

  const cacheKey = `${req.method}:${req.originalUrl}:${scopeId(req)}:${key}`;
  const now = Date.now();
  const existing = store.get(cacheKey);

  if (existing) {
    if (existing.inFlight) {
      res.set('Retry-After', '1');
      return res.status(409).json({ error: 'Duplicate request in progress, retry shortly' });
    }
    if (existing.expiresAt > now) {
      res.set('X-Idempotent-Replayed', 'true');
      return res.status(existing.status).json(existing.body);
    }
    store.delete(cacheKey); // expired
  }

  // Mark in-flight BEFORE the handler runs so concurrent duplicates get 409.
  store.set(cacheKey, { inFlight: true, startedAt: now });
  if (store.size > MAX_ENTRIES) {
    // Evict oldest (Map preserves insertion order).
    const oldest = store.keys().next().value;
    store.delete(oldest);
  }

  const origJson = res.json.bind(res);
  const origSend = res.send.bind(res);
  let settled = false;

  const settle = (status, body) => {
    if (settled) return;
    settled = true;
    if (status >= 200 && status < 300) {
      // LRU refresh on write
      store.delete(cacheKey);
      store.set(cacheKey, { status, body, expiresAt: Date.now() + TTL_MS });
    } else {
      // Never cache errors — client should fix the request and retry
      // with the same key.
      if (store.get(cacheKey)?.inFlight) store.delete(cacheKey);
    }
  };

  res.json = (body) => {
    settle(res.statusCode || 200, body);
    return origJson(body);
  };
  res.send = (body) => {
    let parsed = body;
    try {
      parsed = typeof body === 'string' ? JSON.parse(body) : body;
    } catch { /* keep raw */ }
    settle(res.statusCode || 200, parsed);
    return origSend(body);
  };
  // Safety: if the handler finishes without json/send (e.g. end()), clear the lock.
  res.on('finish', () => {
    if (!settled && store.get(cacheKey)?.inFlight) store.delete(cacheKey);
  });

  next();
}

export function clearIdempotency() {
  store.clear();
}
