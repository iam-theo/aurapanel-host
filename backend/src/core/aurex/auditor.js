import { existsSync, readdirSync, statSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { logger } from '../../lib/logger.js';
import { run } from '../../lib/exec.js';
import { buildServerContext } from './engine.js';

const AUDIT_INTERVAL_MS = parseInt(process.env.AUDIT_INTERVAL_MS || '300000', 10); // 5m
const AUDIT_DATA_DIR = process.env.AUDIT_DATA_DIR || 'data';
const AUDIT_FILE = join(AUDIT_DATA_DIR, 'audit-latest.json');
const AUDIT_HISTORY_FILE = join(AUDIT_DATA_DIR, 'audit-history.json');
const MAX_HISTORY = 20;

let latestReport = null;
let history = [];
let timer = null;
let running = false;

// Severity helpers
function sevFor(value, thresholds) {
  // thresholds: { critical, high, medium }
  if (value >= (thresholds.critical ?? 95)) return 'CRITICAL';
  if (value >= (thresholds.high ?? 85)) return 'HIGH';
  if (value >= (thresholds.medium ?? 70)) return 'MEDIUM';
  return 'LOW';
}

async function safeRun(cmd, timeout = 8000) {
  try { return run(cmd, { timeout }); } catch (e) { return `__ERR:${e.message.slice(0, 500)}`; }
}

function parseAptUpdates(raw) {
  const lines = raw.split('\n').filter(l => l.includes('/') && l.includes('[upgradable'));
  const pkgs = lines.map(l => {
    const m = l.match(/^([^\/]+)\/([^\s]+)\s+([^\s]+)\s+([^\s]+)\s+\[upgradable from:\s*([^\]]+)\]/);
    if (!m) return null;
    const [, name, pocket, version, arch, from] = m;
    return { name, pocket, version, arch, from: from.trim(), isSecurity: pocket.includes('security') };
  }).filter(Boolean);
  return pkgs;
}

async function collectPM2() {
  try {
    const out = run('pm2 jlist 2>&1', { timeout: 5000 });
    const list = JSON.parse(out);
    const apps = list.map(p => ({
      name: p.name,
      status: p.pm2_env?.status,
      memory: p.monit?.memory,
      cpu: p.monit?.cpu,
      restarts: p.pm2_env?.restart_time,
      uptime: p.pm2_env?.pm_uptime,
      cwd: p.pm2_env?.pm_cwd,
      execMode: p.pm2_env?.exec_mode,
      version: p.pm2_env?.version,
    }));
    // tail logs for errors in last 100 lines per app (best effort, first 3 apps)
    const logChecks = [];
    for (const a of apps.slice(0, 5)) {
      try {
        const logs = run(`pm2 logs ${a.name} --nostream --lines 80 --no-color 2>&1 | tail -n 40`, { timeout: 4000 });
        const hasError = /error|exception|failed|crash|EACCES|ENOENT/i.test(logs) && !logs.includes('PM2 log') ? logs.slice(0, 1200) : null;
        if (hasError) logChecks.push({ app: a.name, snippet: hasError.slice(0, 700) });
      } catch {}
    }
    return { apps, logChecks };
  } catch (e) { return { apps: [], error: e.message, logChecks: [] }; }
}

async function collectDocker() {
  try {
    const out = run('docker ps -a --format "{{json .}}" 2>&1', { timeout: 5000 });
    const containers = out.trim().split('\n').filter(Boolean).map(l => { try { const j = JSON.parse(l); return { id: j.ID?.slice(0,12), name: j.Names, image: j.Image, state: j.State, status: j.Status }; } catch { return null; } }).filter(Boolean);
    let images = [];
    try {
      const imgOut = run('docker images --format "{{.Repository}}:{{.Tag}} {{.Size}}" 2>&1 | head -n 20', { timeout: 4000 });
      images = imgOut.trim().split('\n').filter(Boolean).map(l => l.trim());
    } catch {}
    let stats = [];
    try {
      const s = run('docker stats --no-stream --format "{{.Name}}|{{.CPUPerc}}|{{.MemUsage}}|{{.MemPerc}}" 2>&1 | head -n 30', { timeout: 5000 });
      stats = s.trim().split('\n').filter(Boolean).map(l => {
        const [name, cpu, memUsage, memPerc] = l.split('|');
        return { name, cpu, memUsage, memPerc };
      });
    } catch {}
    const issues = [];
    for (const c of containers) {
      if (c.state === 'exited' || c.state === 'dead') issues.push({ container: c.name, issue: `stopped (${c.status})`, severity: 'MEDIUM' });
      if (c.status && c.status.toLowerCase().includes('restarting')) issues.push({ container: c.name, issue: 'restarting', severity: 'HIGH' });
    }
    // high mem via stats
    for (const st of stats) {
      const pct = parseFloat(String(st.memPerc||'').replace('%',''));
      if (!isNaN(pct) && pct > 80) issues.push({ container: st.name, issue: `high memory ${st.memPerc}`, severity: pct > 90 ? 'HIGH' : 'MEDIUM' });
    }
    return { containers, images, stats, issues };
  } catch (e) { return { containers: [], images: [], stats: [], issues: [], error: e.message }; }
}

