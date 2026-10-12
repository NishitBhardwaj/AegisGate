import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { SignJWT } from 'jose';

import { buildApp } from '../src/app.js';
import { dbPool } from '../src/db/pool.js';

import {
  ADMIN_JWT_AUDIENCE,
  ADMIN_JWT_ISSUER,
  ADMIN_JWT_SUBJECT,
  getAdminJwtKey
} from '../src/security/adminJwt.js';

test(
  'AegisGate admin concurrency and transaction safety',
  { timeout: 90_000 },
  async (t) => {
    // These tests write to the development database.
    if (
      process.env.NODE_ENV === 'production' ||
      process.env.AEGIS_ALLOW_DB_CONCURRENCY_TESTS !== '1'
    ) {
      throw new Error(
        'Concurrency tests require explicit development opt-in.'
      );
    }

    // Verify that testing uses the restricted runtime role.
    const identity = await dbPool.query<{
      runtime_user: string;
      db_name: string;
    }>(
      `SELECT
         current_user AS runtime_user,
         current_database() AS db_name`
    );

    assert.equal(
      identity.rows[0].runtime_user,
      'aegisgate_runtime'
    );

    assert.equal(
      identity.rows[0].db_name,
      'aegisgate'
    );

    const app = buildApp();

    const jwt = await new SignJWT({ role: 'admin' })
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

    const headers = {
      authorization: `Bearer ${jwt}`
    };

    const fixtures: string[] = [];

    async function createClient(tag: string) {
      const name =
        `${tag}-${randomUUID().slice(0, 8)}`;

      const response = await app.inject({
        method: 'POST',
        url: '/admin/v1/clients',
        headers,
        payload: { name }
      });

      assert.equal(response.statusCode, 201);

      const clientId: string =
        response.json().client.id;

      fixtures.push(clientId);
      return clientId;
    }

    function issueKey(clientId: string) {
      return app.inject({
        method: 'POST',
        url: `/admin/v1/clients/${clientId}/keys`,
        headers
      });
    }

    function suspendClient(clientId: string) {
      return app.inject({
        method: 'PATCH',
        url: `/admin/v1/clients/${clientId}/status`,
        headers,
        payload: {
          status: 'suspended'
        }
      });
    }

    function revokeKey(keyId: string) {
      return app.inject({
        method: 'DELETE',
        url: `/admin/v1/keys/${keyId}`,
        headers
      });
    }

    async function auditCount(
      action: string,
      clientId: string
    ): Promise<number> {
      const result = await dbPool.query<{
        total: number;
      }>(
        `SELECT COUNT(*)::int AS total
         FROM audit_logs
         WHERE action = $1
           AND details->>'clientId' = $2`,
        [action, clientId]
      );

      return result.rows[0].total;
    }

    async function keyCount(
      clientId: string
    ): Promise<number> {
      const result = await dbPool.query<{
        total: number;
      }>(
        `SELECT COUNT(*)::int AS total
         FROM api_keys
         WHERE client_id = $1`,
        [clientId]
      );

      return result.rows[0].total;
    }

    // Best-effort safety cleanup using audited admin routes.
    // Test clients remain in development DB because runtime
    // does not have permission to DELETE clients.
    t.after(async () => {
      try {
        for (const clientId of fixtures) {
          const activeKeys = await dbPool.query<{
            id: string;
          }>(
            `SELECT id
             FROM api_keys
             WHERE client_id = $1
               AND revoked_at IS NULL`,
            [clientId]
          );

          for (const key of activeKeys.rows) {
            const result = await revokeKey(key.id);

            assert.ok(
              [200, 404].includes(result.statusCode),
              'Test key cleanup failed'
            );
          }

          const suspended =
            await suspendClient(clientId);

          assert.equal(
            suspended.statusCode,
            200,
            'Test client cleanup failed'
          );
        }
      } finally {
        await app.close();
        await dbPool.end();
      }
    });

    // -------------------------------------------------
    // TEST 1: Key issuance racing with suspension
    // -------------------------------------------------

    await t.test(
      'Concurrent issuance and suspension preserve safety',
      async () => {
        const clientId =
          await createClient('RaceTest');

        // Establish one guaranteed issuance success.
        const initial = await issueKey(clientId);

        assert.equal(initial.statusCode, 201);

        const issued = [{
          id: initial.json().id as string,
          token: initial.json().apiKey as string
        }];

        const requests = Array.from(
          { length: 12 },
          () => issueKey(clientId)
        );

        // Execute the suspension concurrently.
        const responses = await Promise.all([
          ...requests,
          suspendClient(clientId)
        ]);

        const suspension = responses.pop()!;

        assert.equal(suspension.statusCode, 200);

        for (const response of responses) {
          // Either outcome is valid depending on which
          // transaction acquires the row lock first.
          assert.ok(
            [201, 403].includes(response.statusCode),
            `Unexpected issuance status: ${response.statusCode}`
          );

          if (response.statusCode === 201) {
            issued.push({
              id: response.json().id,
              token: response.json().apiKey
            });
          }
        }

        const statusResult = await dbPool.query<{
          status: string;
        }>(
          `SELECT status
           FROM clients
           WHERE id = $1`,
          [clientId]
        );

        assert.equal(
          statusResult.rows[0].status,
          'suspended'
        );

        // Every successfully issued key must have
        // a matching committed row and audit event.
        assert.equal(
          await keyCount(clientId),
          issued.length
        );

        assert.equal(
          await auditCount(
            'api_key.issued',
            clientId
          ),
          issued.length
        );

        assert.equal(
          await auditCount(
            'client.status_changed',
            clientId
          ),
          1
        );

        // Once suspension has completed, every issued
        // credential must be rejected.
        for (const key of issued) {
          const response = await app.inject({
            method: 'GET',
            url: '/api/catalog/products',
            headers: {
              'x-api-key': key.token
            }
          });

          assert.equal(response.statusCode, 403);
        }

        // New issuance after suspension must fail.
        const afterSuspension =
          await issueKey(clientId);

        assert.equal(
          afterSuspension.statusCode,
          403
        );
      }
    );

    // -------------------------------------------------
    // TEST 2: Simultaneous suspension requests
    // -------------------------------------------------

    await t.test(
      'Concurrent suspension is effectively idempotent',
      async () => {
        const clientId =
          await createClient('SuspendTest');

        const responses = await Promise.all(
          Array.from(
            { length: 8 },
            () => suspendClient(clientId)
          )
        );

        for (const response of responses) {
          assert.equal(
            response.statusCode,
            200
          );
        }

        const changes = responses.filter(
          response =>
            response.json().changed === true
        );

        // The client starts active, so exactly one
        // request should produce a real transition.
        assert.equal(changes.length, 1);

        assert.equal(
          await auditCount(
            'client.status_changed',
            clientId
          ),
          1
        );

        const status = await dbPool.query<{
          status: string;
        }>(
          `SELECT status
           FROM clients
           WHERE id = $1`,
          [clientId]
        );

        assert.equal(
          status.rows[0].status,
          'suspended'
        );
      }
    );

    // -------------------------------------------------
    // TEST 3: Simultaneous revocation requests
    // -------------------------------------------------

    await t.test(
      'Concurrent revocation succeeds exactly once',
      async () => {
        const clientId =
          await createClient('RevokeTest');

        const created =
          await issueKey(clientId);

        assert.equal(
          created.statusCode,
          201
        );

        const keyId: string =
          created.json().id;

        const responses = await Promise.all(
          Array.from(
            { length: 8 },
            () => revokeKey(keyId)
          )
        );

        const successful = responses.filter(
          response =>
            response.statusCode === 200
        );

        const alreadyRevoked = responses.filter(
          response =>
            response.statusCode === 404
        );

        assert.equal(successful.length, 1);
        assert.equal(alreadyRevoked.length, 7);

        assert.equal(
          await auditCount(
            'api_key.revoked',
            clientId
          ),
          1
        );

        const keyState = await dbPool.query<{
          revoked: boolean;
        }>(
          `SELECT
             revoked_at IS NOT NULL AS revoked
           FROM api_keys
           WHERE id = $1`,
          [keyId]
        );

        assert.equal(
          keyState.rows[0].revoked,
          true
        );

        // Verify the revoked credential is denied.
        const response = await app.inject({
          method: 'GET',
          url: '/api/catalog/products',
          headers: {
            'x-api-key': created.json().apiKey
          }
        });

        assert.equal(response.statusCode, 401);
      }
    );
  }
);
