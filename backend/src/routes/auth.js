import { Router } from 'express';
import { schemas, validateBody } from '../lib/validate.js';
import { verifyPanelUser, signToken, listPanelUsers, createPanelUser, deletePanelUser, updatePanelUserRole, requireAuth, requireRole } from '../lib/auth.js';
import { audit } from '../lib/audit.js';
import { authLimiter } from '../middleware/rateLimit.js';
import { logger } from '../lib/logger.js';

const router = Router();

// POST /api/auth/login
router.post('/login', authLimiter, validateBody(schemas.login), async (req, res) => {
  const { username, password } = req.validated;
  const user = await verifyPanelUser(username, password);
  if (!user) {
    audit({ action: 'auth.login', resource: username, user: username, ip: req.ip, status: 'failure', details: { reason: 'invalid credentials' } });
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  const token = signToken({ sub: username, username, role: user.role });
  // httpOnly cookie + return body for SPA
  res.cookie('panel_token', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 12 * 60 * 60 * 1000,
    path: '/',
  });
  audit({ action: 'auth.login', resource: username, user: username, ip: req.ip, status: 'success' });
  res.json({ token, user });
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  res.clearCookie('panel_token', { path: '/' });
  res.clearCookie('csrf_token', { path: '/' });
  res.json({ success: true });
});

// GET /api/auth/me
router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
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

// Admin: create user
router.post('/users', requireAuth, requireRole('admin'), validateBody(schemas.createPanelUser), async (req, res) => {
  try {
    const { username, password, role } = req.validated;
    const u = await createPanelUser({ username, password, role });
    audit({ action: 'auth.create_user', resource: username, user: req.user.username, ip: req.ip, details: { role } });
    res.json(u);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.delete('/users/:username', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    await deletePanelUser(req.params.username);
    audit({ action: 'auth.delete_user', resource: req.params.username, user: req.user.username, ip: req.ip });
    res.json({ success: true });
  } catch (e) {
    res.status(404).json({ error: e.message });
  }
});

router.patch('/users/:username/role', requireAuth, requireRole('admin'), async (req, res) => {
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
