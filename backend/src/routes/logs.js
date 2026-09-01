import { Router } from 'express';
import { existsSync, readdirSync, statSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
import { run } from '../lib/exec.js';
import { runAsync } from '../lib/execAsync.js';
import { requireRole } from '../lib/auth.js';

const router = Router();

// Centralized log sources on this box
const LOG_SOURCES = {
  syslog: { path: '/var/log/syslog', label: 'System Log (syslog)', type: 'file' },
  auth: { path: '/var/log/auth.log', label: 'Auth log', type: 'file' },
  kern: { path: '/var/log/kern.log', label: 'Kernel', type: 'file' },
  dpkg: { path: '/var/log/dpkg.log', label: 'Package (dpkg)', type: 'file' },
  nginx_access: { path: '/var/log/nginx/access.log', label: 'Nginx access', type: 'file' },
  nginx_error: { path: '/var/log/nginx/error.log', label: 'Nginx error', type: 'file' },
  pm2: { label: 'PM2 (all apps)', type: 'pm2' },
  journal: { label: 'systemd journal', type: 'journal' },
  docker: { label: 'Docker containers', type: 'docker' },
};

function tailFile(path, lines = 200) {
  if (!existsSync(path)) return { exists: false, content: '', path };
  try {
    const out = run(`tail -n ${lines} ${path} 2>&1`, {});
    return { exists: true, path, content: out, lines: out.split('\n').length };
  } catch (e) {
    return { exists: true, path, error: e.message };
  }
}

function listLogFiles() {
  const candidates = [
    '/var/log/syslog', '/var/log/auth.log', '/var/log/kern.log', '/var/log/dpkg.log',
    '/var/log/nginx/access.log', '/var/log/nginx/error.log',
    '/var/log/apt/history.log', '/var/log/apt/term.log',
    '/var/log/cloud-init.log', '/var/log/unattended-upgrades/unattended-upgrades.log',
  ];
  return candidates.filter(p => existsSync(p)).map(p => {
    try {
      const st = statSync(p);
      return { id: p.replace(/[^a-zA-Z0-9]/g, '_'), path: p, label: p, size: st.size, modified: st.mtime, exists: true };
    } catch { return { id: p, path: p, label: p, exists: false }; }
  });
}

// GET /api/logs — list available sources + previews
router.get('/', (req, res) => {
  const files = listLogFiles();

  // pm2 list
  let pm2Apps = [];
  try {
    const out = run('pm2 jlist 2>&1', {});
    const list = JSON.parse(out);
    pm2Apps = list.map(p => ({ name: p.name, status: p.pm2_env?.status, outLog: p.pm2_env?.pm_out_log_path, errLog: p.pm2_env?.pm_err_log_path }));
  } catch {}

  // docker containers
  let dockerContainers = [];
  try {
    const out = run('docker ps -a --format "{{json .}}" 2>&1', {});
    dockerContainers = out.trim().split('\n').filter(Boolean).map(l => { try { const j = JSON.parse(l); return { id: j.ID, name: j.Names, image: j.Image, state: j.State }; } catch { return null; } }).filter(Boolean);
  } catch {}

  // nginx sites
  let nginxSites = [];
  try {
    const avail = readdirSync('/etc/nginx/sites-available').filter(f => !f.startsWith('.'));
    nginxSites = avail;
  } catch {}

  res.json({
    sources: LOG_SOURCES,
    files,
    pm2Apps,
    dockerContainers,
    nginxSites,
    tips: 'Use /api/logs/file?path=... or /api/logs/journal?unit=nginx&lines=200',
  });
});

// GET /api/logs/file?path=/var/log/nginx/error.log&lines=200
router.get('/file', (req, res) => {
  const raw = String(req.query.path || '');
  const lines = Math.min(parseInt(req.query.lines || '200', 10) || 200, 2000);
  if (!raw) return res.status(400).json({ error: 'path query required' });
  const resolved = resolve('/', raw);
  // allowlist-ish: only under /var/log, /home, /tmp or pm2 log paths
  const allowedPrefixes = ['/var/log/', '/home/', '/tmp/', '/root/.pm2/logs/'];
  const isAllowed = allowedPrefixes.some(p => resolved.startsWith(p)) || resolved.startsWith('/home/digital-auracle/.pm2/logs');
  if (!isAllowed && !existsSync(resolved)) return res.status(403).json({ error: 'Path not allowed', allowedPrefixes });
  const result = tailFile(resolved, lines);
  if (!result.exists) return res.status(404).json({ error: `File not found: ${resolved}` });
  res.json({ path: resolved, ...result });
});

// GET /api/logs/pm2/:name?lines=200  (or /pm2 without name for all)
router.get('/pm2/:name', (req, res) => {
  const name = req.params.name;
  const lines = Math.min(parseInt(req.query.lines || '200', 10) || 200, 2000);
  try {
    const out = run(`pm2 logs ${name} --nostream --lines ${lines} --no-color 2>&1`, {});
    res.json({ app: name, lines, logs: out });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
router.get('/pm2', (req, res) => {
  const lines = Math.min(parseInt(req.query.lines || '100', 10) || 100, 500);
  try {
    const out = run(`pm2 logs --nostream --lines ${lines} --no-color 2>&1 | head -c 50000`, {});
    res.json({ lines, logs: out });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/logs/docker/:id?lines=200
router.get('/docker/:id', (req, res) => {
  const id = req.params.id;
  const lines = Math.min(parseInt(req.query.lines || '200', 10) || 200, 2000);
  try {
    const out = run(`docker logs --tail ${lines} ${id} 2>&1`, {});
    res.json({ container: id, lines, logs: out });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/logs/journal?unit=nginx&lines=200&since=1h or &grep=error
router.get('/journal', async (req, res) => {
  const unit = String(req.query.unit || '').trim();
  const lines = Math.min(parseInt(req.query.lines || '200', 10) || 200, 2000);
  const since = String(req.query.since || '1h');
  const grep = String(req.query.grep || '').trim();
  const priority = String(req.query.priority || '').trim(); // e.g. err

  let cmd = `journalctl --no-pager -n ${lines}`;
  if (unit) {
    // sanitize unit: alphanumeric, dash, @, .
    if (!/^[a-zA-Z0-9@._-]+$/.test(unit)) return res.status(400).json({ error: 'Invalid unit' });
    cmd += ` -u ${unit}`;
  }
  if (since) {
    if (!/^[0-9]+(s|min|m|h|d|w)?$/.test(since) && since !== 'today' && since !== 'yesterday') {
      // allow e.g. "1 hour ago" style? keep simple; else ignore
    } else {
      cmd += ` --since "${since}"`;
    }
  }
  if (priority && /^[0-7]$/.test(priority)) cmd += ` -p ${priority}`;
  cmd += ' 2>&1';

  try {
    let out = await runAsync(cmd, { timeout: 10000 });
    if (grep) {
      const safe = grep.replace(/[^a-zA-Z0-9 _.-]/g, '').slice(0, 80);
      const filtered = out.split('\n').filter(l => l.toLowerCase().includes(safe.toLowerCase()));
      out = filtered.join('\n');
    }
    res.json({ unit: unit || 'all', lines, since, grep: grep || null, logs: out.slice(0, 80000) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/logs/nginx/:site?  access/error
router.get('/nginx/:which', (req, res) => {
  const which = req.params.which; // access or error
  if (!['access', 'error'].includes(which)) return res.status(400).json({ error: 'which must be access or error' });
  const lines = Math.min(parseInt(req.query.lines || '200', 10) || 200, 2000);
  const site = req.query.site ? String(req.query.site) : null;
  // site-specific log? try /var/log/nginx/<site>.log else default
  let logPath = `/var/log/nginx/${which}.log`;
  if (site && /^[a-zA-Z0-9._-]+$/.test(site)) {
    const candidate = `/var/log/nginx/${site}_${which}.log`;
    if (existsSync(candidate)) logPath = candidate;
  }
  const result = tailFile(logPath, lines);
  res.json({ which, site: site || 'default', ...result });
});

// GET /api/logs/search?q=error&lines=200  — grep across key logs
router.get('/search', async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q || q.length < 2) return res.status(400).json({ error: 'q (search term) required, min 2 chars' });
  const safe = q.replace(/[^a-zA-Z0-9 _.:-]/g, '').slice(0, 80);
  const lines = Math.min(parseInt(req.query.lines || '200', 10) || 200, 1000);
  try {
    const out = await runAsync(`grep -R -i -n ${JSON.stringify(safe)} /var/log --include="*.log" 2>/dev/null | tail -n ${lines} | head -c 80000`, { timeout: 8000 });
    res.json({ query: safe, hits: out.split('\n').filter(Boolean).length, results: out });
  } catch (e) { res.json({ query: safe, hits: 0, results: '' }); }
});

// POST /api/logs/clear  — truncate a log (admin only)
router.post('/clear', requireRole('admin'), (req, res) => {
  const raw = String(req.body?.path || '');
  if (!raw) return res.status(400).json({ error: 'path required in body' });
  const resolved = resolve('/', raw);
  const allowed = ['/var/log/nginx/', '/var/log/', '/home/digital-auracle/.pm2/logs/'];
  const ok = allowed.some(p => resolved.startsWith(p));
  if (!ok) return res.status(403).json({ error: 'Not allowed to clear this path' });
  try {
    run(`truncate -s 0 ${resolved} 2>&1`, { sudo: true });
    res.json({ success: true, path: resolved });
  } catch (e) {
    try { run(`cat /dev/null > ${resolved} 2>&1`, { sudo: true }); res.json({ success: true, path: resolved }); }
    catch (err) { res.status(500).json({ error: err.message }); }
  }
});

export default router;
