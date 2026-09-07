import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

// Isolate the JSON store before the lib reads DATA_DIR
const tmpData = fs.mkdtempSync(path.join(os.tmpdir(), 'panel-int-'));
process.env.PANEL_DATA_DIR = tmpData;

const { schemas } = await import('../src/lib/validate.js');
const integ = await import('../src/lib/integrations.js');

describe('integrationCreate schema', () => {
  it('accepts a github connection', () => {
    const r = schemas.integrationCreate.safeParse({ provider: 'github', name: 'ci', token: 'x'.repeat(10) });
    assert.equal(r.success, true);
  });
  it('rejects unknown provider', () => {
    assert.equal(schemas.integrationCreate.safeParse({ provider: 'dropbox', name: 'x' }).success, false);
  });
  it('rejects empty name', () => {
    assert.equal(schemas.integrationCreate.safeParse({ provider: 'slack', name: '' }).success, false);
  });
});

describe('provider catalog', () => {
  it('exposes github, docker-registry, slack, webhook', () => {
    for (const id of ['github', 'docker-registry', 'slack', 'webhook']) {
      assert.ok(integ.PROVIDERS[id], id);
      assert.ok(integ.PROVIDERS[id].fields.length > 0);
    }
  });
});

describe('verifyConnection input validation (no network)', () => {
  it('rejects unknown provider', async () => {
    await assert.rejects(() => integ.verifyConnection('nope', {}), /Unknown provider/);
  });
  it('requires github token before fetching', async () => {
    await assert.rejects(() => integ.verifyConnection('github', { token: '' }), /required/);
  });
  it('requires slack webhook before fetching', async () => {
    await assert.rejects(() => integ.verifyConnection('slack', {}), /required/);
  });
  it('rejects non-http registry url before fetching', async () => {
    await assert.rejects(
      () => integ.verifyConnection('docker-registry', { baseUrl: 'ftp://x', username: 'u' }),
      /http\(s\)/,
    );
  });
});

describe('secret masking', () => {
  it('never leaks token/password, shows last4 hints', () => {
    const m = integ.maskConnection({
      id: '1', provider: 'github', name: 'ci', token: 'ghp_abcdefgh1234',
      status: 'ok', createdAt: 't', updatedAt: 't',
    });
    assert.equal(m.hasSecrets, true);
    assert.ok(!JSON.stringify(m).includes('ghp_abcdefgh1234'));
    assert.deepEqual(m.secretHint, [{ field: 'token', hint: '••••1234' }]);
  });
});

describe('connection store round-trip', () => {
  it('saves and loads with 0600 permissions', () => {
    const list = [{ id: 'a', provider: 'webhook', name: 'w', webhookUrl: 'https://x' }];
    integ.saveConnections(list);
    assert.deepEqual(integ.loadConnections(), list);
    const st = fs.statSync(path.join(tmpData, 'integrations.json'));
    assert.equal(st.mode & 0o777, 0o600);
  });
  it('returns [] when store is missing or corrupt', () => {
    fs.rmSync(path.join(tmpData, 'integrations.json'));
    assert.deepEqual(integ.loadConnections(), []);
    fs.writeFileSync(path.join(tmpData, 'integrations.json'), 'not json{{{');
    assert.deepEqual(integ.loadConnections(), []);
  });
});
