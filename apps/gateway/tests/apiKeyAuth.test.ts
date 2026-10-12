import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { buildApp } from '../src/app.js';
import { generateApiKey } from '../src/security/apiKeys.js';
import type { ApiKeyRecord } from '../src/security/apiKeyAuth.js';

test('AegisGate API authentication', async (t) => {
  // Simulated upstream server.
  const upstream = Fastify();

  upstream.get('/products', async (request) => ({
    service: 'mock-catalog',
    apiKeyForwarded: request.headers['x-api-key'] !== undefined,
    authorizationForwarded: request.headers.authorization !== undefined,
    cookieForwarded: request.headers.cookie !== undefined
  }));

  const upstreamAddress = await upstream.listen({
    host: '127.0.0.1',
    port: 0
  });

  const key = generateApiKey();

  const record: ApiKeyRecord = {
    key_hash: key.hash,
    revoked_at: null,
    client_id: 'test-client',
    client_status: 'active'
  };

  const gateway = buildApp({
    catalogUpstream: upstreamAddress,
    keyLookup: async (keyId) =>
      keyId === key.id ? record : null
  });

  t.after(async () => {
    await gateway.close();
    await upstream.close();
  });

  const url = '/api/catalog/products';

  await t.test('health is public', async () => {
    const response = await gateway.inject({
      method: 'GET',
      url: '/health/live'
    });
    assert.equal(response.statusCode, 200);
  });

  await t.test('missing key returns 401', async () => {
    const response = await gateway.inject({
      method: 'GET',
      url
    });
    assert.equal(response.statusCode, 401);
  });

  await t.test('invalid format returns 401', async () => {
    const response = await gateway.inject({
      method: 'GET',
      url,
      headers: {
        'x-api-key': 'invalid'
      }
    });
    assert.equal(response.statusCode, 401);
  });

  await t.test('unknown key returns 401', async () => {
    const unknownKey = generateApiKey();
    const response = await gateway.inject({
      method: 'GET',
      url,
      headers: {
        'x-api-key': unknownKey.token
      }
    });
    assert.equal(response.statusCode, 401);
  });

  await t.test('incorrect secret returns 401', async () => {
    const replacement = key.token.endsWith('A') ? 'B' : 'A';
    const invalidToken = key.token.slice(0, -1) + replacement;
    const response = await gateway.inject({
      method: 'GET',
      url,
      headers: {
        'x-api-key': invalidToken
      }
    });
    assert.equal(response.statusCode, 401);
  });

  await t.test(
    'valid credentials are accepted and stripped',
    async () => {
      const response = await gateway.inject({
        method: 'GET',
        url,
        headers: {
          'x-api-key': key.token,
          authorization: 'Bearer test-token',
          cookie: 'session=test'
        }
      });
      assert.equal(response.statusCode, 200);
      const body = response.json();
      assert.equal(body.service, 'mock-catalog');
      assert.equal(body.apiKeyForwarded, false);
      assert.equal(body.authorizationForwarded, false);
      assert.equal(body.cookieForwarded, false);
    }
  );

  await t.test('revoked key returns 401', async () => {
    record.revoked_at = new Date();
    const response = await gateway.inject({
      method: 'GET',
      url,
      headers: {
        'x-api-key': key.token
      }
    });
    assert.equal(response.statusCode, 401);
    record.revoked_at = null;
  });

  await t.test('suspended client returns 403', async () => {
    record.client_status = 'suspended';
    const response = await gateway.inject({
      method: 'GET',
      url,
      headers: {
        'x-api-key': key.token
      }
    });
    assert.equal(response.statusCode, 403);
    record.client_status = 'active';
  });

  await t.test('database failure returns 503', async () => {
    const unavailableGateway = buildApp({
      catalogUpstream: upstreamAddress,
      keyLookup: async () => {
        throw new Error('Simulated database outage');
      }
    });

    try {
      const response = await unavailableGateway.inject({
        method: 'GET',
        url,
        headers: {
          'x-api-key': key.token
        }
      });
      assert.equal(response.statusCode, 503);
      assert.equal(
        response.json().error,
        'AUTH_SERVICE_UNAVAILABLE'
      );
    } finally {
      await unavailableGateway.close();
    }
  });
});