async function collectSystemd() {
  const KEY_SERVICES = [
    'nginx','php8.3-fpm','php8.4-fpm','postgresql','postgresql@14-main','postgresql@17-main','redis-server','memcached','rabbitmq-server','docker','ollama','cloudflared','tailscaled','ssh','xrdp','cron','ufw','fail2ban'
  ];
  const running = [];
  const failed = [];
  for (const s of KEY_SERVICES) {
    try {
      const raw = s.split('@')[0];
      const active = run(`systemctl is-active ${raw} 2>&1`, { timeout: 2000 }).trim();
      const enabled = run(`systemctl is-enabled ${raw} 2>&1`, { timeout: 2000 }).trim();
      if (active === 'active') running.push({ name: s, status: 'active', enabled });
      else if (active === 'failed' || active === 'inactive') {
        // only count as failed if unit exists and is expected
        const exists = run(`systemctl status ${raw} 2>&1 | head -n 5`, { timeout: 2000 });
        const isNotFound = exists.toLowerCase().includes('could not be found') || exists.toLowerCase().includes('not-found');
        if (!isNotFound) {
          let journal = '';
          try { journal = run(`journalctl -u ${raw} --no-pager -n 8 --no-hostname 2>&1 | tail -n 8`, { timeout: 3000 }).trim().slice(0, 700); } catch {}
          failed.push({ name: s, state: active, enabled, journal, severity: s==='nginx'||s==='docker'||s==='ssh' ? 'HIGH' : 'MEDIUM' });
        }
      }
    } catch {}
  }
  return { running, failed };
}

async function collectProjects() {
  const roots = ['/home/digital-auracle/apps', '/var/www', '/opt/server-panel', '/home/digital-auracle/server-panel'];
  const projects = [];
  for (const r of roots) {
    if (!existsSync(r)) continue;
    try {
      const entries = readdirSync(r).map(n => {
        const full = join(r, n);
        try {
          const st = statSync(full);
          if (!st.isDirectory()) return null;
          const pkgPath = join(full, 'package.json');
          let hasPkg = existsSync(pkgPath);
          let pkgName = null;
          if (hasPkg) { try { pkgName = JSON.parse(readFileSync(pkgPath,'utf8')).name; } catch {} }
          const git = existsSync(join(full,'.git'));
          const nodeModules = existsSync(join(full,'node_modules'));
          return { root: r, name: n, path: full, hasPackageJson: hasPkg, pkgName, git, nodeModules, size: st.size, mtime: st.mtime };
        } catch { return null; }
      }).filter(Boolean);
      projects.push(...entries);
    } catch {}
  }
  return projects.slice(0, 100);
}

async function collectLogs() {
  const logs = {};
  const candidates = [
    { key: 'syslog', path: '/var/log/syslog', lines: 80 },
    { key: 'auth', path: '/var/log/auth.log', lines: 60 },
    { key: 'kern', path: '/var/log/kern.log', lines: 40 },
    { key: 'nginx_error', path: '/var/log/nginx/error.log', lines: 60 },
    { key: 'nginx_access', path: '/var/log/nginx/access.log', lines: 20 },
    { key: 'dpkg', path: '/var/log/dpkg.log', lines: 30 },
  ];
  for (const c of candidates) {
    if (!existsSync(c.path)) { logs[c.key] = { exists: false }; continue; }
    try {
      const out = run(`tail -n ${c.lines} ${c.path} 2>&1 | tail -c 4000`, { timeout: 3000 });
      const errors = out.split('\n').filter(l=> /error|fail|crit|alert|emerg|denied|unauthorized/i.test(l)).slice(-8).join('\n').slice(0, 1200);
      logs[c.key] = { exists: true, tail: out.slice(0, 2000), errors: errors || null };
    } catch (e) { logs[c.key] = { exists: true, error: e.message }; }
  }
  // journal errors last hour
  try {
    const j = run(`journalctl --no-pager -p err --since "1 hour ago" --no-hostname 2>&1 | tail -n 40 | head -c 4000`, { timeout: 4000 });
    logs.journal_err_1h = j.trim() ? j.slice(0, 3000) : null;
  } catch { logs.journal_err_1h = null; }
  return logs;
}

