import { Router } from 'express';
import { run } from '../lib/exec.js';
import client from 'prom-client';

const router = Router();

function check(cmd, timeout = 3000) {
  try {
    const out = run(cmd, { timeout });
    return { ok: true, output: out.trim().slice(0, 500) };
  } catch (e) {
    return { ok: false, error: e.message.slice(0, 500) };
  }
}

router.get('/', async (req, res) => {
  const started = Date.now();
  const checks = {
    api: { ok: true },
    pm2: check('pm2 jlist 2>&1 | head -c 200', 3000),
    docker: check('docker info --format "{{json .}}" 2>&1 | head -c 200', 3000),
    postgres14: check('su postgres -c "psql -p 5432 -c \\"SELECT 1\\" 2>&1" | head -5', 4000) && (() => {
      try { const r = check('su postgres -c "psql -p 5432 -t -A -c \\"SELECT 1\\" 2>&1"', 3000); return { ok: r.output?.includes('1'), output: r.output }; } catch (e) { return { ok: false, error: e.message }; }
    })(),
    postgres17: (() => { try { const r = check('su postgres -c "psql -p 5433 -t -A -c \\"SELECT 1\\" 2>&1"', 3000); return { ok: r.output?.includes('1'), output: r.output }; } catch (e) { return { ok: false, error: e.message }; } })(),
    nginx: check('nginx -t 2>&1; echo EXIT:$?', 3000),
    disk: check('df -h / 2>&1 | tail -1', 2000),
  };
  // overall
  const depsOk = Object.values(checks).every(c => c.ok !== false);
  const payload = {
    status: depsOk ? 'ok' : 'degraded',
    version: process.env.npm_package_version || '1.0.0',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    checks,
    durationMs: Date.now() - started,
  };
  // emit metric
  try {
    const g = client.register.getSingleMetric('panel_health_status');
    if (g) g.set(depsOk ? 1 : 0);
  } catch {}
  res.status(depsOk ? 200 : 207).json(payload);
});

router.get('/ready', (req, res) => res.json({ ready: true }));
router.get('/live', (req, res) => res.json({ live: true }));

export default router;
