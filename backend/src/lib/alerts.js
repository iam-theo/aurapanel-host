import si from 'systeminformation';
import { logger } from './logger.js';

const THRESHOLDS = {
  cpu: parseInt(process.env.ALERT_CPU_PCT || '85', 10),
  mem: parseInt(process.env.ALERT_MEM_PCT || '90', 10),
  disk: parseInt(process.env.ALERT_DISK_PCT || '90', 10),
};

let lastAlert = { cpu: 0, mem: 0, disk: 0 };
const COOLDOWN_MS = 15 * 60 * 1000; // 15min between same alert

async function checkOnce() {
  try {
    const [load, mem, disks] = await Promise.all([si.currentLoad(), si.mem(), si.fsSize()]);
    const cpuPct = Math.round(load.currentLoad);
    const memPct = Math.round((mem.used / mem.total) * 100);
    const now = Date.now();

    if (cpuPct >= THRESHOLDS.cpu && now - lastAlert.cpu > COOLDOWN_MS) {
      logger.warn('ALERT cpu high', { cpuPct, threshold: THRESHOLDS.cpu });
      lastAlert.cpu = now;
    }
    if (memPct >= THRESHOLDS.mem && now - lastAlert.mem > COOLDOWN_MS) {
      logger.warn('ALERT memory high', { memPct, threshold: THRESHOLDS.mem });
      lastAlert.mem = now;
    }
    for (const d of disks) {
      if (d.use >= THRESHOLDS.disk && now - lastAlert.disk > COOLDOWN_MS) {
        logger.warn('ALERT disk high', { mount: d.mount, use: d.use, threshold: THRESHOLDS.disk });
        lastAlert.disk = now;
        break;
      }
    }
  } catch (e) {
    logger.error('alert check failed', { error: e.message });
  }
}

export function startAlertLoop(intervalMs = 60_000) {
  checkOnce();
  const t = setInterval(checkOnce, intervalMs);
  // don't keep process alive just for this
  if (t.unref) t.unref();
  return t;
}
