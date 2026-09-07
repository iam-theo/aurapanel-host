import { Router } from 'express';
import {
  readdirSync, statSync, readFileSync, writeFileSync, mkdirSync,
  renameSync, existsSync, createReadStream, createWriteStream,
} from 'fs';
import { cp, mkdir, rm } from 'fs/promises';
import { join, resolve, extname, basename, dirname } from 'path';
import { ZipArchive } from 'archiver';
import unzipper from 'unzipper';
import multer from 'multer';
import { schemas, validateBody } from '../lib/validate.js';
import { requireRole } from '../lib/auth.js';

const router = Router();

const SAFE_ROOTS = ['/home', '/var/www', '/etc/nginx', '/tmp', '/root', '/opt'];
const BLOCKED = ['/etc/shadow', '/etc/gshadow', '/root/.ssh', '/proc', '/sys'];
const TEXT_EXT = new Set(['txt', 'log', 'md', 'json', 'yml', 'yaml', 'js', 'jsx', 'ts', 'tsx', 'py', 'rb', 'go', 'sh', 'bash', 'env', 'conf', 'cfg', 'ini', 'xml', 'html', 'htm', 'css', 'scss', 'sql', 'c', 'cpp', 'h', 'java', 'php', 'vue', 'svelte', 'tf', 'toml', 'dockerfile', 'gitignore', 'nginx', 'cron', 'lock']);
const MAX_EDIT_SIZE = 5 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 1024 * 1024 * 1024, files: 50 },
});

function getRealPath(requestedPath) {
  const p = String(requestedPath || '/');
  if (!p.startsWith('/')) throw new Error('Absolute path required');
  if (p.includes('\0')) throw new Error('Invalid path');
  const resolved = resolve('/', p);
  for (const b of BLOCKED) if (resolved === b || resolved.startsWith(b + '/')) throw new Error('Access denied');
  return resolved;
}

function isUnderSafeRoot(p) {
  return SAFE_ROOTS.some(r => p === r || p.startsWith(r + '/'));
}

function getStatMeta(fullPath, isDir) {
  try {
    const st = statSync(fullPath);
    return {
      name: basename(fullPath),
      path: fullPath,
      isDirectory: st.isDirectory(),
      isFile: st.isFile(),
      isSymlink: st.isSymbolicLink(),
      size: st.size,
      modified: st.mtime,
      permissions: (st.mode & 0o777).toString(8),
      mode: st.mode.toString(8).slice(-3),
      uid: st.uid,
      gid: st.gid,
      type: st.isDirectory() ? 'dir' : (st.isSymbolicLink() ? 'link' : (isBinaryExt(fullPath) ? 'binary' : 'text')),
      hidden: basename(fullPath).startsWith('.'),
    };
  } catch {
    return { name: basename(fullPath), path: fullPath, isDirectory: isDir, isFile: !isDir, size: 0, modified: null, permissions: '---', type: 'unknown', hidden: basename(fullPath).startsWith('.') };
  }
}

function isBinaryExt(p) {
  const ext = extname(p).toLowerCase().replace('.', '');
  return ext && !TEXT_EXT.has(ext);
}

function looksBinary(buffer) {
  const len = Math.min(buffer.length, 8000);
  for (let i = 0; i < len; i++) {
    const b = buffer[i];
    if (b === 0) return true;
  }
  return false;
}

// full recursive delete (handles dirs + files)
async function removeRecursive(p) {
  await rm(p, { recursive: true, force: true });
}

// recursively copy a file or directory tree
async function copyRecursive(src, dest) {
  if (!existsSync(src)) throw new Error('Source does not exist');
  const st = statSync(src);
  if (st.isDirectory()) {
    await cp(src, dest, { recursive: true, force: true });
  } else {
    await mkdir(dirname(dest), { recursive: true });
    const rs = createReadStream(src);
    const ws = createWriteStream(dest);
    await new Promise((resolve, reject) => {
      rs.on('error', reject);
      ws.on('error', reject);
      ws.on('finish', resolve);
      rs.pipe(ws);
    });
  }
}

