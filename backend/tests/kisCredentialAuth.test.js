import assert from 'node:assert/strict';
import test from 'node:test';
import { useTempDb, bootstrapDb, createUser } from './_helpers/dbHarness.js';

const tmp = useTempDb();
const db = await bootstrapDb();
const credentialService = await import('../src/services/kisCredentialService.js');
const authService = await import('../src/services/kisAuthService.js');
const repository = await import('../src/repositories/kisCredentialsRepository.js');

const alice = createUser(db, 'alice-kis@example.com');

test.after(() => tmp.cleanup());

test('KIS credential settings return only safe fields', () => {
  const result = credentialService.saveSettings(alice.id, {
    appKey: 'app-key-123456',
    appSecret: 'secret-value-123456'
  });

  assert.equal(result.configured, true);
  assert.equal('environment' in result, false);
  assert.match(result.appKeyMasked, /^app-/);
  assert.equal('appSecret' in result, false);
  assert.equal('accessToken' in result, false);

  const row = repository.getByUserId(alice.id);
  assert.notEqual(row.appSecretEncrypted, 'secret-value-123456');
  assert.notEqual(row.appKeyEncrypted, 'app-key-123456');
});

test('KIS auth test issues token with safe response and stores encrypted token', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    assert.ok(String(url).endsWith('/oauth2/tokenP'));
    const body = JSON.parse(init.body);
    assert.equal(body.appkey, 'app-key-123456');
    assert.equal(body.appsecret, 'secret-value-123456');
    return { ok: true, status: 200, json: async () => ({ access_token: 'token-raw-123', expires_in: 3600 }) };
  };
  try {
    const result = await authService.testConnection(alice.id);
    assert.equal(result.ok, true);
    assert.equal(result.status, 'TOKEN_VALID');
    assert.equal('accessToken' in result, false);
    const row = repository.getByUserId(alice.id);
    assert.ok(row.accessTokenEncrypted);
    assert.notEqual(row.accessTokenEncrypted, 'token-raw-123');
  } finally {
    globalThis.fetch = original;
  }
});

test('KIS auth failure returns sanitized message', async () => {
  authService.clearTokenCache(alice.id);
  const original = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: false,
    status: 401,
    json: async () => ({ msg1: 'bad secret token-raw-123' })
  });
  try {
    const result = await authService.testConnection(alice.id);
    assert.equal(result.ok, false);
    assert.match(result.message, /KIS access token 발급에 실패/);
    assert.doesNotMatch(result.message, /token-raw-123|secret-value/);
  } finally {
    globalThis.fetch = original;
  }
});
