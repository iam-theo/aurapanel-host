import { Router } from 'express';
import { execSync } from 'child_process';
import { requireRole } from '../lib/auth.js';

const router = Router();

function run(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf-8', timeout: 10000 });
  } catch (err) {
    return err.stdout || err.message;
  }
}

const KEY_SERVICES = [
  { name: 'nginx', label: 'Nginx Web Server', group: 'web' },
  { name: 'php8.3-fpm', label: 'PHP 8.3 FPM', group: 'web' },
  { name: 'php8.4-fpm', label: 'PHP 8.4 FPM', group: 'web' },
  { name: 'postgresql@14-main', label: 'PostgreSQL 14', group: 'database' },
  { name: 'postgresql@17-main', label: 'PostgreSQL 17', group: 'database' },
  { name: 'redis-server', label: 'Redis', group: 'database' },
  { name: 'memcached', label: 'Memcached', group: 'database' },
  { name: 'rabbitmq-server', label: 'RabbitMQ', group: 'database' },
  { name: 'docker', label: 'Docker', group: 'containers' },
  { name: 'pm2-digital-auracle', label: 'PM2', group: 'application' },
  { name: 'ollama', label: 'Ollama AI', group: 'application' },
  { name: 'cloudflared', label: 'Cloudflare Tunnel', group: 'network' },
  { name: 'tailscaled', label: 'Tailscale VPN', group: 'network' },
  { name: 'ssh', label: 'SSH Server', group: 'network' },
  { name: 'xrdp', label: 'XRDP Remote Desktop', group: 'remote' },
  { name: 'mosquitto', label: 'Mosquitto MQTT', group: 'iot' },
];

router.get('/', (req, res) => {
  try {
    const services = KEY_SERVICES.map(svc => {
      const rawName = svc.name.split('@')[0];
      const output = run(`systemctl is-active ${rawName} 2>&1`).trim();
      const enabled = run(`systemctl is-enabled ${rawName} 2>&1`).trim();
      return {
        ...svc,
        active: output === 'active',
        status: output,
        enabled: enabled === 'enabled',
      };
    });
    res.json(services);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:name/start', requireRole('admin', 'operator'), (req, res) => {
  try {
    const output = run(`sudo systemctl start ${req.params.name} 2>&1`);
    req.audit?.('service.start', req.params.name, {});
    res.json({ success: true, output });
  } catch (err) {
    req.audit?.('service.start', req.params.name, { error: err.message }, 'failure');
    res.status(500).json({ error: err.message });
  }
});

router.post('/:name/stop', requireRole('admin', 'operator'), (req, res) => {
  try {
    const output = run(`sudo systemctl stop ${req.params.name} 2>&1`);
    req.audit?.('service.stop', req.params.name, {});
    res.json({ success: true, output });
  } catch (err) {
    req.audit?.('service.stop', req.params.name, { error: err.message }, 'failure');
    res.status(500).json({ error: err.message });
  }
});

router.post('/:name/restart', requireRole('admin', 'operator'), (req, res) => {
  try {
    const output = run(`sudo systemctl restart ${req.params.name} 2>&1`);
    req.audit?.('service.restart', req.params.name, {});
    res.json({ success: true, output });
  } catch (err) {
    req.audit?.('service.restart', req.params.name, { error: err.message }, 'failure');
    res.status(500).json({ error: err.message });
  }
});

router.post('/:name/enable', requireRole('admin'), (req, res) => {
  try {
    const output = run(`sudo systemctl enable ${req.params.name} 2>&1`);
    req.audit?.('service.enable', req.params.name, {});
    res.json({ success: true, output });
  } catch (err) {
    req.audit?.('service.enable', req.params.name, { error: err.message }, 'failure');
    res.status(500).json({ error: err.message });
  }
});

router.post('/:name/disable', requireRole('admin'), (req, res) => {
  try {
    const output = run(`sudo systemctl disable ${req.params.name} 2>&1`);
    req.audit?.('service.disable', req.params.name, {});
    res.json({ success: true, output });
  } catch (err) {
    req.audit?.('service.disable', req.params.name, { error: err.message }, 'failure');
    res.status(500).json({ error: err.message });
  }
});

router.get('/:name/status', (req, res) => {
  try {
    const output = run(`systemctl status ${req.params.name} --no-pager 2>&1`);
    res.json({ status: output });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
