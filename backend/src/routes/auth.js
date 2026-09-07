import { Router } from 'express';
import { schemas, validateBody } from '../lib/validate.js';
import { verifyPanelUser, signToken, listPanelUsers, createPanelUser, deletePanelUser, updatePanelUserRole, requireAuth, requireRole, useSecureCookies, getSessionMaxAgeMs, getTokenExpiryMs, revokeToken, loginFailureDelay } from '../lib/auth.js';
import { audit } from '../lib/audit.js';
import { authLimiter } from '../middleware/rateLimit.js';
import { checkLoginLockout, recordLoginFailure, recordLoginSuccess, isAccountLocked } from '../middleware/loginLockout.js';
import { idempotencyMiddleware } from '../middleware/idempotency.js';
import { logger } from '../lib/logger.js';

const router = Router();

// Never cache auth responses (tokens, user info) in browsers/proxies.
router.use((req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.set('Pragma', 'no-cache');
  next();
});

// POST /api/auth/login
router.post('/login', authLimiter, checkLoginLockout, validateBody(schemas.login), async (req, res) => {
  const { username, password } = req.validated;
  // Pre-check: account already locked (defense in depth — checkLoginLockout
  // runs before validation, this covers the validated path too).
  const lockedSecs = isAccountLocked(username);
  if (lockedSecs > 0) {
    res.set('Retry-After', String(lockedSecs));
    return res.status(429).json({ error: 'Account temporarily locked due to too many failed attempts', retryAfter: lockedSecs });
  }
  const user = await verifyPanelUser(username, password);
  if (!user) {
    recordLoginFailure(username);
    audit({ action: 'auth.login', resource: username, user: username, ip: req.ip, status: 'failure', details: { reason: 'invalid credentials' } });
    await loginFailureDelay();
    const retryAfter = isAccountLocked(username);
    if (retryAfter > 0) {
      res.set('Retry-After', String(retryAfter));
      return res.status(429).json({ error: 'Account temporarily locked due to too many failed attempts', retryAfter });
    }
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  recordLoginSuccess(username);
  const token = signToken({ sub: username, username, role: user.role });
  const maxAge = getSessionMaxAgeMs();
  const expiresAt = getTokenExpiryMs(token);
  // httpOnly cookie + return body for SPA
  res.cookie('panel_token', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: useSecureCookies(req),
    maxAge,
    path: '/',
  });
  audit({ action: 'auth.login', resource: username, user: username, ip: req.ip, status: 'success' });
  res.json({ token, user, expiresAt, expiresIn: Math.max(0, expiresAt - Date.now()) });
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  const auth = req.headers.authorization;
  const bearer = auth?.startsWith('Bearer ') ? auth.slice(7) : null;
  const token = bearer || req.cookies?.panel_token;
  if (token) revokeToken(token);
  const secure = useSecureCookies(req);
  res.clearCookie('panel_token', { path: '/', httpOnly: true, sameSite: 'lax', secure });
  res.clearCookie('csrf_token', { path: '/', sameSite: 'lax', secure });
  audit({ action: 'auth.logout', resource: req.user?.username || '-', user: req.user?.username || 'anonymous', ip: req.ip, status: 'success' });
  res.json({ success: true });
});

// GET /api/auth/me
router.get('/me', requireAuth, (req, res) => {
  const expiresAt = req.token ? getTokenExpiryMs(req.token) : Date.now() + getSessionMaxAgeMs();
  res.json({ user: req.user, expiresAt, expiresIn: Math.max(0, expiresAt - Date.now()) });
});

// GET /api/auth/csrf  -> issues csrf cookie via auth.js middleware
router.get('/csrf', (req, res) => {
  // auth.js issueCsrfToken will set cookie; just return token value from cookie
  const token = req.cookies?.csrf_token || '';
  res.json({ csrfToken: token });
});

// Admin: list users
router.get('/users', requireAuth, requireRole('admin'), (req, res) => {
  res.json(listPanelUsers());
});

// Admin: create user (idempotent on Idempotency-Key so retries never double-create)
router.post('/users', requireAuth, requireRole('admin'), idempotencyMiddleware, validateBody(schemas.createPanelUser), async (req, res) => {
  try {
    const { username, password, role } = req.validated;
    const u = await createPanelUser({ username, password, role });
    audit({ action: 'auth.create_user', resource: username, user: req.user.username, ip: req.ip, details: { role } });
    res.json(u);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.delete('/users/:username', requireAuth, requireRole('admin'), idempotencyMiddleware, async (req, res) => {
  try {
    await deletePanelUser(req.params.username);
    audit({ action: 'auth.delete_user', resource: req.params.username, user: req.user.username, ip: req.ip });
    res.json({ success: true });
  } catch (e) {
    res.status(404).json({ error: e.message });
  }
});

router.patch('/users/:username/role', requireAuth, requireRole('admin'), idempotencyMiddleware, async (req, res) => {
  try {
    const { role } = req.body;
    if (!['admin', 'operator', 'viewer'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
    const u = await updatePanelUserRole(req.params.username, role);
    audit({ action: 'auth.update_role', resource: req.params.username, user: req.user.username, ip: req.ip, details: { role } });
    res.json(u);
  } catch (e) {
    res.status(404).json({ error: e.message });
  }
});

export default router;
