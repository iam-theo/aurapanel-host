import { Router } from 'express';
import { readdirSync, statSync, existsSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
import { homedir } from 'os';
import { createHmac, randomBytes } from 'crypto';
import { requireRole } from '../lib/auth.js';
import { logger } from '../lib/logger.js';
import { run } from '../lib/exec.js';
import { buildServerContext as coreBuildServerContext } from '../core/aurex/engine.js';
import { PANEL_TOOLS as CORE_TOOLS, getCapabilities as coreGetCapabilities } from '../core/aurex/tools/index.js';
import { INFRASTRUCTURE_INSTRUCTION } from '../core/aurex/prompts/index.js';
import { getLatestReport, getHistory, runDeepAudit } from '../core/aurex/auditor.js';

const router = Router();
const AUREX_API = process.env.AUREX_API_URL || 'http://localhost:4010';
const AUREX_SESSION_SECRET = process.env.AUREX_SESSION_SECRET || process.env.SESSION_SECRET || 'iipk+sjbqtBoh3sWKXpu6+OqQHIhEw2LrodDUmdvqhk=';
const PANEL_AUREX_EMAIL = process.env.PANEL_AUREX_EMAIL || 'panel@server-panel.local';

// Host path selection — allowed roots for agent to run in
// Full server-aware roots: agent can monitor every layer of the box
const HOST_ROOTS = [
  '/',                          // entire filesystem (guarded by per-route checks)
  '/home',
  '/opt',
  '/opt/server-panel',
  '/var/www',
  '/var/log',
  '/var/log/nginx',
  '/etc/nginx',
  '/etc',
  '/tmp',
  '/home/digital-auracle/apps',
  '/home/digital-auracle/aurex',
  '/home/digital-auracle/server-panel',
  '/home/digital-auracle/compose',
  '/home/digital-auracle/backups',
];

function isAllowedHostPath(p) {
  const r = resolve('/', p);
  // '/' allows everything; otherwise prefix check
  if (HOST_ROOTS.includes('/')) return true;
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

// ---- Server-wide context snapshot for Aurex (single call to understand the whole box) ----
async function buildServerContext() {
  const ctx = { generatedAt: new Date().toISOString() };

  // system overview (si)
  try {
    const si = await import('systeminformation');
    const [mem, disk, load] = await Promise.all([si.default.mem(), si.default.fsSize(), si.default.currentLoad()]);
    ctx.system = {
      memory: { total: mem.total, used: mem.used, free: mem.free, pct: Math.round(mem.used / mem.total * 100) },
      disk: disk.filter(d => d.size > 0).map(d => ({ mount: d.mount, size: d.size, used: d.used, use: d.use })),
      cpu: { load: Math.round(load.currentLoad * 100) / 100, cpus: load.cpus?.length },
      uptime: run('uptime -p 2>&1', {}).trim(),
      hostname: run('hostname 2>&1', {}).trim(),
    };
  } catch (e) { ctx.system = { error: e.message }; }

  // pm2
  try {
    const out = run('pm2 jlist 2>&1', {});
    const list = JSON.parse(out);
    ctx.pm2 = list.map(p => ({ name: p.name, status: p.pm2_env?.status, cpu: p.monit?.cpu, memory: p.monit?.memory, uptime: p.pm2_env?.pm_uptime, cwd: p.pm2_env?.pm_cwd }));
  } catch (e) { ctx.pm2 = { error: e.message }; }

  // docker
  try {
    const out = run('docker ps -a --format "{{json .}}" 2>&1', {});
    ctx.docker = out.trim().split('\n').filter(Boolean).map(l => { try { const j = JSON.parse(l); return { id: j.ID?.slice(0, 12), name: j.Names, image: j.Image, state: j.State, status: j.Status }; } catch { return null; } }).filter(Boolean);
    try { ctx.dockerStats = JSON.parse(run('docker info --format "{{json .}}" 2>&1', {})); } catch {}
  } catch (e) { ctx.docker = { error: e.message }; }

  // services (key subset)
  try {
    const svcs = ['nginx', 'docker', 'postgresql', 'redis-server', 'pm2-digital-auracle', 'ollama', 'ssh', 'cloudflared'];
    ctx.services = svcs.map(s => {
      try { const active = run(`systemctl is-active ${s} 2>&1`, {}).trim(); const enabled = run(`systemctl is-enabled ${s} 2>&1`, {}).trim(); return { name: s, active, enabled }; }
      catch { return { name: s, active: 'unknown' }; }
    });
  } catch (e) { ctx.services = { error: e.message }; }

  // nginx sites
  try {
    const avail = readdirSync('/etc/nginx/sites-available').filter(f => !f.startsWith('.'));
    let enabled = [];
    try { enabled = readdirSync('/etc/nginx/sites-enabled'); } catch {}
    ctx.nginx = { available: avail, enabled, count: avail.length };
  } catch {}

  // updates (lightweight)
  try { ctx.updates = run('apt list --upgradable 2>&1 | head -n 20', {}).trim().slice(0, 2000); } catch (e) { ctx.updates = e.message; }

  // recent logs previews
  try { ctx.logs = { syslog: run('tail -n 20 /var/log/syslog 2>&1 | head -c 3000', {}).trim().slice(0, 2000) }; } catch {}

  // cron count
  try { ctx.cron = run('crontab -l 2>&1 | head -c 2000', {}).trim().slice(0, 2000); } catch {}

  // panel health
  try { ctx.backups = readdirSync('/home/digital-auracle/backups').length + ' backup(s)'; } catch { ctx.backups = 'n/a'; }

  return ctx;
}

// Tools manifest — describes every panel capability so Aurex (LLM) can plan actions
const PANEL_TOOLS = [
  { id: 'system.overview', method: 'GET', path: '/api/system/overview', desc: 'CPU/mem/disk/os/network' },
  { id: 'system.processes', method: 'GET', path: '/api/system/processes', desc: 'Top 25 processes' },
  { id: 'system.cpu-history', method: 'GET', path: '/api/system/cpu-history', desc: 'Per-core CPU load' },
  { id: 'pm2.list', method: 'GET', path: '/api/pm2', desc: 'List PM2 apps + status/mem/cpu' },
  { id: 'pm2.deploy', method: 'POST', path: '/api/pm2', desc: 'Deploy new Node app (blank or git clone)' },
  { id: 'pm2.action', method: 'POST', path: '/api/pm2/:name/:op', desc: 'start/stop/restart/delete/deploy for app' },
  { id: 'pm2.logs', method: 'GET', path: '/api/pm2/:name/logs', desc: 'App logs tail' },
  { id: 'docker.containers', method: 'GET', path: '/api/docker/containers', desc: 'List containers' },
  { id: 'docker.create', method: 'POST', path: '/api/docker/containers', desc: 'Create container (image, ports, env)' },
  { id: 'docker.action', method: 'POST', path: '/api/docker/containers/:id/:action', desc: 'start/stop/restart/...' },
  { id: 'docker.logs', method: 'GET', path: '/api/docker/containers/:id/logs', desc: 'Container logs' },
  { id: 'docker.images', method: 'GET', path: '/api/docker/images', desc: 'List images' },
  { id: 'docker.stats', method: 'GET', path: '/api/docker/stats', desc: 'Live CPU/mem per container' },
  { id: 'databases.postgres', method: 'GET', path: '/api/databases/postgres', desc: 'PG clusters, dbs, users' },
  { id: 'databases.redis', method: 'GET', path: '/api/databases/redis', desc: 'Redis info' },
  { id: 'nginx.sites', method: 'GET', path: '/api/nginx/sites', desc: 'Nginx sites + enabled state' },
  { id: 'nginx.create', method: 'POST', path: '/api/nginx/sites', desc: 'Create nginx site' },
  { id: 'nginx.reload', method: 'POST', path: '/api/nginx/reload', desc: 'Reload nginx' },
  { id: 'files.browse', method: 'GET', path: '/api/files?path=...', desc: 'Browse filesystem' },
  { id: 'files.read', method: 'GET', path: '/api/files/read?path=...', desc: 'Read file (<5MB)' },
  { id: 'files.write', method: 'POST', path: '/api/files/write', desc: 'Write file' },
  { id: 'services.list', method: 'GET', path: '/api/services', desc: 'systemd services status' },
  { id: 'services.action', method: 'POST', path: '/api/services/:name/:op', desc: 'start/stop/restart/enable/disable' },
  { id: 'backups.list', method: 'GET', path: '/api/backups', desc: 'List backups' },
  { id: 'backups.create', method: 'POST', path: '/api/backups/directory', desc: 'Create dir/db backup' },
  { id: 'cron.list', method: 'GET', path: '/api/cron', desc: 'List crontab jobs' },
  { id: 'cron.create', method: 'POST', path: '/api/cron', desc: 'Create cron job' },
  { id: 'packages.marketplace', method: 'GET', path: '/api/packages/marketplace', desc: '80+ installable packages' },
  { id: 'packages.install', method: 'POST', path: '/api/packages/install', desc: 'Install marketplace package' },
  { id: 'logs.tail', method: 'GET', path: '/api/logs/file?path=...', desc: 'Tail any log file' },
  { id: 'logs.journal', method: 'GET', path: '/api/logs/journal?unit=...', desc: 'journalctl' },
  { id: 'logs.pm2', method: 'GET', path: '/api/logs/pm2/:name', desc: 'PM2 aggregated logs' },
  { id: 'logs.docker', method: 'GET', path: '/api/logs/docker/:id', desc: 'Docker container logs' },
  { id: 'logs.search', method: 'GET', path: '/api/logs/search?q=...', desc: 'Grep across /var/log' },
  { id: 'updates.check', method: 'GET', path: '/api/updates', desc: 'Pending apt updates' },
  { id: 'updates.upgrade', method: 'POST', path: '/api/updates/upgrade', desc: 'Run apt upgrade' },
  { id: 'health.detailed', method: 'GET', path: '/api/health/detailed', desc: 'pm2/docker/pg/nginx checks' },
  { id: 'metrics', method: 'GET', path: '/api/metrics', desc: 'Prometheus metrics' },
];

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
    // 1. Create Aurex project — handle 409 (workspace_destroyed or import in progress)
    let projRes = await proxyToAurex(req, '/api/projects', { method: 'POST', body: { name: projectName || resolved.split('/').pop() || 'Host Project', description: description || `Imported from host ${resolved}` } });
    if (projRes.status === 409) {
      const errMsg = (projRes.data?.error || '').toLowerCase();
      // If workspace destroyed, ensure workspace then retry once
      if (errMsg.includes('workspace_destroyed')) {
        try { await proxyToAurex(req, '/api/workspaces/ensure', { method: 'POST', body: {} }); } catch {}
        projRes = await proxyToAurex(req, '/api/projects', { method: 'POST', body: { name: projectName || resolved.split('/').pop() || 'Host Project', description: description || `Imported from host ${resolved}` } });
      }
      // If another import in progress, try to reuse existing project with same name or list and return first
      if (projRes.status === 409 && errMsg.includes('another import')) {
        const list = await proxyToAurex(req, '/api/projects').catch(() => ({ status: 500, data: [] }));
        const existing = Array.isArray(list.data) ? list.data.find(p => (p.name || '').toLowerCase() === (projectName || resolved.split('/').pop() || '').toLowerCase()) : null;
        if (existing) {
          return res.status(200).json({ project: existing, hostPath: resolved, message: 'Reusing existing project (import busy)' });
        }
        // Try with uniquified name
        const altName = `${projectName || resolved.split('/').pop() || 'Host Project'} ${Date.now().toString().slice(-4)}`;
        projRes = await proxyToAurex(req, '/api/projects', { method: 'POST', body: { name: altName, description: description || `Imported from host ${resolved}` } });
      }
    }
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
  const { projectId, task, model, hostPath, serverMode = false, includeLogs = false, includeUpdates = false } = req.body || {};
  let enrichedTask = task;
  const parts = [];
  if (hostPath && isAllowedHostPath(hostPath)) {
    parts.push(`[HOST PATH: ${resolve('/', hostPath)}]`);
    parts.push(`[WORKSPACE: Isolated Aurex workspace. Host files at ${hostPath} available via /api/aurex/host-paths.]`);
  }
  if (serverMode) {
    // Inject full server context snapshot
    try {
      const ctx = await buildServerContext();
      const summary = JSON.stringify({
        hostname: ctx.system?.hostname,
        uptime: ctx.system?.uptime,
        cpu: ctx.system?.cpu,
        memory: ctx.system?.memory,
        disk: ctx.system?.disk,
        pm2: ctx.pm2,
        docker: ctx.docker,
        services: ctx.services,
        nginx: ctx.nginx,
        updatesPreview: String(ctx.updates || '').slice(0, 800),
      }, null, 2).slice(0, 8000);
      parts.push(`[SERVER CONTEXT: Full server snapshot — you are the server operator. You can act on apps, services, logs, updates via the ServerPanel API at /api/* . Snapshot:\n${summary}\n]`);
      parts.push(`[PANEL TOOLS: ${PANEL_TOOLS.map(t => `${t.id} (${t.method} ${t.path})`).join(', ').slice(0, 3000)}]`);
      parts.push(`[INSTRUCTIONS: You have full server access. Use /api/aurex/server-context for live data, /api/aurex/tools for tool list, /api/logs/* and /api/updates for monitoring. Ask via /api/aurex/host-paths to browse any path under / . After completing the task, ALWAYS summarize what you did, highlight any bottlenecks (high CPU/mem/disk, stopped services, pending security updates), and proactively suggest 2-3 next steps as follow-up questions — e.g. "Want me to apply security updates?", "Should I investigate the service bottleneck?", "Shall I tail the error logs?". Gain intent by asking the user to confirm before applying mutating actions.]`);
      parts.push(INFRASTRUCTURE_INSTRUCTION);
    } catch (e) {
      parts.push(`[SERVER CONTEXT: unavailable: ${e.message}]`);
    }
  }
  if (includeLogs) parts.push(`[LOGS hint: GET /api/logs , /api/logs/journal , /api/logs/pm2 , /api/logs/docker]`);
  if (includeUpdates) parts.push(`[UPDATES hint: GET /api/updates , POST /api/updates/upgrade]`);
  if (parts.length) enrichedTask = `${parts.join('\n')}\n\n${task}`;
  try {
    const r = await proxyToAurex(req, '/api/runs', { method: 'POST', body: { projectId, task: enrichedTask, model } });
    req.audit?.('aurex.create_run', `aurex/runs/${projectId}`, { hostPath, serverMode });
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

router.post('/runs/:id/messages', requireRole('admin', 'operator'), async (req, res) => {
  try {
    const r = await proxyToAurex(req, `/api/runs/${req.params.id}/messages`, { method: 'POST', body: req.body });
    res.status(r.status).json(r.data);
  } catch (e) { res.status(502).json({ error: e.message }); }
});

router.post('/runs/:id/questions', requireRole('admin', 'operator'), async (req, res) => {
  try {
    const r = await proxyToAurex(req, `/api/runs/${req.params.id}/questions`, { method: 'POST', body: req.body });
    res.status(r.status).json(r.data);
  } catch (e) { res.status(502).json({ error: e.message }); }
});

router.post('/runs/:id/retry', requireRole('admin', 'operator'), async (req, res) => {
  try {
    const r = await proxyToAurex(req, `/api/runs/${req.params.id}/retry`, { method: 'POST', body: {} });
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

// --- Server-wide context + tools for Aurex (full environment awareness) ---
router.get('/server-context', async (req, res) => {
  try {
    const ctx = await coreBuildServerContext();
    res.json(ctx);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/tools', (req, res) => {
  // Core layer is now source of truth — PANEL_TOOLS delegates to CORE_TOOLS
  res.json({ tools: CORE_TOOLS, total: CORE_TOOLS.length, hint: 'Aurex core layer: call via panel with same auth (Bearer/cookie). POST needs x-csrf-token + admin/operator.' });
});

router.get('/capabilities', (req, res) => {
  const coreCaps = coreGetCapabilities();
  res.json({
    server: 'ServerPanel',
    layer: 'core/aurex',
    aurex: { api: AUREX_API, hostMode: process.env.AUREX_HOST_MODE === 'true' },
    capabilities: coreCaps.capabilities,
    hostRoots: HOST_ROOTS,
    tools: CORE_TOOLS.length,
    endpoints: {
      serverContext: '/api/aurex/server-context',
      tools: '/api/aurex/tools',
      hostPaths: '/api/aurex/host-paths',
      logs: '/api/logs',
      updates: '/api/updates',
      system: '/api/system/overview',
      health: '/api/health/detailed',
    }
  });
});

// Deep continuous audit — everywhere (services/projects/logs/nginx/updates) every 5m
router.get('/audit/latest', (req, res) => {
  const r = getLatestReport();
  if (!r) return res.status(202).json({ status: 'warming up — first deep audit in ~15s' });
  res.json(r);
});
router.get('/audit/history', (req, res) => {
  res.json({ history: getHistory(), total: getHistory().length });
});
router.post('/audit/run', requireRole('admin','operator'), async (req, res) => {
  try {
    const r = await runDeepAudit();
    req.audit?.('aurex.audit_run', 'aurex/audit', { id: r.id, overall: r.overall });
    res.json(r);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
router.get('/audit/report', (req, res) => {
  const r = getLatestReport();
  if (!r) return res.status(202).json({ error: 'no report yet' });
  res.type('text/markdown').send(r.markdown);
});

// Allow Aurex agent to call panel read-only endpoints via a bridged helper (same auth)
router.post('/bridge/exec', requireRole('admin','operator'), async (req, res) => {
  const { tool, args } = req.body || {};
  const t = PANEL_TOOLS.find(x => x.id === tool);
  if (!t) return res.status(400).json({ error: 'Unknown tool id', known: PANEL_TOOLS.map(x => x.id).slice(0, 20) });
  // For safety, only allow GET tools via this bridge (no mutating unless explicit)
  if (t.method !== 'GET' && !req.body.allowWrite) return res.status(403).json({ error: 'Write tools require allowWrite:true and admin role' });
  try {
    // internal fetch to panel itself
    const base = `http://localhost:${process.env.PORT || 3500}`;
    const url = `${base}${t.path.split('?')[0]}${args ? '?' + new URLSearchParams(args).toString() : ''}`;
    // forward auth cookies/headers
    const headers = { 'Content-Type': 'application/json' };
    if (req.headers.cookie) headers['Cookie'] = req.headers.cookie;
    if (req.headers.authorization) headers['Authorization'] = req.headers.authorization;
    if (req.headers['x-csrf-token']) headers['x-csrf-token'] = req.headers['x-csrf-token'];
    const r = await fetch(url, { headers });
    const text = await r.text();
    let data; try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 8000) }; }
    res.status(r.status).json({ tool, data, status: r.status });
  } catch (e) { res.status(502).json({ error: e.message }); }
});

export default router;
