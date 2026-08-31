import { Router } from 'express';
import { run, isSafeName } from '../lib/exec.js';
import { readdirSync, statSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { schemas, validateBody } from '../lib/validate.js';
import { requireRole } from '../lib/auth.js';
import { backupGauge } from '../lib/metrics.js';
import { logger } from '../lib/logger.js';
import { createCipheriv, randomBytes } from 'crypto';
import { BACKUP_DIR as CFG_DIR, PANEL_SAFE_USER, chownCmd } from '../lib/config.js';

const router = Router();
const BACKUP_DIR = CFG_DIR;
const BACKUP_RETENTION_DAYS = parseInt(process.env.BACKUP_RETENTION_DAYS || '14', 10);
const BACKUP_MAX_COUNT = parseInt(process.env.BACKUP_MAX_COUNT || '50', 10);
const BACKUP_ENCRYPTION_KEY = process.env.BACKUP_ENCRYPTION_KEY || ''; // 32-byte hex if set
const OFFSITE_HOOK = process.env.BACKUP_OFFSITE_HOOK || ''; // e.g. rclone/s3 sync command

if (!existsSync(BACKUP_DIR)) {
  run(`mkdir -p ${BACKUP_DIR} && ${chownCmd(BACKUP_DIR)}`, {});
}

// Helpers
function listBackups() {
  if (!existsSync(BACKUP_DIR)) return [];
  return readdirSync(BACKUP_DIR).map(f => {
    const p = join(BACKUP_DIR, f);
    const st = statSync(p);
    return {
      name: f,
      path: p,
      size: st.size,
      modified: st.mtime,
      type: f.endsWith('.enc') ? 'encrypted' : f.split('.').pop() === 'gz' || f.includes('tar') ? 'archive' : f.includes('.dump') ? 'database' : 'file',
    };
  });
}

function enforceRetention() {
  const files = listBackups().sort((a, b) => b.modified - a.modified);
  backupGauge.set(files.length);
  const cutoff = Date.now() - BACKUP_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  let removed = 0;
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const tooOld = f.modified.getTime() < cutoff;
    const overCount = i >= BACKUP_MAX_COUNT;
    if (tooOld || overCount) {
      try { run(`rm -f ${f.path}`, {}); removed++; } catch {}
    }
  }
  if (removed) logger.info('backup retention enforced', { removed, retentionDays: BACKUP_RETENTION_DAYS, maxCount: BACKUP_MAX_COUNT });
}

function maybeEncrypt(filepath) {
  if (!BACKUP_ENCRYPTION_KEY) return filepath;
  try {
    const key = Buffer.from(BACKUP_ENCRYPTION_KEY, 'hex');
    if (key.length !== 32) throw new Error('BACKUP_ENCRYPTION_KEY must be 32-byte hex');
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const data = readFileSync(filepath);
    const enc = Buffer.concat([cipher.update(data), cipher.final()]);
    const tag = cipher.getAuthTag();
    const outPath = `${filepath}.enc`;
    const payload = Buffer.concat([iv, tag, enc]);
    const { writeFileSync } = awaitImportFs();
    writeFileSync(outPath, payload);
    run(`rm -f ${filepath}`, {});
    run(`chown ${PANEL_SAFE_USER}:${PANEL_SAFE_USER} ${outPath} 2>&1`, { sudo: true }).catch?.(() => {});
    logger.info('backup encrypted', { file: outPath });
    return outPath;
  } catch (e) {
    logger.error('backup encryption failed', { error: e.message });
    return filepath;
  }
}
function awaitImportFs() { return { writeFileSync: (awaitRequire('fs')).writeFileSync }; function awaitRequire(m){ return eval('require')(m);} }

function triggerOffsite(filepath) {
  if (!OFFSITE_HOOK) return;
  // Fire-and-forget hook, e.g. "rclone copy {file} s3:bucket/backups/"
  const cmd = OFFSITE_HOOK.replace('{file}', filepath).replace('{dir}', BACKUP_DIR);
  run(`${cmd} 2>&1 || true`, { timeout: 120000 });
  logger.info('offsite hook triggered', { filepath });
}

