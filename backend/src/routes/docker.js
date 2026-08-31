import { Router } from 'express';
import { run, isSafeName } from '../lib/exec.js';
import { schemas, validateBody } from '../lib/validate.js';
import { requireRole } from '../lib/auth.js';
import { existsSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { COMPOSE_DIR } from '../lib/config.js';

const router = Router();

function dockerList(cmd, format) {
  const out = run(`docker ${cmd} ${format} 2>&1`, {});
  return out.trim().split('\n').filter(Boolean);
}

// List containers
router.get('/containers', (req, res) => {
  try {
    const out = run(`docker ps -a --format "{{json .}}" 2>&1`, {});
    const containers = out.trim().split('\n').filter(Boolean).map(line => {
      try {
        const c = JSON.parse(line);
        return {
          id: c.ID,
          name: c.Names,
          image: c.Image,
          status: c.Status,
          ports: c.Ports,
          state: c.State,
          createdAt: c.CreatedAt,
        };
      } catch {
        return null;
      }
    }).filter(Boolean);
    res.json(containers);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create a new container
router.post('/containers', requireRole('admin','operator'), validateBody(schemas.createContainer), (req, res) => {
  const { name, image, port, internalPort, env, restart = 'unless-stopped', network, volumes, extraArgs } = req.body;
  if (!isSafeName(name)) return res.status(400).json({ error: 'Invalid container name' });
  if (!image) return res.status(400).json({ error: 'Image is required' });
  try {
    let args = [
      'run',
      '-d',
      `--name ${name}`,
      `--restart ${restart}`,
    ];

    if (port && internalPort) {
      args.push(`-p ${port}:${internalPort}`);
    } else if (port && !internalPort) {
      args.push(`-p ${port}`);
    }

    if (network) args.push(`--network ${network}`);
    if (Array.isArray(volumes) && volumes.length) {
      volumes.forEach(v => args.push(`-v ${v}`));
    }
    if (Array.isArray(env) && env.length) {
      env.forEach(e => args.push(`-e ${e}`));
    }
    if (extraArgs) args.push(extraArgs);
    args.push(image);

    const out = run(`docker ${args.join(' ')} 2>&1`, {});
    req.audit?.('docker.create', `docker/${name}`, { image });
    res.json({ success: true, output: out.trim(), name });
  } catch (err) {
    req.audit?.('docker.create', `docker/${req.body?.name}`, { error: err.message }, 'failure');
    res.status(500).json({ error: err.message });
  }
});

// Create container from a compose file
router.post('/compose/deploy', requireRole('admin','operator'), validateBody(schemas.composeDeploy), (req, res) => {
  const { name, compose } = req.body;
  if (!isSafeName(name)) return res.status(400).json({ error: 'Invalid project name' });
  if (!compose) return res.status(400).json({ error: 'Compose file content is required' });
  try {
    const dir = join(COMPOSE_DIR, name);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'docker-compose.yml'), compose, 'utf-8');

    const out = run(`cd ${dir} && docker compose up -d 2>&1`, { timeout: 60000, sudo: true });
    res.json({ success: true, output: out.trim(), name });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Pull an image
router.post('/images/pull', requireRole('admin','operator'), (req, res) => {
  const { image } = req.body;
  if (!image) return res.status(400).json({ error: 'Image is required' });
  try {
    const out = run(`docker pull ${image} 2>&1`, { timeout: 120000 });
    res.json({ success: true, output: out.trim() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete an image
router.delete('/images/:id', requireRole('admin'), (req, res) => {
  try {
    const out = run(`docker rmi ${req.params.id} 2>&1`, {});
    res.json({ success: true, output: out.trim() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// List images
router.get('/images', (req, res) => {
  try {
    const out = run(`docker images --format "{{.ID}}|{{.Repository}}|{{.Tag}}|{{.Size}}|{{.CreatedAt}}" 2>&1`, {});
    const images = out.trim().split('\n').filter(Boolean).map(line => {
      const [id, repo, tag, size, created] = line.split('|');
      return { id, repo, tag, size, created };
    });
    res.json(images);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Networks
router.get('/networks', (req, res) => {
  try {
    const out = run('docker network ls --format "{{.ID}}|{{.Name}}|{{.Driver}}|{{.Scope}}|{{.Internal}}" 2>&1', {});
    const networks = out.trim().split('\n').filter(Boolean).map(line => {
      const [id, name, driver, scope, internal] = line.split('|');
      return { id, name, driver, scope, internal: internal === 'true' };
    });
    res.json(networks);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/networks', requireRole('admin','operator'), (req, res) => {
  const { name, driver = 'bridge', subnet } = req.body;
  if (!isSafeName(name)) return res.status(400).json({ error: 'Invalid network name' });
  try {
    const args = ['network', 'create', `--driver ${driver}`];
    if (subnet) args.push(`--subnet ${subnet}`);
    args.push(name);
    const out = run(`docker ${args.join(' ')} 2>&1`, {});
    res.json({ success: true, output: out.trim(), name });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Volumes
router.get('/volumes', (req, res) => {
  try {
    const out = run('docker volume ls --format "{{.Name}}|{{.Driver}}" 2>&1', {});
    const volumes = out.trim().split('\n').filter(Boolean).map(line => {
      const [name, driver] = line.split('|');
      return { name, driver };
    });
    res.json(volumes);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Container actions
router.post('/containers/:id/:action', requireRole('admin','operator'), (req, res) => {
  const { id, action } = req.params;
  const valid = ['start', 'stop', 'restart', 'pause', 'unpause', 'kill'];
  if (!valid.includes(action)) return res.status(400).json({ error: 'Invalid action' });
  try {
    const out = run(`docker ${action} ${id} 2>&1`, {});
    res.json({ success: true, output: out.trim() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete container
router.delete('/containers/:id', requireRole('admin'), (req, res) => {
  const force = req.query.force === 'true';
  try {
    const out = run(`docker rm ${force ? '-f ' : ''}${req.params.id} 2>&1`, {});
    res.json({ success: true, output: out.trim() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Container logs
router.get('/containers/:id/logs', (req, res) => {
  const lines = req.query.lines || 100;
  try {
    const out = run(`docker logs --tail ${lines} ${req.params.id} 2>&1`, {});
    res.json({ logs: out });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Container inspect
router.get('/containers/:id/inspect', (req, res) => {
  try {
    const out = run(`docker inspect ${req.params.id} 2>&1`, {});
    res.json({ inspect: JSON.parse(out) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Docker info / stats
router.get('/info', (req, res) => {
  try {
    const raw = JSON.parse(run('docker info --format "{{json .}}" 2>&1', {}));
    res.json({
      name: raw.Name,
      version: raw.ServerVersion,
      containers: raw.Containers,
      running: raw.ContainersRunning,
      paused: raw.ContainersPaused,
      stopped: raw.ContainersStopped,
      images: raw.Images,
      memory: raw.MemTotal,
      cpus: raw.NCPU,
      storageDriver: raw.Driver,
      os: raw.OperatingSystem,
      kernel: raw.KernelVersion,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Live stats (streaming CPU/mem per container)
router.get('/stats', (req, res) => {
  try {
    const out = run('docker stats --no-stream --format "{{.Name}}|{{.CPUPerc}}|{{.MemUsage}}|{{.MemPerc}}|{{.NetIO}}" 2>&1', {});
    const stats = out.trim().split('\n').filter(Boolean).map(line => {
      const [name, cpu, memUsage, memPerc, net] = line.split('|');
      return { name, cpu, memUsage, memPerc, net };
    });
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
