import rateLimit, { ipKeyGenerator } from 'express-rate-limit';

export const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, slow down' },
  skip: (req) => req.path.startsWith('/api/auth') || req.path.startsWith('/api/v1/auth'),
});

// Strict brute-force protection for login.
// Counts every login attempt per IP. Tunable via env:
//   LOGIN_RATE_MAX (default 10), LOGIN_RATE_WINDOW_MS (default 15 min)
const LOGIN_WINDOW_MS = Number(process.env.LOGIN_RATE_WINDOW_MS || 15 * 60 * 1000);
const LOGIN_MAX = Number(process.env.LOGIN_RATE_MAX || 10);

export const authLimiter = rateLimit({
  windowMs: LOGIN_WINDOW_MS,
  max: LOGIN_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  // Count successful logins too — otherwise an attacker can spray
  // usernames without ever tripping the limiter on success paths.
  skipSuccessfulRequests: false,
  keyGenerator: (req) => {
    // Per-IP bucket (trust proxy is set to 'loopback' so req.ip is the
    // real client via X-Forwarded-For). ipKeyGenerator keeps IPv6
    // subnets in separate buckets so one /64 can't evade the limit.
    return ipKeyGenerator(req.ip || 'unknown');
  },
  handler: (req, res) => {
    const retryAfter = Math.ceil(LOGIN_WINDOW_MS / 1000);
    res.set('Retry-After', String(retryAfter));
    return res.status(429).json({
      error: 'Too many login attempts, try again later',
      retryAfter,
    });
  },
});

export const writeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many write operations, slow down' },
});
