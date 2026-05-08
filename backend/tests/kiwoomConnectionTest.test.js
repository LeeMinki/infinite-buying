import assert from 'node:assert/strict';
import test from 'node:test';
import { useTempDb, bootstrapDb, createUser } from './_helpers/dbHarness.js';

const tmp = useTempDb();
const db = await bootstrapDb();

const credentialService = await import('../src/services/kiwoomCredentialService.js');
const authService = await import('../src/services/kiwoomAuthService.js');

const alice = createUser(db, 'alice-conn@example.com');

test.after(() => tmp.cleanup());

function withMockedFetch(handler, run) {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  return Promise.resolve()
    .then(run)
    .finally(() => {
      globalThis.fetch = original;
    });
}

function okTokenResponse(token = 'tok-good') {
  return {
    ok: true,
    status: 200,
    json: async () => ({ token, expires_in: 3600 })
  };
}

function badKeyResponse() {
  return {
    ok: false,
    status: 401,
    json: async () => ({ return_msg: '잘못된 App Key 입니다.' })
  };
}

test('connection test fails when Kiwoom rejects the saved keys', async () => {
  credentialService.saveSettings(alice.id, { appKey: 'badkey', secretKey: 'badsecret' });
  await withMockedFetch(async () => badKeyResponse(), async () => {
    const result = await authService.testConnection(alice.id);
    assert.equal(result.ok, false);
    assert.equal(result.status, 'TOKEN_ERROR');
    assert.match(result.message, /실패|잘못된/);
  });
});

test('connection test succeeds with valid keys and caches the token', async () => {
  credentialService.saveSettings(alice.id, { appKey: 'goodkey', secretKey: 'goodsecret' });
  await withMockedFetch(async () => okTokenResponse('tok-A'), async () => {
    const result = await authService.testConnection(alice.id);
    assert.equal(result.ok, true);
    assert.equal(result.status, 'TOKEN_VALID');
  });
});

test('saving new keys invalidates the cached token so connection test re-authenticates', async () => {
  // Replace previously-valid keys with new ones; a stale cached token must NOT
  // be reused. The next test call must hit Kiwoom with the new keys.
  credentialService.saveSettings(alice.id, { appKey: 'badkey-2', secretKey: 'badsecret-2' });
  let calls = 0;
  await withMockedFetch(async (url, init) => {
    calls += 1;
    const body = JSON.parse(init.body);
    assert.equal(body.appkey, 'badkey-2', 'must use freshly saved keys, not stale cached token');
    return badKeyResponse();
  }, async () => {
    const result = await authService.testConnection(alice.id);
    assert.equal(result.ok, false);
  });
  assert.equal(calls, 1, 'Kiwoom must be called once with the new keys');
});

test('testConnection without saved credentials reports a clear error', async () => {
  credentialService.deleteSettings(alice.id);
  const result = await authService.testConnection(alice.id);
  assert.equal(result.ok, false);
  assert.match(result.message, /등록되어 있지 않/);
});
