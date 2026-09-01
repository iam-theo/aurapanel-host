import { Router } from 'express';
import { existsSync, readFileSync, statSync } from 'fs';
import { run } from '../lib/exec.js';
import { runAsync } from '../lib/execAsync.js';
import { requireRole } from '../lib/auth.js';
import { logger } from '../lib/logger.js';

const router = Router();

let cachedUpdateInfo = null;
let cachedAt = 0;
const CACHE_TTL = 60_000; // 1m
let runningJob = null; // { id, cmd, status: running|done|failed, log, startedAt }

function parseAptList(raw) {
  // raw from apt list --upgradable
  const lines = raw.split('\n').filter(l => l.includes('/') && l.includes('[upgradable'));
  return lines.map(l => {
    // e.g. nginx/jammy-updates 1.18.0-6ubuntu14.4 amd64 [upgradable from: ...]
    const m = l.match(/^([^\/]+)\/([^\s]+)\s+([^\s]+)\s+([^\s]+)\s+\[upgradable from:\s*([^\]]+)\]/);
    if (!m) return { raw: l };
    const [, name, pocket, version, arch, from] = m;
    const isSecurity = pocket.includes('security');
    return { name, pocket, version, arch, from: from.trim(), isSecurity, raw: l };
  }).filter(p => p.name);
}

async function getUpdates(force = false) {
  const now = Date.now();
  if (!force && cachedUpdateInfo && now - cachedAt < CACHE_TTL) return cachedUpdateInfo;

  // refresh apt cache in background if stale > 6h (don't block)
  let aptList = '';
  try {
    aptList = await runAsync('apt list --upgradable 2>&1 | head -n 300', { timeout: 15000 });
  } catch (e) { aptList = e.message || ''; }

  const packages = parseAptList(aptList);
  const securityCount = packages.filter(p => p.isSecurity).length;

  // last apt update time
  let lastAptUpdate = null;
  try {
    const st = statSync('/var/cache/apt/pkgcache.bin');
    lastAptUpdate = st.mtime;
  } catch {}

  // unattended-upgrades status
  let unattended = { enabled: false, logTail: '' };
  try {
    const out = run('systemctl is-enabled unattended-upgrades 2>&1 || systemctl is-enabled apt-daily 2>&1', {});
    unattended.enabled = out.trim() === 'enabled';
  } catch {}
  try {
    if (existsSync('/var/log/unattended-upgrades/unattended-upgrades.log')) {
      unattended.logTail = run('tail -n 30 /var/log/unattended-upgrades/unattended-upgrades.log 2>&1', {});
    }
  } catch {}

  // reboot required?
  const rebootRequired = existsSync('/var/run/reboot-required');
  let rebootPkgs = '';
  if (rebootRequired) {
    try { rebootPkgs = readFileSync('/var/run/reboot-required.pkgs', 'utf-8').slice(0, 2000); } catch {}
  }

  // kernel + distro
  let osInfo = {};
  try { osInfo = JSON.parse(run('lsb_release -a 2>&1 | tr -d "\\n" | head -c 500', {})); } catch {}
  try {
    const lsb = run('lsb_release -d 2>&1', {}).trim();
    osInfo.distro = lsb.replace('Description:', '').trim();
  } catch {}
  try { osInfo.kernel = run('uname -r 2>&1', {}).trim(); } catch {}

  const payload = {
    total: packages.length,
    security: securityCount,
    regular: packages.length - securityCount,
    packages: packages.slice(0, 200),
    lastAptUpdate,
    unattended,
    rebootRequired,
    rebootPkgs,
    os: osInfo,
    checkedAt: new Date().toISOString(),
    rawPreview: aptList.slice(0, 5000),
  };
  cachedUpdateInfo = payload;
  cachedAt = now;
  return payload;
}