async function collectNginx() {
  try {
    const avail = existsSync('/etc/nginx/sites-available') ? readdirSync('/etc/nginx/sites-available').filter(f=>!f.startsWith('.')) : [];
    let enabled = [];
    try { enabled = readdirSync('/etc/nginx/sites-enabled'); } catch {}
    const test = run('nginx -t 2>&1; echo EXIT:$?', { timeout: 4000 }).trim();
    const valid = test.includes('successful') || test.includes('test is successful');
    const reloadNeeded = test.includes('emerg') || test.includes('failed');
    return { available: avail, enabled, count: avail.length, test: test.slice(0, 1200), valid, reloadNeeded };
  } catch (e) { return { error: e.message }; }
}

async function collectUpdates() {
  try {
    const raw = run('apt list --upgradable 2>&1 | head -n 300', { timeout: 8000 });
    const pkgs = parseAptUpdates(raw);
    const security = pkgs.filter(p=>p.isSecurity).length;
    const reboot = existsSync('/var/run/reboot-required');
    let rebootPkgs = '';
    if (reboot) try { rebootPkgs = readFileSync('/var/run/reboot-required.pkgs','utf8').slice(0,800); } catch {}
    return { total: pkgs.length, security, regular: pkgs.length - security, pkgs: pkgs.slice(0, 30), rebootRequired: reboot, rebootPkgs, raw: raw.slice(0, 2000) };
  } catch (e) { return { total: 0, error: e.message }; }
}

function analyzeBottlenecks(ctx, pm2, docker, systemd, logs, updates, nginx) {
  const bottlenecks = [];
  // RAM
  if (ctx.system?.memory) {
    const pct = ctx.system.memory.pct;
    bottlenecks.push({ resource: 'RAM', value: `${pct}% (${Math.round(ctx.system.memory.used/1024/1024)} MB / ${Math.round(ctx.system.memory.total/1024/1024)} MB)`, severity: sevFor(pct, { critical: 95, high: 85, medium: 70 }) });
  }
  if (ctx.system?.cpu) {
    const load = ctx.system.cpu.load;
    bottlenecks.push({ resource: 'CPU', value: `${load}% load`, severity: sevFor(load, { critical: 90, high: 75, medium: 60 }) });
  }
  if (ctx.system?.disk) {
    for (const d of ctx.system.disk) {
      bottlenecks.push({ resource: `Disk ${d.mount}`, value: `${d.use}%`, severity: sevFor(d.use, { critical: 95, high: 85, medium: 75 }) });
    }
  }
  // PM2 restarts
  for (const a of (pm2.apps||[])) {
    if ((a.restarts||0) > 20) bottlenecks.push({ resource: `PM2 ${a.name}`, value: `${a.restarts} restarts`, severity: 'MEDIUM' });
    const memMb = (a.memory||0)/1024/1024;
    if (memMb > 600) bottlenecks.push({ resource: `PM2 ${a.name}`, value: `${Math.round(memMb)} MB`, severity: memMb>900 ? 'HIGH' : 'MEDIUM' });
  }
  // Docker high mem
  for (const iss of (docker.issues||[])) {
    bottlenecks.push({ resource: `Docker ${iss.container}`, value: iss.issue, severity: iss.severity });
  }
  // Failed services
  for (const f of (systemd.failed||[])) {
    bottlenecks.push({ resource: `Service ${f.name}`, value: f.state, severity: f.severity || 'MEDIUM' });
  }
  if (updates.rebootRequired) bottlenecks.push({ resource: 'Reboot', value: 'required', severity: 'MEDIUM' });
  if (nginx && nginx.valid === false) bottlenecks.push({ resource: 'Nginx', value: 'config invalid', severity: 'HIGH' });
  // log errors
  if (logs.journal_err_1h) bottlenecks.push({ resource: 'Journal', value: `${logs.journal_err_1h.split('\n').filter(Boolean).length} err in 1h`, severity: 'MEDIUM' });
  return bottlenecks;
}

