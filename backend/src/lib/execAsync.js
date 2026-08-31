import { exec } from 'child_process';
import { promisify } from 'util';
import { getSecret } from './secrets.js';

const execAsyncRaw = promisify(exec);

function buildSudo(cmd) {
  const pw = getSecret('SUDO_PASSWORD');
  const script = `bash -c ${JSON.stringify(cmd)}`;
  if (pw) {
    const esc = pw.replace(/\\/g, '\\\\').replace(/'/g, "'\\''");
    return `printf '%s\\n' '${esc}' | sudo -S -p '' ${script} 2>&1`;
  }
  return `sudo -n bash -c ${JSON.stringify(cmd)} 2>&1 || echo "__SUDO_NEEDS_PASSWORD__"`;
}

export async function runAsync(cmd, { sudo = false, timeout = 20000 } = {}) {
  const fullCmd = sudo ? buildSudo(cmd) : cmd;
  try {
    const { stdout } = await execAsyncRaw(fullCmd, { timeout, maxBuffer: 10 * 1024 * 1024 });
    const out = stdout || '';
    const pw = getSecret('SUDO_PASSWORD');
    if (!pw && out.includes('__SUDO_NEEDS_PASSWORD__')) {
      const e = new Error('Operation requires sudo elevation. Set SUDO_PASSWORD env or /run/secrets/sudo_password');
      e.code = 'SUDO_NEEDS_PASSWORD';
      throw e;
    }
    return out;
  } catch (err) {
    if (err.code === 'SUDO_NEEDS_PASSWORD') throw err;
    const msg = String(err.message || '');
    const pw = getSecret('SUDO_PASSWORD');
    if (!pw && (msg.includes('sudo') || msg.includes('a password is required'))) {
      const e = new Error('Operation requires sudo elevation. Set SUDO_PASSWORD');
      e.code = 'SUDO_NEEDS_PASSWORD';
      throw e;
    }
    // Include stdout in error for debugging
    if (err.stdout) err.message = `${err.message}\n${err.stdout}`;
    throw err;
  }
}

export async function runAsyncSafe(cmd, opts = {}) {
  try { return await runAsync(cmd, opts); } catch (e) { return ''; }
}
