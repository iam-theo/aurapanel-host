import { Router } from 'express';
import si from 'systeminformation';
import { execSync } from 'child_process';

const router = Router();

// Simple TTL cache: slow / mostly-static data should not re-scan every poll
const cache = new Map();
function cached(key, ttlMs, fn) {
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now - hit.t < ttlMs) return hit.v;
  const v = fn();
  cache.set(key, { t: now, v });
  return v;
}

router.get('/overview', async (req, res) => {
  try {
    // cpu/os/networkInterfaces are essentially static -> cache 60s
    const [cpu, mem, disk, os, networkInterfaces, load] = await Promise.all([
      cached('cpu', 60000, () => si.cpu()),
      si.mem(),
      si.fsSize(),
      cached('os', 60000, () => si.osInfo()),
      cached('netif', 60000, () => si.networkInterfaces()),
      si.currentLoad(),
    ]);

    const uptime = cached('uptime', 1000, () => execSync('uptime -p').toString().trim());
    const hostname = cached('hostname', 60000, () => execSync('hostname').toString().trim());

    res.json({
      hostname,
      uptime,
      cpu: {
        manufacturer: cpu.manufacturer,
        brand: cpu.brand,
        speed: cpu.speed,
        cores: cpu.cores,
        physicalCores: cpu.physicalCores,
        usage: Math.round(load.currentLoad * 100) / 100,
      },
      memory: {
        total: mem.total,
        used: mem.used,
        free: mem.free,
        usagePercent: Math.round((mem.used / mem.total) * 10000) / 100,
      },
      disk: disk.map(d => ({
        fs: d.fs,
        mount: d.mount,
        size: d.size,
        used: d.used,
        available: d.available,
        usagePercent: d.use,
      })).filter(d => d.size > 0),
      os: {
        platform: os.platform,
        distro: os.distro,
        release: os.release,
        kernel: os.kernel,
        arch: os.arch,
      },
      network: networkInterfaces
        .filter(n => !n.internal && n.ip4)
        .map(n => ({
          iface: n.iface,
          ip4: n.ip4,
          mac: n.mac,
          speed: n.speed,
        })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/cpu-history', async (req, res) => {
  try {
    // currentLoad is expensive (~550ms); serve cached within 3s since the chart polls every 5s
    const load = await cached('cpu-load', 3000, () => si.currentLoad());
    const cores = load.cpus.map(c => Math.round(c.load * 100) / 100);
    res.json({
      total: Math.round(load.currentLoad * 100) / 100,
      cores,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/network-stats', async (req, res) => {
  try {
    // rx/tx rates only update meaningfully on a slow interval
    const stats = await cached('net-stats', 4000, () => si.networkStats());
    res.json(stats.filter(s => s.iface !== 'lo').map(s => ({
      iface: s.iface,
      rxBytes: s.rx_bytes,
      txBytes: s.tx_bytes,
      rxSec: s.rx_sec,
      txSec: s.tx_sec,
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/processes', async (req, res) => {
  try {
    const procs = await si.processes();
    const top = procs.list
      .sort((a, b) => b.cpu - a.cpu)
      .slice(0, 25)
      .map(p => ({
        pid: p.pid,
        name: p.name,
        cpu: Math.round(p.cpu * 100) / 100,
        mem: Math.round(p.mem * 100) / 100,
        state: p.state,
        user: p.user,
        started: p.started,
        command: p.command?.substring(0, 120),
      }));
    res.json({
      total: procs.all,
      running: procs.running,
      sleeping: procs.sleeping,
      list: top,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
