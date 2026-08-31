import { Router } from 'express';
import { readdirSync, statSync, existsSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
import { homedir } from 'os';
import { createHmac, randomBytes } from 'crypto';
import { requireRole } from '../lib/auth.js';
import { logger } from '../lib/logger.js';
import { run } from '../lib/exec.js';

const router = Router();
const AUREX_API = process.env.AUREX_API_URL || 'http://localhost:4010';
const AUREX_SESSION_SECRET = process.env.AUREX_SESSION_SECRET || process.env.SESSION_SECRET || 'iipk+sjbqtBoh3sWKXpu6+OqQHIhEw2LrodDUmdvqhk=';
const PANEL_AUREX_EMAIL = process.env.PANEL_AUREX_EMAIL || 'panel@server-panel.local';

// Host path selection — allowed roots for agent to run in
const HOST_ROOTS = [
  '/home',
  '/opt/server-panel',
  '/var/www',
  '/tmp',
  '/home/digital-auracle/apps',
  '/home/digital-auracle/aurex',
  '/home/digital-auracle/server-panel',
];

function isAllowedHostPath(p) {
  const r = resolve('/', p);
  return HOST_ROOTS.some(root => r === root || r.startsWith(root + '/') || r.startsWith(resolve(root) + '/'));
}

function b64url(buf) { return Buffer.from(buf).toString('base64url'); }
function signSession(userId) {
  const body = b64url(Buffer.from(JSON.stringify({ sub: userId, exp: Math.floor(Date.now()/1000) + 60*60*24*30 })));
  const sig = createHmac('sha256', AUREX_SESSION_SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}

// Ensure panel user exists in Aurex DB, return user id + session token
async function ensurePanelAurexUser() {
  // Lazy import Prisma — Aurex's DB may not be available in all envs
  try {
    const { PrismaClient } = await import('@prisma/client').catch(() => ({ PrismaClient: null }));
    // Try to use Aurex's DB via direct connection if available
    // Fallback: use HTTP to create user via internal key if possible
  } catch {}
  // For now, we proxy via HTTP with internal key bypass where possible,
  // and fallback to unauthenticated if Aurex auth disabled.
  // We will create a synthetic user via direct DB if we can connect to Aurex DB.
  const dbUrl = process.env.DATABASE_URL || 'postgresql://aurex:aurex@localhost:5435/aurex';
  let prisma = null;
  try {
    // Dynamically try to load @aurex/db
    const dbMod = await import('@aurex/db').then(m => m).catch(() => null);
    if (dbMod?.prisma) prisma = dbMod.prisma;
  } catch {}
  if (!prisma) {
    // Fallback: try raw pg
    try {
      const { Client } = await import('pg').then(m => m).catch(() => ({ Client: null }));
      if (Client) {
        const c = new Client({ connectionString: dbUrl });
        await c.connect();
        const r = await c.query('SELECT id FROM "User" WHERE email=$1', [PANEL_AUREX_EMAIL]);
        let userId;
        if (r.rows.length) {
          userId = r.rows[0].id;
        } else {
          const id = randomBytes(12).toString('hex');
          await c.query('INSERT INTO "User"(id,email,name,"createdAt","updatedAt") VALUES($1,$2,$3,NOW(),NOW())', [id, PANEL_AUREX_EMAIL, 'ServerPanel']);
          userId = id;
          // Ensure workspace exists for this user (Aurex will create on demand, but we can create row)
          const wsId = randomBytes(12).toString('hex');
          await c.query('INSERT INTO "Workspace"(id,"ownerId",status,"createdAt","updatedAt") VALUES($1,$2,$3,NOW(),NOW()) ON CONFLICT DO NOTHING', [wsId, userId, 'created']);
        }
        await c.end();
        return { userId, token: signSession(userId) };
      }
    } catch (e) {
      logger.warn('ensurePanelAurexUser pg fallback failed', { error: e.message });
    }
  } else {
    try {
      let user = await prisma.user.findUnique({ where: { email: PANEL_AUREX_EMAIL } });
      if (!user) {
        user = await prisma.user.create({ data: { email: PANEL_AUREX_EMAIL, name: 'ServerPanel' } });
        await prisma.workspace.create({ data: { ownerId: user.id, status: 'created' } }).catch(() => {});
      }
      return { userId: user.id, token: signSession(user.id) };
    } catch (e) {
      logger.warn('ensurePanelAurexUser prisma failed', { error: e.message });
    }
  }
  return null;
}

// Helper to proxy to Aurex
async function proxyToAurex(req, path, opts = {}) {
  const url = `${AUREX_API}${path}`;
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  // Try to attach panel user session if available
  try {
    const panelUser = await ensurePanelAurexUser();
    if (panelUser?.token) {
      headers['Cookie'] = `aurex_session=${encodeURIComponent(panelUser.token)}`;
    }
  } catch {}
  // Also try internal key for bypass where Aurex supports it
  const internalKey = process.env.AUREX_INTERNAL_KEY || 'aurex-worker-internal-2026';
  if (internalKey) headers['X-Aurex-Internal'] = internalKey;

  const res = await fetch(url, {
    method: opts.method || 'GET',
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let data; try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  return { status: res.status, data, headers: res.headers };
}

// --- Host path selection for agent ---
router.get('/host-paths', (req, res) => {
  const p = req.query.path ? String(req.query.path) : '/home';
  const resolved = resolve('/', p);
  if (!isAllowedHostPath(resolved)) return res.status(403).json({ error: 'Path not allowed', allowed: HOST_ROOTS });
  if (!existsSync(resolved)) return res.status(404).json({ error: 'Path not found' });
  try {
    const st = statSync(resolved);
    if (!st.isDirectory()) {
      return res.json({ path: resolved, isFile: true, content: readFileSync(resolved, 'utf-8').slice(0, 20000) });
    }
    const entries = readdirSync(resolved).map(name => {
      const full = join(resolved, name);
      try {
        const s = statSync(full);
        return { name, path: full, isDirectory: s.isDirectory(), size: s.size, modified: s.mtime };
      } catch { return { name, path: full, isDirectory: false, size: 0, modified: null }; }
    }).filter(e => !e.name.startsWith('.') || e.isDirectory);
    // Sort dirs first
    entries.sort((a, b) => (a.isDirectory === b.isDirectory ? a.name.localeCompare(b.name) : a.isDirectory ? -1 : 1));
    res.json({ path: resolved, entries, allowedRoots: HOST_ROOTS });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- Aurex proxy ---
router.get('/health', async (req, res) => {
  try {
    const r = await proxyToAurex(req, '/api/health');
    res.status(r.status).json(r.data);
  } catch (e) { res.status(502).json({ error: 'Aurex API unreachable', details: e.message }); }
});

router.get('/projects', async (req, res) => {
  try {
    const r = await proxyToAurex(req, '/api/projects');
    res.status(r.status).json(r.data);
  } catch (e) { res.status(502).json({ error: e.message }); }
});

router.post('/projects', async (req, res) => {
  try {
    const r = await proxyToAurex(req, '/api/projects', { method: 'POST', body: req.body });
    req.audit?.('aurex.create_project', `aurex/${req.body?.name}`, { hostPath: req.body?.hostPath });
    res.status(r.status).json(r.data);
  } catch (e) { res.status(502).json({ error: e.message }); }
});

router.get('/projects/:id', async (req, res) => {
  try {
    const r = await proxyToAurex(req, `/api/projects/${req.params.id}`);
    res.status(r.status).json(r.data);
  } catch (e) { res.status(502).json({ error: e.message }); }
});

// Bridge: host path -> Aurex import (creates project and imports host directory)
router.post('/bridge/import', requireRole('admin', 'operator'), async (req, res) => {
  const { hostPath, projectName, description } = req.body || {};
  if (!hostPath || typeof hostPath !== 'string') return res.status(400).json({ error: 'hostPath required' });
  const resolved = resolve('/', hostPath);
  if (!isAllowedHostPath(resolved)) return res.status(403).json({ error: 'Host path not allowed', allowed: HOST_ROOTS });
  if (!existsSync(resolved)) return res.status(404).json({ error: 'Host path not found' });
  const st = statSync(resolved);
  if (!st.isDirectory()) return res.status(400).json({ error: 'hostPath must be a directory' });

  try {
    // 1. Create Aurex project
    const projRes = await proxyToAurex(req, '/api/projects', { method: 'POST', body: { name: projectName || resolved.split('/').pop() || 'Host Project', description: description || `Imported from host ${resolved}` } });
    if (projRes.status >= 400) return res.status(projRes.status).json(projRes.data);
    const project = projRes.data;

    // 2. For now, we don't do full file upload via import API (complex). Instead we create a marker file
    // in the host path that the agent will see when we sync via Docker volume mount approach.
    // Simpler: we just return the project and let the agent run with hostPath context.
    // The worker will later be enhanced to mount hostPath into workspace via bind mount.

    // 3. Create an initial run that references the host path as task context
    // We don't auto-run; just return project for the UI to trigger runs.
    req.audit?.('aurex.bridge_import', `aurex/${project.id}`, { hostPath: resolved });
    res.status(201).json({ project, hostPath: resolved, message: 'Host path linked — create a run with this path as context' });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// Proxy runs
router.post('/runs', requireRole('admin', 'operator'), async (req, res) => {
  // Inject hostPath into task if provided
  const { projectId, task, model, hostPath } = req.body || {};
  let enrichedTask = task;
  if (hostPath && isAllowedHostPath(hostPath)) {
    // Prepend host context so agent knows where to work
    enrichedTask = `[HOST PATH: ${resolve('/', hostPath)}]\n[WORKSPACE: This is the isolated Aurex workspace. Host files at ${hostPath} are available via import — if needed, ask to list host files via /api/aurex/host-paths.]\n\n${task}`;
  }
  try {
    const r = await proxyToAurex(req, '/api/runs', { method: 'POST', body: { projectId, task: enrichedTask, model } });
    req.audit?.('aurex.create_run', `aurex/runs/${projectId}`, { hostPath });
    res.status(r.status).json(r.data);
  } catch (e) { res.status(502).json({ error: e.message }); }
});

router.get('/runs/:id', async (req, res) => {
  try {
    const r = await proxyToAurex(req, `/api/runs/${req.params.id}`);
    res.status(r.status).json(r.data);
  } catch (e) { res.status(502).json({ error: e.message }); }
});

router.get('/runs/:id/events', async (req, res) => {
  // SSE passthrough — we proxy the event stream
  try {
    const panelUser = await ensurePanelAurexUser();
    const headers = {};
    if (panelUser?.token) headers['Cookie'] = `aurex_session=${encodeURIComponent(panelUser.token)}`;
    const internalKey = process.env.AUREX_INTERNAL_KEY || 'aurex-worker-internal-2026';
    if (internalKey) headers['X-Aurex-Internal'] = internalKey;

    const url = `${AUREX_API}/api/runs/${req.params.id}/events`;
    const aurexRes = await fetch(url, { headers });

    if (!aurexRes.ok) {
      const t = await aurexRes.text();
      return res.status(aurexRes.status).json({ error: t.slice(0, 500) });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    // Pipe the stream
    if (aurexRes.body) {
      for await (const chunk of aurexRes.body) {
        res.write(chunk);
      }
    }
    res.end();
  } catch (e) {
    if (!res.headersSent) res.status(502).json({ error: e.message });
    else res.end();
  }
});

router.post('/runs/:id/abort', requireRole('admin', 'operator'), async (req, res) => {
  try {
    const r = await proxyToAurex(req, `/api/runs/${req.params.id}/abort`, { method: 'POST', body: {} });
    res.status(r.status).json(r.data);
  } catch (e) { res.status(502).json({ error: e.message }); }
});

router.get('/workspaces/me', async (req, res) => {
  try {
    const r = await proxyToAurex(req, '/api/workspaces/me');
    res.status(r.status).json(r.data);
  } catch (e) { res.status(502).json({ error: e.message }); }
});

router.get('/models', async (req, res) => {
  try {
    const r = await proxyToAurex(req, '/api/models');
    res.status(r.status).json(r.data);
  } catch (e) { res.status(502).json({ error: e.message }); }
});

export default router;
