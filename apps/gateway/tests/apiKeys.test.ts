import assert from 'node:assert/strict';
import test from 'node:test';

import {
  generateApiKey,
  getApiKeyId,
  hashApiKey,
  verifyApiKeyHash
} from '../src/security/apiKeys.js';

test('generates unique API keys', () => {
  const first = generateApiKey();
  const second = generateApiKey();

  assert.notEqual(first.token, second.token);
  assert.notEqual(first.id, second.id);
});

test('extracts the correct key UUID', () => {
  const key = generateApiKey();

  assert.equal(getApiKeyId(key.token), key.id);

  assert.equal(getApiKeyId('invalid-key'), null);
});

test('validates stored key hashes', () => {
  const key = generateApiKey();

  assert.equal(verifyApiKeyHash(key.token, key.hash), true);

  assert.equal(
    verifyApiKeyHash(key.token + 'invalid', key.hash),
    false
  );
});

test('does not store plaintext secrets', () => {
  const key = generateApiKey();

  assert.equal(key.hash.length, 64);
  assert.notEqual(key.token, key.hash);
  assert.equal(hashApiKey(key.token), key.hash);
});
