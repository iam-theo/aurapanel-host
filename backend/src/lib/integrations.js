import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from 'fs';
import { join, dirname } from 'path';
import { DATA_DIR } from './config.js';

const STORE_PATH = join(DATA_DIR, 'integrations.json');

export const PROVIDERS = {
  github: {
    id: 'github',
    label: 'GitHub',
    description: 'Verify a personal access token and read the authenticated user.',
    fields: [
      { key: 'token', label: 'Personal access token', type: 'password', required: true, help: 'Classic PAT with read:user scope' },
    ],
  },
  'docker-registry': {
    id: 'docker-registry',
    label: 'Docker Registry',
    description: 'Ping a registry /v2/ endpoint, optionally with basic auth.',
    fields: [
      { key: 'baseUrl', label: 'Registry URL', type: 'text', required: true, help: 'e.g. https://registry.example.com' },
      { key: 'username', label: 'Username', type: 'text', required: false },
      { key: 'password', label: 'Password / token', type: 'password', required: false },
    ],
  },
  slack: {
    id: 'slack',
    label: 'Slack Webhook',
    description: 'Post a ping message to an incoming webhook URL.',
    fields: [
      { key: 'webhookUrl', label: 'Webhook URL', type: 'text', required: true, help: 'https://hooks.slack.com/services/…' },
    ],
  },
  webhook: {
    id: 'webhook',
    label: 'Generic Webhook',
    description: 'POST a JSON ping event; any 2xx response counts as healthy.',
    fields: [
      { key: 'webhookUrl', label: 'Webhook URL', type: 'text', required: true },
    ],
  },
};

function fetchWithTimeout(url, opts = {}, ms = 15000) {
  return fetch(url, { ...opts, signal: AbortSignal.timeout(ms) });
}

// Throws on failure with a human-readable message; resolves { ok: true, detail }
export async function verifyConnection(provider, config, { ping = false } = {}) {
  const def = PROVIDERS[provider];
  if (!def) throw new Error(`Unknown provider: ${provider}`);
  for (const f of def.fields) {
    if (f.required && !String(config[f.key] || '').trim()) throw new Error(`${f.label} is required`);
  }

  if (provider === 'github') {
    const res = await fetchWithTimeout('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${config.token.trim()}`,
        'User-Agent': 'server-panel',
        Accept: 'application/vnd.github+json',
      },
    }).catch(e => { throw new Error(`GitHub unreachable: ${e.message}`); });
    if (res.status === 401) throw new Error('GitHub rejected the token (401)');
    if (res.status === 403) throw new Error('GitHub rate-limited or forbade the request (403)');
    if (!res.ok) throw new Error(`GitHub responded ${res.status}`);
    const user = await res.json().catch(() => ({}));
    return { ok: true, detail: user.login ? `@${user.login}` : 'token valid' };
  }

  if (provider === 'docker-registry') {
    const base = String(config.baseUrl).trim().replace(/\/+$/, '');
    if (!/^https?:\/\//i.test(base)) throw new Error('Registry URL must start with http(s)://');
    const headers = {};
    if (config.username?.trim()) {
      headers.Authorization = 'Basic ' + Buffer.from(`${config.username.trim()}:${config.password || ''}`).toString('base64');
    }
    const res = await fetchWithTimeout(`${base}/v2/`, { headers }).catch(e => { throw new Error(`Registry unreachable: ${e.message}`); });
    if (res.status === 401) throw new Error('Registry rejected the credentials (401)');
    if (!res.ok && res.status !== 200) throw new Error(`Registry responded ${res.status}`);
    return { ok: true, detail: config.username?.trim() ? `authenticated as ${config.username.trim()}` : 'reachable' };
  }

  if (provider === 'slack' || provider === 'webhook') {
    const url = String(config.webhookUrl).trim();
    if (!/^https?:\/\//i.test(url)) throw new Error('Webhook URL must start with http(s)://');
    const body = provider === 'slack'
      ? { text: ping ? ':white_check_mark: ServerPanel ping — integration connected' : ':white_check_mark: ServerPanel test — integration connected' }
      : { event: 'panel.ping', source: 'server-panel', at: new Date().toISOString() };
    const res = await fetchWithTimeout(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).catch(e => { throw new Error(`Webhook unreachable: ${e.message}`); });
    const text = await res.text().catch(() => '');
    if (!res.ok) throw new Error(`Webhook responded ${res.status}`);
    if (provider === 'slack' && text.trim() !== 'ok') throw new Error(`Slack rejected the payload (${text.slice(0, 80) || res.status})`);
    return { ok: true, detail: provider === 'slack' ? 'message posted' : `HTTP ${res.status}` };
  }

  throw new Error(`Unknown provider: ${provider}`);
}

export function loadConnections() {
  try {
    if (!existsSync(STORE_PATH)) return [];
    const raw = JSON.parse(readFileSync(STORE_PATH, 'utf-8'));
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

export function saveConnections(list) {
  mkdirSync(dirname(STORE_PATH), { recursive: true });
  writeFileSync(STORE_PATH, JSON.stringify(list, null, 2));
  try { chmodSync(STORE_PATH, 0o600); } catch {}
}

// Public view — secrets never leave the server
export function maskConnection(c) {
  const def = PROVIDERS[c.provider];
  const secretKeys = (def?.fields || []).filter(f => f.type === 'password').map(f => f.key);
  const masked = { ...c };
  for (const k of secretKeys) {
    if (masked[k]) {
      const v = String(masked[k]);
      masked[k] = `••••${v.slice(-4)}`;
    }
  }
  return {
    id: masked.id,
    provider: masked.provider,
    name: masked.name,
    baseUrl: masked.baseUrl || null,
    username: masked.username || null,
    webhookUrl: masked.webhookUrl || null,
    hasSecrets: secretKeys.some(k => !!c[k]),
    secretHint: secretKeys.map(k => (masked[k] && c[k] ? { field: k, hint: masked[k] } : null)).filter(Boolean),
    status: masked.status || 'unknown',
    statusDetail: masked.statusDetail || null,
    lastChecked: masked.lastChecked || null,
    createdAt: masked.createdAt,
    updatedAt: masked.updatedAt,
  };
}
