import { execSync } from 'child_process';
import { getSecret } from './secrets.js';

function buildSudo(cmd) {
  const SUDO_PASSWORD = getSecret('SUDO_PASSWORD');
  const script = `bash -c ${JSON.stringify(cmd)}`;
  if (SUDO_PASSWORD) {
    const pw = SUDO_PASSWORD.replace(/\\/g, '\\\\').replace(/'/g, "'\\''");
    return `printf '%s\\n' '${pw}' | sudo -S -p '' ${script} 2>&1`;
  }
  return `sudo -n bash -c ${JSON.stringify(cmd)} 2>&1 || echo "__SUDO_NEEDS_PASSWORD__"`;
}

export function run(cmd, { sudo = false, shell = '/bin/bash', timeout = 20000 } = {}) {
  const pw = getSecret('SUDO_PASSWORD');
  const fullCmd = sudo ? buildSudo(cmd) : cmd;
  try {
    const out = execSync(fullCmd, {
      encoding: 'utf-8',
      timeout,
      shell,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    if (!pw && out.includes('__SUDO_NEEDS_PASSWORD__')) {
      const e = new Error('Operation requires sudo elevation. Set the SUDO_PASSWORD env var to enable privileged operations.');
      e.code = 'SUDO_NEEDS_PASSWORD';
      throw e;
    }
    return out;
  } catch (err) {
    if (err.code === 'SUDO_NEEDS_PASSWORD') throw err;
    if (!pw && (String(err.message).includes('sudo') || String(err.message).includes('a password is required'))) {
      const e = new Error('Operation requires sudo elevation. Set the SUDO_PASSWORD env var to enable privileged operations.');
      e.code = 'SUDO_NEEDS_PASSWORD';
      throw e;
    }
    throw err;
  }
}

export function exists(cmd) {
  try {
    return run(`command -v ${cmd}`);
  } catch {
    return false;
  }
}

export function sudoAvailable() {
  try {
    run('true', { sudo: true });
    return true;
  } catch {
    return false;
  }
}

export function safeShellEscape(str) {
  if (str == null) return '';
  return String(str).replace(/(['"\\$`])/g, '\\$1');
}

export function isSafeIdentifier(name) {
  return /^[a-zA-Z0-9_-]+$/.test(name || '');
}

export function isSafeName(name) {
  return /^[a-zA-Z0-9_.-]+$/.test(name || '');
}
