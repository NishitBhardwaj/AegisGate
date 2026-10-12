import assert from 'node:assert/strict';
import test from 'node:test';

import { SignJWT } from 'jose';

import { buildApp } from '../src/app.js';

import {
  ADMIN_JWT_AUDIENCE,
  ADMIN_JWT_ISSUER,
  ADMIN_JWT_SUBJECT,
  getAdminJwtKey
} from '../src/security/adminJwt.js';

async function issueToken(
  options: {
    role?: string;
    issuer?: string;
    audience?: string;
    expired?: boolean;
    secret?: Uint8Array;
  } = {}
) {
  const now = Math.floor(Date.now() / 1000);

  return new SignJWT({
    role: options.role ?? 'admin'
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(options.issuer ?? ADMIN_JWT_ISSUER)
    .setAudience(options.audience ?? ADMIN_JWT_AUDIENCE)
    .setSubject(ADMIN_JWT_SUBJECT)
    .setIssuedAt(options.expired ? now - 3600 : now)
    .setExpirationTime(
      options.expired ? now - 1800 : now + 900
    )
    .sign(options.secret ?? getAdminJwtKey());
}

test('AegisGate administrator authorization', async (t) => {
  const app = buildApp();

  t.after(async () => {
    await app.close();
  });

  const url = '/admin/v1/whoami';

  async function check(
    token: string | undefined,
    expectedStatus: number
  ) {
    const response = await app.inject({
      method: 'GET',
      url,
      headers: token
        ? { authorization: `Bearer ${token}` }
        : {}
    });

    assert.equal(response.statusCode, expectedStatus);
    return response;
  }

  await t.test('missing token returns 401', async () => {
    await check(undefined, 401);
  });

  await t.test('invalid token returns 401', async () => {
    await check('invalid.token.value', 401);
  });

  await t.test('incorrect signature returns 401', async () => {
    const forged = await issueToken({
      secret: new Uint8Array(32).fill(1)
    });

    await check(forged, 401);
  });

  await t.test('incorrect issuer returns 401', async () => {
    await check(
      await issueToken({ issuer: 'other-issuer' }),
      401
    );
  });

  await t.test('incorrect audience returns 401', async () => {
    await check(
      await issueToken({ audience: 'other-api' }),
      401
    );
  });

  await t.test('expired token returns 401', async () => {
    await check(
      await issueToken({ expired: true }),
      401
    );
  });

  await t.test('non-admin role returns 403', async () => {
    await check(
      await issueToken({ role: 'viewer' }),
      403
    );
  });

  await t.test('valid admin token returns 200', async () => {
    const response = await check(
      await issueToken(),
      200
    );

    assert.equal(response.json().role, 'admin');
  });

  await t.test('health remains public', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health/live'
    });

    assert.equal(response.statusCode, 200);
  });

  await t.test('admin JWT does not replace an API key', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/catalog/products',
      headers: {
        authorization: `Bearer ${await issueToken()}`
      }
    });

    assert.equal(response.statusCode, 401);
  });
});
