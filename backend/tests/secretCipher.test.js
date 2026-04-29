import assert from 'node:assert/strict';
import test from 'node:test';
import { encryptSecret, decryptSecret } from '../src/crypto/secretCipher.js';
import { maskAppKey } from '../src/crypto/mask.js';
import { redact } from '../src/lib/logger.js';

test('encrypts and decrypts secrets without storing plaintext', () => {
  const encrypted = encryptSecret('plain-secret-value');
  assert.notEqual(encrypted, 'plain-secret-value');
  assert.equal(decryptSecret(encrypted), 'plain-secret-value');
});

test('masks app key for safe display', () => {
  assert.equal(maskAppKey('abcd1234wxyz'), 'abcd****wxyz');
});

test('redacts sensitive log fields recursively', () => {
  const result = redact({
    password: 'pw',
    appKey: 'app',
    nested: { accessToken: 'token', normal: 'ok' }
  });
  assert.equal(result.password, '[REDACTED]');
  assert.equal(result.appKey, '[REDACTED]');
  assert.equal(result.nested.accessToken, '[REDACTED]');
  assert.equal(result.nested.normal, 'ok');
});
