import { homedir } from 'os';
import { existsSync } from 'fs';

function detectPanelUser() {
  // priority: env > current OS user > fallback
  if (process.env.PANEL_USER) return process.env.PANEL_USER;
  if (process.env.SUDO_USER && process.env.SUDO_USER !== 'root') return process.env.SUDO_USER;
  if (process.env.USER && process.env.USER !== 'root') return process.env.USER;
  try {
    const h = homedir(); // /home/<user> or /root
    const parts = h.split('/').filter(Boolean);
    const last = parts[parts.length - 1];
    if (last && last !== 'root') return last;
  } catch {}
  return 'root';
}

export const PANEL_USER = detectPanelUser();
export const PANEL_HOME = process.env.PANEL_HOME || (PANEL_USER === 'root' ? '/root' : `/home/${PANEL_USER}`);

// Portable dirs — all overridable via env, like aaPanel's /www/server/panel
export const APPS_DIR = process.env.PANEL_APPS_DIR || `${PANEL_HOME}/apps`;
export const BACKUP_DIR = process.env.PANEL_BACKUP_DIR || process.env.BACKUP_DIR || `${PANEL_HOME}/backups`;
export const COMPOSE_DIR = process.env.PANEL_COMPOSE_DIR || `${PANEL_HOME}/compose`;
export const CRON_USER = process.env.PANEL_CRON_USER || PANEL_USER;
export const DATA_DIR = process.env.PANEL_DATA_DIR || 'data';

// for chown helpers
export const PANEL_SAFE_USER = PANEL_USER.replace(/[^a-z0-9_-]/gi, '');

export const NGINX_AVAILABLE = process.env.NGINX_AVAILABLE || '/etc/nginx/sites-available';
export const NGINX_ENABLED = process.env.NGINX_ENABLED || '/etc/nginx/sites-enabled';
export const NGINX_DEFAULT_ROOT = process.env.NGINX_DEFAULT_ROOT || '/var/www';

// protected users that cannot be deleted via panel
export const PROTECTED_USERS = new Set(['root', PANEL_USER, 'admin', 'ubuntu', 'debian']);

export function chownCmd(path) {
  // best-effort chown to panel user, no-op if fails
  return `chown -R ${PANEL_SAFE_USER}:${PANEL_SAFE_USER} ${path} 2>&1 || chown -R ${PANEL_SAFE_USER} ${path} 2>&1 || true`;
}
