import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { getOrCreateJwtSecret } from './secrets.js';
import { logger } from './logger.js';

const USERS_PATH = process.env.PANEL_USERS_PATH || 'data/panel-users.json';
const JWT_EXPIRY = process.env.JWT_EXPIRY || '12h';
const BCRYPT_ROUNDS = 10;

function ensureDir(p) {
  const d = dirname(p);
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
}

function loadUsers() {
  if (!existsSync(USERS_PATH)) return [];
  try { return JSON.parse(readFileSync(USERS_PATH, 'utf-8')); } catch { return []; }
}

function saveUsers(users) {
  ensureDir(USERS_PATH);
  writeFileSync(USERS_PATH, JSON.stringify(users, null, 2), 'utf-8');
}

export function listPanelUsers() {
  return loadUsers().map(u => ({ username: u.username, role: u.role, createdAt: u.createdAt }));
}

export async function createPanelUser({ username, password, role = 'admin' }) {
  const users = loadUsers();
  if (users.find(u => u.username === username)) throw new Error('User already exists');
  const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const user = { username, passwordHash: hash, role, createdAt: new Date().toISOString() };
  users.push(user);
  saveUsers(users);
  logger.info('panel user created', { username, role });
  return { username, role };
}

export async function verifyPanelUser(username, password) {
  const users = loadUsers();
  const u = users.find(x => x.username === username);
  if (!u) return null;
  const ok = await bcrypt.compare(password, u.passwordHash);
  if (!ok) return null;
  return { username: u.username, role: u.role };
}

export async function updatePanelUserRole(username, role) {
  const users = loadUsers();
  const u = users.find(x => x.username === username);
  if (!u) throw new Error('User not found');
  u.role = role;
  saveUsers(users);
  return { username, role };
}

export async function deletePanelUser(username) {
  let users = loadUsers();
  const before = users.length;
  users = users.filter(u => u.username !== username);
  if (users.length === before) throw new Error('User not found');
  saveUsers(users);
}

export async function changePassword(username, newPassword) {
  const users = loadUsers();
  const u = users.find(x => x.username === username);
  if (!u) throw new Error('User not found');
  u.passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
  saveUsers(users);
}

// Ensure at least one admin exists on first boot (from env)
export async function ensureDefaultAdmin() {
  const users = loadUsers();
  if (users.length > 0) return;
  const defUser = process.env.PANEL_ADMIN_USER || 'admin';
  const defPass = process.env.PANEL_ADMIN_PASS || 'admin123';
  if (process.env.PANEL_ADMIN_USER || process.env.PANEL_ADMIN_PASS) {
    await createPanelUser({ username: defUser, password: defPass, role: 'admin' });
    logger.info('default panel admin created from env', { username: defUser });
  } else {
    // No env creds and no users — create default but warn loudly
    await createPanelUser({ username: 'admin', password: 'admin123', role: 'admin' });
    logger.warn('No panel users found — created default admin/admin123. Change immediately!');
  }
}

export function signToken(payload) {
  const secret = getOrCreateJwtSecret();
  return jwt.sign(payload, secret, { expiresIn: JWT_EXPIRY });
}

export function verifyToken(token) {
  const secret = getOrCreateJwtSecret();
  return jwt.verify(token, secret);
}

// Middleware: require valid JWT (Bearer or httpOnly cookie)
export function requireAuth(req, res, next) {
  // Allow health/metrics/login without auth
  const open = ['/api/health', '/api/metrics', '/api/auth/login', '/api/auth/csrf'];
  if (open.some(p => req.path === p || req.originalUrl.startsWith(p + '?'))) return next();

  // Also allow if AUTH_DISABLED=true (dev)
  if (process.env.AUTH_DISABLED === 'true') {
    req.user = { username: 'dev', role: 'admin', sub: 'dev' };
    return next();
  }

  const auth = req.headers.authorization;
  const cookieToken = req.cookies?.panel_token;
  const token = (auth?.startsWith('Bearer ') ? auth.slice(7) : null) || cookieToken;
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  try {
    const decoded = verifyToken(token);
    req.user = decoded;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'Forbidden: insufficient role' });
    next();
  };
}

// CSRF: double-submit cookie
import { randomBytes } from 'crypto';
export function csrfMiddleware(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (process.env.AUTH_DISABLED === 'true') return next();
  // Login is exempt (no session yet)
  if (req.path === '/api/auth/login' || req.path === '/auth/login') return next();

  const header = req.headers['x-csrf-token'];
  const cookie = req.cookies?.csrf_token;
  if (!cookie || !header || cookie !== header) {
    return res.status(403).json({ error: 'CSRF token missing or invalid' });
  }
  next();
}

export function issueCsrfToken(req, res, next) {
  let token = req.cookies?.csrf_token;
  if (!token) {
    token = randomBytes(32).toString('hex');
    res.cookie('csrf_token', token, { httpOnly: false, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/' });
  }
  // Also return in JSON for SPA to read
  if (req.path === '/api/auth/csrf' || req.path === '/auth/csrf') {
    return res.json({ csrfToken: token });
  }
  next();
}
