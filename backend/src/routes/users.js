import { Router } from 'express';
import { run, isSafeName } from '../lib/exec.js';
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { PROTECTED_USERS } from '../lib/config.js';
import { schemas, validateBody } from '../lib/validate.js';
import { requireRole } from '../lib/auth.js';

const router = Router();
const home = homedir();
const AUTHORIZED_KEYS = `${home}/.ssh/authorized_keys`;

// Ensure .ssh exists
if (!existsSync(`${home}/.ssh`)) {
  mkdirSync(`${home}/.ssh`, { recursive: true });
  run(`chmod 700 ${home}/.ssh 2>&1`, {});
}

// List SSH keys
router.get('/ssh-keys', (req, res) => {
  try {
    const keys = [];
    if (existsSync(AUTHORIZED_KEYS)) {
      const content = readFileSync(AUTHORIZED_KEYS, 'utf-8');
      content.split('\n').forEach((line, i) => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) return;
        const parts = trimmed.split(/\s+/);
        const [type, key, comment] = parts;
        keys.push({
          id: `key-${i + 1}`,
          type: type || 'unknown',
          fingerprint: key ? key.substring(0, 32) + '…' : '',
          comment: comment || '',
          full: trimmed,
        });
      });
    }
    res.json(keys);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Add SSH key
router.post('/ssh-keys', requireRole('admin'), validateBody(schemas.addSshKey), (req, res) => {
  const { pubkey, comment } = req.body;
  if (!pubkey) return res.status(400).json({ error: 'Public key is required' });
  if (!/^(ssh-rsa|ssh-ed25519|ecdsa-sha2-)/.test(pubkey.trim())) {
    return res.status(400).json({ error: 'Invalid public key format' });
  }
  try {
    let authorized = '';
    if (existsSync(AUTHORIZED_KEYS)) {
      authorized = readFileSync(AUTHORIZED_KEYS, 'utf-8').replace(/\n+$/, '');
    }
    const newKey = comment ? `${pubkey.trim()} ${comment}` : pubkey.trim();
    const updated = authorized ? `${authorized}\n${newKey}\n` : `${newKey}\n`;

    writeFileSync(AUTHORIZED_KEYS, updated, 'utf-8');
    run(`chmod 600 ${AUTHORIZED_KEYS} && chown ${process.env.USER}:${process.env.USER} ${AUTHORIZED_KEYS} 2>&1`, {});
    req.audit?.('ssh.add', req.body.pubkey.slice(0, 40), {});
    res.json({ success: true });
  } catch (err) {
    req.audit?.('ssh.add', 'ssh-keys', { error: err.message }, 'failure');
    res.status(500).json({ error: err.message });
  }
});

// Delete SSH key (by index)
router.delete('/ssh-keys/:id', requireRole('admin'), (req, res) => {
  const id = parseInt(req.params.id.replace('key-', ''), 10);
  if (isNaN(id) || id < 1) return res.status(400).json({ error: 'Invalid key id' });
  try {
    if (!existsSync(AUTHORIZED_KEYS)) return res.status(404).json({ error: 'No SSH keys' });
    let count = 0;
    let removed = false;
    const lines = readFileSync(AUTHORIZED_KEYS, 'utf-8').split('\n');
    const filtered = lines.filter(line => {
      const t = line.trim();
      if (!t || t.startsWith('#')) return true;
      count++;
      if (count === id) {
        removed = true;
        return false;
      }
      return true;
    });
    if (!removed) return res.status(404).json({ error: 'Key not found' });
    writeFileSync(AUTHORIZED_KEYS, filtered.join('\n').replace(/\n+$/, '') + '\n', 'utf-8');
    req.audit?.('ssh.delete', req.params.id, {});
    res.json({ success: true });
  } catch (err) {
    req.audit?.('ssh.delete', req.params.id, { error: err.message }, 'failure');
    res.status(500).json({ error: err.message });
  }
});

// Generate a new SSH key pair
router.post('/ssh-keys/generate', requireRole('admin'), (req, res) => {
  const { name = 'serverpanel', type = 'ed25519' } = req.body;
  if (!isSafeName(name)) return res.status(400).json({ error: 'Invalid key name' });
  try {
    const keyDir = `${home}/.ssh`;
    const privBit = type === 'rsa' ? '-b 4096' : '';
    run(`ssh-keygen -t ${type} ${privBit} -f ${keyDir}/${name} -N "" -C "serverpanel" 2>&1`, {});
    if (type === 'rsa') {
      run(`ssh-keygen -p -f ${keyDir}/${name} -m PEM -N "" 2>&1`, {});
    }
    const pub = readFileSync(`${keyDir}/${name}.pub`, 'utf-8').trim();
    res.json({ success: true, privateKey: `${keyDir}/${name}`, publicKey: pub });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// System users
router.get('/users', (req, res) => {
  try {
    const out = run('getent passwd 2>&1; echo "EXIT:$?"', {});
    const users = out.split('\n').filter(Boolean).map(line => {
      const parts = line.split(':');
      return parts.length >= 7 ? {
        username: parts[0],
        uid: parts[2],
        gid: parts[3],
        comment: parts[4],
        home: parts[5],
        shell: parts[6],
      } : null;
    }).filter(Boolean).filter(u => u.uid >= 1000);
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create a system user
router.post('/users', requireRole('admin'), (req, res) => {
  const { name, home, shell = '/bin/bash', createHome = true } = req.body;
  if (!isSafeName(name)) return res.status(400).json({ error: 'Invalid username' });
  try {
    const args = ['useradd'];
    if (createHome) args.push('-m');
    if (home) args.push(`-d ${home}`);
    args.push(`-s ${shell}`);
    args.push(name);
    const out = run(`sudo -n useradd ${args.slice(1).join(' ')} ${name} 2>&1 || echo "NEEDSSUDO"`, {});
    res.json({ success: true, output: out.trim() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete a system user
router.delete('/users/:name', requireRole('admin'), (req, res) => {
  const name = req.params.name;
  if (!isSafeName(name)) return res.status(400).json({ error: 'Invalid username' });
  if (PROTECTED_USERS.has(name)) return res.status(403).json({ error: 'Cannot delete protected user' });
  try {
    const out = run(`sudo -n userdel -r ${name} 2>&1 || echo "NEEDSSUDO"`, {});
    res.json({ success: true, output: out.trim() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