function buildMarkdownReport({ ctx, pm2, docker, systemd, logs, updates, nginx, projects, bottlenecks, generatedAt }) {
  const hostname = ctx.system?.hostname || 'unknown';
  const uptime = ctx.system?.uptime || 'n/a';
  const load = ctx.system?.cpu ? `${ctx.system.cpu.load}% / ${ctx.system.cpu.cpus||'?'} CPUs` : 'n/a';
  const ramPct = ctx.system?.memory?.pct ?? '?';
  const ramUsed = ctx.system?.memory ? `${Math.round(ctx.system.memory.used/1024/1024)} MB / ${Math.round(ctx.system.memory.total/1024/1024)} MB` : 'n/a';
  const diskPct = ctx.system?.disk?.[0] ? `${ctx.system.disk[0].use}%` : 'n/a';

  // Overall status
  const hasCritical = bottlenecks.some(b=>b.severity==='CRITICAL');
  const hasHigh = bottlenecks.some(b=>b.severity==='HIGH');
  const overall = hasCritical ? '🔴 CRITICAL' : hasHigh ? '⚠️ DEGRADED' : bottlenecks.some(b=>b.severity==='MEDIUM') ? '⚠️ DEGRADED' : '✅ HEALTHY';

  let md = `# Infrastructure Audit Report\n\n`;
  md += `**Host:** \`${hostname}\`  **Uptime:** ${uptime}  **Load:** ${load}  **RAM:** ${ramPct}% (${ramUsed})  **Disk:** ${diskPct}\n\n`;
  md += `**Generated:** ${new Date(generatedAt).toLocaleString()}  **Mode:** deep continuous (every ${Math.round(AUDIT_INTERVAL_MS/60000)}m)\n\n`;
  md += `## System Status\n\n**Overall:** ${overall}\n\n`;
  md += `| Resource | Status | Severity |\n|---|---|---|\n`;
  for (const b of bottlenecks.slice(0, 12)) {
    md += `| ${b.resource} | ${b.value} | ${b.severity} |\n`;
  }
  if (bottlenecks.length === 0) md += `| All | Normal | LOW |\n`;
  md += `\n`;

  // PM2
  md += `## PM2 Analysis\n\n`;
  if ((pm2.apps||[]).length) {
    md += `| App | Status | Memory | CPU | Restarts | Uptime | Notes |\n|---|---|---|---|---|---|---|\n`;
    for (const a of pm2.apps) {
      const mem = a.memory ? `${Math.round(a.memory/1024/1024)} MB` : '-';
      const cpu = a.cpu != null ? `${a.cpu}%` : '-';
      const rest = a.restarts ?? '-';
      const up = a.uptime ? `${Math.round((Date.now() - a.uptime)/1000/60)}m` : '-';
      const notes = (a.restarts||0)>20 ? '**high restarts**' : (a.memory||0)>600*1024*1024 ? '**high mem**' : '';
      md += `| ${a.name} | ${a.status} | ${mem} | ${cpu} | ${rest} | ${up} | ${notes} |\n`;
    }
    md += `\n`;
    if (pm2.logChecks?.length) {
      md += `### PM2 Issues\n\n`;
      for (const lc of pm2.logChecks) {
        md += `**${lc.app}** — log snippet suggests errors (see tail). Severity: MEDIUM — check \`pm2 logs ${lc.app}\`.\n\n`;
      }
    }
  } else md += `No PM2 apps.\n\n`;

  // Docker
  md += `## Docker Containers\n\n`;
  if ((docker.containers||[]).length) {
    md += `| Container | Status | Memory | CPU | Health |\n|---|---|---|---|---|\n`;
    for (const c of docker.containers.slice(0, 20)) {
      const st = docker.stats.find(s=>s.name===c.name);
      md += `| ${c.name} | ${c.state} | ${st?.memUsage||'-'} | ${st?.cpu||'-'} | ${c.status||'-'} |\n`;
    }
    md += `\n`;
    if (docker.issues?.length) {
      md += `### Docker Issues\n\n`;
      for (const iss of docker.issues) md += `- **${iss.container}**: ${iss.issue} — ${iss.severity}\n`;
      md += `\n`;
    }
  } else md += `No containers.\n\n`;

  // Systemd
  md += `## Systemd\n\n`;
  md += `### Running Services\n\n| Service | Status |\n|---|---|\n`;
  for (const s of (systemd.running||[]).slice(0, 12)) md += `| ${s.name} | ${s.status} |\n`;
  md += `\n`;
  if ((systemd.failed||[]).length) {
    md += `### Failed Services\n\n| Service | Issue | Severity |\n|---|---|---|\n`;
    for (const f of systemd.failed) md += `| ${f.name} | ${f.state} | ${f.severity||'MEDIUM'} |\n`;
    md += `\n`;
  } else md += `No failed key services.\n\n`;

  // Projects
  md += `## Projects (${projects.length})\n\n`;
  if (projects.length) {
    md += `| Project | Root | Git | package.json |\n|---|---|---|---|\n`;
    for (const p of projects.slice(0, 20)) md += `| ${p.name} | ${p.root} | ${p.git?'yes':'no'} | ${p.hasPackageJson?(p.pkgName||'yes'):'no'} |\n`;
    md += `\n`;
  }

  // Nginx
  md += `## Nginx\n\n`;
  md += `- Sites: ${nginx.count||0} available, ${nginx.enabled?.length||0} enabled — ${nginx.valid ? 'config valid ✅' : 'config **invalid** ❌'}\n`;
  if (nginx.test) md += `- Test: \`${nginx.test.split('\n')[0].slice(0,120)}\`\n`;
  md += `\n`;

  // Updates
  md += `## Updates\n\n`;
  md += `- Total: **${updates.total}** — security **${updates.security}**, regular ${updates.regular}\n`;
  if (updates.rebootRequired) md += `- **Reboot required** — \`${updates.rebootPkgs?.split('\n')[0]?.slice(0,80)||''}\`\n`;
  if ((updates.pkgs||[]).length) {
    md += `\n| Package | Pocket | Version | Security |\n|---|---|---|---|\n`;
    for (const pkg of updates.pkgs.slice(0, 10)) md += `| ${pkg.name} | ${pkg.pocket} | ${pkg.version} | ${pkg.isSecurity?'yes':''} |\n`;
    md += `\n`;
  }

  // Logs
  md += `## Log Analysis (last hour)\n\n`;
  if (logs.journal_err_1h) md += `- Journal errors (1h, p err): \n\`\`\`\n${logs.journal_err_1h.slice(0, 1200)}\n\`\`\`\n\n`;
  for (const k of ['nginx_error','auth','syslog']) {
    if (logs[k]?.errors) md += `- ${k}: \`\`\`\n${logs[k].errors.slice(0, 600)}\n\`\`\`\n`;
  }
  if (!logs.journal_err_1h && !logs.nginx_error?.errors) md += `- No critical errors in last hour — INFO/NOISE only.\n\n`;

  // Bottlenecks summary
  md += `## System Bottlenecks\n\n| Resource | Status | Severity |\n|---|---|---|\n`;
  for (const b of bottlenecks.slice(0, 15)) md += `| ${b.resource} | ${b.value} | ${b.severity} |\n`;
  md += `\n`;

  // Recommendations
  md += `## Follow-up Suggestions\n\n`;
  const recs = [];
  if ((updates.security||0) > 0) recs.push(`1. **Apply ${updates.security} security updates** — \`apt upgrade\` for ${updates.pkgs.filter(p=>p.isSecurity).slice(0,3).map(p=>p.name).join(', ')} — check reboot.`);
  if ((systemd.failed||[]).length) recs.push(`2. **Fix ${systemd.failed.length} failed service(s)** — ${systemd.failed.slice(0,2).map(s=>s.name).join(', ')} — journalctl + restart.`);
  if ((pm2.apps||[]).some(a=>(a.restarts||0)>20)) recs.push(`3. **Investigate PM2 restarts** — high restarts suggest crash loop — tail \`pm2 logs\`.`);
  if (bottlenecks.some(b=>b.resource.includes('RAM') && ['HIGH','CRITICAL'].includes(b.severity))) recs.push(`4. **Investigate RAM** — top consumers: PM2/Docker — consider restart or limit.`);
  if (recs.length===0) recs.push(`1. **No action required** — system healthy. Next deep check in ${Math.round(AUDIT_INTERVAL_MS/60000)}m.`);
  md += recs.join('\n') + `\n\n`;

  md += `## Aurex Assessment\n\n`;
  md += `> Overall: **${overall.replace('⚠️ ','').replace('🔴 ','').replace('✅ ','')}** — ${bottlenecks.filter(b=>['HIGH','CRITICAL'].includes(b.severity)).length} high/critical, ${bottlenecks.filter(b=>b.severity==='MEDIUM').length} medium. ${updates.rebootRequired ? 'Reboot pending. ' : ''}${(systemd.failed||[]).length ? `${systemd.failed.length} service(s) need attention. ` : ''}Next deep audit in ${Math.round(AUDIT_INTERVAL_MS/60000)}m.\n\n`;
  md += `## Next Actions\n\n`;
  recs.forEach((r,i)=> md += `${i+1}. ${r.replace(/^\d+\.\s*\*\*/,'**')}\n`);
  md += `\n`;

  return md;
}

