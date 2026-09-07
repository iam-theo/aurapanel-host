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
  // NOTE: no `|| echo` fallback — a failing command must surface its real
  // error. Sudo-auth failure is detected from sudo's own diagnostics.
  return `sudo -n bash -c ${JSON.stringify(cmd)} 2>&1`;
}

function isSudoAuthFailure(text) {
  return /sudo:\s|a password is required|no tty present|no new privileges/i.test(String(text || ''));
}

export function sudoElevationError() {
  const e = new Error('Operation requires sudo elevation. Set SUDO_PASSWORD env or /run/secrets/sudo_password');
  e.code = 'SUDO_NEEDS_PASSWORD';
  return e;
}

export async function runAsync(cmd, { sudo = false, timeout = 20000 } = {}) {
  const fullCmd = sudo ? buildSudo(cmd) : cmd;
  try {
    const { stdout } = await execAsyncRaw(fullCmd, { timeout, maxBuffer: 10 * 1024 * 1024 });
    const out = stdout || '';
    const pw = getSecret('SUDO_PASSWORD');
    if (!pw && isSudoAuthFailure(out)) throw sudoElevationError();
    return out;
  } catch (err) {
    if (err.code === 'SUDO_NEEDS_PASSWORD') throw err;
    const combined = String((err.stdout || '') + (err.stderr || '') + err.message);
    const pw = getSecret('SUDO_PASSWORD');
    if (!pw && isSudoAuthFailure(combined)) throw sudoElevationError();
    // Surface the command's real output instead of a generic exec error
    if (err.stdout) err.message = `${String(err.stdout).trim().slice(0, 2000)}`;
    throw err;
  }
}

export async function runAsyncSafe(cmd, opts = {}) {
  try { return await runAsync(cmd, opts); } catch (e) { return ''; }
}