// zip a file or directory to a .zip file
async function createZip(target, zipPath) {
  const st = statSync(target);
  const out = createWriteStream(zipPath);
  const archive = new ZipArchive({ zlib: { level: 6 } });
  const done = new Promise((resolve, reject) => {
    out.on('close', resolve);
    archive.on('error', reject);
    out.on('error', reject);
  });
  archive.pipe(out);
  if (st.isDirectory()) {
    const rootName = basename(target);
    archive.directory(target, rootName);
  } else {
    archive.file(target, { name: basename(target) });
  }
  await archive.finalize();
  await done;
}

// unzip an archive into a directory (unzipper has built-in zip-slip protection)
async function extractZip(zipPath, destDir) {
  await mkdir(destDir, { recursive: true });
  const db = await unzipper.Open.file(zipPath);
  await db.extract({ path: destDir });
}

router.get('/', (req, res) => {
  let dirPath;
  try { dirPath = getRealPath(req.query.path || '/'); } catch (e) { return res.status(400).json({ error: e.message }); }
  try {
    const showHidden = req.query.showHidden === 'true';
    const entries = readdirSync(dirPath, { withFileTypes: true });
    const items = entries
      .filter(d => showHidden || !d.name.startsWith('.'))
      .map(d => {
        const fullPath = join(dirPath, d.name);
        return getStatMeta(fullPath, d.isDirectory());
      });
    res.json({ path: dirPath, items });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/read', (req, res) => {
  let filePath;
  try { filePath = getRealPath(req.query.path); } catch (e) { return res.status(400).json({ error: e.message }); }
  try {
    const st = statSync(filePath);
    if (!st.isFile()) return res.status(400).json({ error: 'Not a file' });
    if (st.size > MAX_EDIT_SIZE) {
      res.status(200).json({
        path: filePath, binary: true, error: `File too large to edit (${st.size} bytes > 5MB)`,
        preview: '', size: st.size,
      });
      return;
    }
    const buf = readFileSync(filePath);
    if (looksBinary(buf)) return res.json({ path: filePath, binary: true, content: '', size: st.size });
    res.json({ path: filePath, binary: false, content: buf.toString('utf-8'), size: st.size });
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

router.post('/write', requireRole('admin', 'operator'), validateBody(schemas.writeFile), async (req, res) => {
  const { path: filePath, content } = req.validated;
  let real;
  try { real = getRealPath(filePath); } catch (e) { return res.status(400).json({ error: e.message }); }
  if (!isUnderSafeRoot(real)) return res.status(403).json({ error: 'Write outside allowed roots' });
  try {
    await mkdir(dirname(real), { recursive: true });
    writeFileSync(real, content, 'utf-8');
    req.audit?.('files.write', real, {});
    res.json({ success: true });
  } catch (err) {
    req.audit?.('files.write', real, { error: err.message }, 'failure');
    res.status(500).json({ error: err.message });
  }
});

router.post('/create', requireRole('admin', 'operator'), validateBody(schemas.createFile), (req, res) => {
  const { path: dirPath, name } = req.validated;
  let real;
  try { real = getRealPath(dirPath); } catch (e) { return res.status(400).json({ error: e.message }); }
  if (!isUnderSafeRoot(real)) return res.status(403).json({ error: 'Write outside allowed roots' });
  if (!/^[^/\0]+$/.test(name)) return res.status(400).json({ error: 'Invalid file name' });
  const fullPath = join(real, name);
  try {
    writeFileSync(fullPath, '', { flag: 'wx' });
    req.audit?.('files.create', fullPath, {});
    res.json({ success: true, path: fullPath });
  } catch (err) {
    res.status(500).json({ error: err.code === 'EEXIST' ? 'File already exists' : err.message });
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
  if (SAFE_ROOTS.some(r => filePath === r)) return res.status(403).json({ error: 'Cannot delete a root directory' });
  if (!isUnderSafeRoot(filePath)) return res.status(403).json({ error: 'Delete outside allowed roots' });
  removeRecursive(filePath)
    .then(() => {
      req.audit?.('files.delete', filePath, {});
      res.json({ success: true });
    })
    .catch(err => {
      req.audit?.('files.delete', filePath, { error: err.message }, 'failure');
      res.status(500).json({ error: err.message });
    });
});

router.post('/rename', requireRole('admin', 'operator'), async (req, res) => {
  const { oldPath, newPath } = req.body;
  let ro, rn;
  try { ro = getRealPath(oldPath); rn = getRealPath(newPath); } catch (e) { return res.status(400).json({ error: e.message }); }
  if (!isUnderSafeRoot(ro) || !isUnderSafeRoot(rn)) return res.status(403).json({ error: 'Rename outside allowed roots' });
  try {
    if (!existsSync(ro)) return res.status(404).json({ error: 'Source not found' });
    if (existsSync(rn)) return res.status(409).json({ error: 'Destination already exists' });
    await mkdir(dirname(rn), { recursive: true });
    renameSync(ro, rn);
    req.audit?.('files.rename', `${ro} -> ${rn}`, {});
    res.json({ success: true, path: rn });
  } catch (err) {
    req.audit?.('files.rename', `${ro} -> ${rn}`, { error: err.message }, 'failure');
    res.status(500).json({ error: err.message });
  }
});

router.post('/copy', requireRole('admin', 'operator'), validateBody(schemas.copyItem), async (req, res) => {
  const { source, dest } = req.validated;
  let rs, rd;
  try { rs = getRealPath(source); rd = getRealPath(dest); } catch (e) { return res.status(400).json({ error: e.message }); }
  if (!isUnderSafeRoot(rs) || !isUnderSafeRoot(rd)) return res.status(403).json({ error: 'Copy outside allowed roots' });
  try {
    if (!existsSync(rs)) return res.status(404).json({ error: 'Source not found' });
    await copyRecursive(rs, rd);
    req.audit?.('files.copy', `${rs} -> ${rd}`, {});
    res.json({ success: true, path: rd });
  } catch (err) {
    req.audit?.('files.copy', `${rs} -> ${rd}`, { error: err.message }, 'failure');
    res.status(500).json({ error: err.message });
  }
});

// Move (rename across devices with copy+delete fallback)
router.post('/move', requireRole('admin', 'operator'), validateBody(schemas.copyItem), async (req, res) => {
  const { source, dest } = req.validated;
  let rs, rd;
  try { rs = getRealPath(source); rd = getRealPath(dest); } catch (e) { return res.status(400).json({ error: e.message }); }
  if (!isUnderSafeRoot(rs) || !isUnderSafeRoot(rd)) return res.status(403).json({ error: 'Move outside allowed roots' });
  try {
    if (!existsSync(rs)) return res.status(404).json({ error: 'Source not found' });
    if (existsSync(rd)) return res.status(409).json({ error: 'Destination already exists' });
    if (rd === rs) return res.status(400).json({ error: 'Cannot move onto itself' });
    await mkdir(dirname(rd), { recursive: true });
    try {
      renameSync(rs, rd);
    } catch (e) {
      if (e.code !== 'EXDEV' && e.code !== 'EBUSY') throw e;
      await copyRecursive(rs, rd);
      await removeRecursive(rs);
    }
    req.audit?.('files.move', `${rs} -> ${rd}`, {});
    res.json({ success: true, path: rd });
  } catch (err) {
    req.audit?.('files.move', `${rs} -> ${rd}`, { error: err.message }, 'failure');
    res.status(500).json({ error: err.message });
  }
});

router.post('/zip', requireRole('admin', 'operator'), validateBody(schemas.zipItem), async (req, res) => {
  const { path: target, name } = req.validated;
  let real;
  try { real = getRealPath(target); } catch (e) { return res.status(400).json({ error: e.message }); }
  if (!isUnderSafeRoot(real)) return res.status(403).json({ error: 'Zip outside allowed roots' });
  try {
    if (!existsSync(real)) return res.status(404).json({ error: 'Path not found' });
    const base = name || `${basename(real)}.zip`;
    if (!/^[^/\0]+\.zip$/i.test(base)) return res.status(400).json({ error: 'Zip name must end with .zip' });
    const zipPath = join(dirname(real), base);
    if (existsSync(zipPath)) return res.status(409).json({ error: 'Zip file already exists' });
    await createZip(real, zipPath);
    req.audit?.('files.zip', zipPath, { source: real });
    res.json({ success: true, path: zipPath });
  } catch (err) {
    req.audit?.('files.zip', real, { error: err.message }, 'failure');
    res.status(500).json({ error: err.message });
  }
});

router.post('/unzip', requireRole('admin', 'operator'), validateBody(schemas.unzipItem), async (req, res) => {
  const { path: zipPath, dest } = req.validated;
  let real, destDir;
  try {
    real = getRealPath(zipPath);
    destDir = dest ? getRealPath(dest) : real.replace(/\.zip$/i, '');
    // default dest: avoid colliding with an existing file (or non-empty dir)
    if (!dest) {
      let n = 2;
      while (existsSync(destDir) && !statSync(destDir).isDirectory()) {
        destDir = `${real.replace(/\.zip$/i, '')} (${n++})`;
      }
    }
  } catch (e) { return res.status(400).json({ error: e.message }); }
  if (!isUnderSafeRoot(real) || !isUnderSafeRoot(destDir)) return res.status(403).json({ error: 'Unzip outside allowed roots' });
  try {
    if (!existsSync(real)) return res.status(404).json({ error: 'Archive not found' });
    if (!/\.zip$/i.test(real)) return res.status(400).json({ error: 'Not a zip archive' });
    await extractZip(real, destDir);
    req.audit?.('files.unzip', destDir, { source: real });
    res.json({ success: true, path: destDir });
  } catch (err) {
    req.audit?.('files.unzip', real, { error: err.message }, 'failure');
    res.status(500).json({ error: err.message });
  }
});

router.get('/download', (req, res) => {
  let p;
  try { p = getRealPath(req.query.path); } catch (e) { return res.status(400).json({ error: e.message }); }
  try {
    const st = statSync(p);
    if (st.isDirectory()) {
      const tmp = join('/tmp', `dl-${Date.now()}-${basename(p)}.zip`);
      createZip(p, tmp).then(() => {
        res.download(tmp, `${basename(p)}.zip`, (err) => {
          if (err && !res.headersSent) res.status(500).json({ error: err.message });
          rm(tmp, { force: true }).catch(() => {});
        });
      }).catch(e => res.status(500).json({ error: e.message }));
    } else {
      res.download(p, basename(p));
    }
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

router.post('/upload', requireRole('admin', 'operator'), (req, res) => {
  const dirPath = getRealPath(req.body.dir || req.query.dir || '/');
  if (!isUnderSafeRoot(dirPath)) return res.status(403).json({ error: 'Upload outside allowed roots' });
  upload.array('files', 50)(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message || 'Upload failed' });
    try {
      await mkdir(dirPath, { recursive: true });
      const written = [];
      for (const file of req.files || []) {
        const full = join(dirPath, file.originalname);
        if (!isUnderSafeRoot(full)) throw new Error(`Blocked path for ${file.originalname}`);
        writeFileSync(full, file.buffer);
        written.push(file.originalname);
      }
      req.audit?.('files.upload', dirPath, { count: written.length });
      res.json({ success: true, count: written.length, files: written });
    } catch (e) {
      req.audit?.('files.upload', dirPath, { error: e.message }, 'failure');
      res.status(500).json({ error: e.message });
    }
  });
});

export default router;