export async function runDeepAudit() {
  if (running) return latestReport;
  running = true;
  const started = Date.now();
  try {
    const ctx = await buildServerContext();
    const [pm2, docker, systemd, projects, logs, nginx, updates] = await Promise.all([
      collectPM2(),
      collectDocker(),
      collectSystemd(),
      collectProjects(),
      collectLogs(),
      collectNginx(),
      collectUpdates(),
    ]);
    const bottlenecks = analyzeBottlenecks(ctx, pm2, docker, systemd, logs, updates, nginx);
    const generatedAt = new Date().toISOString();
    const markdown = buildMarkdownReport({ ctx, pm2, docker, systemd, logs, updates, nginx, projects, bottlenecks, generatedAt });

    const report = {
      id: `audit-${Date.now().toString(36)}`,
      generatedAt,
      durationMs: Date.now() - started,
      intervalMs: AUDIT_INTERVAL_MS,
      overall: bottlenecks.some(b=>b.severity==='CRITICAL') ? 'CRITICAL' : bottlenecks.some(b=>['HIGH','MEDIUM'].includes(b.severity)) ? 'DEGRADED' : 'HEALTHY',
      bottlenecks,
      counts: { pm2: pm2.apps?.length||0, docker: docker.containers?.length||0, projects: projects.length, failedServices: systemd.failed?.length||0, updates: updates.total||0, securityUpdates: updates.security||0 },
      ctx,
      pm2,
      docker,
      systemd,
      projects,
      logs,
      nginx,
      updates,
      markdown,
    };

    latestReport = report;
    history.unshift({ id: report.id, generatedAt, overall: report.overall, durationMs: report.durationMs, counts: report.counts, markdown: report.markdown.slice(0, 8000) });
    if (history.length > MAX_HISTORY) history = history.slice(0, MAX_HISTORY);

    // persist
    try {
      if (!existsSync(AUDIT_DATA_DIR)) mkdirSync(AUDIT_DATA_DIR, { recursive: true });
      writeFileSync(AUDIT_FILE, JSON.stringify(report, null, 2));
      writeFileSync(AUDIT_HISTORY_FILE, JSON.stringify(history, null, 2));
    } catch {}

    // also log via winston
    logger.info('deep audit completed', { id: report.id, overall: report.overall, durationMs: report.durationMs, counts: report.counts });

    // emit metrics if needed (could add gauge)
    return report;
  } catch (e) {
    logger.error('deep audit failed', { error: e.message });
    throw e;
  } finally { running = false; }
}

export function getLatestReport() { return latestReport; }
export function getHistory() { return history; }

export function loadFromDisk() {
  try {
    if (existsSync(AUDIT_FILE)) latestReport = JSON.parse(readFileSync(AUDIT_FILE,'utf8'));
    if (existsSync(AUDIT_HISTORY_FILE)) history = JSON.parse(readFileSync(AUDIT_HISTORY_FILE,'utf8'));
  } catch {}
}

export function startAuditLoop() {
  loadFromDisk();
  // first run soon
  setTimeout(() => { runDeepAudit().catch(()=>{}); }, 15000);
  if (timer) clearInterval(timer);
  timer = setInterval(() => { runDeepAudit().catch(e=>logger.error('audit interval failed', { error: e.message })); }, AUDIT_INTERVAL_MS);
  if (timer.unref) timer.unref();
  logger.info(`deep audit loop started — every ${Math.round(AUDIT_INTERVAL_MS/60000)}m, host everywhere (services/projects/logs/nginx/updates)`);
  return timer;
}

export function stopAuditLoop() { if (timer) clearInterval(timer); timer=null; }
