import assert from 'node:assert/strict';
import test from 'node:test';

import Fastify from 'fastify';
import { SignJWT } from 'jose';

import { buildApp } from '../src/app.js';

import {
  generateApiKey
} from '../src/security/apiKeys.js';

import type {
  ApiKeyRecord
} from '../src/security/apiKeyAuth.js';

import {
  ADMIN_JWT_AUDIENCE,
  ADMIN_JWT_ISSUER,
  ADMIN_JWT_SUBJECT,
  getAdminJwtKey
} from '../src/security/adminJwt.js';

async function makeAdminToken(
  role: string = 'admin'
) {
  return new SignJWT({ role })
    .setProtectedHeader({
      alg: 'HS256',
      typ: 'JWT'
    })
    .setIssuer(ADMIN_JWT_ISSUER)
    .setAudience(ADMIN_JWT_AUDIENCE)
    .setSubject(ADMIN_JWT_SUBJECT)
    .setIssuedAt()
    .setExpirationTime('15m')
    .sign(getAdminJwtKey());
}

test('AegisGate security boundary tests', async (t) => {
  const upstream = Fastify();

  // Simulate an internal backend.
  // Only report whether sensitive headers arrived.
  upstream.get('/products', async (request) => ({
    service: 'security-test-catalog',

    leakedApiKey:
      request.headers['x-api-key'] !== undefined,

    leakedAuthorization:
      request.headers.authorization !== undefined,

    leakedCookie:
      request.headers.cookie !== undefined,

    leakedProxyAuthorization:
      request.headers['proxy-authorization'] !== undefined,

    leakedIdentity:
      request.headers['x-aegis-client-id'] !== undefined
  }));

  const upstreamAddress = await upstream.listen({
    host: '127.0.0.1',
    port: 0
  });

  const keyA = generateApiKey();
  const keyB = generateApiKey();

  // Mock database records.
  const records = new Map<string, ApiKeyRecord>([
    [
      keyA.id,
      {
        key_hash: keyA.hash,
        revoked_at: null,
        client_id: 'client-a',
        client_status: 'active'
      }
    ],
    [
      keyB.id,
      {
        key_hash: keyB.hash,
        revoked_at: null,
        client_id: 'client-b',
        client_status: 'active'
      }
    ]
  ]);

  const app = buildApp({
    catalogUpstream: upstreamAddress,

    keyLookup: async (keyId) =>
      records.get(keyId) ?? null
  });

  t.after(async () => {
    await app.close();
    await upstream.close();
  });

  const catalogUrl = '/api/catalog/products';
  const adminUrl = '/admin/v1/whoami';

  // TEST 1
  await t.test(
    'Missing API key is rejected',
    async () => {
      const response = await app.inject({
        method: 'GET',
        url: catalogUrl
      });

      assert.equal(response.statusCode, 401);
    }
  );

  // TEST 2
  await t.test(
    'Malformed API key is rejected',
    async () => {
      const response = await app.inject({
        method: 'GET',
        url: catalogUrl,
        headers: {
          'x-api-key': 'malformed-token'
        }
      });

      assert.equal(response.statusCode, 401);
    }
  );

  // TEST 3
  await t.test(
    'Unknown client credential is rejected',
    async () => {
      const unknown = generateApiKey();

      const response = await app.inject({
        method: 'GET',
        url: catalogUrl,
        headers: {
          'x-api-key': unknown.token
        }
      });

      assert.equal(response.statusCode, 401);
    }
  );

  // TEST 4
  await t.test(
    'Client A cannot authenticate using client B secret',
    async () => {
      const secretStart =
        'ag_dev_'.length + 36 + 1;

      const mixedToken =
        keyA.token.slice(0, secretStart) +
        keyB.token.slice(secretStart);

      const response = await app.inject({
        method: 'GET',
        url: catalogUrl,
        headers: {
          'x-api-key': mixedToken
        }
      });

      assert.equal(response.statusCode, 401);
    }
  );

  // TEST 5
  await t.test(
    'Valid client A credentials are accepted',
    async () => {
      const response = await app.inject({
        method: 'GET',
        url: catalogUrl,
        headers: {
          'x-api-key': keyA.token
        }
      });

      assert.equal(response.statusCode, 200);

      assert.equal(
        response.json().service,
        'security-test-catalog'
      );
    }
  );

  // TEST 6
  await t.test(
    'Revoked credential is rejected',
    async () => {
      const record = records.get(keyA.id)!;

      record.revoked_at = new Date();

      try {
        const response = await app.inject({
          method: 'GET',
          url: catalogUrl,
          headers: {
            'x-api-key': keyA.token
          }
        });

        assert.equal(response.statusCode, 401);
      } finally {
        record.revoked_at = null;
      }
    }
  );

  // TEST 7
  await t.test(
    'Suspended client is rejected',
    async () => {
      const record = records.get(keyA.id)!;

      record.client_status = 'suspended';

      try {
        const response = await app.inject({
          method: 'GET',
          url: catalogUrl,
          headers: {
            'x-api-key': keyA.token
          }
        });

        assert.equal(response.statusCode, 403);
      } finally {
        record.client_status = 'active';
      }
    }
  );

  // TEST 8
  await t.test(
    'API key cannot authenticate administrator',
    async () => {
      const response = await app.inject({
        method: 'GET',
        url: adminUrl,
        headers: {
          'x-api-key': keyA.token
        }
      });

      assert.equal(response.statusCode, 401);
    }
  );

  // TEST 9
  await t.test(
    'Administrator JWT cannot replace an API key',
    async () => {
      const jwt = await makeAdminToken();

      const response = await app.inject({
        method: 'GET',
        url: catalogUrl,
        headers: {
          authorization: `Bearer ${jwt}`
        }
      });

      assert.equal(response.statusCode, 401);
    }
  );

  // TEST 10
  await t.test(
    'Non-admin JWT is rejected for administrator route',
    async () => {
      const jwt = await makeAdminToken('viewer');

      const response = await app.inject({
        method: 'GET',
        url: adminUrl,
        headers: {
          authorization: `Bearer ${jwt}`
        }
      });

      assert.equal(response.statusCode, 403);
    }
  );

  // TEST 11
  await t.test(
    'Internal identity spoofing headers are removed',
    async () => {
      const response = await app.inject({
        method: 'GET',
        url: catalogUrl,
        headers: {
          'x-api-key': keyA.token,
          'x-aegis-client-id': 'administrator',
          authorization: 'Bearer forged',
          cookie: 'session=forged',
          'proxy-authorization': 'Basic forged'
        }
      });

      assert.equal(response.statusCode, 200);

      const body = response.json();

      assert.equal(body.leakedApiKey, false);
      assert.equal(body.leakedAuthorization, false);
      assert.equal(body.leakedCookie, false);
      assert.equal(
        body.leakedProxyAuthorization,
        false
      );
      assert.equal(body.leakedIdentity, false);
    }
  );

  // TEST 12
  await t.test(
    'Unknown /api namespace is protected by default',
    async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/unregistered-resource'
      });

      assert.equal(response.statusCode, 401);
    }
  );

  // TEST 13
  await t.test(
    'Gateway liveness remains public',
    async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/health/live'
      });

      assert.equal(response.statusCode, 200);
    }
  );
});
