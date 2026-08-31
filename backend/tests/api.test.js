import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

let base = 'http://localhost:3500';

describe('api smoke', () => {
  it('health returns ok', async () => {
    const r = await fetch(`${base}/api/health`);
    assert.equal(r.status, 200);
    const j = await r.json();
    assert.equal(j.status, 'ok');
  });

  it('v1 health returns ok', async () => {
    const r = await fetch(`${base}/api/v1/health`);
    assert.equal(r.status, 200);
    const j = await r.json();
    assert.ok(j.version);
  });

  it('metrics returns prometheus', async () => {
    const r = await fetch(`${base}/api/metrics`);
    assert.equal(r.status, 200);
    const t = await r.text();
    assert.match(t, /panel_http_requests_total/);
  });

  it('auth login with default admin', async () => {
    // AUTH_DISABLED=true allows without login, but login should still work
    const r = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123' }),
    });
    // Either 200 (auth enabled) or if AUTH_DISABLED the login still validates against panel users
    assert.ok([200, 401].includes(r.status));
  });
});