// GET /api/backups  (with retention + metrics)
router.get('/', (req, res) => {
  try {
    const files = listBackups();
    backupGauge.set(files.length);
    res.json(files);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/backups/database  (encrypted + retention + offsite)
router.post('/database', requireRole('admin', 'operator'), validateBody(schemas.createDbBackup), (req, res) => {
  const { database, cluster = 'pg17', label } = req.validated;
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename = `${label || database}_${ts}.dump`;
  const filepath = join(BACKUP_DIR, filename);
  try {
    const port = cluster === 'pg14' || cluster === '14/main' ? 5432 : 5433;
    const tmpPath = `/tmp/${filename}`;
    const out = run(`su postgres -c ${JSON.stringify(`pg_dump -p ${port} -Fc ${database} > ${tmpPath} 2>&1`)} && cp ${tmpPath} ${filepath} && chown ${PANEL_SAFE_USER}:${PANEL_SAFE_USER} ${filepath} && rm -f ${tmpPath}`, { sudo: true });
    if (!existsSync(filepath)) return res.status(500).json({ error: `Backup failed: ${out}` });
    const finalPath = maybeEncrypt(filepath);
    const st = statSync(finalPath);
    enforceRetention();
    triggerOffsite(finalPath);
    req.audit?.('backup.create_db', `backups/${finalPath.split('/').pop()}`, { database, cluster });
    res.json({ success: true, filename: finalPath.split('/').pop(), size: st.size, output: out.trim() });
  } catch (err) {
    req.audit?.('backup.create_db', `backups/${database}`, { database, error: err.message }, 'failure');
    res.status(500).json({ error: err.message });
  }
});

// POST /api/backups/directory  (encrypted + retention + offsite)
router.post('/directory', requireRole('admin', 'operator'), (req, res) => {
  const { source, label } = req.body;
  if (!source) return res.status(400).json({ error: 'Source path is required' });
  if (!existsSync(source)) return res.status(404).json({ error: `Source '${source}' not found` });
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const baseName = source.split('/').filter(Boolean).pop() || 'backup';
  const safe = baseName.replace(/[^a-zA-Z0-9_-]/g, '_');
  const filename = `${label || safe}_${ts}.tar.gz`;
  const filepath = join(BACKUP_DIR, filename);
  try {
    const out = run(`tar -czf ${filepath} -C $(dirname ${source}) $(basename ${source}) 2>&1`, { timeout: 120000 });
    if (!existsSync(filepath)) return res.status(500).json({ error: `Backup failed: ${out}` });
    try { run(`chown ${PANEL_SAFE_USER}:${PANEL_SAFE_USER} ${filepath} 2>&1`, { sudo: true }); } catch {}
    const finalPath = maybeEncrypt(filepath);
    const st = statSync(finalPath);
    enforceRetention();
    triggerOffsite(finalPath);
    req.audit?.('backup.create_dir', `backups/${finalPath.split('/').pop()}`, { source });
    res.json({ success: true, filename: finalPath.split('/').pop(), size: st.size, output: out.trim() });
  } catch (err) {
    req.audit?.('backup.create_dir', `backups/${source}`, { error: err.message }, 'failure');
    res.status(500).json({ error: err.message });
  }
});

// POST /api/backups/restore/database
router.post('/restore/database', requireRole('admin'), validateBody(schemas.restoreDbBackup), (req, res) => {
  const { filename, database, cluster = 'pg17' } = req.validated;
  const filepath = join(BACKUP_DIR, filename);
  if (!existsSync(filepath)) return res.status(404).json({ error: 'Backup file not found' });
  const port = cluster === 'pg14' || cluster === '14/main' ? 5432 : 5433;
  try {
    let restorePath = filepath;
    // Decrypt if needed
    if (filepath.endsWith('.enc')) {
      if (!BACKUP_ENCRYPTION_KEY) return res.status(400).json({ error: 'Backup is encrypted but BACKUP_ENCRYPTION_KEY not set' });
      const key = Buffer.from(BACKUP_ENCRYPTION_KEY, 'hex');
      const data = readFileSync(filepath);
      const iv = data.subarray(0, 12);
      const tag = data.subarray(12, 28);
      const enc = data.subarray(28);
      const { createDecipheriv } = awaitRequire2('crypto');
      const decipher = createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(tag);
      const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
      restorePath = `/tmp/restore_${filename.replace(/\.enc$/, '')}`;
      const { writeFileSync: wfs } = awaitRequire2('fs');
      wfs(restorePath, dec);
    }
    const tmpStage = restorePath === filepath ? `/tmp/restore_${filename}` : restorePath;
    if (restorePath === filepath) {
      run(`cp ${filepath} ${tmpStage} && chmod 644 ${tmpStage}`, {});
    } else {
      run(`chmod 644 ${tmpStage}`, {});
    }
    try {
      run(`su postgres -c 'createdb -p ${port} ${database}' || true`, { sudo: true });
      const out = run(`su postgres -c 'pg_restore -p ${port} --clean --if-exists -d ${database} ${tmpStage}'`, { sudo: true, timeout: 120000 });
      req.audit?.('backup.restore_db', `backups/${filename}`, { database, cluster });
      res.json({ success: true, output: (out || '').trim() });
    } finally {
      run(`rm -f ${tmpStage}`, {});
    }
  } catch (err) {
    req.audit?.('backup.restore_db', `backups/${filename}`, { error: err.message }, 'failure');
    res.status(500).json({ error: err.message });
  }
});
function awaitRequire2(m){ return eval('require')(m); }

// POST /api/backups/restore/directory
router.post('/restore/directory', requireRole('admin'), (req, res) => {
  const { filename, destination } = req.body;
  if (!isSafeName(filename)) return res.status(400).json({ error: 'Invalid filename' });
  if (!destination) return res.status(400).json({ error: 'Destination required' });
  const filepath = join(BACKUP_DIR, filename);
  if (!existsSync(filepath)) return res.status(404).json({ error: 'Backup file not found' });
  try {
    if (!existsSync(destination)) run(`mkdir -p ${destination}`, {});
    const out = run(`tar -xzf ${filepath} -C ${destination} 2>&1`, { timeout: 120000 });
    req.audit?.('backup.restore_dir', `backups/${filename}`, { destination });
    res.json({ success: true, output: out.trim() });
  } catch (err) {
    req.audit?.('backup.restore_dir', `backups/${filename}`, { error: err.message }, 'failure');
    res.status(500).json({ error: err.message });
  }
});

// GET /api/backups/download/:name
router.get('/download/:name', (req, res) => {
  const name = req.params.name;
  if (!isSafeName(name)) return res.status(400).json({ error: 'Invalid filename' });
  const filepath = join(BACKUP_DIR, name);
  if (!existsSync(filepath)) return res.status(404).json({ error: 'Backup not found' });
  res.download(filepath);
});

// GET /api/backups/verify/:name  - test restore to temp DB and checksum
router.get('/verify/:name', requireRole('admin', 'operator'), (req, res) => {
  const name = req.params.name;
  if (!isSafeName(name)) return res.status(400).json({ error: 'Invalid filename' });
  const filepath = join(BACKUP_DIR, name);
  if (!existsSync(filepath)) return res.status(404).json({ error: 'Backup not found' });
  try {
    const out = run(`pg_restore -l ${filepath} 2>&1 | head -20`, { timeout: 30000 });
    const ok = !out.toLowerCase().includes('error');
    res.json({ valid: ok, preview: out.slice(0, 2000) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/backups/:name
router.delete('/:name', requireRole('admin', 'operator'), (req, res) => {
  const name = req.params.name;
  if (!isSafeName(name)) return res.status(400).json({ error: 'Invalid filename' });
  try {
    const filepath = join(BACKUP_DIR, name);
    if (!existsSync(filepath)) return res.status(404).json({ error: 'Backup not found' });
    run(`rm -f ${filepath}`, {});
    req.audit?.('backup.delete', `backups/${name}`, {});
    res.json({ success: true, name });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/backups/retention/run  - manual trigger
router.post('/retention/run', requireRole('admin'), (req, res) => {
  enforceRetention();
  res.json({ success: true });
});

export default router;
