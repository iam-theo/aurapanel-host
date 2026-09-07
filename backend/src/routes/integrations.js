import { Router } from 'express';
import { randomUUID } from 'crypto';
import { schemas, validateBody } from '../lib/validate.js';
import { requireRole } from '../lib/auth.js';
import { PROVIDERS, verifyConnection, loadConnections, saveConnections, maskConnection } from '../lib/integrations.js';

const router = Router();

// GET /api/integrations — provider catalog + saved connections (secrets masked)
router.get('/', (req, res) => {
  const providers = Object.values(PROVIDERS).map(p => ({
    id: p.id, label: p.label, description: p.description, fields: p.fields,
  }));
  res.json({ providers, connections: loadConnections().map(maskConnection) });
});

// POST /api/integrations — verify live, then store
router.post('/', requireRole('admin'), validateBody(schemas.integrationCreate), async (req, res) => {
  const { provider, name, baseUrl, username, password, token, webhookUrl } = req.validated;
  const config = { baseUrl, username, password, token, webhookUrl };
  try {
    const check = await verifyConnection(provider, config);
    const now = new Date().toISOString();
    const list = loadConnections();
    const conn = {
      id: randomUUID(),
      provider, name: name.trim(),
      ...(baseUrl ? { baseUrl: baseUrl.trim() } : {}),
      ...(username ? { username: username.trim() } : {}),
      ...(password ? { password } : {}),
      ...(token ? { token } : {}),
      ...(webhookUrl ? { webhookUrl: webhookUrl.trim() } : {}),
      status: 'ok',
      statusDetail: check.detail,
      lastChecked: now,
      createdAt: now,
      updatedAt: now,
    };
    list.push(conn);
    saveConnections(list);
    req.audit?.('integrations.create', `${provider}:${name}`, {});
    res.json(maskConnection(conn));
  } catch (err) {
    req.audit?.('integrations.create', `${provider}:${name}`, { error: err.message }, 'failure');
    res.status(400).json({ error: `Verification failed: ${err.message}` });
  }
});

// POST /api/integrations/:id/test — re-verify stored credentials
router.post('/:id/test', requireRole('admin'), async (req, res) => {
  const list = loadConnections();
  const conn = list.find(c => c.id === req.params.id);
  if (!conn) return res.status(404).json({ error: 'Integration not found' });
  try {
    const check = await verifyConnection(conn.provider, conn);
    conn.status = 'ok';
    conn.statusDetail = check.detail;
    conn.lastChecked = new Date().toISOString();
    conn.updatedAt = conn.lastChecked;
    saveConnections(list);
    req.audit?.('integrations.test', `${conn.provider}:${conn.name}`, {});
    res.json(maskConnection(conn));
  } catch (err) {
    conn.status = 'error';
    conn.statusDetail = err.message;
    conn.lastChecked = new Date().toISOString();
    try { saveConnections(list); } catch {}
    req.audit?.('integrations.test', `${conn.provider}:${conn.name}`, { error: err.message }, 'failure');
    res.status(400).json({ error: err.message });
  }
});

// DELETE /api/integrations/:id
router.delete('/:id', requireRole('admin'), (req, res) => {
  const list = loadConnections();
  const idx = list.findIndex(c => c.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Integration not found' });
  const [removed] = list.splice(idx, 1);
  saveConnections(list);
  req.audit?.('integrations.delete', `${removed.provider}:${removed.name}`, {});
  res.json({ success: true });
});

export default router;
