import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, rmSync } from 'fs';

const TEST_USERS = 'data/test-panel-users.json';

describe('auth', () => {
  before(() => {
    process.env.PANEL_USERS_PATH = TEST_USERS;
    process.env.JWT_SECRET = 'test-jwt-secret-for-ci-please-change';
    if (existsSync(TEST_USERS)) rmSync(TEST_USERS);
  });

  it('create and verify user', async () => {
    const { createPanelUser, verifyPanelUser, signToken, verifyToken } = await import('../src/lib/auth.js');
    const u = await createPanelUser({ username: 'testadmin', password: 'TestPass123!', role: 'admin' });
    assert.equal(u.username, 'testadmin');
    const ok = await verifyPanelUser('testadmin', 'TestPass123!');
    assert.ok(ok);
    assert.equal(ok.role, 'admin');
    const bad = await verifyPanelUser('testadmin', 'wrong');
    assert.equal(bad, null);
    const token = signToken({ sub: 'testadmin', username: 'testadmin', role: 'admin' });
    assert.ok(token);
    const decoded = verifyToken(token);
    assert.equal(decoded.username, 'testadmin');
  });

  it('rejects duplicate user', async () => {
    const { createPanelUser } = await import('../src/lib/auth.js');
    await assert.rejects(() => createPanelUser({ username: 'testadmin', password: 'Another123!', role: 'viewer' }));
  });
});
