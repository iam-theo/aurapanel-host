import { existsSync, mkdirSync, readdirSync } from 'fs';
import { join } from 'path';
import { run } from '../../lib/exec.js';

// Host mapping — mirrors aurex/packages/docker host mode
const HOST_ROOT = process.env.AUREX_HOST_ROOT ?? '/';
const HOST_MODE = process.env.AUREX_HOST_MODE === 'true' || process.env.AUREX_EXEC_MODE === 'host';

export function resolveHostPath(containerPath) {
  if (!containerPath.startsWith('/workspace')) return containerPath;
  const rel = containerPath.slice('/workspace'.length) || '/';
  if (HOST_ROOT === '/') return rel === '/' ? '/' : rel;
  return join(HOST_ROOT, rel);
}

export function ensureHostWorkspace(dir) {
  const hostDir = dir.startsWith('/workspace') ? resolveHostPath(dir) : dir;
  if (!existsSync(hostDir)) mkdirSync(hostDir, { recursive: true });
  return hostDir;
}

// Re-export the same server-context builder that routes/aurex.js uses,
// but now owned by the core layer so routes become thin facades.
export async function buildServerContext() {
  const ctx = { generatedAt: new Date().toISOString(), hostMode: HOST_MODE };

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

  try {
    const out = run('pm2 jlist 2>&1', {});
    const list = JSON.parse(out);
    ctx.pm2 = list.map(p => ({ name: p.name, status: p.pm2_env?.status, cpu: p.monit?.cpu, memory: p.monit?.memory, uptime: p.pm2_env?.pm_uptime, cwd: p.pm2_env?.pm_cwd }));
  } catch (e) { ctx.pm2 = { error: e.message }; }

  try {
    const out = run('docker ps -a --format "{{json .}}" 2>&1', {});
    ctx.docker = out.trim().split('\n').filter(Boolean).map(l => { try { const j = JSON.parse(l); return { id: j.ID?.slice(0, 12), name: j.Names, image: j.Image, state: j.State, status: j.Status }; } catch { return null; } }).filter(Boolean);
    try { ctx.dockerStats = JSON.parse(run('docker info --format "{{json .}}" 2>&1', {})); } catch {}
  } catch (e) { ctx.docker = { error: e.message }; }

  try {
    const svcs = ['nginx', 'docker', 'postgresql', 'redis-server', 'pm2-digital-auracle', 'ollama', 'ssh', 'cloudflared'];
    ctx.services = svcs.map(s => {
      try { const active = run(`systemctl is-active ${s} 2>&1`, {}).trim(); const enabled = run(`systemctl is-enabled ${s} 2>&1`, {}).trim(); return { name: s, active, enabled }; }
      catch { return { name: s, active: 'unknown' }; }
    });
  } catch (e) { ctx.services = { error: e.message }; }

  try {
    const avail = readdirSync('/etc/nginx/sites-available').filter(f => !f.startsWith('.'));
    let enabled = [];
    try { enabled = readdirSync('/etc/nginx/sites-enabled'); } catch {}
    ctx.nginx = { available: avail, enabled, count: avail.length };
  } catch {}

  try { ctx.updates = run('apt list --upgradable 2>&1 | head -n 20', {}).trim().slice(0, 2000); } catch (e) { ctx.updates = e.message; }

  try { ctx.logs = { syslog: run('tail -n 20 /var/log/syslog 2>&1 | head -c 3000', {}).trim().slice(0, 2000) }; } catch {}

  try { ctx.cron = run('crontab -l 2>&1 | head -c 2000', {}).trim().slice(0, 2000); } catch {}

  try { ctx.backups = readdirSync('/home/digital-auracle/backups').length + ' backup(s)'; } catch { ctx.backups = 'n/a'; }

  return ctx;
}
