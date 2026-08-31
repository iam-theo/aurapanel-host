import { Router } from 'express';
import { run, isSafeName } from '../lib/exec.js';
import { schemas, validateBody } from '../lib/validate.js';
import { requireRole } from '../lib/auth.js';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { APPS_DIR, chownCmd } from '../lib/config.js';

const router = Router();

function pm2List() {
  const out = run('pm2 jlist 2>&1', {});
  return JSON.parse(out);
}

// Ensure the apps directory exists
function ensureAppsDir() {
  if (!existsSync(APPS_DIR)) {
    mkdirSync(APPS_DIR, { recursive: true });
    try { run(chownCmd(APPS_DIR), { sudo: true }); } catch {}
  }
}
try { ensureAppsDir(); } catch {}

// List all PM2 processes
router.get('/', (req, res) => {
  try {
    const list = pm2List();
    const processes = list.map(p => ({
      name: p.name,
      pid: p.pid,
      pmId: p.pm_id,
      status: p.pm2_env?.status,
      restarts: p.pm2_env?.restart_time,
      uptime: p.pm2_env?.pm_uptime,
      memory: p.monit?.memory,
      cpu: p.monit?.cpu,
      port: p.pm2_env?.env?.PORT || p.pm2_env?.args?.find(a => a.startsWith('--port='))?.split('=')[1],
      script: p.pm2_env?.pm_exec_path,
      cwd: p.pm2_env?.pm_cwd,
      version: p.pm2_env?.version,
      nodeVersion: p.pm2_env?.node_version,
      statusColor: p.pm2_env?.status,
      logs: {
        out: p.pm2_env?.pm_out_log_path,
        err: p.pm2_env?.pm_err_log_path,
      },
      execMode: p.pm2_env?.exec_mode,
      instances: p.pm2_env?.instances,
    }));
    res.json(processes);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Deploy a new application
router.post('/', requireRole('admin','operator'), (req, res) => {
  const { name, type = 'node', entry, port, gitRepo, branch, env, buildCommand, startCommand, instances = 1 } = req.body;
  if (!isSafeName(name)) return res.status(400).json({ error: 'Invalid app name (alphanumeric, dash, underscore only)' });
  if (/^[0-9]/.test(name)) return res.status(400).json({ error: 'App name cannot start with a number' });
  if (!port || isNaN(port)) return res.status(400).json({ error: 'A valid port is required' });

  try {
    // Check if app exists
    const existing = pm2List().find(p => p.name === name);
    if (existing) return res.status(409).json({ error: `Application '${name}' already exists` });

    const appDir = join(APPS_DIR, name);
    mkdirSync(appDir, { recursive: true });

    // If git repo provided, clone it
    if (gitRepo) {
      run(`git clone --depth 1 ${gitRepo} ${appDir} 2>&1`, {});
      if (branch) {
        run(`cd ${appDir} && git checkout ${branch} 2>&1`, {});
      }
    } else {
      // Create a basic package.json
      const packageJson = {
        name,
        version: '1.0.0',
        private: true,
        main: entry || 'index.js',
        scripts: {
          start: startCommand || `node ${entry || 'index.js'}`,
          ...(buildCommand ? { build: buildCommand } : {}),
        },
        dependencies: {
          express: '^4.21.0',
        },
      };
      writeFileSync(join(appDir, 'package.json'), JSON.stringify(packageJson, null, 2) + '\n', 'utf-8');
      // Create a starter entry file if it doesn't exist yet
      const entryName = entry || 'index.js';
      const entryPath = join(appDir, entryName.split('/').pop());
      if (!existsSync(entryPath)) {
        writeFileSync(entryPath, `const express = require('express');\nconst app = express();\nconst PORT = ${port};\n\napp.get('/', (req, res) => res.send('Hello from ${name}!'));\n\napp.listen(PORT, () => {\n  console.log('${name} listening on port ' + PORT);\n});\n`, 'utf-8');
      }
    }

    // Write ecosystem config
    const ecosystem = {
      apps: [{
        name,
        cwd: appDir,
        script: entry || 'index.js',
        instances,
        exec_mode: 'cluster',
        max_memory_restart: '512M',
        env: {
          PORT: Number(port),
          ...(env || {}),
          NODE_ENV: 'production',
        },
      }],
    };
    const ecPath = join(appDir, 'ecosystem.config.js');
    writeFileSync(ecPath, `module.exports = ${JSON.stringify(ecosystem, null, 2)}\n`, 'utf-8');

    // Install deps if package.json has them
    if (existsSync(join(appDir, 'package.json'))) {
      run(`cd ${appDir} && npm install --production --no-fund --no-audit 2>&1`, { timeout: 60000 });
    }

    // Start via PM2
    const out = run(`pm2 start ${ecPath} 2>&1`, {});
    run('pm2 save 2>&1', {});

    req.audit?.('pm2.deploy', `pm2/${name}`, { port });
    res.json({
      success: true,
      name,
      dir: appDir,
      output: out.trim(),
    });
  } catch (err) {
    req.audit?.('pm2.deploy', `pm2/${req.body?.name}`, { error: err.message }, 'failure');
    res.status(500).json({ error: err.message });
  }
});

// Clone an existing app (duplicate)
router.post('/:name/clone', requireRole('admin','operator'), (req, res) => {
  const { name } = req.params;
  const { newName } = req.body;
  if (!isSafeName(newName)) return res.status(400).json({ error: 'Invalid new name' });
  try {
    const app = pm2List().find(p => p.name === name);
    if (!app) return res.status(404).json({ error: 'App not found' });
    if (pm2List().find(p => p.name === newName)) return res.status(409).json({ error: 'New name already exists' });

    const sourceDir = app.pm2_env?.pm_cwd || join(APPS_DIR, name);
    const destDir = join(APPS_DIR, newName);
    if (existsSync(sourceDir)) {
      run(`cp -r ${sourceDir} ${destDir} 2>&1`, {});
      // Update package.json name
      const pkgPath = join(destDir, 'package.json');
      if (existsSync(pkgPath)) {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
        pkg.name = newName;
        writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
      }
      const ecPath = join(destDir, 'ecosystem.config.js');
      if (existsSync(ecPath)) {
        const ec = readFileSync(ecPath, 'utf-8');
        writeFileSync(ecPath, ec.replace(new RegExp(`name: '${name}'`, 'g'), `name: '${newName}'`).replace(new RegExp(name, 'g'), newName));
      }
      const out = run(`cd ${destDir} && pm2 start ecosystem.config.js 2>&1; pm2 save 2>&1`, {});
      res.json({ success: true, name: newName, output: out.trim() });
    } else {
      res.status(400).json({ error: 'Source app has no directory to clone' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:name/start', requireRole('admin','operator'), (req, res) => {
  const output = run(`pm2 start ${req.params.name} 2>&1`, {});
  req.audit?.('pm2.start', `pm2/${req.params.name}`, {});
  res.json({ success: true, output });
});

router.post('/:name/stop', requireRole('admin','operator'), (req, res) => {
  const output = run(`pm2 stop ${req.params.name} 2>&1`, {});
  req.audit?.('pm2.stop', `pm2/${req.params.name}`, {});
  res.json({ success: true, output });
});

router.post('/:name/restart', requireRole('admin','operator'), (req, res) => {
  const output = run(`pm2 restart ${req.params.name} --update-env 2>&1`, {});
  req.audit?.('pm2.restart', `pm2/${req.params.name}`, {});
  res.json({ success: true, output });
});

router.post('/:name/delete', requireRole('admin'), (req, res) => {
  try {
    // Get app dir before deleting
    const app = pm2List().find(p => p.name === req.params.name);
    const appDir = app?.pm2_env?.pm_cwd || join(APPS_DIR, req.params.name);

    const output = run(`pm2 delete ${req.params.name} 2>&1 && pm2 save 2>&1`, {});

    // Optionally remove the directory
    const removeDir = req.query.removeDir !== 'false';
    if (removeDir && existsSync(appDir) && appDir.startsWith(APPS_DIR)) {
      run(`rm -rf ${appDir} 2>&1`, {});
    }

    res.json({ success: true, output, removedDir: removeDir && appDir.startsWith(APPS_DIR) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Deploy git update (pull)
router.post('/:name/deploy', requireRole('admin','operator'), (req, res) => {
  const { name } = req.params;
  try {
    const app = pm2List().find(p => p.name === name);
    const appDir = app?.pm2_env?.pm_cwd || join(APPS_DIR, name);
    const out = run(`cd ${appDir} && git pull 2>&1 && npm install --production --no-fund --no-audit 2>&1 && pm2 restart ${name} --update-env 2>&1`, {});
    res.json({ success: true, output: out.trim() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:name/logs', (req, res) => {
  const lines = req.query.lines || 100;
  try {
    const output = run(`pm2 logs ${req.params.name} --nostream --lines ${lines} --no-color 2>&1`, {});
    res.json({ logs: output });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/summary', (req, res) => {
  try {
    const list = pm2List();
    const online = list.filter(p => p.pm2_env?.status === 'online').length;
    const stopped = list.filter(p => p.pm2_env?.status === 'stopped').length;
    const totalMem = list.reduce((acc, p) => acc + (p.monit?.memory || 0), 0);
    res.json({ total: list.length, online, stopped, totalMemory: totalMem });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
