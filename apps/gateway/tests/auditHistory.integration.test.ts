import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { SignJWT } from 'jose';

import { buildApp } from '../src/app.js';
import { dbPool } from '../src/db/pool.js';
import { withTransaction } from '../src/db/transaction.js';

import {
  ADMIN_JWT_AUDIENCE,
  ADMIN_JWT_ISSUER,
  ADMIN_JWT_SUBJECT,
  getAdminJwtKey
} from '../src/security/adminJwt.js';

async function createAdminToken() {
  return new SignJWT({ role: 'admin' })
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

test(
  'Audit history and transactional integrity',
  async (t) => {
    const app = buildApp();
    const token = await createAdminToken();

    const headers = {
      authorization: `Bearer ${token}`
    };

    t.after(async () => {
      await app.close();
      await dbPool.end();
    });

    await t.test(
      'Unauthenticated history is rejected',
      async () => {
        const response = await app.inject({
          method: 'GET',
          url: '/admin/v1/audit-logs'
        });

        assert.equal(response.statusCode, 401);
      }
    );

    await t.test(
      'Admin can retrieve audit history',
      async () => {
        const response = await app.inject({
          method: 'GET',
          url: '/admin/v1/audit-logs?limit=5',
          headers
        });

        assert.equal(response.statusCode, 200);

        const body = response.json();

        assert.ok(Array.isArray(body.items));
        assert.equal(body.page.limit, 5);
      }
    );

    await t.test(
      'Audit responses discourage caching',
      async () => {
        const response = await app.inject({
          method: 'GET',
          url: '/admin/v1/audit-logs',
          headers
        });

        assert.equal(
          response.headers['cache-control'],
          'no-store, private'
        );
      }
    );

    await t.test(
      'Invalid page size returns 400',
      async () => {
        const response = await app.inject({
          method: 'GET',
          url: '/admin/v1/audit-logs?limit=1000',
          headers
        });

        assert.equal(response.statusCode, 400);
      }
    );

    await t.test(
      'Invalid cursor returns 400',
      async () => {
        const response = await app.inject({
          method: 'GET',
          url: '/admin/v1/audit-logs?cursor=invalid',
          headers
        });

        assert.equal(response.statusCode, 400);
      }
    );

    await t.test(
      'Action filtering returns only matching events',
      async () => {
        const response = await app.inject({
          method: 'GET',
          url: '/admin/v1/audit-logs?action=api_key.revoked',
          headers
        });

        assert.equal(response.statusCode, 200);

        const body = response.json();

        for (const item of body.items) {
          assert.equal(
            item.action,
            'api_key.revoked'
          );
        }
      }
    );

    await t.test(
      'Cursor pagination does not repeat records',
      async () => {
        const firstResponse = await app.inject({
          method: 'GET',
          url: '/admin/v1/audit-logs?limit=2',
          headers
        });

        assert.equal(firstResponse.statusCode, 200);

        const first = firstResponse.json();

        // Existing development audit events are
        // required for this integration scenario.
        assert.equal(first.items.length, 2);
        assert.ok(first.page.nextCursor);

        const cursor = first.page.nextCursor;

        const secondResponse = await app.inject({
          method: 'GET',
          url: `/admin/v1/audit-logs?limit=2&cursor=${cursor}`,
          headers
        });

        assert.equal(secondResponse.statusCode, 200);

        const second = secondResponse.json();

        for (const item of second.items) {
          assert.ok(
            BigInt(item.id) < BigInt(cursor)
          );
        }

        const firstIds = new Set(
          first.items.map(
            (item: { id: string }) => item.id
          )
        );

        for (const item of second.items) {
          assert.equal(
            firstIds.has(item.id),
            false
          );
        }
      }
    );

    await t.test(
      'Failed audit insert rolls back client creation',
      async () => {
        const clientId = randomUUID();
        const name = `rollback-test-${clientId.slice(0, 8)}`;

        // Deliberately violate the NOT NULL
        // constraint on audit_logs.actor.
        await assert.rejects(
          withTransaction(async (tx) => {
            await tx.query(
              `INSERT INTO clients (id, name)
               VALUES ($1, $2)`,
              [clientId, name]
            );

            await tx.query(
              `INSERT INTO audit_logs
                 (actor, action, resource_type)
               VALUES (NULL, $1, $2)`,
              ['rollback.test', 'client']
            );
          })
        );

        const result = await dbPool.query(
          `SELECT id
           FROM clients
           WHERE id = $1`,
          [clientId]
        );

        assert.equal(result.rowCount, 0);
      }
    );
  }
);
