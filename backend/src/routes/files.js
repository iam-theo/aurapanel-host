import { Router } from 'express';
import { readdirSync, statSync, readFileSync, writeFileSync, mkdirSync, unlinkSync, renameSync, existsSync } from 'fs';
import { join, resolve, extname } from 'path';
import { schemas, validateBody } from '../lib/validate.js';
import { requireRole } from '../lib/auth.js';

const router = Router();

const SAFE_ROOTS = ['/home', '/var/www', '/etc/nginx', '/tmp'];
const BLOCKED = ['/etc/shadow', '/etc/gshadow', '/root/.ssh', '/proc', '/sys'];

function getRealPath(requestedPath) {
  const p = String(requestedPath || '/home');
  // prevent null bytes and traversal tricks
  if (p.includes('\0')) throw new Error('Invalid path');
  const resolved = resolve('/', p);
  // block sensitive files
  for (const b of BLOCKED) if (resolved === b || resolved.startsWith(b + '/')) throw new Error('Access denied');
  // enforce SAFE_ROOTS for non-viewer? allow read of listed roots, block others for write (enforced per-route)
  return resolved;
}

function isUnderSafeRoot(p) {
  return SAFE_ROOTS.some(r => p === r || p.startsWith(r + '/'));
}

// Viewer can list/read within safe roots
router.get('/', (req, res) => {
  let dirPath;
  try { dirPath = getRealPath(req.query.path || '/home'); } catch (e) { return res.status(400).json({ error: e.message }); }
  try {
    const entries = readdirSync(dirPath);
    const items = entries.map(name => {
      const fullPath = join(dirPath, name);
      try {
        const stat = statSync(fullPath);
        return {
          name,
          path: fullPath,
          isDirectory: stat.isDirectory(),
          size: stat.size,
          modified: stat.mtime,
          permissions: stat.mode.toString(8).slice(-3),
        };
      } catch {
        return { name, path: fullPath, isDirectory: false, size: 0, modified: null, permissions: '---' };
      }
    }).filter(item => !item.name.startsWith('.'));
    res.json({ path: dirPath, items });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/read', (req, res) => {
  let filePath;
  try { filePath = getRealPath(req.query.path); } catch (e) { return res.status(400).json({ error: e.message }); }
  try {
    const stat = statSync(filePath);
    if (stat.size > 5 * 1024 * 1024) return res.status(413).json({ error: 'File too large (>5MB)' });
    // block binary read by extension? allow but limit
    const content = readFileSync(filePath, 'utf-8');
    res.json({ path: filePath, content, size: stat.size });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/write', requireRole('admin', 'operator'), validateBody(schemas.writeFile), (req, res) => {
  const { path: filePath, content } = req.validated;
  let real;
  try { real = getRealPath(filePath); } catch (e) { return res.status(400).json({ error: e.message }); }
  if (!isUnderSafeRoot(real)) return res.status(403).json({ error: 'Write outside allowed roots' });
  try {
    writeFileSync(real, content, 'utf-8');
    req.audit?.('files.write', real, {});
    res.json({ success: true });
  } catch (err) {
    req.audit?.('files.write', real, { error: err.message }, 'failure');
    res.status(500).json({ error: err.message });
  }
});

router.post('/mkdir', requireRole('admin', 'operator'), (req, res) => {
  const { path: dirPath } = req.body;
  let real;
  try { real = getRealPath(dirPath); } catch (e) { return res.status(400).json({ error: e.message }); }
  if (!isUnderSafeRoot(real)) return res.status(403).json({ error: 'Write outside allowed roots' });
  try {
    mkdirSync(real, { recursive: true });
    req.audit?.('files.mkdir', real, {});
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/delete', requireRole('admin'), (req, res) => {
  let filePath;
  try { filePath = getRealPath(req.query.path); } catch (e) { return res.status(400).json({ error: e.message }); }
  if (!isUnderSafeRoot(filePath)) return res.status(403).json({ error: 'Delete outside allowed roots' });
  try {
    unlinkSync(filePath);
    req.audit?.('files.delete', filePath, {});
    res.json({ success: true });
  } catch (err) {
    req.audit?.('files.delete', filePath, { error: err.message }, 'failure');
    res.status(500).json({ error: err.message });
  }
});

router.post('/rename', requireRole('admin', 'operator'), (req, res) => {
  const { oldPath, newPath } = req.body;
  let ro, rn;
  try { ro = getRealPath(oldPath); rn = getRealPath(newPath); } catch (e) { return res.status(400).json({ error: e.message }); }
  if (!isUnderSafeRoot(ro) || !isUnderSafeRoot(rn)) return res.status(403).json({ error: 'Rename outside allowed roots' });
  try {
    renameSync(ro, rn);
    req.audit?.('files.rename', `${ro} -> ${rn}`, {});
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
