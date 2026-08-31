import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { schemas } from '../src/lib/validate.js';

describe('validate schemas', () => {
  it('createSite rejects invalid name', () => {
    const r = schemas.createSite.safeParse({ name: 'bad/name', serverName: 'example.com' });
    assert.equal(r.success, false);
  });
  it('createSite accepts valid', () => {
    const r = schemas.createSite.safeParse({ name: 'my-site_1', serverName: 'example.com' });
    assert.equal(r.success, true);
  });
  it('createDatabase rejects bad chars', () => {
    const r = schemas.createDatabase.safeParse({ name: 'bad-name;' });
    assert.equal(r.success, false);
  });
  it('createUser requires password', () => {
    const r = schemas.createUser.safeParse({ name: 'bob', password: 'short' });
    assert.equal(r.success, false); // too short
  });
  it('login requires fields', () => {
    assert.equal(schemas.login.safeParse({ username: '', password: 'x' }).success, false);
    assert.equal(schemas.login.safeParse({ username: 'admin', password: 'secret' }).success, true);
  });
  it('createContainer requires image', () => {
    assert.equal(schemas.createContainer.safeParse({ image: '' }).success, false);
    assert.equal(schemas.createContainer.safeParse({ image: 'nginx:alpine' }).success, true);
  });
});
