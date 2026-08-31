import { Router } from 'express';
import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { run, isSafeName } from '../lib/exec.js';
import { NGINX_AVAILABLE as CFG_AVAILABLE, NGINX_ENABLED as CFG_ENABLED, NGINX_DEFAULT_ROOT } from '../lib/config.js';
import { schemas, validateBody } from '../lib/validate.js';
import { requireRole } from '../lib/auth.js';

const router = Router();

const NGINX_AVAILABLE = CFG_AVAILABLE;
const NGINX_ENABLED = CFG_ENABLED;
const DEFAULT_ROOT = NGINX_DEFAULT_ROOT;

function nginxConf(name) {
  return `${NGINX_AVAILABLE}/${name}`;
}

function siteExists(name) {
  return existsSync(nginxConf(name));
}

// List all sites (both enabled and available)
router.get('/sites', (req, res) => {
  try {
    const available = readdirSync(NGINX_AVAILABLE).filter(f => f.endsWith('.conf') || !f.startsWith('.'));
    let enabled = [];
    try { enabled = readdirSync(NGINX_ENABLED); } catch {}

    const sites = available.map(name => {
      const confPath = join(NGINX_AVAILABLE, name);
      let config = '';
      try { config = readFileSync(confPath, 'utf-8'); } catch {}
      const serverNames = [...config.matchAll(/server_name\s+([^;]+);/g)].map(m => m[1].trim());
      const roots = [...config.matchAll(/root\s+([^;]+);/g)].map(m => m[1].trim());
      const hasSsl = config.includes('listen 443') || config.includes('ssl_certificate');
      const hasPhp = config.includes('fastcgi_pass');
      const isEnabled = enabled.includes(name) || enabled.includes(`${name}.conf`);
      return {
        name,
        serverNames,
        defaultServer: serverNames[0] || name,
        roots,
        root: roots[0] || '',
        hasSsl,
        hasPhp,
        enabled: isEnabled,
        size: config.length,
      };
    });
    res.json(sites);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get config for a specific site
router.get('/config/:name', (req, res) => {
  try {
    const confPath = nginxConf(req.params.name);
    if (!existsSync(confPath)) {
      const enabledPath = join(NGINX_ENABLED, req.params.name);
      if (existsSync(enabledPath)) {
        return res.sendFile(enabledPath);
      }
      return res.status(404).json({ error: 'Site not found' });
    }
    res.sendFile(confPath);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function buildNginxConfig({ serverName, root, php, hsts, proxy_pass }) {
  const esc = s => String(s || '').replace(/[^a-zA-Z0-9._\-\/]/g, '');
  const lines = [];
  lines.push('# ServerPanel managed - DO NOT EDIT manually');
  lines.push(`server {`);
  lines.push(`    listen 80;`);
  lines.push(`    listen [::]:80;`);
  lines.push(`    server_name ${esc(serverName)};`);
  lines.push(`    root ${esc(root)};`);
  lines.push(`    index index.php index.html index.htm;`);
  lines.push(``);
  lines.push(`    # Error pages`);
  lines.push(`    error_page 404 /404.html;`);
  lines.push(`    error_page 500 502 503 504 /50x.html;`);
  lines.push(``);
  lines.push(`    location / {`);
  if (proxy_pass && !php) {
    lines.push(`        proxy_pass ${esc(proxy_pass)};`);
    lines.push(`        proxy_set_header Host $host;`);
    lines.push(`        proxy_set_header X-Real-IP $remote_addr;`);
    lines.push(`        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`);
    lines.push(`        proxy_set_header X-Forwarded-Proto $scheme;`);
  } else {
    lines.push(`        try_files $uri $uri/ /index.php?$query_string;`);
  }
  lines.push(`    }`);
  if (php) {
    lines.push(``);
    lines.push(`    # PHP-FPM`);
    lines.push(`    location ~ \\.php$ {`);
    lines.push(`        include snippets/fastcgi-php.conf;`);
    lines.push(`        fastcgi_pass unix:/var/run/php/php8.3-fpm.sock;`);
    lines.push(`    }`);
  }
  if (hsts) {
    lines.push(``);
    lines.push(`    add_header Strict-Transport-Security "max-age=31536000" always;`);
  }
  lines.push(`}`);
  return lines.join('\n');
}

// Create a new site
router.post('/sites', requireRole('admin'), validateBody(schemas.createSite), (req, res) => {
  const { name, serverName, root, php, hsts, proxy_pass } = req.validated;

  try {
    if (siteExists(name)) return res.status(409).json({ error: `Site '${name}' already exists` });

    const siteRoot = root || join(DEFAULT_ROOT, name);
    const config = buildNginxConfig({ serverName, root: siteRoot, php, hsts, proxy_pass });

    // Create the web root (as current user, then chown via sudo)
    run(`mkdir -p ${siteRoot} && chmod 755 ${siteRoot}`, {});
    if (php) {
      run(`printf '%s\\n' '<?php phpinfo();' > ${siteRoot}/index.php && chmod 644 ${siteRoot}/index.php`, {});
    } else {
      run(`printf '%s\\n' '<h1>${name}</h1><p>Site created via ServerPanel.</p>' > ${siteRoot}/index.html && chmod 644 ${siteRoot}/index.html`, {});
    }

    // Write nginx config (needs sudo for /etc/nginx)
    try {
      // Stage config in /tmp (no sudo needed), then sudo cp into place to avoid
      // stdin conflicts between sudo -S password and a heredoc.
      const tmpConf = `/tmp/nginx_${name}.conf`;
      writeFileSync(tmpConf, config, 'utf-8');
      run(`cp ${tmpConf} ${nginxConf(name)} && rm -f ${tmpConf}`, { sudo: true });
    } catch (e) {
      // fallback: try writing directly
      try {
        writeFileSync(nginxConf(name), config, 'utf-8');
      } catch (err) {
        return res.status(500).json({ error: `Failed to write nginx config (needs sudo). ${err.message}` });
      }
    }

    // Enable the site
    try {
      run(`ln -s ${nginxConf(name)} ${NGINX_ENABLED}/${name}`, { sudo: true });
    } catch (e) {
      try {
        run(`ln -s ${nginxConf(name)} ${NGINX_ENABLED}/${name}`, {});
      } catch {}
    }

    req.audit?.('nginx.create', `sites/${name}`, { serverName });
    res.json({ success: true, name, root: siteRoot, serverName, config });
  } catch (err) {
    req.audit?.('nginx.create', `sites/${name}`, { error: err.message }, 'failure');
    res.status(500).json({ error: err.message });
  }
});

// Delete a site
router.delete('/sites/:name', requireRole('admin'), (req, res) => {
  const name = req.params.name;
  try {
    if (!siteExists(name) && !existsSync(join(NGINX_ENABLED, name))) {
      return res.status(404).json({ error: `Site '${name}' not found` });
    }

    // Remove enabled symlink + available config
    try {
      run(`rm -f ${NGINX_ENABLED}/${name}`, { sudo: true });
    } catch (e) {
      try { run(`rm -f ${NGINX_ENABLED}/${name}`, {}); } catch {}
    }
    try {
      run(`rm -f ${nginxConf(name)}`, { sudo: true });
    } catch (e) {
      try { run(`rm -f ${nginxConf(name)}`, {}); } catch {}
    }

    req.audit?.('nginx.delete', `sites/${name}`, {});
    res.json({ success: true, name });
  } catch (err) {
    req.audit?.('nginx.delete', `sites/${name}`, { error: err.message }, 'failure');
    res.status(500).json({ error: err.message });
  }
});

// Enable / disable a site
router.post('/sites/:name/:action', requireRole('admin', 'operator'), (req, res) => {
  const { name, action } = req.params;
  if (!['enable', 'disable'].includes(action)) return res.status(400).json({ error: 'Action must be enable or disable' });
  try {
    if (!siteExists(name) && !existsSync(join(NGINX_ENABLED, name))) {
      return res.status(404).json({ error: `Site '${name}' not found` });
    }
    const cmd = action === 'enable'
      ? `ln -s ${nginxConf(name)} ${NGINX_ENABLED}/${name}`
      : `rm -f ${NGINX_ENABLED}/${name}`;
    try {
      run(cmd, { sudo: true });
    } catch (e) {
      try { run(cmd, {}); } catch (err) {
        return res.status(500).json({ error: `Failed: ${err.message}` });
      }
    }
    req.audit?.(`nginx.${action}`, `sites/${name}`, {});
    res.json({ success: true, name, action });
  } catch (err) {
    req.audit?.(`nginx.${req.params.action}`, `sites/${name}`, { error: err.message }, 'failure');
    res.status(500).json({ error: err.message });
  }
});

// Check nginx status
router.get('/status', (req, res) => {
  try {
    const out = run('nginx -v 2>&1 || true', {});
    const test = run('nginx -t 2>&1; echo "EXIT:$?"', { sudo: true }).trim();
    res.json({ version: out.trim(), test });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Reload nginx
router.post('/reload', requireRole('admin', 'operator'), (req, res) => {
  try {
    const out = run('nginx -s reload 2>&1; echo "EXIT:$?"', { sudo: true }).trim();
    req.audit?.('nginx.reload', 'nginx', { success: out.includes('EXIT:0') });
    res.json({ success: out.includes('EXIT:0'), output: out });
  } catch (err) {
    req.audit?.('nginx.reload', 'nginx', { error: err.message }, 'failure');
    res.status(500).json({ error: err.message });
  }
});

export default router;