// GET /api/updates — overview (cached)
router.get('/', async (req, res) => {
  try {
    const force = req.query.refresh === '1' || req.query.refresh === 'true';
    const data = await getUpdates(force);
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/updates/check — alias with force refresh
router.get('/check', async (req, res) => {
  try {
    const data = await getUpdates(true);
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/updates/refresh — runs apt update (needs sudo, async job)
router.post('/refresh', requireRole('admin', 'operator'), async (req, res) => {
  if (runningJob?.status === 'running') return res.status(409).json({ error: 'Another job is running', job: runningJob });
  const id = `apt-update-${Date.now()}`;
  runningJob = { id, cmd: 'apt update', status: 'running', log: 'Running apt update...\n', startedAt: new Date().toISOString() };
  res.json({ jobId: id, message: 'apt update started' });

  setImmediate(async () => {
    try {
      const out = await runAsync('sudo -n apt update 2>&1 || sudo apt update 2>&1', { timeout: 120000 });
      runningJob.log += out.slice(-10000);
      runningJob.status = 'done';
      cachedAt = 0; // invalidate
      logger.info('apt update completed', { jobId: id });
    } catch (e) {
      runningJob.log += `\nERROR: ${e.message.slice(0, 5000)}`;
      runningJob.status = 'failed';
    }
  });
});

// POST /api/updates/upgrade — apt upgrade -y (admin only, async)
router.post('/upgrade', requireRole('admin'), async (req, res) => {
  const { packages, securityOnly = false } = req.body || {};
  if (runningJob?.status === 'running') return res.status(409).json({ error: 'Another job running', job: runningJob });
  let cmd;
  if (Array.isArray(packages) && packages.length) {
    const safePkgs = packages.filter(p => /^[a-zA-Z0-9:._+~-]+$/.test(p)).slice(0, 50);
    if (!safePkgs.length) return res.status(400).json({ error: 'No valid package names' });
    cmd = `sudo DEBIAN_FRONTEND=noninteractive apt install -y ${safePkgs.join(' ')} 2>&1`;
  } else if (securityOnly) {
    cmd = `sudo DEBIAN_FRONTEND=noninteractive unattended-upgrades 2>&1 || sudo DEBIAN_FRONTEND=noninteractive apt upgrade -y 2>&1`;
  } else {
    cmd = `sudo DEBIAN_FRONTEND=noninteractive apt upgrade -y 2>&1`;
  }
  const id = `apt-upgrade-${Date.now()}`;
  runningJob = { id, cmd, status: 'running', log: `Running: ${cmd}\n`, startedAt: new Date().toISOString(), securityOnly, packages };
  req.audit?.('updates.upgrade', 'updates', { securityOnly, packages });
  res.json({ jobId: id, message: 'Upgrade started', cmd });

  setImmediate(async () => {
    try {
      const out = await runAsync(cmd, { timeout: 600000 });
      runningJob.log += out.slice(-15000);
      runningJob.status = out.toLowerCase().includes('error') ? 'failed' : 'done';
      cachedAt = 0;
    } catch (e) {
      runningJob.log += `\nERROR: ${e.message.slice(0, 6000)}`;
      runningJob.status = 'failed';
    }
  });
});

// GET /api/updates/jobs/:id  — poll job
router.get('/jobs/:id', (req, res) => {
  if (!runningJob || runningJob.id !== req.params.id) return res.status(404).json({ error: 'Job not found' });
  res.json(runningJob);
});
router.get('/jobs', (req, res) => {
  if (!runningJob) return res.json({ job: null });
  res.json({ job: runningJob });
});

// GET /api/updates/history — apt history log
router.get('/history', (req, res) => {
  const lines = Math.min(parseInt(req.query.lines || '80', 10) || 80, 300);
  try {
    const candidates = ['/var/log/apt/history.log', '/var/log/dpkg.log', '/var/log/unattended-upgrades/unattended-upgrades.log'];
    const out = {};
    for (const p of candidates) {
      if (existsSync(p)) {
        try { out[p] = run(`tail -n ${lines} ${p} 2>&1 | head -c 20000`, {}); } catch (e) { out[p] = e.message; }
      }
    }
    res.json(out);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/updates/reboot — if reboot-required
router.post('/reboot', requireRole('admin'), (req, res) => {
  try {
    req.audit?.('updates.reboot', 'updates', {});
    run('sudo -n reboot 2>&1 || echo NEEDSUDO', {});
    res.json({ success: true, message: 'Reboot initiated' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

export default router;
